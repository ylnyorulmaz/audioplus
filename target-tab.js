const TARGET_KEY = 'audioPlus.controlTargetTabId';

export async function resolveTargetTab() {
  const params = new URLSearchParams(globalThis.location?.search ?? '');
  const fromQuery = Number(params.get('tabId'));
  if (Number.isInteger(fromQuery) && fromQuery > 0) {
    try {
      const tab = await chrome.tabs.get(fromQuery);
      await chrome.storage.session.set({ [TARGET_KEY]: fromQuery });
      return tab;
    } catch {}
  }

  const stored = Number((await chrome.storage.session.get(TARGET_KEY))[TARGET_KEY]);
  if (Number.isInteger(stored) && stored > 0) {
    try { return await chrome.tabs.get(stored); } catch {}
  }

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id) await chrome.storage.session.set({ [TARGET_KEY]: tab.id });
  return tab ?? null;
}

export async function setTargetTab(tabId) {
  if (Number.isInteger(tabId) && tabId > 0) await chrome.storage.session.set({ [TARGET_KEY]: tabId });
}
