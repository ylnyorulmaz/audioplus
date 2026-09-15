import { DEFAULT_SETTINGS, sanitizeSettings } from './audio-settings.js';

const STATE_PREFIX = 'audioPlus.tab.';
const SETTINGS_KEY = 'audioPlus.settings';
const SITE_PROFILES_KEY = 'audioPlus.siteProfiles';

function stateKey(tabId) {
  return `${STATE_PREFIX}${tabId}`;
}

function siteKeyFromUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

async function persistentSettings(siteKey) {
  const result = await chrome.storage.local.get([SETTINGS_KEY, SITE_PROFILES_KEY]);
  const profiles = result[SITE_PROFILES_KEY];
  const siteSettings = profiles && typeof profiles === 'object' && profiles[siteKey]?.settings;
  return sanitizeSettings(siteSettings ?? result[SETTINGS_KEY] ?? DEFAULT_SETTINGS);
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;

  try {
    const sessionKey = stateKey(tabId);
    const stored = await chrome.storage.session.get(sessionKey);
    const current = stored[sessionKey];
    if (!current) return;

    const nextSiteKey = siteKeyFromUrl(changeInfo.url);
    if (!nextSiteKey || nextSiteKey === current.siteKey) return;

    const settings = await persistentSettings(nextSiteKey);
    const next = {
      ...settings,
      enabled: Boolean(current.enabled),
      error: current.error ?? null,
      siteKey: nextSiteKey,
      smartFixResult: null
    };

    await chrome.storage.session.set({ [sessionKey]: next });

    if (next.enabled) {
      const result = await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'APPLY_SETTINGS',
        tabId,
        settings: sanitizeSettings(next)
      });
      if (!result?.ok) throw new Error(result?.error ?? 'Could not apply the new site audio profile.');
    }
  } catch (error) {
    console.warn('[Audio+] navigation profile sync failed', error);
  }
});
