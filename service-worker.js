import './live-ai-background.js';
import './background.js';

const CONTROL_PAGE = 'sidepanel.html';
const LABEL_PREFIX = 'audioPlus.tabLabel.';
const PANEL_TARGET_PREFIX = 'audioPlus.sidePanelTarget.';
const TAB_STATE_PREFIX = 'audioPlus.tab.';
const LIVE_PREFIX = 'audioPlus.liveAi.';

function labelKey(tabId) { return `${LABEL_PREFIX}${tabId}`; }
function panelTargetKey(windowId) { return `${PANEL_TARGET_PREFIX}${windowId}`; }

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

async function selectPanelTarget(tab) {
  if (!tab?.id || !Number.isInteger(tab.windowId)) return;
  await rememberTabLabel(tab);
  await chrome.storage.session.set({ [panelTargetKey(tab.windowId)]: tab.id });
  await chrome.sidePanel.setOptions({ path: CONTROL_PAGE, enabled: true });
  await chrome.sidePanel.open({ windowId: tab.windowId });
  chrome.runtime.sendMessage({
    type: 'SIDE_PANEL_TARGET_CHANGED',
    tabId: tab.id,
    windowId: tab.windowId
  }).catch(() => {});
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
  selectPanelTarget(tab).catch((error) => console.error('[Audio+] could not open side panel', error));
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
