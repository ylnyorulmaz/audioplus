import { sanitizeSettings } from './audio-settings.js';
import { MDX_INST_HQ3 } from './mdx-profile.js';
import { getInstalledLiveAiModel } from './live-ai-model-store.js';
import { normalizeLiveAiError } from './live-ai-errors.js';
import { getTargetTab } from './target-tab.js';

const button = document.querySelector('#liveAiButton');
const status = document.querySelector('#liveAiStatus');
const compact = Boolean(document.querySelector('.eq-shell'));

let activeTab = null;
let busy = false;
let pollTimer = null;

function liveKey(tabId) { return `audioPlus.liveAi.${tabId}`; }
function siteKeyFromUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.hostname.toLowerCase() : null;
  } catch { return null; }
}
function setStatus(text, tone = '') {
  if (!status) return;
  status.textContent = text;
  status.dataset.tone = tone;
}
function engineLabel(backend) {
  if (backend === 'webgpu') return 'WebGPU';
  if (backend === 'wasm') return 'CPU/WASM';
  return null;
}
function actionableErrorText(value) {
  const detail = value?.errorCode
    ? { code: value.errorCode, message: value.reason ?? 'AI Karaoke stopped.', action: value.action ?? null }
    : normalizeLiveAiError(value);
  const suffix = detail.action ? ` ${detail.action}` : '';
  return `${detail.message}${suffix}`.trim();
}

async function readLiveState() {
  if (!activeTab?.id) return { active: false, phase: 'off', quality: 'off' };
  const key = liveKey(activeTab.id);
  const result = await chrome.storage.session.get(key);
  return result[key] ?? { active: false, phase: 'off', quality: 'off', reason: null, rtf: null, backend: null, errorCode: null, action: null };
}

function isActive(state) {
  return Boolean(state.active && ['starting', 'warming', 'buffering', 'live'].includes(state.phase));
}

function describe(state) {
  if (busy) return status?.textContent ?? '';
  const engine = engineLabel(state.backend);
  if (state.phase === 'starting') return 'Starting local AI engine…';
  if (state.phase === 'warming') return 'Preparing AI Karaoke: GPU first, safe CPU fallback if needed…';
  if (state.phase === 'buffering') {
    if (state.backend === 'wasm') return 'GPU unavailable. Testing CPU/WASM real-time speed safely…';
    if (state.backend === 'webgpu') return 'GPU ready. Measuring real-time speed…';
    return 'Preparing the first AI audio window and measuring this device…';
  }
  if (state.phase === 'live') {
    const rtf = Number.isFinite(state.rtf) ? ` · RTF ${state.rtf.toFixed(2)}×` : '';
    return `AI Karaoke ON${engine ? ` · ${engine}` : ''}${rtf}`;
  }
  if (state.phase === 'fallback') {
    const prefix = 'AI Karaoke needs a faster local engine than this tab has right now.';
    return `${prefix} Normal Audio+ is back. ${state.reason ?? ''} ${state.action ?? ''}`.trim();
  }
  if (state.phase === 'error') return `AI Karaoke could not start. ${actionableErrorText(state)}`;
  return compact
    ? 'Needs WebGPU for real-time; otherwise use Fast Karaoke.'
    : 'Ready. Needs WebGPU for real-time Inst HQ_3; CPU is only used if it can keep up. Fast Karaoke works on any PC.';
}

function render(state) {
  if (!button) return;
  const active = isActive(state);
  button.dataset.active = String(active);
  button.textContent = active
    ? (compact ? 'Stop AI Karaoke' : 'Turn AI Karaoke Off')
    : (compact ? 'AI Karaoke' : 'Try AI Karaoke');
  button.disabled = busy || !activeTab?.id;
  if (!busy) {
    const tone = state.phase === 'live' ? (state.quality === 'good' ? 'success' : 'warning') : ['fallback', 'error'].includes(state.phase) ? 'warning' : '';
    setStatus(describe(state), tone);
  }
}

async function downloadVerifiedModel() {
  const installed = await getInstalledLiveAiModel({ includeBytes: false });
  if (installed?.sha256 === MDX_INST_HQ3.sha256) return installed;

  // Do not Range-probe the packaged ONNX — that can poison Chrome's cache and make the
  // later full-file load return only 1 byte. Presence is verified when offscreen loads it.
  setStatus('Using packaged AI model…');
  return { sha256: MDX_INST_HQ3.sha256, fileName: MDX_INST_HQ3.fileName, packaged: true };
}

async function ensureBaseAudio() {
  const siteKey = siteKeyFromUrl(activeTab.url ?? '');
  const current = await chrome.runtime.sendMessage({ type: 'GET_TAB_STATE', tabId: activeTab.id, siteKey });
  if (!current?.ok) throw new Error(current?.error ?? 'Could not read Audio+ state.');
  if (current.state?.enabled) return current.state;

  setStatus('Enabling Audio+ on this tab…');
  const started = await chrome.runtime.sendMessage({
    type: 'START_CAPTURE',
    tabId: activeTab.id,
    siteKey,
    settings: sanitizeSettings(current.state)
  });
  if (!started?.ok) throw new Error(started?.error ?? 'Could not enable tab audio.');
  return started.state;
}

async function startOneClickAi() {
  busy = true; render(await readLiveState());
  try {
    setStatus('Preparing local AI engine…');
    await downloadVerifiedModel();
    await ensureBaseAudio();
    setStatus('Starting AI Karaoke from the existing Audio+ audio stream…');
    const response = await chrome.runtime.sendMessage({ type: 'START_LIVE_AI_REQUEST', tabId: activeTab.id });
    if (!response?.ok) throw new Error(response?.error ?? 'Live AI request was rejected.');
  } finally {
    busy = false;
    await refresh();
  }
}

async function stopAi() {
  busy = true; button.disabled = true; setStatus('Turning AI Karaoke off…');
  try {
    const response = await chrome.runtime.sendMessage({ type: 'STOP_LIVE_AI_REQUEST', tabId: activeTab.id });
    if (!response?.ok) throw new Error(response?.error ?? 'Could not stop AI Karaoke.');
  } finally { busy = false; await refresh(); }
}

async function refresh() {
  try { render(await readLiveState()); }
  catch (error) { setStatus(actionableErrorText(error), 'error'); if (button) button.disabled = busy; }
}

button?.addEventListener('click', async () => {
  if (busy || !activeTab?.id) return;
  try {
    const state = await readLiveState();
    if (isActive(state)) await stopAi();
    else await startOneClickAi();
  } catch (error) {
    busy = false;
    setStatus(actionableErrorText(error), 'error');
    button.disabled = false;
    button.dataset.active = 'false';
    button.textContent = compact ? 'AI Karaoke' : 'Try AI Karaoke';
  }
});

(async () => {
  activeTab = await getTargetTab();
  if (!activeTab?.id) throw new Error('No browser tab is selected. Open the tab you want and click the Audio+ toolbar icon.');
  await refresh();
  pollTimer = setInterval(() => { if (document.visibilityState === 'visible' && !busy) refresh(); }, 700);
})().catch((error) => setStatus(actionableErrorText(error), 'error'));

window.addEventListener('pagehide', () => clearInterval(pollTimer));
