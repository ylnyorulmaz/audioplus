import { sanitizeSettings } from './audio-settings.js';
import { resolveTargetTab } from './target-tab.js';

const button = document.querySelector('#liveAiButton');
const status = document.querySelector('#liveAiStatus');
const powerButton = document.querySelector('#powerButton');

let activeTab = null;
let pollTimer = null;

function liveKey(tabId) { return `audioPlus.liveAi.${tabId}`; }
function siteKeyFromUrl(url) {
  try { const parsed = new URL(url); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.hostname.toLowerCase() : null; }
  catch { return null; }
}

async function readLiveState() {
  if (!activeTab?.id) return { active: false, phase: 'off' };
  const key = liveKey(activeTab.id);
  return (await chrome.storage.session.get(key))[key] ?? { active: false, phase: 'off', quality: 'off', reason: null, rtf: null };
}

function describe(state) {
  if (state.phase === 'starting') return 'Starting AI Karaoke…';
  if (state.phase === 'warming' || state.phase === 'buffering') return 'Preparing the first AI audio segment…';
  if (state.phase === 'live') return state.quality === 'good' ? 'AI Karaoke is on.' : 'AI Karaoke is on. This computer is working near its real-time limit.';
  if (state.phase === 'fallback') return state.reason || 'AI Karaoke stopped safely and normal Audio+ audio was restored.';
  if (state.phase === 'error') return state.reason || 'AI Karaoke could not start.';
  return 'Ready. Press Start and Audio+ will set up everything automatically.';
}

function render(state) {
  const active = Boolean(state.active && ['starting', 'warming', 'buffering', 'live'].includes(state.phase));
  button.disabled = !activeTab;
  button.textContent = active ? 'Stop AI Karaoke' : 'Start AI Karaoke';
  button.dataset.active = String(active);
  status.textContent = describe(state);
  status.dataset.tone = state.phase === 'live' ? (state.quality === 'good' ? 'success' : 'warning') : (['error', 'fallback'].includes(state.phase) ? 'warning' : '');
}

async function ensureBaseAudio() {
  const siteKey = siteKeyFromUrl(activeTab?.url ?? '');
  const stateResponse = await chrome.runtime.sendMessage({ type: 'GET_TAB_STATE', tabId: activeTab.id, siteKey });
  if (!stateResponse?.ok) throw new Error(stateResponse?.error ?? 'Could not read Audio+ state.');
  if (stateResponse.state?.enabled) return;

  const ensured = await chrome.runtime.sendMessage({ type: 'ENSURE_OFFSCREEN' });
  if (!ensured?.ok) throw new Error(ensured?.error ?? 'Could not prepare Audio+.');
  const started = await chrome.runtime.sendMessage({
    type: 'START_CAPTURE',
    tabId: activeTab.id,
    siteKey,
    settings: sanitizeSettings(stateResponse.state)
  });
  if (!started?.ok) throw new Error(started?.error ?? 'Could not start tab audio.');
}

async function startLive() {
  await ensureBaseAudio();
  const response = await chrome.runtime.sendMessage({ type: 'START_LIVE_AI_REQUEST', tabId: activeTab.id });
  if (!response?.ok) throw new Error(response?.error ?? 'AI Karaoke request was rejected.');
}

async function stopLive() {
  const response = await chrome.runtime.sendMessage({ type: 'STOP_LIVE_AI_REQUEST', tabId: activeTab.id });
  if (!response?.ok) throw new Error(response?.error ?? 'Could not stop AI Karaoke.');
}

async function refresh() {
  try { render(await readLiveState()); }
  catch (error) { status.textContent = error?.message ?? String(error); status.dataset.tone = 'error'; }
}

button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    const state = await readLiveState();
    const active = Boolean(state.active && ['starting', 'warming', 'buffering', 'live'].includes(state.phase));
    status.textContent = active ? 'Stopping AI Karaoke…' : 'Starting AI Karaoke…';
    if (active) await stopLive(); else await startLive();
    await new Promise((resolve) => setTimeout(resolve, 150));
  } catch (error) {
    status.textContent = error?.message ?? String(error);
    status.dataset.tone = 'error';
  } finally { await refresh(); }
});

powerButton?.addEventListener('click', () => {
  readLiveState().then((state) => {
    if (state.active) chrome.runtime.sendMessage({ type: 'STOP_LIVE_AI_REQUEST', tabId: activeTab?.id }).catch(() => {});
  }).catch(() => {});
}, true);

(async () => {
  activeTab = await resolveTargetTab();
  await refresh();
  pollTimer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 750);
})();

window.addEventListener('pagehide', () => clearInterval(pollTimer));
