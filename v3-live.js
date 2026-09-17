import { getInstalledLiveAiModel } from './live-ai-model-store.js';

const button = document.querySelector('#liveAiButton');
const status = document.querySelector('#liveAiStatus');
const installLink = document.querySelector('#liveAiInstallLink');
const powerButton = document.querySelector('#powerButton');

let activeTab = null;
let modelInstalled = false;
let pollTimer = null;

function liveKey(tabId) { return `audioPlus.liveAi.${tabId}`; }

async function readLiveState() {
  if (!activeTab?.id) return { active: false, phase: 'off' };
  const key = liveKey(activeTab.id);
  const result = await chrome.storage.session.get(key);
  return result[key] ?? { active: false, phase: 'off', quality: 'off', reason: null, rtf: null };
}

function describe(state) {
  if (!modelInstalled) return 'Install the verified HQ3 model in AI Karaoke Lab first.';
  if (state.phase === 'starting') return 'Starting local AI capture…';
  if (state.phase === 'warming' || state.phase === 'buffering') return 'Buffering the first ~5.9 s chunk and measuring real-time performance…';
  if (state.phase === 'live') {
    const rtf = Number.isFinite(state.rtf) ? `RTF ${state.rtf.toFixed(2)}×` : 'RTF measuring';
    const quality = state.quality === 'good' ? 'device healthy' : 'device near the live limit';
    return `Live AI Karaoke active · ${rtf} · ${quality}. Audio is delayed by the model look-ahead window.`;
  }
  if (state.phase === 'fallback') return `AI stopped safely and normal Audio+ audio was restored. ${state.reason ?? ''}`.trim();
  if (state.phase === 'error') return `AI could not start. ${state.reason ?? ''}`.trim();
  return 'Uses a bounded local buffer. If RTF exceeds 1.0× or the queue underruns/overflows, Audio+ restores the normal audio path automatically.';
}

function render(state) {
  const active = Boolean(state.active && ['starting', 'warming', 'buffering', 'live'].includes(state.phase));
  button.disabled = !activeTab || (!modelInstalled && !active);
  button.textContent = active ? 'Stop Live AI Karaoke' : 'Start Live AI Karaoke';
  button.dataset.active = String(active);
  status.textContent = describe(state);
  status.dataset.tone = state.phase === 'live' ? (state.quality === 'good' ? 'success' : 'warning') : (['error', 'fallback'].includes(state.phase) ? 'warning' : '');
  installLink.hidden = modelInstalled;
}

async function refresh() {
  try {
    const state = await readLiveState();
    render(state);
  } catch (error) {
    status.textContent = error?.message ?? String(error);
    status.dataset.tone = 'error';
  }
}

async function sendRequest(type) {
  if (!activeTab?.id) return;
  const response = await chrome.runtime.sendMessage({ type, tabId: activeTab.id });
  if (!response?.ok) throw new Error(response?.error ?? 'Live AI request was rejected.');
  await new Promise((resolve) => setTimeout(resolve, 150));
  await refresh();
}

button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    const state = await readLiveState();
    const active = Boolean(state.active && ['starting', 'warming', 'buffering', 'live'].includes(state.phase));
    await sendRequest(active ? 'STOP_LIVE_AI_REQUEST' : 'START_LIVE_AI_REQUEST');
  } catch (error) {
    status.textContent = error?.message ?? String(error);
    status.dataset.tone = 'error';
  } finally {
    await refresh();
  }
});

powerButton?.addEventListener('click', () => {
  readLiveState().then((state) => {
    if (state.active) chrome.runtime.sendMessage({ type: 'STOP_LIVE_AI_REQUEST', tabId: activeTab?.id }).catch(() => {});
  }).catch(() => {});
}, true);

(async () => {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  modelInstalled = Boolean(await getInstalledLiveAiModel({ includeBytes: false }));
  await refresh();
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') refresh();
  }, 750);
})();

window.addEventListener('pagehide', () => clearInterval(pollTimer));
