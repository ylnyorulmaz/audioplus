import {
  EQ_FREQUENCIES,
  DEFAULT_SETTINGS,
  sanitizeSettings,
  calculateHeadroomDb
} from './audio-settings.js';
import { BUILTIN_PRESETS, presetMatches, presetSnapshot } from './presets.js';
import { getTargetTab } from './target-tab.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const els = {
  siteLabel: $('#siteLabel'),
  statusPill: $('#statusPill'),
  powerButton: $('#powerButton'),
  powerHint: $('#powerHint'),
  presetGrid: $('#presetGrid'),
  bassSlider: $('#bassSlider'), bassValue: $('#bassValue'),
  midSlider: $('#midSlider'), midValue: $('#midValue'),
  trebleSlider: $('#trebleSlider'), trebleValue: $('#trebleValue'),
  volumeSlider: $('#volumeSlider'), volumeValue: $('#volumeValue'),
  dialogueSlider: $('#dialogueBoostSlider'), dialogueValue: $('#dialogueBoostValue'),
  vocalSlider: $('#vocalReductionSlider'), vocalValue: $('#vocalReductionValue'),
  keepBassToggle: $('#keepBassToggle'),
  smartFixButton: $('#smartFixButton'), clearSmartFixButton: $('#clearSmartFixButton'), smartFixResult: $('#smartFixResult'),
  siteProfileToggle: $('#siteProfileToggle'), siteProfileHint: $('#siteProfileHint'),
  customPresetSelect: $('#customPresetSelect'), applyCustomPreset: $('#applyCustomPreset'), deleteCustomPreset: $('#deleteCustomPreset'),
  customPresetName: $('#customPresetName'), saveCustomPreset: $('#saveCustomPreset'),
  advancedPanel: $('#advancedPanel'), eqGrid: $('#eqGrid'),
  preampSlider: $('#preampSlider'), preampValue: $('#preampValue'),
  autoHeadroom: $('#autoHeadroom'), headroomValue: $('#headroomValue'),
  spectrumBars: $('#spectrumBars'), spectrumStatus: $('#spectrumStatus'), spectrumMetrics: $('#spectrumMetrics'),
  bypassButton: $('#bypassButton'), resetButton: $('#resetButton'), message: $('#message'),
  minimizeWindowButton: $('#minimizeWindowButton'), closeWindowButton: $('#closeWindowButton')
};

let activeTab = null;
let siteKey = null;
let state = { ...sanitizeSettings(DEFAULT_SETTINGS), enabled: false, error: null, smartFixResult: null };
let siteProfileActive = false;
let customPresets = [];
let busy = false;
let smartFixBusy = false;
let patchTimer = null;
let pendingPatch = {};
let updateChain = Promise.resolve();
let spectrumPolling = false;
const eqControls = [];
const presetButtons = new Map();

function siteKeyFromUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.hostname.toLowerCase() : null;
  } catch { return null; }
}

function isCapturable(tab) {
  try {
    const protocol = new URL(tab?.url ?? '').protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch { return false; }
}

function formatHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') || 'Current tab'; } catch { return 'Current tab'; }
}
function formatDb(value) {
  const n = Number(value) || 0;
  const text = Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1);
  return `${n > 0 ? '+' : ''}${text} dB`;
}
function formatFrequency(value) { return value >= 1000 ? `${value / 1000}k` : String(value); }
function send(message) { return chrome.runtime.sendMessage(message); }
function setMessage(text = '', tone = 'error') {
  els.message.textContent = text;
  els.message.className = `message${text ? ` message-${tone}` : ''}`;
}

function buildPresetButtons() {
  els.presetGrid.replaceChildren();
  for (const preset of BUILTIN_PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset-button';
    button.textContent = preset.name;
    button.dataset.presetId = preset.id;
    button.addEventListener('click', () => applyPatchNow(presetSnapshot(preset.settings), `${preset.name} preset applied.`).catch(showError));
    els.presetGrid.append(button);
    presetButtons.set(preset.id, button);
  }
}

