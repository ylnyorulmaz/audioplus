const PANEL_TARGET_PREFIX = 'audioPlus.sidePanelTarget.';

export function targetTabIdFromLocation() {
  const value = new URLSearchParams(location.search).get('tabId');
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function storedPanelTargetId() {
  try {
    const currentWindow = await chrome.windows.getCurrent();
    if (!Number.isInteger(currentWindow?.id)) return null;
    const key = `${PANEL_TARGET_PREFIX}${currentWindow.id}`;
    const result = await chrome.storage.session.get(key);
    const id = Number(result[key]);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

async function tabById(id) {
  if (!id) return null;
  try {
    const tab = await chrome.tabs.get(id);
    return tab?.id ? tab : null;
  } catch {
    return null;
  }
}

export async function getTargetTab() {
  const requestedId = targetTabIdFromLocation();
  const requested = await tabById(requestedId);
  if (requested) return requested;

  const stored = await tabById(await storedPanelTargetId());
  if (stored) return stored;

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const capturable = tabs.find((tab) => {
    try {
      const url = new URL(tab.url ?? '');
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  });
  return capturable ?? tabs[0] ?? null;
}
