export function targetTabIdFromLocation() {
  const value = new URLSearchParams(location.search).get('tabId');
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function getTargetTab() {
  const requestedId = targetTabIdFromLocation();
  if (requestedId) {
    try {
      const tab = await chrome.tabs.get(requestedId);
      if (tab?.id) return tab;
    } catch {}
  }

  const tabs = await chrome.tabs.query({ active: true });
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
