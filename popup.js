import {
  EQ_FREQUENCIES,
  DEFAULT_SETTINGS,
  sanitizeSettings,
  calculateHeadroomDb
} from './audio-settings.js';
import {
  BUILTIN_PRESETS,
  presetMatches,
  presetSnapshot
} from './presets.js';

const els = {
  siteLabel: document.querySelector('#siteLabel'),
  statusPill: document.querySelector('#statusPill'),
  powerButton: document.querySelector('#powerButton'),
  powerHint: document.querySelector('#powerHint'),
  presetGrid: document.querySelector('#presetGrid'),
  bassSlider: document.querySelector('#bassSlider'),
  bassValue: document.querySelector('#bassValue'),
  midSlider: document.querySelector('#midSlider'),
  midValue: document.querySelector('#midValue'),
  trebleSlider: document.querySelector('#trebleSlider'),
  trebleValue: document.querySelector('#trebleValue'),
  volumeSlider: document.querySelector('#volumeSlider'),
  volumeValue: document.querySelector('#volumeValue'),
  siteProfileToggle: document.querySelector('#siteProfileToggle'),
  siteProfileHint: document.querySelector('#siteProfileHint'),
  customPresetSelect: document.querySelector('#customPresetSelect'),
  applyCustomPreset: document.querySelector('#applyCustomPreset'),
  deleteCustomPreset: document.querySelector('#deleteCustomPreset'),
  customPresetName: document.querySelector('#customPresetName'),
  saveCustomPreset: document.querySelector('#saveCustomPreset'),
  advancedPanel: document.querySelector('#advancedPanel'),
  eqGrid: document.querySelector('#eqGrid'),
  preampSlider: document.querySelector('#preampSlider'),
  preampValue: document.querySelector('#preampValue'),
  autoHeadroom: document.querySelector('#autoHeadroom'),
  headroomValue: document.querySelector('#headroomValue'),
  bypassButton: document.querySelector('#bypassButton'),
  resetButton: document.querySelector('#resetButton'),
  message: document.querySelector('#message')
};

let activeTab = null;
let siteKey = null;
let state = {
  ...sanitizeSettings(DEFAULT_SETTINGS),
  enabled: false,
  error: null
};
let customPresets = [];
let siteProfileActive = false;
let busy = false;
let pendingPatch = {};
let patchTimer = null;
let updateChain = Promise.resolve();
const eqControls = [];
const presetButtons = new Map();

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function setBusy(nextBusy) {
  busy = nextBusy;
  els.powerButton.disabled = nextBusy || !isCapturableTab(activeTab);
  els.resetButton.disabled = nextBusy;
  els.bypassButton.disabled = nextBusy;
}

function setMessage(text = '', type = 'error') {
  els.message.textContent = text;
  els.message.className = `message${text ? ` message-${type}` : ''}`;
}

function formatHost(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '') || 'Current tab';
  } catch {
    return 'Current tab';
  }
}

function siteKeyFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isCapturableTab(tab) {
  if (!tab?.url) return false;
  try {
    const parsed = new URL(tab.url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function formatDb(value) {
  const number = Number(value) || 0;
  const rounded = Number.isInteger(number) ? number.toFixed(0) : number.toFixed(1);
  return `${number > 0 ? '+' : ''}${rounded} dB`;
}

function formatFrequency(frequency) {
  return frequency >= 1000 ? `${frequency / 1000}k` : String(frequency);
}

function buildPresetButtons() {
  for (const preset of BUILTIN_PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset-button';
    button.textContent = preset.name;
    button.dataset.presetId = preset.id;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => applyPreset(preset.settings, preset.name));
    els.presetGrid.append(button);
    presetButtons.set(preset.id, button);
  }
}

function buildEqControls() {
  EQ_FREQUENCIES.forEach((frequency, index) => {
    const row = document.createElement('div');
    row.className = 'eq-row';

    const label = document.createElement('label');
    label.htmlFor = `eq-${frequency}`;
    label.textContent = formatFrequency(frequency);

    const slider = document.createElement('input');
    slider.id = `eq-${frequency}`;
    slider.type = 'range';
    slider.min = '-12';
    slider.max = '12';
    slider.step = '0.5';
    slider.value = '0';

    const output = document.createElement('output');
    output.htmlFor = slider.id;
    output.textContent = '0 dB';

    slider.addEventListener('input', () => {
      const bands = [...state.eqBands];
      bands[index] = Number(slider.value);
      state = { ...state, eqBands: bands };
      output.textContent = formatDb(slider.value);
      renderHeadroom();
      renderPresetSelection();
      queueSettingsPatch({ eqBands: bands });
    });

    row.append(label, slider, output);
    els.eqGrid.append(row);
    eqControls.push({ slider, output });
  });
}

function renderHeadroom() {
  const compensation = calculateHeadroomDb(state);
  els.headroomValue.textContent = state.autoHeadroom
    ? `${formatDb(compensation)} compensation`
    : 'Disabled';
}

function renderPresetSelection() {
  for (const preset of BUILTIN_PRESETS) {
    const button = presetButtons.get(preset.id);
    if (!button) continue;
    button.setAttribute('aria-pressed', String(presetMatches(state, preset.settings)));
  }
}

function renderCustomPresets(selectedId = null) {
  const currentSelection = selectedId ?? els.customPresetSelect.value;
  els.customPresetSelect.replaceChildren();

  if (customPresets.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No saved presets';
    els.customPresetSelect.append(option);
  } else {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose preset…';
    els.customPresetSelect.append(placeholder);

    for (const preset of customPresets) {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.name;
      els.customPresetSelect.append(option);
    }
  }

  if (currentSelection && customPresets.some((preset) => preset.id === currentSelection)) {
    els.customPresetSelect.value = currentSelection;
  }

  const hasSelection = Boolean(els.customPresetSelect.value);
  els.applyCustomPreset.disabled = !hasSelection;
  els.deleteCustomPreset.disabled = !hasSelection;
}

function renderSiteProfile() {
  els.siteProfileToggle.checked = siteProfileActive;
  els.siteProfileToggle.disabled = !siteKey;
  els.siteProfileHint.textContent = !siteKey
    ? 'Site profiles work on normal web pages.'
    : siteProfileActive
      ? `Using saved settings for ${siteKey}.`
      : 'Uses your global settings.';
}

function renderPowerState() {
  const capturable = isCapturableTab(activeTab);
  els.powerButton.disabled = busy || !capturable;
  els.powerButton.dataset.enabled = String(Boolean(state.enabled));
  els.powerButton.textContent = state.enabled ? 'Disable Audio+' : 'Enable Audio+';
  els.statusPill.textContent = state.enabled ? 'ON' : 'OFF';
  els.statusPill.classList.toggle('status-on', state.enabled);
  els.statusPill.classList.toggle('status-off', !state.enabled);

  if (!capturable) {
    els.powerHint.textContent = 'Open a normal web page such as YouTube or Spotify Web to enable audio processing.';
  } else if (state.enabled) {
    els.powerHint.textContent = 'Processing this tab. Settings update live.';
  } else {
    els.powerHint.textContent = 'Enable processing for this tab.';
  }
}

function render() {
  state = {
    ...state,
    ...sanitizeSettings(state)
  };

  els.bassSlider.value = String(state.bassDb);
  els.bassValue.value = formatDb(state.bassDb);
  els.midSlider.value = String(state.midDb);
  els.midValue.value = formatDb(state.midDb);
  els.trebleSlider.value = String(state.trebleDb);
  els.trebleValue.value = formatDb(state.trebleDb);
  els.volumeSlider.value = String(state.volume);
  els.volumeValue.value = `${Math.round(state.volume)}%`;

  eqControls.forEach(({ slider, output }, index) => {
    slider.value = String(state.eqBands[index]);
    output.value = formatDb(state.eqBands[index]);
  });

  els.preampSlider.value = String(state.preampDb);
  els.preampValue.value = formatDb(state.preampDb);
  els.autoHeadroom.checked = Boolean(state.autoHeadroom);
  renderHeadroom();

  els.bypassButton.setAttribute('aria-pressed', String(Boolean(state.bypass)));
  els.bypassButton.textContent = state.bypass ? 'Bypassed' : 'Bypass';

  renderPresetSelection();
  renderSiteProfile();
  renderPowerState();

  if (state.error) setMessage(state.error, 'error');
}

async function refreshState() {
  const response = await sendMessage({
    type: 'GET_TAB_STATE',
    tabId: activeTab.id,
    siteKey
  });

  if (!response?.ok) throw new Error(response?.error ?? 'Could not read Audio+ state.');
  state = response.state;
  siteProfileActive = Boolean(response.siteProfileActive);
  customPresets = response.customPresets ?? [];
  renderCustomPresets();
  render();
}

async function enableAudio() {
  setBusy(true);
  setMessage('Connecting to this tab…', 'info');

  try {
    await flushSettingsPatch();
    const ensured = await sendMessage({ type: 'ENSURE_OFFSCREEN' });
    if (!ensured?.ok) throw new Error(ensured?.error ?? 'Could not prepare audio processor.');

    const response = await sendMessage({
      type: 'START_CAPTURE',
      tabId: activeTab.id,
      siteKey,
      settings: sanitizeSettings(state)
    });

    if (!response?.ok) throw new Error(response?.error ?? 'Could not start tab capture.');
    state = response.state;
    render();
    setMessage('Audio+ is processing this tab.', 'success');
  } catch (error) {
    setMessage(error?.message ?? String(error), 'error');
  } finally {
    setBusy(false);
    renderPowerState();
  }
}

async function disableAudio() {
  setBusy(true);
  setMessage('Stopping audio processing…', 'info');

  try {
    const response = await sendMessage({
      type: 'STOP_CAPTURE',
      tabId: activeTab.id,
      siteKey
    });
    if (!response?.ok) throw new Error(response?.error ?? 'Could not stop Audio+.');
    state = response.state;
    render();
    setMessage('Audio processing stopped.', 'info');
  } catch (error) {
    setMessage(error?.message ?? String(error), 'error');
  } finally {
    setBusy(false);
    renderPowerState();
  }
}

function queueSettingsPatch(patch) {
  if (!activeTab) return;
  pendingPatch = { ...pendingPatch, ...patch };
  clearTimeout(patchTimer);
  patchTimer = setTimeout(() => {
    flushSettingsPatch();
  }, 45);
}

function flushSettingsPatch() {
  clearTimeout(patchTimer);
  patchTimer = null;
  if (!activeTab || Object.keys(pendingPatch).length === 0) return updateChain;

  const patch = pendingPatch;
  pendingPatch = {};

  updateChain = updateChain.then(async () => {
    const response = await sendMessage({
      type: 'UPDATE_SETTINGS',
      tabId: activeTab.id,
      siteKey,
      patch
    });

    if (!response?.ok) {
      setMessage(response?.error ?? 'Could not update audio settings.', 'error');
      await refreshState();
      return;
    }

    state = response.state;
    renderPresetSelection();
  }).catch((error) => {
    setMessage(error?.message ?? String(error), 'error');
  });

  return updateChain;
}

async function applyPatchNow(patch, successMessage = '') {
  await flushSettingsPatch();
  const response = await sendMessage({
    type: 'UPDATE_SETTINGS',
    tabId: activeTab.id,
    siteKey,
    patch
  });

  if (!response?.ok) throw new Error(response?.error ?? 'Could not apply audio settings.');
  state = response.state;
  render();
  if (successMessage) setMessage(successMessage, 'success');
}

async function applyPreset(settings, name) {
  try {
    await applyPatchNow(presetSnapshot(settings), `${name} preset applied.`);
  } catch (error) {
    setMessage(error?.message ?? String(error), 'error');
  }
}

function bindSlider(slider, stateKeyName, output) {
  slider.addEventListener('input', () => {
    const value = Number(slider.value);
    state = { ...state, [stateKeyName]: value };
    output.value = formatDb(value);
    renderHeadroom();
    renderPresetSelection();
    queueSettingsPatch({ [stateKeyName]: value });
  });
}

els.powerButton.addEventListener('click', async () => {
  if (state.enabled) await disableAudio();
  else await enableAudio();
});

bindSlider(els.bassSlider, 'bassDb', els.bassValue);
bindSlider(els.midSlider, 'midDb', els.midValue);
bindSlider(els.trebleSlider, 'trebleDb', els.trebleValue);
bindSlider(els.preampSlider, 'preampDb', els.preampValue);

els.volumeSlider.addEventListener('input', () => {
  const value = Number(els.volumeSlider.value);
  state = { ...state, volume: value };
  els.volumeValue.value = `${Math.round(value)}%`;
  queueSettingsPatch({ volume: value });
});

els.autoHeadroom.addEventListener('change', () => {
  state = { ...state, autoHeadroom: els.autoHeadroom.checked };
  renderHeadroom();
  renderPresetSelection();
  queueSettingsPatch({ autoHeadroom: state.autoHeadroom });
});

els.bypassButton.addEventListener('click', () => {
  state = { ...state, bypass: !state.bypass };
  render();
  queueSettingsPatch({ bypass: state.bypass });
});

els.resetButton.addEventListener('click', async () => {
  try {
    clearTimeout(patchTimer);
    pendingPatch = {};
    await updateChain;

    const response = await sendMessage({
      type: 'RESET_AUDIO',
      tabId: activeTab.id,
      siteKey
    });
    if (!response?.ok) throw new Error(response?.error ?? 'Could not reset Audio+.');
    state = response.state;
    render();
    setMessage('Audio settings reset to Flat.', 'success');
  } catch (error) {
    setMessage(error?.message ?? String(error), 'error');
  }
});

els.siteProfileToggle.addEventListener('change', async () => {
  if (!siteKey) return;
  const requested = els.siteProfileToggle.checked;
  els.siteProfileToggle.disabled = true;

  try {
    await flushSettingsPatch();
    const response = await sendMessage({
      type: 'SET_SITE_PROFILE',
      tabId: activeTab.id,
      siteKey,
      enabled: requested
    });
    if (!response?.ok) throw new Error(response?.error ?? 'Could not update site profile.');
    siteProfileActive = Boolean(response.siteProfileActive);
    renderSiteProfile();
    setMessage(
      siteProfileActive
        ? `Settings will now be remembered for ${siteKey}.`
        : `Site-specific settings removed for ${siteKey}.`,
      'success'
    );
  } catch (error) {
    siteProfileActive = !requested;
    renderSiteProfile();
    setMessage(error?.message ?? String(error), 'error');
  }
});

els.customPresetSelect.addEventListener('change', () => {
  const hasSelection = Boolean(els.customPresetSelect.value);
  els.applyCustomPreset.disabled = !hasSelection;
  els.deleteCustomPreset.disabled = !hasSelection;
});

els.applyCustomPreset.addEventListener('click', async () => {
  const preset = customPresets.find((item) => item.id === els.customPresetSelect.value);
  if (!preset) return;
  await applyPreset(preset.settings, preset.name);
});

els.saveCustomPreset.addEventListener('click', async () => {
  try {
    await flushSettingsPatch();
    const response = await sendMessage({
      type: 'SAVE_CUSTOM_PRESET',
      name: els.customPresetName.value,
      settings: state
    });
    if (!response?.ok) throw new Error(response?.error ?? 'Could not save preset.');
    customPresets = response.customPresets ?? [];
    renderCustomPresets(response.preset?.id ?? null);
    els.customPresetName.value = '';
    setMessage(`Saved preset “${response.preset.name}”.`, 'success');
  } catch (error) {
    setMessage(error?.message ?? String(error), 'error');
  }
});

els.customPresetName.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    els.saveCustomPreset.click();
  }
});

els.deleteCustomPreset.addEventListener('click', async () => {
  const preset = customPresets.find((item) => item.id === els.customPresetSelect.value);
  if (!preset) return;
  if (!window.confirm(`Delete preset “${preset.name}”?`)) return;

  try {
    const response = await sendMessage({
      type: 'DELETE_CUSTOM_PRESET',
      presetId: preset.id
    });
    if (!response?.ok) throw new Error(response?.error ?? 'Could not delete preset.');
    customPresets = response.customPresets ?? [];
    renderCustomPresets();
    setMessage(`Deleted preset “${preset.name}”.`, 'info');
  } catch (error) {
    setMessage(error?.message ?? String(error), 'error');
  }
});

buildPresetButtons();
buildEqControls();

(async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active browser tab found.');

    activeTab = tab;
    siteKey = siteKeyFromUrl(tab.url ?? '');
    els.siteLabel.textContent = formatHost(tab.url ?? '');

    await refreshState();

    if (!isCapturableTab(tab)) {
      setMessage('Audio+ cannot capture Chrome internal pages or other restricted tabs.', 'warning');
    }
  } catch (error) {
    setMessage(error?.message ?? String(error), 'error');
    els.powerButton.disabled = true;
  }
})();
