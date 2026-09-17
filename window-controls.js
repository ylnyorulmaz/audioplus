import './persistent-target-shim.js';

const minimizeButton = document.querySelector('#minimizeWindow');
const closeButton = document.querySelector('#closeWindow');
const settingsButton = document.querySelector('#settingsButton');

minimizeButton?.addEventListener('click', async () => {
  const current = await chrome.windows.getCurrent();
  if (current?.id != null) await chrome.windows.update(current.id, { state: 'minimized' });
});

closeButton?.addEventListener('click', async () => {
  const current = await chrome.windows.getCurrent();
  if (current?.id != null) await chrome.windows.remove(current.id);
});

settingsButton?.addEventListener('click', () => chrome.runtime.openOptionsPage());
