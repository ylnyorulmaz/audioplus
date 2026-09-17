import { sanitizeSettings } from './audio-settings.js';
import { MDX_INST_HQ3 } from './mdx-profile.js';
import { getInstalledLiveAiModel, installLiveAiModel } from './live-ai-model-store.js';
import { getTargetTab } from './target-tab.js';

const MODEL_URL = 'https://huggingface.co/seanghay/uvr_models/resolve/main/UVR-MDX-NET-Inst_HQ_3.onnx?download=true';
const button = document.querySelector('#liveAiButton');
const status = document.querySelector('#liveAiStatus');

let activeTab = null;
let busy = false;
let pollTimer = null;
let inferenceCapabilityPromise = null;

function liveKey(tabId) { return `audioPlus.liveAi.${tabId}`; }
function siteKeyFromUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.hostname.toLowerCase() : null;
  } catch { return null; }
}
function setStatus(text, tone = '') {
  status.textContent = text;
  status.dataset.tone = tone;
}
function humanMb(bytes) { return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function readLiveState() {
  if (!activeTab?.id) return { active: false, phase: 'off', quality: 'off' };
  const key = liveKey(activeTab.id);
  const result = await chrome.storage.session.get(key);
  return result[key] ?? { active: false, phase: 'off', quality: 'off', reason: null, rtf: null };
}

function isActive(state) {
  return Boolean(state.active && ['starting', 'warming', 'buffering', 'live'].includes(state.phase));
}

function providerLabel(state) {
  if (state.provider === 'wasm') return 'CPU';
  if (state.provider === 'webgpu') return 'GPU';
  return '';
}

function describe(state) {
  if (busy) return status.textContent;
  const provider = providerLabel(state);
  const suffix = provider ? ` · ${provider}` : '';
  if (state.phase === 'starting') return `Starting AI Karaoke${suffix}…`;
  if (state.phase === 'warming' || state.phase === 'buffering') return `Preparing the first AI audio window${suffix} and measuring this device…`;
  if (state.phase === 'live') {
    const rtf = Number.isFinite(state.rtf) ? ` · RTF ${state.rtf.toFixed(2)}×` : '';
    return `AI Karaoke ON${suffix}${rtf}`;
  }
  if (state.phase === 'fallback') return `AI mode stopped safely; normal Audio+ audio is back. ${state.reason ?? ''}`.trim();
  if (state.phase === 'error') return `AI Karaoke could not start. ${state.reason ?? ''}`.trim();
  return 'Ready. First use installs the local AI model automatically.';
}

function render(state) {
  const active = isActive(state);
  button.dataset.active = String(active);
  button.textContent = active ? 'Turn AI Karaoke Off' : 'AI Karaoke';
  button.disabled = busy || !activeTab?.id;
  if (!busy) {
    const tone = state.phase === 'live' ? (state.quality === 'good' ? 'success' : 'warning') : ['fallback', 'error'].includes(state.phase) ? 'warning' : '';
    setStatus(describe(state), tone);
  }
}

async function detectInferenceCapability() {
  if (!inferenceCapabilityPromise) {
    inferenceCapabilityPromise = (async () => {
      if (!navigator.gpu) {
        return { provider: 'wasm', reason: 'WebGPU is unavailable in this browser session.' };
      }
      try {
        // On Windows Chrome ignores powerPreference, so request the browser-selected adapter.
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return { provider: 'wasm', reason: 'Chrome could not expose a WebGPU adapter.' };
        return { provider: 'webgpu', reason: null };
      } catch (error) {
        return { provider: 'wasm', reason: error?.message ?? 'WebGPU adapter detection failed.' };
      }
    })();
  }
  return inferenceCapabilityPromise;
}

async function downloadVerifiedModel() {
  const installed = await getInstalledLiveAiModel({ includeBytes: false });
  if (installed?.sha256 === MDX_INST_HQ3.sha256) return installed;

  setStatus(`First use: downloading ${MDX_INST_HQ3.displayName} (~67 MB)…`, '');
  const response = await fetch(MODEL_URL, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`AI model download failed (${response.status}). Try AI Karaoke again.`);

  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    return verifyAndInstall(buffer);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (total > 0) setStatus(`Installing AI model… ${Math.min(100, Math.round(received / total * 100))}% (${humanMb(received)})`);
    else setStatus(`Installing AI model… ${humanMb(received)} downloaded`);
  }

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return verifyAndInstall(merged.buffer);
}

async function verifyAndInstall(buffer) {
  setStatus('Verifying AI model…');
  const hash = await sha256Hex(buffer);
  if (hash !== MDX_INST_HQ3.sha256) throw new Error('Downloaded AI model failed integrity verification. Nothing was installed.');
  await installLiveAiModel(buffer, { fileName: MDX_INST_HQ3.fileName, size: buffer.byteLength, sha256: hash });
  setStatus('AI model installed locally. Starting Karaoke…', 'success');
  return getInstalledLiveAiModel({ includeBytes: false });
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
    setStatus('Checking local AI acceleration…');
    const capability = await detectInferenceCapability();
    if (capability.provider === 'wasm') {
      setStatus('WebGPU unavailable. Testing fully local CPU fallback; it will stop automatically if this device is too slow.', 'warning');
    } else {
      setStatus('Local GPU acceleration available.');
    }
    await downloadVerifiedModel();
    await ensureBaseAudio();
    setStatus(capability.provider === 'wasm' ? 'Starting AI Karaoke on local CPU…' : 'Starting Live AI Karaoke on GPU…');
    const response = await chrome.runtime.sendMessage({
      type: 'START_LIVE_AI_REQUEST',
      tabId: activeTab.id,
      executionProvider: capability.provider
    });
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
  catch (error) { setStatus(error?.message ?? String(error), 'error'); button.disabled = busy; }
}

button.addEventListener('click', async () => {
  if (busy || !activeTab?.id) return;
  try {
    const state = await readLiveState();
    if (isActive(state)) await stopAi();
    else await startOneClickAi();
  } catch (error) {
    busy = false;
    setStatus(error?.message ?? String(error), 'error');
    button.disabled = false;
    button.dataset.active = 'false';
    button.textContent = 'AI Karaoke';
  }
});

(async () => {
  activeTab = await getTargetTab();
  if (!activeTab?.id) throw new Error('No browser tab selected for AI Karaoke.');
  await refresh();
  pollTimer = setInterval(() => { if (document.visibilityState === 'visible' && !busy) refresh(); }, 700);
})().catch((error) => setStatus(error?.message ?? String(error), 'error'));

window.addEventListener('pagehide', () => clearInterval(pollTimer));
