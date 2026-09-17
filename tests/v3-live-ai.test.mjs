import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

test('service worker composes audio bridges and opens Chrome native side panel', async () => {
  const text=await read('service-worker.js');
  assert.match(text,/^import '\.\/live-ai-background\.js';\nimport '\.\/background\.js';/);
  assert.match(text,/chrome\.action\.onClicked/); assert.match(text,/chrome\.sidePanel\.open/); assert.match(text,/sidepanel\.html/);
  assert.doesNotMatch(text,/chrome\.windows\.create/); assert.doesNotMatch(text,/type: 'popup'/);
});

test('service worker reports audible and active Audio+ tab counts without tabs permission', async () => {
  const text=await read('service-worker.js');
  assert.match(text,/chrome\.tabs\.query\(\{ audible: true \}\)/); assert.match(text,/GET_AUDIO_OVERVIEW/); assert.match(text,/otherAudibleCount/); assert.match(text,/otherEnabledCount/);
  assert.match(text,/audioPlus\.tabLabel/);
});

test('source overview makes the bound tab and other audio sessions visible in side panel', async () => {
  const text=await read('source-overview.js'); const html=await read('sidepanel.html');
  assert.match(text,/GET_AUDIO_OVERVIEW/); assert.match(text,/focusSourceButton/); assert.match(text,/otherAudibleCount/); assert.match(text,/otherEnabledCount/);
  assert.match(html,/Selected audio source/); assert.match(html,/id="sourceName"/); assert.match(html,/id="audibleTabsBadge"/); assert.match(html,/id="sessionsBadge"/);
});

test('target resolver keeps native side panel bound to explicitly selected source tab', async () => {
  const text=await read('target-tab.js');
  assert.match(text,/PANEL_TARGET_PREFIX/); assert.match(text,/chrome\.windows\.getCurrent/); assert.match(text,/chrome\.storage\.session\.get/); assert.match(text,/chrome\.tabs\.get/);
});

test('build emits worker bundle and packages local ONNX WASM assets', async () => {
  const text=await read('scripts/build.mjs');
  assert.match(text,/entryPoints: \['live-ai-worker-entry\.js'\]/); assert.match(text,/format: 'iife'/); assert.match(text,/outfile: join\(distDir, 'live-ai-worker\.js'\)/);
  assert.match(text,/ort-wasm\.\*\\\.\(\?:wasm\|mjs\)/); assert.match(text,/vendor\/ort|ortDir/);
});

test('live AI worker prefers WebGPU then falls back to single-thread WASM CPU', async () => {
  const text=await read('live-ai-worker-entry.js');
  assert.match(text,/onnxruntime-web\/webgpu/);
  assert.match(text,/executionProviders: \['webgpu'\]/);
  assert.match(text,/executionProviders: \['wasm'\]/);
  assert.match(text,/ort\.env\.wasm\.numThreads = 1/);
  assert.match(text,/webgpuFallbackReason/);
  assert.match(text,/backend/);
  assert.match(text,/rtf: elapsedMs \/ audioMs/);
  assert.match(text,/PROCESS_CHUNK/);
});

test('live AI controller hard-bounds memory, watchdog time, and RTF', async () => {
  const text=await read('live-ai-controller.js');
  assert.match(text,/const MAX_RTF = 1\.0/); assert.match(text,/const GOOD_RTF = 0\.6/);
  assert.match(text,/RING_CAPACITY_SAMPLES = mdxChunkSize\(MDX_INST_HQ3\) \* 2/);
  assert.match(text,/INFERENCE_WATCHDOG_MS/); assert.match(text,/inference exceeded the real-time budget/);
  assert.match(text,/ring buffer reached its hard limit/); assert.match(text,/underrun/); assert.match(text,/state\.lastRtf > MAX_RTF/);
  assert.match(text,/state\.worker\.terminate/); assert.match(text,/stopLiveAi\(state, \{ restoreBase: false, preserveStatus: true \}\)/);
});

test('Live AI is exclusive across tabs while base Audio+ remains per-tab', async () => {
  const text=await read('live-ai-background.js');
  assert.match(text,/stopOtherLiveTabs/); assert.match(text,/switched-to-another-tab/); assert.match(text,/stateLooksLive/); assert.match(text,/await stopOtherLiveTabs\(tabId\)/);
  const base=await read('background.js'); assert.match(base,/audioPlus\.tab\./); assert.match(base,/message\.tabId/);
});

test('one-click AI Karaoke no longer blocks on a UI WebGPU preflight', async () => {
  const text=await read('v3-live.js');
  assert.match(text,/huggingface\.co\/seanghay\/uvr_models\/resolve/); assert.match(text,/crypto\.subtle\.digest\('SHA-256'/); assert.match(text,/hash !== MDX_INST_HQ3\.sha256/);
  assert.match(text,/installLiveAiModel/); assert.match(text,/type: 'START_CAPTURE'/); assert.match(text,/type: 'START_LIVE_AI_REQUEST'/); assert.match(text,/Turn AI Karaoke Off/);
  assert.match(text,/WebGPU first, CPU fallback/); assert.match(text,/CPU\/WASM/);
  assert.doesNotMatch(text,/requestAdapter/); assert.doesNotMatch(text,/powerPreference/);
});

test('model store keeps verified weights local in IndexedDB', async () => {
  const text=await read('live-ai-model-store.js');
  assert.match(text,/indexedDB\.open/); assert.match(text,/bytes: buffer\.slice\(0\)/); assert.doesNotMatch(text,/fetch\(/);
});

test('side panel has explicit AI off path and Fast Karaoke Off control', async () => {
  const html=await read('sidepanel.html'); const live=await read('v3-live.js');
  assert.match(html,/id="liveAiButton"/); assert.match(html,/data-vocal-preset="0"[^>]*>Off/); assert.match(live,/STOP_LIVE_AI_REQUEST/); assert.match(live,/Turn AI Karaoke Off/);
});

test('side panel target sync reloads existing panel when user selects another source tab', async () => {
  const text=await read('sidepanel-target-sync.js'); const worker=await read('service-worker.js');
  assert.match(text,/SIDE_PANEL_TARGET_CHANGED/); assert.match(text,/location\.reload/);
  assert.match(worker,/SIDE_PANEL_TARGET_CHANGED/); assert.match(worker,/audioPlus\.sidePanelTarget/);
});

test('offscreen host preflights packaged worker and restores base audio', async () => {
  const text=await read('live-ai-offscreen.js');
  assert.match(text,/assertLiveRuntimePackaged/); assert.match(text,/dist\/live-ai-worker\.js/); assert.match(text,/npm install && npm run build/);
  assert.match(text,/chromeMediaSource: 'tab'/); assert.match(text,/target: 'offscreen', type: 'APPLY_SETTINGS'/); assert.match(text,/muteBase: \(\) => applyBaseSettings\(tabId, \{ volume: 0 \}\)/); assert.match(text,/restoreBase: \(\) => applyBaseSettings\(tabId, originalSettings\)/);
});

test('offscreen page loads live AI host alongside stable V2 graph', async () => {
  const html=await read('offscreen.html'); assert.match(html,/src="offscreen\.js"/); assert.match(html,/src="live-ai-offscreen\.js"/);
});
