import './live-ai-background.js';
import './background.js';

const CONTROL_PAGE = 'popup.html';
const LABEL_PREFIX = 'audioPlus.tabLabel.';
const TAB_STATE_PREFIX = 'audioPlus.tab.';
const LIVE_PREFIX = 'audioPlus.liveAi.';

function labelKey(tabId) { return `${LABEL_PREFIX}${tabId}`; }
function controlUrl(tabId) {
  return chrome.runtime.getURL(`${CONTROL_PAGE}?tabId=${encodeURIComponent(tabId)}`);
}

function safeHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

async function rememberTabLabel(tab) {
  if (!tab?.id) return;
  await chrome.storage.session.set({
    [labelKey(tab.id)]: {
      tabId: tab.id,
      windowId: tab.windowId,
      title: String(tab.title ?? '').slice(0, 160),
      host: safeHost(tab.url ?? ''),
      updatedAt: Date.now()
    }
  });
}

async function findControlWindow() {
  const baseUrl = chrome.runtime.getURL(CONTROL_PAGE);
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['popup'] });
  for (const windowInfo of windows) {
    const controlTab = windowInfo.tabs?.find((tab) => tab.url?.startsWith(baseUrl));
    if (controlTab) return { windowInfo, controlTab };
  }
  return null;
}

async function openControlWindow(tab) {
  if (!tab?.id) return;
  await rememberTabLabel(tab);
  const url = controlUrl(tab.id);
  const existing = await findControlWindow();
  if (existing) {
    await chrome.tabs.update(existing.controlTab.id, { url, active: true });
    await chrome.windows.update(existing.windowInfo.id, { focused: true, state: 'normal' });
    return;
  }

  await chrome.windows.create({
    url,
    type: 'popup',
    focused: true,
    width: 430,
    height: 820
  });
}

async function audioOverview(targetTabId) {
  const [audibleTabs, session] = await Promise.all([
    chrome.tabs.query({ audible: true }),
    chrome.storage.session.get(null)
  ]);

  const enabledTabIds = [];
  const liveTabIds = [];
  for (const [key, value] of Object.entries(session)) {
    if (key.startsWith(TAB_STATE_PREFIX) && value?.enabled) {
      const id = Number(key.slice(TAB_STATE_PREFIX.length));
      if (Number.isInteger(id)) enabledTabIds.push(id);
    }
    if (key.startsWith(LIVE_PREFIX) && value?.active && ['starting', 'warming', 'buffering', 'live'].includes(value.phase)) {
      const id = Number(key.slice(LIVE_PREFIX.length));
      if (Number.isInteger(id)) liveTabIds.push(id);
    }
  }

  const label = session[labelKey(targetTabId)] ?? null;
  return {
    targetTabId,
    targetAudible: audibleTabs.some((tab) => tab.id === targetTabId),
    audibleCount: audibleTabs.length,
    otherAudibleCount: audibleTabs.filter((tab) => tab.id !== targetTabId).length,
    enabledCount: enabledTabIds.length,
    otherEnabledCount: enabledTabIds.filter((id) => id !== targetTabId).length,
    liveTabIds,
    label
  };
}

chrome.action.onClicked.addListener((tab) => {
  openControlWindow(tab).catch((error) => console.error('[Audio+] could not open control window', error));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;
  if (message.type === 'GET_AUDIO_OVERVIEW') {
    audioOverview(Number(message.tabId)).then((overview) => sendResponse({ ok: true, overview })).catch((error) => {
      sendResponse({ ok: false, error: error?.message ?? String(error) });
    });
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(labelKey(tabId)).catch(() => {});
});