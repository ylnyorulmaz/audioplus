import './live-ai-background.js';
import './background.js';

const CONTROL_PAGE = 'popup.html';

function controlUrl(tabId) {
  return chrome.runtime.getURL(`${CONTROL_PAGE}?tabId=${encodeURIComponent(tabId)}`);
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

chrome.action.onClicked.addListener((tab) => {
  openControlWindow(tab).catch((error) => console.error('[Audio+] could not open control window', error));
});
