const WINDOW_KEY = 'audioPlus.controlWindowId';
const TARGET_KEY = 'audioPlus.controlTargetTabId';

async function rememberTarget(tabId) {
  if (Number.isInteger(tabId) && tabId > 0) await chrome.storage.session.set({ [TARGET_KEY]: tabId });
}

async function getExistingWindowId() {
  const id = Number((await chrome.storage.session.get(WINDOW_KEY))[WINDOW_KEY]);
  if (!Number.isInteger(id)) return null;
  try {
    await chrome.windows.get(id);
    return id;
  } catch {
    await chrome.storage.session.remove(WINDOW_KEY);
    return null;
  }
}

async function openControl(tab) {
  if (!tab?.id) return;
  await rememberTarget(tab.id);

  const existingId = await getExistingWindowId();
  if (existingId != null) {
    try { await chrome.windows.remove(existingId); } catch {}
  }

  const created = await chrome.windows.create({
    url: chrome.runtime.getURL(`popup.html?tabId=${tab.id}&persistent=1`),
    type: 'popup',
    width: 440,
    height: 760,
    focused: true
  });
  if (created?.id != null) await chrome.storage.session.set({ [WINDOW_KEY]: created.id });
}

chrome.action.onClicked.addListener((tab) => {
  openControl(tab).catch((error) => console.error('[Audio+] could not open control window', error));
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const stored = Number((await chrome.storage.session.get(WINDOW_KEY))[WINDOW_KEY]);
  if (stored === windowId) await chrome.storage.session.remove(WINDOW_KEY);
});
