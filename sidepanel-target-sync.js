chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'SIDE_PANEL_TARGET_CHANGED') return;
  if (!Number.isInteger(Number(message.tabId))) return;
  location.reload();
});
