import { sanitizeSettings } from './audio-settings.js';
import { getTargetTab } from './target-tab.js';

const message = document.querySelector('#message');
const buttons = [...document.querySelectorAll('[data-experience]')];
let activeTab = null;
let siteKey = null;
let busy = false;

function setMessage(text = '', tone = 'info') {
  if (!message) return;
  message.textContent = text;
  message.className = `message${text ? ` message-${tone}` : ''}`;
}

function siteKeyFromUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

async function ensureAudioEnabled() {
  const current = await chrome.runtime.sendMessage({ type: 'GET_TAB_STATE', tabId: activeTab.id, siteKey });
  if (!current?.ok) throw new Error(current?.error ?? 'Could not read Audio+ state.');
  if (current.state?.enabled) return current.state;

  const started = await chrome.runtime.sendMessage({
    type: 'START_CAPTURE',
    tabId: activeTab.id,
    siteKey,
    settings: sanitizeSettings(current.state)
  });
  if (!started?.ok) throw new Error(started?.error ?? 'Could not enable Audio+.');
  return started.state;
}

async function updateSettings(patch) {
  const response = await chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', tabId: activeTab.id, siteKey, patch });
  if (!response?.ok) throw new Error(response?.error ?? 'Could not update Audio+ settings.');
  return response.state;
}

async function runSmartFix() {
  const response = await chrome.runtime.sendMessage({ type: 'RUN_SMART_FIX', tabId: activeTab.id, siteKey });
  if (!response?.ok) throw new Error(response?.error ?? 'Smart Fix failed.');
  return response;
}

async function runExperience(name) {
  if (busy || !activeTab?.id) return;
  busy = true;
  buttons.forEach((button) => { button.disabled = true; });

  try {
    await ensureAudioEnabled();

    if (name === 'karaoke') {
      await updateSettings({ vocalReduction: 82, keepBass: true });
      document.querySelector('#karaokeZone')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setMessage('Karaoke Night is ready. Try AI Karaoke below for stronger vocal removal.', 'success');
      return;
    }

    if (name === 'voices') {
      await updateSettings({
        dialogueBoost: 70,
        nightMode: 'light',
        bassDb: -2,
        midDb: 3,
        trebleDb: 1.5,
        vocalReduction: 0
      });
      document.querySelector('#clarityZone')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setMessage('Clear Voices is on: dialogue is lifted and loud jumps are softened.', 'success');
      return;
    }

    if (name === 'better-sound') {
      setMessage('Listening to this tab and tuning it…', 'info');
      await runSmartFix();
      document.querySelector('#soundZone')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setMessage('Smart Fix analyzed this audio and applied a conservative correction.', 'success');
    }
  } catch (error) {
    setMessage(error?.message ?? String(error), 'error');
  } finally {
    busy = false;
    buttons.forEach((button) => { button.disabled = false; });
  }
}

buttons.forEach((button) => {
  button.addEventListener('click', () => runExperience(button.dataset.experience));
});

(async () => {
  activeTab = await getTargetTab();
  if (!activeTab?.id) throw new Error('No browser tab selected for Audio+.');
  siteKey = siteKeyFromUrl(activeTab.url ?? '');
})().catch((error) => setMessage(error?.message ?? String(error), 'error'));