function buildEqControls() {
  els.eqGrid.replaceChildren();
  EQ_FREQUENCIES.forEach((frequency, index) => {
    const row = document.createElement('div');
    row.className = 'eq-row';
    const label = document.createElement('label');
    label.textContent = formatFrequency(frequency);
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = '-12'; slider.max = '12'; slider.step = '0.5';
    const output = document.createElement('output');
    slider.addEventListener('input', () => {
      const eqBands = [...state.eqBands];
      eqBands[index] = Number(slider.value);
      state = { ...state, eqBands };
      output.textContent = formatDb(slider.value);
      renderHeadroom(); renderPresetSelection(); queuePatch({ eqBands });
    });
    row.append(label, slider, output);
    els.eqGrid.append(row);
    eqControls.push({ slider, output });
  });
}

function buildSpectrumBars() {
  els.spectrumBars.replaceChildren();
  for (const frequency of EQ_FREQUENCIES) {
    const column = document.createElement('div'); column.className = 'spectrum-column';
    const track = document.createElement('div'); track.className = 'spectrum-track';
    const fill = document.createElement('div'); fill.className = 'spectrum-fill'; fill.style.height = '2%';
    const label = document.createElement('span'); label.className = 'spectrum-label'; label.textContent = formatFrequency(frequency);
    track.append(fill); column.append(track, label); els.spectrumBars.append(column);
  }
}

