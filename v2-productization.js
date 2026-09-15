import { EQ_FREQUENCIES } from './audio-settings.js';

const POLL_MS = 240;
const spectrumBars = document.querySelector('#spectrumBars');
const spectrumStatus = document.querySelector('#spectrumStatus');
const spectrumMetrics = document.querySelector('#spectrumMetrics');
const advancedPanel = document.querySelector('#advancedPanel');
const powerButton = document.querySelector('#powerButton');

let activeTab = null;
let state = null;
let stopped = false;
let polling = false;

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

function buildBars() {
  spectrumBars.replaceChildren();
  for (const frequency of EQ_FREQUENCIES) {
    const column = document.createElement('div');
    column.className = 'spectrum-column';

    const track = document.createElement('div');
    track.className = 'spectrum-track';

    const fill = document.createElement('div');
    fill.className = 'spectrum-fill';
    fill.dataset.frequency = String(frequency);
    fill.style.height = '2%';

    const label = document.createElement('span');
    label.className = 'spectrum-label';
    label.textContent = formatFrequency(frequency);

    track.append(fill);
    column.append(track, label);
    spectrumBars.append(column);
  }
}

function resetSpectrum(message = 'Open Advanced while Audio+ is active.') {
  for (const fill of spectrumBars.querySelectorAll('.spectrum-fill')) fill.style.height = '2%';
  spectrumStatus.textContent = 'Idle';
  spectrumMetrics.textContent = message;
}

function renderSpectrum(snapshot) {
  const levels = Array.isArray(snapshot?.levels) ? snapshot.levels : [];
  const fills = [...spectrumBars.querySelectorAll('.spectrum-fill')];
  fills.forEach((fill, index) => {
    const level = Math.max(0, Math.min(1, Number(levels[index]) || 0));
    fill.style.height = `${Math.max(2, Math.round(level * 100))}%`;
  });

  spectrumStatus.textContent = snapshot?.contextState === 'running' ? 'Live' : snapshot?.contextState ?? 'Live';
  const rms = Number(snapshot?.rmsDb);
  const peak = Number(snapshot?.peakDb);
  spectrumMetrics.textContent = Number.isFinite(rms) && Number.isFinite(peak)
    ? `Input ${rms.toFixed(1)} dB RMS · Peak ${peak.toFixed(1)} dB`
    : 'Live input spectrum';
}

async function refreshState() {
  if (!activeTab) return;
  const response = await chrome.runtime.sendMessage({
    type: 'GET_TAB_STATE',
    tabId: activeTab.id,
    siteKey: siteKeyFromUrl(activeTab.url)
  });
  if (response?.ok) state = response.state;
}

async function pollSpectrum() {
  if (polling || stopped || !activeTab) return;
  if (document.visibilityState !== 'visible' || !advancedPanel.open) return;
  if (!state?.enabled) {
    resetSpectrum('Enable Audio+ to view the live input spectrum.');
    return;
  }

  polling = true;
  try {
    const response = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'GET_SPECTRUM', tabId: activeTab.id });
    if (!response?.ok || !response.active) {
      state = { ...(state ?? {}), enabled: false };
      resetSpectrum('Audio processor is not active.');
      return;
    }
    renderSpectrum(response.spectrum);
  } catch {
    resetSpectrum('Spectrum unavailable while the audio processor reconnects.');
  } finally {
    polling = false;
  }
}

async function loop() {
  while (!stopped) {
    await pollSpectrum();
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

advancedPanel.addEventListener('toggle', () => {
  if (advancedPanel.open) {
    refreshState().then(pollSpectrum).catch(console.error);
  } else {
    resetSpectrum(state?.enabled ? 'Open Advanced to view the live input spectrum.' : 'Enable Audio+ to view the live input spectrum.');
  }
});

powerButton.addEventListener('click', () => {
  setTimeout(() => refreshState().then(pollSpectrum).catch(console.error), 300);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshState().then(pollSpectrum).catch(console.error);
});

window.addEventListener('pagehide', () => { stopped = true; });

(async () => {
  buildBars();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  activeTab = tab;
  await refreshState();
  resetSpectrum(state?.enabled ? 'Open Advanced to view the live input spectrum.' : 'Enable Audio+ to view the live input spectrum.');
  loop().catch(console.error);
})().catch((error) => {
  spectrumStatus.textContent = 'Unavailable';
  spectrumMetrics.textContent = error?.message ?? String(error);
});
