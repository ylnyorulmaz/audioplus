import { startLiveAi, stopLiveAi, LIVE_AI_LIMITS } from './live-ai-controller.js';
import { LIVE_AI_ERROR_CODES, liveAiError, liveAiStatusFromError } from './live-ai-errors.js';

const controllers = new Map();
const LIVE_PREFIX = 'audioPlus.liveAi.';

function liveStateKey(tabId) { return `${LIVE_PREFIX}${tabId}`; }

async function writeStatus(tabId, status) {
  const payload = {
    ...status,
    limits: LIVE_AI_LIMITS,
    updatedAt: Date.now()
  };
  const response = await chrome.runtime.sendMessage({ type: 'LIVE_AI_STATUS', tabId, status: payload });
  if (response?.ok) return;

  const area = chrome.storage?.session;
  if (area?.set) {
    await area.set({ [liveStateKey(tabId)]: payload });
    return;
  }

  throw liveAiError(
    LIVE_AI_ERROR_CODES.WORKER_INIT_FAILED,
    response?.error ?? 'Audio+ could not store AI Karaoke status from the audio processor.',
    'Reload Audio+ in chrome://extensions, then try AI Karaoke again.'
  );
}

async function assertLiveRuntimePackaged() {
  // Do not Range-probe the ONNX here — Chrome can cache the partial response and break the full load.
  const required = [
    'dist/live-ai-worker.js',
    'vendor/ort/ort-wasm-simd-threaded.asyncify.wasm'
  ];
  try {
    for (const path of required) {
      const response = await fetch(chrome.runtime.getURL(path), { cache: 'no-store' });
      if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
    }
  } catch (cause) {
    throw liveAiError(
      LIVE_AI_ERROR_CODES.RUNTIME_MISSING,
      'The local AI runtime is missing from this Audio+ build.',
      'Run npm install && npm run build, reload Audio+ in chrome://extensions, then try again.',
      cause
    );
  }
}

function cloneBaseCapture(tabId) {
  const bridge = globalThis.audioPlusCaptureBridge;
  if (!bridge?.cloneBaseStream) {
    throw liveAiError(
      LIVE_AI_ERROR_CODES.BASE_CAPTURE_MISSING,
      'Audio+ could not access the existing tab audio stream.',
      'Reload the extension, turn Audio+ off and on for this tab, then retry AI Karaoke.'
    );
  }
  try {
    return bridge.cloneBaseStream(tabId);
  } catch (cause) {
    const ended = /ended/i.test(cause?.message ?? '');
    throw liveAiError(
      ended ? LIVE_AI_ERROR_CODES.BASE_CAPTURE_ENDED : LIVE_AI_ERROR_CODES.BASE_CAPTURE_MISSING,
      ended ? 'The tab audio stream ended before AI Karaoke could start.' : 'Audio+ could not reuse the active tab audio stream.',
      'Turn Audio+ off and on once for this tab, then retry AI Karaoke.',
      cause
    );
  }
}

async function applyBaseSettings(tabId, settings) {
  const response = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'APPLY_SETTINGS', tabId, settings });
  if (!response?.ok) {
    throw liveAiError(
      LIVE_AI_ERROR_CODES.RESTORE_FAILED,
      response?.error ?? 'Could not switch the normal Audio+ graph.',
      'Turn AI Karaoke off. Normal Audio+ will remain the safe fallback.'
    );
  }
}

async function stopController(tabId, { reason = 'user', preserveStatus = false } = {}) {
  const state = controllers.get(tabId);
  if (!state) {
    if (!preserveStatus) await writeStatus(tabId, { active: false, phase: 'off', quality: 'off', reason: null, rtf: null, errorCode: null, action: null });
    return;
  }
  controllers.delete(tabId);
  await stopLiveAi(state, { restoreBase: true, preserveStatus });
  if (!preserveStatus) {
    await writeStatus(tabId, {
      active: false,
      phase: 'off',
      quality: 'off',
      reason: null,
      rtf: state.lastRtf ?? null,
      stoppedBy: reason,
      errorCode: null,
      action: null
    });
  }
}

async function startController(tabId, originalSettings) {
  await stopController(tabId, { reason: 'restart' });
  let stream;
  try {
    await assertLiveRuntimePackaged();
    stream = cloneBaseCapture(tabId);
    if (stream.getAudioTracks().length === 0) {
      throw liveAiError(
        LIVE_AI_ERROR_CODES.BASE_CAPTURE_ENDED,
        'The shared tab stream has no live audio track.',
        'Re-enable Audio+ on this tab, then retry AI Karaoke.'
      );
    }

    const state = await startLiveAi({
      stream,
      onStatus: (status) => {
        writeStatus(tabId, status).catch(console.error);
        if (status.phase === 'fallback') controllers.delete(tabId);
      },
      muteBase: () => applyBaseSettings(tabId, { volume: 0 }),
      restoreBase: () => applyBaseSettings(tabId, originalSettings)
    });
    controllers.set(tabId, state);

    for (const track of stream.getAudioTracks()) {
      track.onended = () => {
        if (controllers.get(tabId) === state) stopController(tabId, { reason: 'track-ended' }).catch(console.error);
      };
    }

    return { ok: true, limits: LIVE_AI_LIMITS, capture: 'shared-base-stream' };
  } catch (error) {
    if (stream) for (const track of stream.getTracks()) track.stop();
    const detail = liveAiStatusFromError(error);
    try {
      await writeStatus(tabId, { ...detail, rtf: null });
    } catch (statusError) {
      console.error('[Audio+] could not persist AI Karaoke error', statusError);
    }
    return { ok: false, error: detail.reason, errorCode: detail.errorCode, action: detail.action };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== 'live-offscreen') return;

  (async () => {
    if (message.type === 'START_LIVE_AI') {
      sendResponse(await startController(message.tabId, message.originalSettings ?? {}));
      return;
    }
    if (message.type === 'STOP_LIVE_AI') {
      await stopController(message.tabId, { reason: message.reason ?? 'user' });
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false, error: `Unknown live offscreen message type: ${message.type}`, errorCode: LIVE_AI_ERROR_CODES.UNKNOWN });
  })().catch(async (error) => {
    const detail = liveAiStatusFromError(error);
    if (message.tabId != null) await writeStatus(message.tabId, detail).catch(() => {});
    sendResponse({ ok: false, error: detail.reason, errorCode: detail.errorCode, action: detail.action });
  });

  return true;
});
