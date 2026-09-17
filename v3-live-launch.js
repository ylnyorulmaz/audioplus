const link = document.querySelector('.ai-lab-link');

function siteKeyFromUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.hostname.toLowerCase() : '';
  } catch {
    return '';
  }
}

link?.addEventListener('click', async (event) => {
  event.preventDefault();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const params = new URLSearchParams();
  if (Number.isInteger(tab?.id)) params.set('tabId', String(tab.id));
  const siteKey = siteKeyFromUrl(tab?.url ?? '');
  if (siteKey) params.set('site', siteKey);
  if (tab?.title) params.set('title', tab.title.slice(0, 120));
  const url = chrome.runtime.getURL(`ai-lab.html${params.size ? `?${params}` : ''}`);
  await chrome.tabs.create({ url });
});
