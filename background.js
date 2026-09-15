import { DEFAULT_SETTINGS, sanitizeSettings } from './audio-settings.js';

const OFFSCREEN_PATH = 'offscreen.html';
const STATE_PREFIX = 'audioPlus.tab.';
const SETTINGS_KEY = 'audioPlus.settings';
const SETTING_KEYS = new Set(Object.keys(DEFAULT_SETTINGS));

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

function settingsFromState(state) {
  return sanitizeSettings(state);
}

function settingsPatch(patch) {
  return Object.fromEntries(
    Object.entries(patch ?? {}).filter(([key]) => SETTING_KEYS.has(key))
  );
}

async function readPersistentSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return sanitizeSettings(result[SETTINGS_KEY] ?? DEFAULT_SETTINGS);
}

async function writePersistentSettings(settings) {
  const sanitized = sanitizeSettings(settings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: sanitized });
  return sanitized;
}

async function readTabState(tabId) {
  const key = stateKey(tabId);
  const result = await chrome.storage.session.get(key);
  if (result[key]) return result[key];

  const settings = await readPersistentSettings();
  return {
    ...settings,
    enabled: false,
    error: null
  };
}

async function writeTabState(tabId, patch, { persist = true } = {}) {
  const key = stateKey(tabId);
  const current = await readTabState(tabId);
  const incomingSettings = settingsPatch(patch);
  const nextSettings = sanitizeSettings({ ...current, ...incomingSettings });
  const next = {
    ...current,
    ...nextSettings,
    ...patch
  };

  await chrome.storage.session.set({ [key]: next });

  if (persist && Object.keys(incomingSettings).length > 0) {
    await writePersistentSettings(nextSettings);
  }

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

        const current = await readTabState(message.tabId);
        const requested = sanitizeSettings({ ...current, ...(message.settings ?? {}) });
        const state = await writeTabState(message.tabId, {
          ...requested,
          enabled: false,
          error: null
        });

        const streamId = await chrome.tabCapture.getMediaStreamId({
          targetTabId: message.tabId
        });

        const result = await chrome.runtime.sendMessage({
          target: 'offscreen',
          type: 'START_CAPTURE',
          tabId: message.tabId,
          streamId,
          settings: settingsFromState(state)
        });

        if (!result?.ok) {
          const error = result?.error ?? 'Could not start audio processing.';
          await writeTabState(message.tabId, { enabled: false, error }, { persist: false });
          sendResponse({ ok: false, error });
          return;
        }

        const next = await writeTabState(
          message.tabId,
          { enabled: true, error: null },
          { persist: false }
        );
        sendResponse({ ok: true, state: next });
        return;
      }

      case 'STOP_CAPTURE': {
        await sendToOffscreen({ type: 'STOP_CAPTURE', tabId: message.tabId });
        const next = await writeTabState(
          message.tabId,
          { enabled: false, error: null },
          { persist: false }
        );
        sendResponse({ ok: true, state: next });
        return;
      }

      case 'UPDATE_SETTINGS': {
        const current = await readTabState(message.tabId);
        const requested = sanitizeSettings({ ...current, ...(message.patch ?? {}) });
        const next = await writeTabState(message.tabId, requested);

        if (next.enabled) {
          const result = await sendToOffscreen({
            type: 'APPLY_SETTINGS',
            tabId: message.tabId,
            settings: settingsFromState(next)
          });
          if (!result?.ok) throw new Error(result?.error ?? 'Could not apply audio settings.');
        }

        sendResponse({ ok: true, state: next });
        return;
      }

      case 'RESET_AUDIO': {
        const resetSettings = sanitizeSettings(DEFAULT_SETTINGS);
        const next = await writeTabState(message.tabId, resetSettings);
        if (next.enabled) {
          const result = await sendToOffscreen({
            type: 'APPLY_SETTINGS',
            tabId: message.tabId,
            settings: resetSettings
          });
          if (!result?.ok) throw new Error(result?.error ?? 'Could not reset audio settings.');
        }
        sendResponse({ ok: true, state: next });
        return;
      }

      case 'OFFSCREEN_STATUS': {
        if (message.tabId != null) {
          await writeTabState(
            message.tabId,
            {
              enabled: Boolean(message.enabled),
              error: message.error ?? null
            },
            { persist: false }
          );
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
      await writeTabState(
        info.tabId,
        {
          enabled: false,
          error: info.status === 'error' ? 'Chrome stopped tab audio capture.' : null
        },
        { persist: false }
      );
    } catch (error) {
      console.warn('[Audio+] capture status sync failed', error);
    }
  }
});
