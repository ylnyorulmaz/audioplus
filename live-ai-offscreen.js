import { startLiveAi, stopLiveAi, LIVE_AI_LIMITS } from './live-ai-controller.js';

const controllers = new Map();
const LIVE_PREFIX = 'audioPlus.liveAi.';

function liveStateKey(tabId) { return `${LIVE_PREFIX}${tabId}`; }

async function writeStatus(tabId, status) {
  await chrome.storage.session.set({
    [liveStateKey(tabId)]: {
      ...status,
      limits: LIVE_AI_LIMITS,
      updatedAt: Date.now()
    }
  });
}

async function assertLiveRuntimePackaged() {
  const workerUrl = chrome.runtime.getURL('dist/live-ai-worker.js');
  try {
    const response = await fetch(workerUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch {
    throw new Error('Live AI runtime bundle is missing. If this is an unpacked source checkout, run npm install && npm run build, then reload Audio+ in chrome://extensions. Packaged releases include this automatically.');
  }
}

async function applyBaseSettings(tabId, settings) {
  const response = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'APPLY_SETTINGS', tabId, settings });
  if (!response?.ok) throw new Error(response?.error ?? 'Could not switch the base Audio+ graph.');
}

async function stopController(tabId, { reason = 'user', preserveStatus = false } = {}) {
  const state = controllers.get(tabId);
  if (!state) {
    if (!preserveStatus) await writeStatus(tabId, { active: false, phase: 'off', quality: 'off', reason: null, rtf: null });
    return;
  }
  controllers.delete(tabId);
  await stopLiveAi(state, { restoreBase: true, preserveStatus });
  if (!preserveStatus) await writeStatus(tabId, { active: false, phase: 'off', quality: 'off', reason: null, rtf: state.lastRtf ?? null, provider: state.executionProvider, stoppedBy: reason });
}

async function startController(tabId, streamId, originalSettings, executionProvider = 'webgpu') {
  await stopController(tabId, { reason: 'restart' });
  let stream;
  try {
    await assertLiveRuntimePackaged();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
      video: false
    });
    if (stream.getAudioTracks().length === 0) throw new DOMException('No tab audio track was returned.', 'NotFoundError');

    const state = await startLiveAi({
      stream,
      executionProvider,
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

    return { ok: true, limits: LIVE_AI_LIMITS, provider: state.executionProvider };
  } catch (error) {
    if (stream) for (const track of stream.getTracks()) track.stop();
    const reason = error?.message ?? String(error);
    await writeStatus(tabId, { active: false, phase: 'error', quality: 'fallback', reason, rtf: null, provider: executionProvider });
    return { ok: false, error: reason };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== 'live-offscreen') return;

  (async () => {
    if (message.type === 'START_LIVE_AI') {
      sendResponse(await startController(message.tabId, message.streamId, message.originalSettings ?? {}, message.executionProvider));
      return;
    }
    if (message.type === 'STOP_LIVE_AI') {
      await stopController(message.tabId, { reason: message.reason ?? 'user' });
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false, error: `Unknown live offscreen message type: ${message.type}` });
  })().catch((error) => sendResponse({ ok: false, error: error?.message ?? String(error) }));

  return true;
});
