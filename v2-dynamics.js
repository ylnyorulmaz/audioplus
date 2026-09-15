import { sanitizeSettings } from './audio-settings.js';

const dialogueSlider = document.querySelector('#dialogueBoostSlider');
const dialogueValue = document.querySelector('#dialogueBoostValue');
const nightButtons = [...document.querySelectorAll('[data-night-mode]')];
const vocalSlider = document.querySelector('#vocalReductionSlider');
const vocalValue = document.querySelector('#vocalReductionValue');
const vocalPresetButtons = [...document.querySelectorAll('[data-vocal-preset]')];
const keepBassToggle = document.querySelector('#keepBassToggle');
const resetButton = document.querySelector('#resetButton');
let activeTab = null;
let siteKey = null;
let state = null;
let timer = null;

function siteKeyFromUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.hostname.toLowerCase() : null;
  } catch { return null; }
}

function render() {
  if (!state) return;
  dialogueSlider.value = String(state.dialogueBoost);
  dialogueValue.value = `${Math.round(state.dialogueBoost)}%`;
  for (const button of nightButtons) button.setAttribute('aria-pressed', String(button.dataset.nightMode === state.nightMode));

  vocalSlider.value = String(state.vocalReduction);
  vocalValue.value = `${Math.round(state.vocalReduction)}%`;
  keepBassToggle.checked = Boolean(state.keepBass);
  for (const button of vocalPresetButtons) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.vocalPreset) === state.vocalReduction));
  }
}

async function refresh() {
  if (!activeTab) return;
  const response = await chrome.runtime.sendMessage({ type: 'GET_TAB_STATE', tabId: activeTab.id, siteKey });
  if (!response?.ok) return;
  state = sanitizeSettings(response.state);
  render();
}

async function patch(settingsPatch) {
  if (!activeTab) return;
  const response = await chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', tabId: activeTab.id, siteKey, patch: settingsPatch });
  if (!response?.ok) throw new Error(response?.error ?? 'Could not update enhancement settings.');
  state = sanitizeSettings(response.state);
  render();
}

dialogueSlider.addEventListener('input', () => {
  const value = Number(dialogueSlider.value);
  dialogueValue.value = `${value}%`;
  clearTimeout(timer);
  timer = setTimeout(() => patch({ dialogueBoost: value }).catch(console.error), 45);
});

for (const button of nightButtons) {
  button.addEventListener('click', () => patch({ nightMode: button.dataset.nightMode }).catch(console.error));
}

vocalSlider.addEventListener('input', () => {
  const value = Number(vocalSlider.value);
  vocalValue.value = `${value}%`;
  clearTimeout(timer);
  timer = setTimeout(() => patch({ vocalReduction: value }).catch(console.error), 45);
});

for (const button of vocalPresetButtons) {
  button.addEventListener('click', () => patch({ vocalReduction: Number(button.dataset.vocalPreset), keepBass: true }).catch(console.error));
}

keepBassToggle.addEventListener('change', () => {
  patch({ keepBass: keepBassToggle.checked }).catch(console.error);
});

resetButton.addEventListener('click', () => setTimeout(() => refresh().catch(console.error), 120));

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  activeTab = tab;
  siteKey = siteKeyFromUrl(tab.url);
  await refresh();
})().catch(console.error);
