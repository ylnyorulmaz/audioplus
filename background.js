const OFFSCREEN_PATH = 'offscreen.html';
const STATE_PREFIX = 'audioPlus.tab.';

let creatingOffscreen = null;

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });

  if (contexts.length > 0) return;

  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
      justification: 'Capture the user-selected tab audio, process it with Web Audio, and play the processed sound back.'
    }).finally(() => {
      creatingOffscreen = null;
    });
  }

  await creatingOffscreen;
}

function stateKey(tabId) {
  return `${STATE_PREFIX}${tabId}`;
}

async function readTabState(tabId) {
  const key = stateKey(tabId);
  const result = await chrome.storage.session.get(key);
  return result[key] ?? {
    enabled: false,
    bassDb: 0,
    volume: 100,
    bypass: false,
    error: null
  };
}

async function writeTabState(tabId, patch) {
  const key = stateKey(tabId);
  const current = await readTabState(tabId);
  const next = { ...current, ...patch };
  await chrome.storage.session.set({ [key]: next });
  return next;
}

async function clearTabState(tabId) {
  await chrome.storage.session.remove(stateKey(tabId));
}

async function sendToOffscreen(message) {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage({ ...message, target: 'offscreen' });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target === 'offscreen') return;

  (async () => {
    switch (message.type) {
      case 'ENSURE_OFFSCREEN': {
        await ensureOffscreenDocument();
        sendResponse({ ok: true });
        return;
      }

      case 'GET_TAB_STATE': {
        const state = await readTabState(message.tabId);
        sendResponse({ ok: true, state });
        return;
      }

      case 'START_CAPTURE': {
        await ensureOffscreenDocument();

        const state = await writeTabState(message.tabId, {
          enabled: false,
          error: null,
          bassDb: message.settings?.bassDb ?? 0,
          volume: message.settings?.volume ?? 100,
          bypass: message.settings?.bypass ?? false
        });

        const streamId = await chrome.tabCapture.getMediaStreamId({
          targetTabId: message.tabId
        });

        const result = await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'START_CAPTURE',
          tabId: message.tabId,
          streamId,
          settings: state
        });

        if (!result?.ok) {
          const error = result?.error ?? 'Could not start audio processing.';
          await writeTabState(message.tabId, { enabled: false, error });
          sendResponse({ ok: false, error });
          return;
        }

        const next = await writeTabState(message.tabId, { enabled: true, error: null });
        sendResponse({ ok: true, state: next });
        return;
      }

      case 'STOP_CAPTURE': {
        await sendToOffscreen({ type: 'STOP_CAPTURE', tabId: message.tabId });
        const next = await writeTabState(message.tabId, { enabled: false, error: null });
        sendResponse({ ok: true, state: next });
        return;
      }

      case 'SET_BASS': {
        const next = await writeTabState(message.tabId, { bassDb: message.value });
        if (next.enabled) {
          await sendToOffscreen({ type: 'SET_BASS', tabId: message.tabId, value: message.value });
        }
        sendResponse({ ok: true, state: next });
        return;
      }

      case 'SET_VOLUME': {
        const next = await writeTabState(message.tabId, { volume: message.value });
        if (next.enabled) {
          await sendToOffscreen({ type: 'SET_VOLUME', tabId: message.tabId, value: message.value });
        }
        sendResponse({ ok: true, state: next });
        return;
      }

      case 'SET_BYPASS': {
        const next = await writeTabState(message.tabId, { bypass: message.value });
        if (next.enabled) {
          await sendToOffscreen({ type: 'SET_BYPASS', tabId: message.tabId, value: message.value });
        }
        sendResponse({ ok: true, state: next });
        return;
      }

      case 'RESET_AUDIO': {
        const patch = { bassDb: 0, volume: 100, bypass: false };
        const next = await writeTabState(message.tabId, patch);
        if (next.enabled) {
          await sendToOffscreen({ type: 'APPLY_SETTINGS', tabId: message.tabId, settings: next });
        }
        sendResponse({ ok: true, state: next });
        return;
      }

      case 'OFFSCREEN_STATUS': {
        if (message.tabId != null) {
          await writeTabState(message.tabId, {
            enabled: Boolean(message.enabled),
            error: message.error ?? null
          });
        }
        sendResponse({ ok: true });
        return;
      }

      default:
        sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
    }
  })().catch((error) => {
    console.error('[Audio+] background error', error);
    sendResponse({ ok: false, error: error?.message ?? String(error) });
  });

  return true;
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    const state = await readTabState(tabId);
    if (state.enabled) {
      await sendToOffscreen({ type: 'STOP_CAPTURE', tabId });
    }
    await clearTabState(tabId);
  } catch (error) {
    console.warn('[Audio+] tab cleanup failed', error);
  }
});

chrome.tabCapture.onStatusChanged.addListener(async (info) => {
  if (info.status === 'stopped' || info.status === 'error') {
    try {
      await writeTabState(info.tabId, {
        enabled: false,
        error: info.status === 'error' ? 'Chrome stopped tab audio capture.' : null
      });
    } catch (error) {
      console.warn('[Audio+] capture status sync failed', error);
    }
  }
});
