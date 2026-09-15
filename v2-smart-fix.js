import { EQ_FREQUENCIES, sanitizeSettings } from './audio-settings.js';

const smartFixButton = document.querySelector('#smartFixButton');
const clearSmartFixButton = document.querySelector('#clearSmartFixButton');
const smartFixResult = document.querySelector('#smartFixResult');
const resetButton = document.querySelector('#resetButton');
const powerButton = document.querySelector('#powerButton');

let activeTab = null;
let siteKey = null;
let state = null;
let busy = false;

function siteKeyFromUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

function formatFrequency(frequency) {
  return frequency >= 1000 ? `${frequency / 1000}k` : String(frequency);
}

function formatBandChanges(bands = []) {
  return bands
    .map((gain, index) => ({ gain: Number(gain) || 0, frequency: EQ_FREQUENCIES[index] }))
    .filter(({ gain }) => Math.abs(gain) >= 0.1)
    .sort((a, b) => Math.abs(b.gain) - Math.abs(a.gain))
    .slice(0, 3)
    .map(({ gain, frequency }) => `${formatFrequency(frequency)} Hz ${gain > 0 ? '+' : ''}${gain.toFixed(1)} dB`)
    .join(' · ');
}

function renderResult(result = null) {
  if (!state) return;
  smartFixButton.disabled = busy;
  clearSmartFixButton.disabled = busy;
  clearSmartFixButton.hidden = !state.smartFixEnabled;

  if (busy) {
    smartFixButton.textContent = 'Analyzing…';
    smartFixResult.textContent = 'Listening to the current tab for about a second…';
    return;
  }

  smartFixButton.textContent = state.smartFixEnabled ? '✦ RE-RUN SMART FIX' : '✦ FIX THIS AUDIO';

  const effectiveResult = result ?? state.smartFixResult;
  if (effectiveResult) {
    const changes = formatBandChanges(effectiveResult.bands);
    const issueText = effectiveResult.issues?.length
      ? effectiveResult.issues.slice(0, 3).map((issue) => `${issue.label} ${issue.score}`).join(' · ')
      : 'No major tonal imbalance detected';
    smartFixResult.textContent = changes ? `${issueText}. Applied: ${changes}.` : `${issueText}. No tonal correction needed.`;
    return;
  }

  smartFixResult.textContent = state.smartFixEnabled
    ? 'Smart Fix is active. Re-run it to analyze the current audio again.'
    : 'Enable Audio+, play audio, then run Smart Fix.';
}

async function refresh() {
  if (!activeTab) return;
  const response = await chrome.runtime.sendMessage({ type: 'GET_TAB_STATE', tabId: activeTab.id, siteKey });
  if (!response?.ok) throw new Error(response?.error ?? 'Could not read Smart Fix state.');
  state = { ...response.state, ...sanitizeSettings(response.state) };
  renderResult(response.state.smartFixResult ?? null);
}

async function runSmartFix() {
  if (!activeTab || busy) return;
  busy = true;
  renderResult();
  try {
    const response = await chrome.runtime.sendMessage({ type: 'RUN_SMART_FIX', tabId: activeTab.id, siteKey });
    if (!response?.ok) throw new Error(response?.error ?? 'Smart Fix could not analyze this audio.');
    state = { ...response.state, ...sanitizeSettings(response.state) };
    renderResult(response.smartFixResult ?? null);
  } catch (error) {
    smartFixResult.textContent = error?.message ?? String(error);
  } finally {
    busy = false;
    renderResult(state?.smartFixResult ?? null);
  }
}

async function clearSmartFix() {
  if (!activeTab || busy) return;
  busy = true;
  renderResult();
  try {
    const response = await chrome.runtime.sendMessage({ type: 'CLEAR_SMART_FIX', tabId: activeTab.id, siteKey });
    if (!response?.ok) throw new Error(response?.error ?? 'Could not clear Smart Fix.');
    state = { ...response.state, ...sanitizeSettings(response.state) };
    smartFixResult.textContent = 'Smart Fix cleared. Manual EQ and other Audio+ settings were left unchanged.';
  } catch (error) {
    smartFixResult.textContent = error?.message ?? String(error);
  } finally {
    busy = false;
    renderResult();
  }
}

smartFixButton.addEventListener('click', () => runSmartFix().catch(console.error));
clearSmartFixButton.addEventListener('click', () => clearSmartFix().catch(console.error));
resetButton.addEventListener('click', () => setTimeout(() => refresh().catch(console.error), 150));
powerButton.addEventListener('click', () => setTimeout(() => refresh().catch(console.error), 250));

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  activeTab = tab;
  siteKey = siteKeyFromUrl(tab.url);
  await refresh();
})().catch((error) => {
  smartFixResult.textContent = error?.message ?? String(error);
});
