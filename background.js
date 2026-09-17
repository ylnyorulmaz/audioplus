import { DEFAULT_SETTINGS, sanitizeSettings } from './audio-settings.js';
import { presetSnapshot, sanitizePresetName } from './presets.js';
import { buildSmartFix } from './smart-fix.js';

const OFFSCREEN_PATH = 'offscreen.html';
const STATE_PREFIX = 'audioPlus.tab.';
const SETTINGS_KEY = 'audioPlus.settings';
const SITE_PROFILES_KEY = 'audioPlus.siteProfiles';
const CUSTOM_PRESETS_KEY = 'audioPlus.customPresets';
const MAX_CUSTOM_PRESETS = 12;
const SETTING_KEYS = new Set(Object.keys(DEFAULT_SETTINGS));

let creatingOffscreen = null;
const smartFixRuns = new Set();

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [offscreenUrl] });
  if (contexts.length > 0) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
      justification: 'Capture the user-selected tab audio, process it with Web Audio, and play the processed sound back.'
    }).finally(() => { creatingOffscreen = null; });
  }
  await creatingOffscreen;
}

function stateKey(tabId) { return `${STATE_PREFIX}${tabId}`; }

function normalizeSiteKey(value) {
  const siteKey = String(value ?? '').trim().toLowerCase();
  if (!siteKey || siteKey.length > 253) return null;
  if (!/^[a-z0-9.-]+$/.test(siteKey)) return null;
  return siteKey;
}

function siteKeyFromUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? normalizeSiteKey(parsed.hostname) : null;
  } catch {
    return null;
  }
}

function settingsFromState(state) { return sanitizeSettings(state); }

function settingsPatch(patch) {
  return Object.fromEntries(Object.entries(patch ?? {}).filter(([key]) => SETTING_KEYS.has(key)));
}

async function readGlobalSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return sanitizeSettings(result[SETTINGS_KEY] ?? DEFAULT_SETTINGS);
}

async function writeGlobalSettings(settings) {
  const safe = sanitizeSettings(settings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: safe });
  return safe;
}

async function readSiteProfiles() {
  const result = await chrome.storage.local.get(SITE_PROFILES_KEY);
  const profiles = result[SITE_PROFILES_KEY];
  return profiles && typeof profiles === 'object' && !Array.isArray(profiles) ? profiles : {};
}

async function writeSiteProfiles(profiles) { await chrome.storage.local.set({ [SITE_PROFILES_KEY]: profiles }); }

async function readCustomPresets() {
  const result = await chrome.storage.local.get(CUSTOM_PRESETS_KEY);
  const presets = result[CUSTOM_PRESETS_KEY];
  if (!Array.isArray(presets)) return [];
  return presets
    .filter((preset) => preset && typeof preset === 'object')
    .map((preset) => ({
      id: String(preset.id ?? ''),
      name: sanitizePresetName(preset.name),
      settings: presetSnapshot(preset.settings),
      createdAt: Number(preset.createdAt) || Date.now(),
      updatedAt: Number(preset.updatedAt) || Date.now()
    }))
    .filter((preset) => preset.id && preset.name)
    .slice(0, MAX_CUSTOM_PRESETS);
}

async function writeCustomPresets(presets) { await chrome.storage.local.set({ [CUSTOM_PRESETS_KEY]: presets.slice(0, MAX_CUSTOM_PRESETS) }); }

async function getSiteProfile(siteKey) {
  const normalized = normalizeSiteKey(siteKey);
  if (!normalized) return null;
  const profiles = await readSiteProfiles();
  const profile = profiles[normalized];
  if (!profile?.settings) return null;
  return { siteKey: normalized, settings: sanitizeSettings(profile.settings), updatedAt: Number(profile.updatedAt) || 0 };
}

async function isSiteProfileActive(siteKey) { return Boolean(await getSiteProfile(siteKey)); }

async function readPersistentSettings(siteKey) {
  const profile = await getSiteProfile(siteKey);
  if (profile) return profile.settings;
  return readGlobalSettings();
}

