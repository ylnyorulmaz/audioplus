const els = {
  siteLabel: document.querySelector('#siteLabel'),
  statusPill: document.querySelector('#statusPill'),
  powerButton: document.querySelector('#powerButton'),
  bassSlider: document.querySelector('#bassSlider'),
  bassValue: document.querySelector('#bassValue'),
  volumeSlider: document.querySelector('#volumeSlider'),
  volumeValue: document.querySelector('#volumeValue'),
  bypassButton: document.querySelector('#bypassButton'),
  resetButton: document.querySelector('#resetButton'),
  message: document.querySelector('#message')
};

let activeTab = null;
let state = {
  enabled: false,
  bassDb: 0,
  volume: 100,
  bypass: false,
  error: null
};
let busy = false;

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

function render() {
  els.bassSlider.value = String(state.bassDb ?? 0);
  els.bassValue.value = `${state.bassDb > 0 ? '+' : ''}${state.bassDb ?? 0} dB`;

  els.volumeSlider.value = String(state.volume ?? 100);
  els.volumeValue.value = `${state.volume ?? 100}%`;

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
      settings: state
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

async function updateSetting(type, value) {
  if (!activeTab || busy) return;

  const response = await sendMessage({ type, tabId: activeTab.id, value });
  if (!response?.ok) {
    setMessage(response?.error ?? 'Could not update audio setting.');
    return;
  }

  state = response.state;
  setMessage('');
  render();
}

els.powerButton.addEventListener('click', async () => {
  if (state.enabled) await disableAudio();
  else await enableAudio();
});

els.bassSlider.addEventListener('input', () => {
  const value = Number(els.bassSlider.value);
  state = { ...state, bassDb: value };
  render();
});

els.bassSlider.addEventListener('change', () => {
  updateSetting('SET_BASS', Number(els.bassSlider.value));
});

els.volumeSlider.addEventListener('input', () => {
  const value = Number(els.volumeSlider.value);
  state = { ...state, volume: value };
  render();
});

els.volumeSlider.addEventListener('change', () => {
  updateSetting('SET_VOLUME', Number(els.volumeSlider.value));
});

els.bypassButton.addEventListener('click', () => {
  updateSetting('SET_BYPASS', !state.bypass);
});

els.resetButton.addEventListener('click', async () => {
  const response = await sendMessage({ type: 'RESET_AUDIO', tabId: activeTab.id });
  if (!response?.ok) {
    setMessage(response?.error ?? 'Could not reset Audio+.');
    return;
  }
  state = response.state;
  setMessage('');
  render();
});

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
