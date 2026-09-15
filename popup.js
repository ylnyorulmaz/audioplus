import {
  EQ_FREQUENCIES,
  DEFAULT_SETTINGS,
  sanitizeSettings,
  calculateHeadroomDb
} from './audio-settings.js';

const els = {
  siteLabel: document.querySelector('#siteLabel'),
  statusPill: document.querySelector('#statusPill'),
  powerButton: document.querySelector('#powerButton'),
  bassSlider: document.querySelector('#bassSlider'),
  bassValue: document.querySelector('#bassValue'),
  midSlider: document.querySelector('#midSlider'),
  midValue: document.querySelector('#midValue'),
  trebleSlider: document.querySelector('#trebleSlider'),
  trebleValue: document.querySelector('#trebleValue'),
  eqGrid: document.querySelector('#eqGrid'),
  preampSlider: document.querySelector('#preampSlider'),
  preampValue: document.querySelector('#preampValue'),
  autoHeadroom: document.querySelector('#autoHeadroom'),
  headroomValue: document.querySelector('#headroomValue'),
  volumeSlider: document.querySelector('#volumeSlider'),
  volumeValue: document.querySelector('#volumeValue'),
  bypassButton: document.querySelector('#bypassButton'),
  resetButton: document.querySelector('#resetButton'),
  message: document.querySelector('#message')
};

let activeTab = null;
let state = {
  ...sanitizeSettings(DEFAULT_SETTINGS),
  enabled: false,
  error: null
};
let busy = false;
let pendingPatch = {};
let patchTimer = null;
let updateChain = Promise.resolve();
const eqControls = [];

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function setBusy(nextBusy) {
  busy = nextBusy;
  els.powerButton.disabled = nextBusy;
  els.resetButton.disabled = nextBusy;
  els.bypassButton.disabled = nextBusy;
}

function setMessage(text = '') {
  els.message.textContent = text;
}

function formatHost(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return 'Current tab';
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

  eqControls.forEach(({ slider, output }, index) => {
    slider.value = String(state.eqBands[index]);
    output.value = formatDb(state.eqBands[index]);
  });

  els.preampSlider.value = String(state.preampDb);
  els.preampValue.value = formatDb(state.preampDb);
  els.autoHeadroom.checked = Boolean(state.autoHeadroom);
  renderHeadroom();

  els.volumeSlider.value = String(state.volume);
  els.volumeValue.value = `${Math.round(state.volume)}%`;

  els.bypassButton.setAttribute('aria-pressed', String(Boolean(state.bypass)));
  els.bypassButton.textContent = state.bypass ? 'Bypassed' : 'Bypass';

  els.statusPill.textContent = state.enabled ? 'ON' : 'OFF';
  els.statusPill.classList.toggle('status-on', state.enabled);
  els.statusPill.classList.toggle('status-off', !state.enabled);

  els.powerButton.dataset.enabled = String(Boolean(state.enabled));
  els.powerButton.textContent = state.enabled ? 'Disable Audio+' : 'Enable Audio+';

  if (state.error) setMessage(state.error);
}

async function refreshState() {
  const response = await sendMessage({
    type: 'GET_TAB_STATE',
    tabId: activeTab.id
  });

  if (!response?.ok) throw new Error(response?.error ?? 'Could not read Audio+ state.');
  state = response.state;
  render();
}

async function enableAudio() {
  setBusy(true);
  setMessage('Starting audio processing…');

  try {
    const ensured = await sendMessage({ type: 'ENSURE_OFFSCREEN' });
    if (!ensured?.ok) throw new Error(ensured?.error ?? 'Could not prepare audio processor.');

    const response = await sendMessage({
      type: 'START_CAPTURE',
      tabId: activeTab.id,
      settings: sanitizeSettings(state)
    });

    if (!response?.ok) throw new Error(response?.error ?? 'Could not start tab capture.');
    state = response.state;
    setMessage('');
    render();
  } catch (error) {
    setMessage(error?.message ?? String(error));
  } finally {
    setBusy(false);
  }
}

async function disableAudio() {
  setBusy(true);
  setMessage('');

  try {
    const response = await sendMessage({
      type: 'STOP_CAPTURE',
      tabId: activeTab.id
    });
    if (!response?.ok) throw new Error(response?.error ?? 'Could not stop Audio+.');
    state = response.state;
    render();
  } catch (error) {
    setMessage(error?.message ?? String(error));
  } finally {
    setBusy(false);
  }
}

function queueSettingsPatch(patch) {
  if (!activeTab) return;
  pendingPatch = { ...pendingPatch, ...patch };
  clearTimeout(patchTimer);
  patchTimer = setTimeout(flushSettingsPatch, 45);
}

function flushSettingsPatch() {
  if (!activeTab || Object.keys(pendingPatch).length === 0) return;
  const patch = pendingPatch;
  pendingPatch = {};

  updateChain = updateChain.then(async () => {
    const response = await sendMessage({
      type: 'UPDATE_SETTINGS',
      tabId: activeTab.id,
      patch
    });

    if (!response?.ok) {
      setMessage(response?.error ?? 'Could not update audio settings.');
      await refreshState();
      return;
    }

    setMessage('');
  }).catch((error) => {
    setMessage(error?.message ?? String(error));
  });
}

function bindSlider(slider, stateKey, output) {
  slider.addEventListener('input', () => {
    const value = Number(slider.value);
    state = { ...state, [stateKey]: value };
    output.value = formatDb(value);
    renderHeadroom();
    queueSettingsPatch({ [stateKey]: value });
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

els.autoHeadroom.addEventListener('change', () => {
  state = { ...state, autoHeadroom: els.autoHeadroom.checked };
  renderHeadroom();
  queueSettingsPatch({ autoHeadroom: state.autoHeadroom });
});

els.volumeSlider.addEventListener('input', () => {
  const value = Number(els.volumeSlider.value);
  state = { ...state, volume: value };
  els.volumeValue.value = `${Math.round(value)}%`;
  queueSettingsPatch({ volume: value });
});

els.bypassButton.addEventListener('click', () => {
  state = { ...state, bypass: !state.bypass };
  render();
  queueSettingsPatch({ bypass: state.bypass });
});

els.resetButton.addEventListener('click', async () => {
  clearTimeout(patchTimer);
  pendingPatch = {};
  await updateChain;

  const response = await sendMessage({ type: 'RESET_AUDIO', tabId: activeTab.id });
  if (!response?.ok) {
    setMessage(response?.error ?? 'Could not reset Audio+.');
    return;
  }
  state = response.state;
  setMessage('');
  render();
});

buildEqControls();

(async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active browser tab found.');

    activeTab = tab;
    els.siteLabel.textContent = formatHost(tab.url ?? '');

    await refreshState();
  } catch (error) {
    setMessage(error?.message ?? String(error));
    els.powerButton.disabled = true;
  }
})();
