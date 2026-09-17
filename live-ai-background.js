import { sanitizeSettings } from './audio-settings.js';

const OFFSCREEN_PATH = 'offscreen.html';
const STATE_PREFIX = 'audioPlus.tab.';
const LIVE_PREFIX = 'audioPlus.liveAi.';
let creatingOffscreen = null;

function tabStateKey(tabId) { return `${STATE_PREFIX}${tabId}`; }
function liveStateKey(tabId) { return `${LIVE_PREFIX}${tabId}`; }

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [offscreenUrl] });
  if (contexts.length > 0) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
      justification: 'Run bounded local AI Karaoke capture and playback for a user-selected tab.'
    }).finally(() => { creatingOffscreen = null; });
  }
  await creatingOffscreen;
}

async function writeLiveState(tabId, patch) {
  const key = liveStateKey(tabId);
  const current = (await chrome.storage.session.get(key))[key] ?? {};
  await chrome.storage.session.set({ [key]: { ...current, ...patch, updatedAt: Date.now() } });
}

function stateLooksLive(value) {
  return Boolean(value?.active && ['starting', 'warming', 'buffering', 'live'].includes(value.phase));
}

async function stopLive(tabId, reason = 'user') {
  await ensureOffscreenDocument();
  await chrome.runtime.sendMessage({ target: 'live-offscreen', type: 'STOP_LIVE_AI', tabId, reason });
  await writeLiveState(tabId, { active: false, phase: 'off', quality: 'off', reason: null, stoppedBy: reason });
}

async function stopOtherLiveTabs(nextTabId) {
  const all = await chrome.storage.session.get(null);
  const otherIds = [];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(LIVE_PREFIX) || !stateLooksLive(value)) continue;
    const tabId = Number(key.slice(LIVE_PREFIX.length));
    if (Number.isInteger(tabId) && tabId !== nextTabId) otherIds.push(tabId);
  }
  for (const tabId of otherIds) await stopLive(tabId, 'switched-to-another-tab');
  return otherIds;
}

async function startLive(tabId, executionProvider = 'webgpu') {
  const provider = executionProvider === 'wasm' ? 'wasm' : 'webgpu';
  const tabKey = tabStateKey(tabId);
  const state = (await chrome.storage.session.get(tabKey))[tabKey];
  if (!state?.enabled) throw new Error('Enable Audio+ on this tab before starting Live AI Karaoke.');
  await ensureOffscreenDocument();
  const stoppedTabs = await stopOtherLiveTabs(tabId);
  await writeLiveState(tabId, {
    active: true,
    phase: 'starting',
    quality: 'warming',
    reason: null,
    rtf: null,
    provider,
    tookOverFromAnotherTab: stoppedTabs.length > 0
  });
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  const response = await chrome.runtime.sendMessage({
    target: 'live-offscreen',
    type: 'START_LIVE_AI',
    tabId,
    streamId,
    executionProvider: provider,
    originalSettings: sanitizeSettings(state)
  });
  if (!response?.ok) throw new Error(response?.error ?? 'Could not start Live AI Karaoke.');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;

  if (message.type === 'START_LIVE_AI_REQUEST') {
    sendResponse({ ok: true, accepted: true });
    startLive(message.tabId, message.executionProvider).catch(async (error) => {
      console.error('[Audio+] live AI start failed', error);
      await writeLiveState(message.tabId, { active: false, phase: 'error', quality: 'fallback', reason: error?.message ?? String(error) });
    });
    return;
  }

  if (message.type === 'STOP_LIVE_AI_REQUEST') {
    sendResponse({ ok: true, accepted: true });
    stopLive(message.tabId).catch((error) => console.error('[Audio+] live AI stop failed', error));
    return;
  }

  if (message.type === 'OFFSCREEN_STATUS' && message.tabId != null && message.enabled === false) {
    stopLive(message.tabId, 'base-processor-stopped').catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  stopLive(tabId, 'tab-closed').catch(() => {});
  chrome.storage.session.remove(liveStateKey(tabId)).catch(() => {});
});