function renderHeadroom() {
  const compensation = calculateHeadroomDb(state);
  els.headroomValue.textContent = state.autoHeadroom ? `${formatDb(compensation)} compensation` : 'Disabled';
}
function renderPresetSelection() {
  for (const preset of BUILTIN_PRESETS) presetButtons.get(preset.id)?.setAttribute('aria-pressed', String(presetMatches(state, preset.settings)));
}
function renderCustomPresets(selectedId = null) {
  const current = selectedId ?? els.customPresetSelect.value;
  els.customPresetSelect.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = ''; placeholder.textContent = customPresets.length ? 'Choose preset…' : 'No saved presets';
  els.customPresetSelect.append(placeholder);
  for (const preset of customPresets) {
    const option = document.createElement('option'); option.value = preset.id; option.textContent = preset.name; els.customPresetSelect.append(option);
  }
  if (current && customPresets.some((preset) => preset.id === current)) els.customPresetSelect.value = current;
  const selected = Boolean(els.customPresetSelect.value);
  els.applyCustomPreset.disabled = !selected; els.deleteCustomPreset.disabled = !selected;
}
function renderSmartFix() {
  els.smartFixButton.disabled = smartFixBusy;
  els.clearSmartFixButton.hidden = !state.smartFixEnabled;
  if (smartFixBusy) { els.smartFixButton.textContent = 'Analyzing…'; els.smartFixResult.textContent = 'Listening locally for about a second…'; return; }
  els.smartFixButton.textContent = state.smartFixEnabled ? '✦ RE-RUN SMART FIX' : '✦ FIX THIS AUDIO';
  const result = state.smartFixResult;
  if (result) {
    const issues = result.issues?.length ? result.issues.slice(0, 3).map((item) => `${item.label} ${item.score}`).join(' · ') : 'No major tonal imbalance';
    els.smartFixResult.textContent = issues;
  } else {
    els.smartFixResult.textContent = state.smartFixEnabled ? 'Smart Fix is active.' : 'Enable Audio+, play audio, then run Smart Fix.';
  }
}
function render() {
  state = { ...state, ...sanitizeSettings(state) };
  els.siteLabel.textContent = formatHost(activeTab?.url ?? '');
  els.statusPill.textContent = state.enabled ? 'ON' : 'OFF';
  els.statusPill.classList.toggle('status-on', state.enabled); els.statusPill.classList.toggle('status-off', !state.enabled);
  els.powerButton.textContent = state.enabled ? 'Disable Audio+' : 'Enable Audio+';
  els.powerButton.disabled = busy || !isCapturable(activeTab);
  els.powerHint.textContent = !isCapturable(activeTab) ? 'Select a normal web tab such as YouTube or Spotify.' : state.enabled ? 'Processing this tab. Controls update live.' : 'Enable processing for this tab.';

  for (const [key, slider, output] of [
    ['bassDb', els.bassSlider, els.bassValue], ['midDb', els.midSlider, els.midValue], ['trebleDb', els.trebleSlider, els.trebleValue], ['preampDb', els.preampSlider, els.preampValue]
  ]) { slider.value = String(state[key]); output.value = formatDb(state[key]); }
  els.volumeSlider.value = String(state.volume); els.volumeValue.value = `${Math.round(state.volume)}%`;
  els.dialogueSlider.value = String(state.dialogueBoost); els.dialogueValue.value = `${Math.round(state.dialogueBoost)}%`;
  els.vocalSlider.value = String(state.vocalReduction); els.vocalValue.value = `${Math.round(state.vocalReduction)}%`;
  els.keepBassToggle.checked = Boolean(state.keepBass);
  els.autoHeadroom.checked = Boolean(state.autoHeadroom);
  eqControls.forEach(({ slider, output }, index) => { slider.value = String(state.eqBands[index]); output.value = formatDb(state.eqBands[index]); });
  $$('[data-night-mode]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.nightMode === state.nightMode)));
  $$('[data-vocal-preset]').forEach((button) => button.setAttribute('aria-pressed', String(Number(button.dataset.vocalPreset) === state.vocalReduction)));
  els.bypassButton.setAttribute('aria-pressed', String(Boolean(state.bypass))); els.bypassButton.textContent = state.bypass ? 'Bypassed' : 'Bypass';
  els.siteProfileToggle.checked = siteProfileActive; els.siteProfileToggle.disabled = !siteKey;
  els.siteProfileHint.textContent = !siteKey ? 'Site profiles work on normal web pages.' : siteProfileActive ? `Using saved settings for ${siteKey}.` : 'Uses your global settings.';
  renderHeadroom(); renderPresetSelection(); renderSmartFix();
  if (state.error) setMessage(state.error, 'error');
}

async function refreshState() {
  if (!activeTab?.id) return;
  const response = await send({ type: 'GET_TAB_STATE', tabId: activeTab.id, siteKey });
  if (!response?.ok) throw new Error(response?.error ?? 'Could not read Audio+ state.');
  state = { ...response.state, ...sanitizeSettings(response.state) };
  siteProfileActive = Boolean(response.siteProfileActive); customPresets = response.customPresets ?? [];
  renderCustomPresets(); render();
}

async function enableAudio() {
  busy = true; render(); setMessage('Connecting to this tab…', 'info');
  try {
    const response = await send({ type: 'START_CAPTURE', tabId: activeTab.id, siteKey, settings: sanitizeSettings(state) });
    if (!response?.ok) throw new Error(response?.error ?? 'Could not start tab audio.');
    state = response.state; setMessage('Audio+ is processing this tab.', 'success');
  } finally { busy = false; render(); }
}
async function disableAudio() {
  busy = true; render();
  try {
    await send({ type: 'STOP_LIVE_AI_REQUEST', tabId: activeTab.id }).catch(() => {});
    const response = await send({ type: 'STOP_CAPTURE', tabId: activeTab.id, siteKey });
    if (!response?.ok) throw new Error(response?.error ?? 'Could not stop Audio+.');
    state = response.state; setMessage('Audio processing stopped.', 'info');
  } finally { busy = false; render(); }
}

function queuePatch(patch) {
  pendingPatch = { ...pendingPatch, ...patch };
  clearTimeout(patchTimer);
  patchTimer = setTimeout(() => flushPatch(), 45);
}
function flushPatch() {
  clearTimeout(patchTimer); patchTimer = null;
  if (!activeTab?.id || !Object.keys(pendingPatch).length) return updateChain;
  const patch = pendingPatch; pendingPatch = {};
  updateChain = updateChain.then(async () => {
    const response = await send({ type: 'UPDATE_SETTINGS', tabId: activeTab.id, siteKey, patch });
    if (!response?.ok) throw new Error(response?.error ?? 'Could not update audio settings.');
    state = { ...response.state, ...sanitizeSettings(response.state) }; render();
  }).catch(showError);
  return updateChain;
}
async function applyPatchNow(patch, successMessage = '') {
  await flushPatch();
  const response = await send({ type: 'UPDATE_SETTINGS', tabId: activeTab.id, siteKey, patch });
  if (!response?.ok) throw new Error(response?.error ?? 'Could not update audio settings.');
  state = { ...response.state, ...sanitizeSettings(response.state) }; render();
  if (successMessage) setMessage(successMessage, 'success');
}
function showError(error) { setMessage(error?.message ?? String(error), 'error'); }

function bindRange(slider, stateKey, output, formatter = formatDb) {
  slider.addEventListener('input', () => {
    const value = Number(slider.value); state = { ...state, [stateKey]: value }; output.value = formatter(value); renderHeadroom(); renderPresetSelection(); queuePatch({ [stateKey]: value });
  });
}

els.powerButton.addEventListener('click', () => (state.enabled ? disableAudio() : enableAudio()).catch(showError));
bindRange(els.bassSlider, 'bassDb', els.bassValue); bindRange(els.midSlider, 'midDb', els.midValue); bindRange(els.trebleSlider, 'trebleDb', els.trebleValue); bindRange(els.preampSlider, 'preampDb', els.preampValue);
bindRange(els.dialogueSlider, 'dialogueBoost', els.dialogueValue, (value) => `${Math.round(value)}%`);
bindRange(els.vocalSlider, 'vocalReduction', els.vocalValue, (value) => `${Math.round(value)}%`);
els.volumeSlider.addEventListener('input', () => { const volume = Number(els.volumeSlider.value); state = { ...state, volume }; els.volumeValue.value = `${Math.round(volume)}%`; queuePatch({ volume }); });
els.keepBassToggle.addEventListener('change', () => applyPatchNow({ keepBass: els.keepBassToggle.checked }).catch(showError));
els.autoHeadroom.addEventListener('change', () => applyPatchNow({ autoHeadroom: els.autoHeadroom.checked }).catch(showError));
$$('[data-night-mode]').forEach((button) => button.addEventListener('click', () => applyPatchNow({ nightMode: button.dataset.nightMode }).catch(showError)));
$$('[data-vocal-preset]').forEach((button) => button.addEventListener('click', () => applyPatchNow({ vocalReduction: Number(button.dataset.vocalPreset), keepBass: true }, Number(button.dataset.vocalPreset) === 0 ? 'Fast Karaoke off.' : '').catch(showError)));
els.bypassButton.addEventListener('click', () => applyPatchNow({ bypass: !state.bypass }).catch(showError));

els.smartFixButton.addEventListener('click', async () => {
  if (smartFixBusy) return;
  smartFixBusy = true; renderSmartFix();
  try {
    if (!state.enabled) await enableAudio();
    const response = await send({ type: 'RUN_SMART_FIX', tabId: activeTab.id, siteKey });
    if (!response?.ok) throw new Error(response?.error ?? 'Smart Fix failed.');
    state = { ...response.state, ...sanitizeSettings(response.state), smartFixResult: response.smartFixResult ?? response.state.smartFixResult ?? null };
  } catch (error) { showError(error); } finally { smartFixBusy = false; render(); }
});
els.clearSmartFixButton.addEventListener('click', async () => {
  try {
    const response = await send({ type: 'CLEAR_SMART_FIX', tabId: activeTab.id, siteKey });
    if (!response?.ok) throw new Error(response?.error ?? 'Could not clear Smart Fix.');
    state = { ...response.state, ...sanitizeSettings(response.state) }; render();
  } catch (error) { showError(error); }
});

els.resetButton.addEventListener('click', async () => {
  try {
    pendingPatch = {}; clearTimeout(patchTimer); await updateChain;
    const response = await send({ type: 'RESET_AUDIO', tabId: activeTab.id, siteKey });
    if (!response?.ok) throw new Error(response?.error ?? 'Could not reset Audio+.');
    state = { ...response.state, ...sanitizeSettings(response.state) }; render(); setMessage('Audio settings reset.', 'success');
  } catch (error) { showError(error); }
});

els.siteProfileToggle.addEventListener('change', async () => {
  try {
    const response = await send({ type: 'SET_SITE_PROFILE', tabId: activeTab.id, siteKey, enabled: els.siteProfileToggle.checked });
    if (!response?.ok) throw new Error(response?.error ?? 'Could not update site profile.');
    siteProfileActive = Boolean(response.siteProfileActive); render();
  } catch (error) { showError(error); }
});
els.customPresetSelect.addEventListener('change', () => renderCustomPresets(els.customPresetSelect.value));
els.applyCustomPreset.addEventListener('click', () => {
  const preset = customPresets.find((item) => item.id === els.customPresetSelect.value);
  if (preset) applyPatchNow(preset.settings, `${preset.name} applied.`).catch(showError);
});
els.saveCustomPreset.addEventListener('click', async () => {
  try {
    const response = await send({ type: 'SAVE_CUSTOM_PRESET', name: els.customPresetName.value, settings: state });
    if (!response?.ok) throw new Error(response?.error ?? 'Could not save preset.');
    customPresets = response.customPresets ?? []; renderCustomPresets(response.preset?.id); els.customPresetName.value = '';
  } catch (error) { showError(error); }
});
els.deleteCustomPreset.addEventListener('click', async () => {
  const preset = customPresets.find((item) => item.id === els.customPresetSelect.value); if (!preset) return;
  try {
    const response = await send({ type: 'DELETE_CUSTOM_PRESET', presetId: preset.id });
    if (!response?.ok) throw new Error(response?.error ?? 'Could not delete preset.');
    customPresets = response.customPresets ?? []; renderCustomPresets();
  } catch (error) { showError(error); }
});

async function pollSpectrum() {
  if (spectrumPolling || !els.advancedPanel.open || document.visibilityState !== 'visible' || !state.enabled) return;
  spectrumPolling = true;
  try {
    const response = await send({ target: 'offscreen', type: 'GET_SPECTRUM', tabId: activeTab.id });
    if (!response?.ok || !response.active) return;
    const fills = $$('.spectrum-fill');
    fills.forEach((fill, index) => { fill.style.height = `${Math.max(2, Math.round((Number(response.spectrum?.levels?.[index]) || 0) * 100))}%`; });
    els.spectrumStatus.textContent = 'Live';
    const rms = Number(response.spectrum?.rmsDb), peak = Number(response.spectrum?.peakDb);
    els.spectrumMetrics.textContent = Number.isFinite(rms) && Number.isFinite(peak) ? `Input ${rms.toFixed(1)} dB RMS · Peak ${peak.toFixed(1)} dB` : 'Live input spectrum';
  } catch { els.spectrumStatus.textContent = 'Unavailable'; } finally { spectrumPolling = false; }
}
setInterval(() => pollSpectrum(), 250);
els.advancedPanel.addEventListener('toggle', () => pollSpectrum());

els.minimizeWindowButton.addEventListener('click', async () => { const win = await chrome.windows.getCurrent(); if (win?.id) await chrome.windows.update(win.id, { state: 'minimized' }); });
els.closeWindowButton.addEventListener('click', async () => { const win = await chrome.windows.getCurrent(); if (win?.id) await chrome.windows.remove(win.id); });

buildPresetButtons(); buildEqControls(); buildSpectrumBars();

(async () => {
  activeTab = await getTargetTab();
  if (!activeTab?.id) throw new Error('No browser tab selected for Audio+.');
  siteKey = siteKeyFromUrl(activeTab.url ?? '');
  await refreshState();
  if (!isCapturable(activeTab)) setMessage('Audio+ cannot capture Chrome internal or restricted pages.', 'warning');
})().catch(showError);