async function persistSettings(settings, siteKey) {
  const safe = sanitizeSettings(settings);
  const normalized = normalizeSiteKey(siteKey);
  if (normalized) {
    const profiles = await readSiteProfiles();
    if (profiles[normalized]) {
      profiles[normalized] = { settings: safe, updatedAt: Date.now() };
      await writeSiteProfiles(profiles);
      return safe;
    }
  }
  return writeGlobalSettings(safe);
}

async function getSessionState(tabId) {
  const key = stateKey(tabId);
  const result = await chrome.storage.session.get(key);
  return result[key] ?? null;
}

async function setSessionState(tabId, state) {
  await chrome.storage.session.set({ [stateKey(tabId)]: state });
  return state;
}

async function readTabState(tabId, siteKey = null) {
  const current = await getSessionState(tabId);
  if (current) return current;
  const normalized = normalizeSiteKey(siteKey);
  const settings = await readPersistentSettings(normalized);
  return setSessionState(tabId, { ...settings, enabled: false, error: null, siteKey: normalized, smartFixResult: null });
}

async function writeTabState(tabId, patch, { persist = true, siteKey = null } = {}) {
  const current = await readTabState(tabId, siteKey);
  const incomingSettings = settingsPatch(patch);
  const nextSettings = sanitizeSettings({ ...current, ...incomingSettings });
  const normalized = normalizeSiteKey(siteKey) ?? current.siteKey ?? null;
  const next = { ...current, ...nextSettings, ...patch, siteKey: normalized };
  await setSessionState(tabId, next);
  if (persist && Object.keys(incomingSettings).length > 0) await persistSettings(nextSettings, normalized);
  return next;
}

async function syncTabSiteContext(tabId, siteKey) {
  const normalized = normalizeSiteKey(siteKey);
  const current = await getSessionState(tabId);
  if (!current) return readTabState(tabId, normalized);
  if (!normalized || current.siteKey === normalized) return current;

  const settings = await readPersistentSettings(normalized);
  const next = { ...settings, enabled: Boolean(current.enabled), error: current.error ?? null, siteKey: normalized, smartFixResult: null };
  await setSessionState(tabId, next);

  if (next.enabled) {
    const result = await sendToOffscreen({ type: 'APPLY_SETTINGS', tabId, settings: settingsFromState(next) });
    if (!result?.ok) throw new Error(result?.error ?? 'Could not switch site audio profile.');
  }

  return next;
}

async function clearTabState(tabId) { await chrome.storage.session.remove(stateKey(tabId)); }

async function sendToOffscreen(message) {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage({ ...message, target: 'offscreen' });
}

async function enableSiteProfile(siteKey, settings) {
  const normalized = normalizeSiteKey(siteKey);
  if (!normalized) throw new Error('This page cannot use a site profile.');
  const profiles = await readSiteProfiles();
  profiles[normalized] = { settings: sanitizeSettings(settings), updatedAt: Date.now() };
  await writeSiteProfiles(profiles);
}

async function disableSiteProfile(siteKey) {
  const normalized = normalizeSiteKey(siteKey);
  if (!normalized) return;
  const profiles = await readSiteProfiles();
  if (!profiles[normalized]) return;
  delete profiles[normalized];
  await writeSiteProfiles(profiles);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target === 'offscreen' || message.target === 'live-offscreen') return;
  if (message.type === 'START_LIVE_AI_REQUEST' || message.type === 'STOP_LIVE_AI_REQUEST' || message.type === 'LIVE_AI_STATUS') return;

  (async () => {
    switch (message.type) {
      case 'ENSURE_OFFSCREEN':
        await ensureOffscreenDocument(); sendResponse({ ok: true }); return;

      case 'GET_TAB_STATE': {
        const state = await syncTabSiteContext(message.tabId, message.siteKey);
        const [siteProfileActive, customPresets] = await Promise.all([isSiteProfileActive(message.siteKey), readCustomPresets()]);
        sendResponse({ ok: true, state, siteProfileActive, customPresets }); return;
      }

      case 'START_CAPTURE': {
        await ensureOffscreenDocument();
        const current = await syncTabSiteContext(message.tabId, message.siteKey);
        const requested = sanitizeSettings({ ...current, ...(message.settings ?? {}) });
        const state = await writeTabState(message.tabId, { ...requested, enabled: false, error: null }, { persist: true, siteKey: message.siteKey });
        const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: message.tabId });
        const result = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'START_CAPTURE', tabId: message.tabId, streamId, settings: settingsFromState(state) });
        if (!result?.ok) {
          const error = result?.error ?? 'Could not start audio processing.';
          await writeTabState(message.tabId, { enabled: false, error }, { persist: false, siteKey: message.siteKey });
          sendResponse({ ok: false, error }); return;
        }
        const next = await writeTabState(message.tabId, { enabled: true, error: null }, { persist: false, siteKey: message.siteKey });
        sendResponse({ ok: true, state: next }); return;
      }

      case 'STOP_CAPTURE': {
        await sendToOffscreen({ type: 'STOP_CAPTURE', tabId: message.tabId });
        const next = await writeTabState(message.tabId, { enabled: false, error: null }, { persist: false, siteKey: message.siteKey });
        sendResponse({ ok: true, state: next }); return;
      }

      case 'UPDATE_SETTINGS': {
        const current = await syncTabSiteContext(message.tabId, message.siteKey);
        const requested = sanitizeSettings({ ...current, ...(message.patch ?? {}) });
        const next = await writeTabState(message.tabId, requested, { persist: true, siteKey: message.siteKey });
        if (next.enabled) {
          const result = await sendToOffscreen({ type: 'APPLY_SETTINGS', tabId: message.tabId, settings: settingsFromState(next) });
          if (!result?.ok) throw new Error(result?.error ?? 'Could not apply audio settings.');
        }
        sendResponse({ ok: true, state: next }); return;
      }

      case 'RUN_SMART_FIX': {
        if (smartFixRuns.has(message.tabId)) throw new Error('Smart Fix is already analyzing this tab.');
        smartFixRuns.add(message.tabId);
        try {
          const current = await syncTabSiteContext(message.tabId, message.siteKey);
          if (!current.enabled) throw new Error('Enable Audio+ and play audio before running Smart Fix.');
          const analysis = await sendToOffscreen({ type: 'ANALYZE_AUDIO', tabId: message.tabId });
          if (!analysis?.ok) throw new Error(analysis?.error ?? 'Could not analyze this audio.');
          const fix = buildSmartFix(analysis.metrics);
          const resultSummary = { summary: fix.summary, scores: fix.scores, issues: fix.issues, metrics: analysis.metrics, bands: fix.bands };
          const next = await writeTabState(
            message.tabId,
            { smartFixEnabled: true, smartFixBands: fix.bands, smartFixResult: resultSummary },
            { persist: true, siteKey: message.siteKey }
          );
          const applied = await sendToOffscreen({ type: 'APPLY_SETTINGS', tabId: message.tabId, settings: settingsFromState(next) });
          if (!applied?.ok) throw new Error(applied?.error ?? 'Could not apply Smart Fix.');
          sendResponse({ ok: true, state: next, smartFixResult: resultSummary });
        } finally {
          smartFixRuns.delete(message.tabId);
        }
        return;
      }

      case 'CLEAR_SMART_FIX': {
        const current = await syncTabSiteContext(message.tabId, message.siteKey);
        const next = await writeTabState(
          message.tabId,
          { smartFixEnabled: false, smartFixBands: [...DEFAULT_SETTINGS.smartFixBands], smartFixResult: null },
          { persist: true, siteKey: message.siteKey }
        );
        if (current.enabled) {
          const applied = await sendToOffscreen({ type: 'APPLY_SETTINGS', tabId: message.tabId, settings: settingsFromState(next) });
          if (!applied?.ok) throw new Error(applied?.error ?? 'Could not clear Smart Fix.');
        }
        sendResponse({ ok: true, state: next }); return;
      }

      case 'RESET_AUDIO': {
        const resetSettings = sanitizeSettings(DEFAULT_SETTINGS);
        const next = await writeTabState(message.tabId, { ...resetSettings, smartFixResult: null }, { persist: true, siteKey: message.siteKey });
        if (next.enabled) {
          const result = await sendToOffscreen({ type: 'APPLY_SETTINGS', tabId: message.tabId, settings: resetSettings });
          if (!result?.ok) throw new Error(result?.error ?? 'Could not reset audio settings.');
        }
        sendResponse({ ok: true, state: next }); return;
      }

      case 'SET_SITE_PROFILE': {
        const state = await syncTabSiteContext(message.tabId, message.siteKey);
        if (message.enabled) await enableSiteProfile(message.siteKey, settingsFromState(state));
        else await disableSiteProfile(message.siteKey);
        sendResponse({ ok: true, state, siteProfileActive: Boolean(message.enabled) }); return;
      }

      case 'SAVE_CUSTOM_PRESET': {
        const name = sanitizePresetName(message.name);
        if (!name) throw new Error('Enter a preset name first.');
        const presets = await readCustomPresets();
        const existingIndex = presets.findIndex((preset) => preset.name.toLowerCase() === name.toLowerCase());
        const now = Date.now();
        const preset = {
          id: existingIndex >= 0 ? presets[existingIndex].id : `custom-${now}-${Math.random().toString(36).slice(2, 8)}`,
          name,
          settings: presetSnapshot(message.settings),
          createdAt: existingIndex >= 0 ? presets[existingIndex].createdAt : now,
          updatedAt: now
        };
        if (existingIndex >= 0) presets.splice(existingIndex, 1, preset);
        else {
          if (presets.length >= MAX_CUSTOM_PRESETS) throw new Error(`You can save up to ${MAX_CUSTOM_PRESETS} custom presets.`);
          presets.push(preset);
        }
        await writeCustomPresets(presets);
        sendResponse({ ok: true, customPresets: presets, preset }); return;
      }

      case 'DELETE_CUSTOM_PRESET': {
        const presets = await readCustomPresets();
        const next = presets.filter((preset) => preset.id !== message.presetId);
        await writeCustomPresets(next);
        sendResponse({ ok: true, customPresets: next }); return;
      }

      case 'OFFSCREEN_STATUS': {
        if (message.tabId != null) {
          const current = await getSessionState(message.tabId);
          await writeTabState(message.tabId, { enabled: Boolean(message.enabled), error: message.error ?? null }, { persist: false, siteKey: current?.siteKey ?? null });
        }
        sendResponse({ ok: true }); return;
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

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  const siteKey = siteKeyFromUrl(changeInfo.url);
  if (!siteKey) return;

  try {
    await syncTabSiteContext(tabId, siteKey);
  } catch (error) {
    console.warn('[Audio+] navigation profile sync failed', error);
    const current = await getSessionState(tabId);
    if (current?.enabled && /No active processor/.test(error?.message ?? '')) {
      await writeTabState(tabId, { enabled: false, error: 'Audio processing stopped during navigation. Enable Audio+ again.' }, { persist: false, siteKey });
    }
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  smartFixRuns.delete(tabId);
  try {
    const state = await getSessionState(tabId);
    if (state?.enabled) await sendToOffscreen({ type: 'STOP_CAPTURE', tabId });
    await clearTabState(tabId);
  } catch (error) { console.warn('[Audio+] tab cleanup failed', error); }
});

chrome.tabCapture.onStatusChanged.addListener(async (info) => {
  if (info.status === 'stopped' || info.status === 'error') {
    try {
      const current = await getSessionState(info.tabId);
      if (!current) return;
      await writeTabState(
        info.tabId,
        { enabled: false, error: info.status === 'error' ? 'Chrome stopped tab audio capture.' : null },
        { persist: false, siteKey: current.siteKey }
      );
    } catch (error) { console.warn('[Audio+] capture status sync failed', error); }
  }
});
