import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { LIVE_AI_ERROR_CODES, liveAiError, normalizeLiveAiError } from '../live-ai-errors.js';

const read = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

test('service worker composes audio bridges and opens Chrome native side panel', async () => {
  const text=await read('service-worker.js');
  assert.match(text,/^import '\.\/live-ai-background\.js';\nimport '\.\/background\.js';/);
  assert.match(text,/chrome\.action\.onClicked/); assert.match(text,/chrome\.sidePanel\.open/); assert.match(text,/audioPlus\.sidePanelTarget/);
  assert.doesNotMatch(text,/chrome\.windows\.create/); assert.doesNotMatch(text,/type: 'popup'/);
});

test('service worker reports audible and active Audio+ tab counts without tabs permission', async () => {
  const text=await read('service-worker.js');
  assert.match(text,/chrome\.tabs\.query\(\{ audible: true \}\)/); assert.match(text,/GET_AUDIO_OVERVIEW/); assert.match(text,/otherAudibleCount/); assert.match(text,/otherEnabledCount/);
  assert.match(text,/audioPlus\.tabLabel/);
});

test('source overview is optional when the equalizer panel hides tab chrome', async () => {
  const text=await read('source-overview.js'); const html=await read('sidepanel.html');
  assert.match(text,/GET_AUDIO_OVERVIEW/); assert.match(text,/if \(!sourceName\) return/);
  assert.doesNotMatch(html,/You're controlling/); assert.doesNotMatch(html,/Current browser tab/); assert.doesNotMatch(html,/id="sourceName"/);
});

test('target resolver keeps native side panel bound to explicitly selected source tab', async () => {
  const text=await read('target-tab.js');
  assert.match(text,/PANEL_TARGET_PREFIX/); assert.match(text,/chrome\.windows\.getCurrent/); assert.match(text,/chrome\.storage\.session\.get/); assert.match(text,/chrome\.tabs\.get/);
});

test('build emits worker bundle and packages local ONNX WASM assets', async () => {
  const text=await read('scripts/build.mjs');
  assert.match(text,/entryPoints: \['live-ai-worker-entry\.js'\]/); assert.match(text,/format: 'esm'/); assert.match(text,/outfile: join\(distDir, 'live-ai-worker\.js'\)/);
  assert.match(text,/ort-wasm\.\*\\\.\(\?:wasm\|mjs\)/); assert.match(text,/vendor\/ort|ortDir/);
});

test('live AI worker prefers WebGPU then falls back to single-thread WASM CPU', async () => {
  const text=await read('live-ai-worker-entry.js');
  assert.match(text,/onnxruntime-web\/webgpu/);
  assert.match(text,/createOnnxSession\(modelBytes, 'webgpu'\)/);
  assert.match(text,/createOnnxSession\(modelBytes, 'wasm'\)/);
  assert.match(text,/ort\?\.InferenceSession\?\.create/);
  assert.match(text,/ort\.env\.wasm\.numThreads = 1/);
  assert.match(text,/ort\.env\.wasm\.proxy = false/);
  assert.match(text,/wasmBinary/);
  assert.match(text,/ort-wasm-simd-threaded\.asyncify\.wasm/);
  assert.match(text,/delete ort\.env\.wasm\.wasmPaths/);
  assert.match(text,/requestAdapter/);
  assert.match(text,/webgpuFallbackReason/);
  assert.match(text,/incomplete result/);
  assert.match(text,/backend/);
  assert.match(text,/measureRealtimeProbe/);
  assert.match(text,/probe RTF/);
  assert.match(text,/powerPreference: 'high-performance'/);
  assert.match(text,/rtf: elapsedMs \/ audioMs/);
  assert.match(text,/PROCESS_CHUNK/);
  assert.match(text,/fetchPackagedModelBuffer/);
  assert.match(text,/message\.modelBytes/);
  assert.match(text,/message\.modelUrl/);
});

test('live AI controller hard-bounds memory, watchdog time, and RTF', async () => {
  const text=await read('live-ai-controller.js');
  assert.match(text,/const MAX_RTF = 1\.0/); assert.match(text,/const GOOD_RTF = 0\.6/);
  assert.match(text,/RING_CAPACITY_SAMPLES = mdxChunkSize\(MDX_INST_HQ3\) \* 2/);
  assert.match(text,/INFERENCE_WATCHDOG_MS/); assert.match(text,/inference exceeded the real-time budget/);
  assert.match(text,/ring buffer reached its hard limit/); assert.match(text,/underrun/); assert.match(text,/state\.lastRtf > MAX_RTF/);
  assert.match(text,/state\.worker\.terminate/); assert.match(text,/stopLiveAi\(state, \{ restoreBase: false, preserveStatus: true \}\)/);
  assert.match(text,/audioWorklet\.addModule/);
  assert.match(text,/AudioWorkletNode/);
  assert.match(text,/live-ai-capture-worklet\.js/);
  assert.match(text,/captureArmed/);
  assert.doesNotMatch(text,/createScriptProcessor/);
  assert.match(text,/event\?\.error\?\.message/);
  assert.match(text,/modelUrl: chrome\.runtime\.getURL\(MDX_INST_HQ3\.fileName\)/);
  assert.match(text,/loadPackagedModelBytes/);
  assert.match(text,/modelBytes/);
  assert.match(text,/type: 'module'/);
  assert.match(text,/fetching the script/);
});

test('base background ignores live AI messages so offscreen can answer START_LIVE_AI', async () => {
  const text=await read('background.js');
  assert.match(text,/message\.target === 'live-offscreen'/);
  assert.match(text,/START_LIVE_AI_REQUEST/);
  assert.match(text,/STOP_LIVE_AI_REQUEST/);
  assert.match(text,/LIVE_AI_STATUS/);
});

test('Live AI is exclusive across tabs while base Audio+ remains per-tab', async () => {
  const text=await read('live-ai-background.js');
  assert.match(text,/stopOtherLiveTabs/); assert.match(text,/switched-to-another-tab/); assert.match(text,/stateLooksLive/); assert.match(text,/await stopOtherLiveTabs\(tabId\)/);
  const base=await read('background.js'); assert.match(base,/audioPlus\.tab\./); assert.match(base,/message\.tabId/);
});

test('live AI reuses the existing base capture instead of opening a second tabCapture stream', async () => {
  const background=await read('live-ai-background.js');
  const host=await read('live-ai-offscreen.js');
  const bridge=await read('capture-bridge.js');
  const html=await read('offscreen.html');
  assert.doesNotMatch(background,/tabCapture\.getMediaStreamId/);
  assert.doesNotMatch(host,/getUserMedia|chromeMediaSourceId/);
  assert.match(host,/cloneBaseCapture/); assert.match(host,/shared-base-stream/);
  assert.match(bridge,/pendingByStreamId/); assert.match(bridge,/stream\.clone\(\)/); assert.match(bridge,/audioPlusCaptureBridge/);
  assert.ok(html.indexOf('capture-bridge.js') < html.indexOf('offscreen.js'));
  assert.match(html,/<script src="capture-bridge\.js"><\/script>/);
});

test('one-click AI Karaoke no longer blocks on a UI WebGPU preflight', async () => {
  const text=await read('v3-live.js');
  assert.match(text,/Using packaged AI model/); assert.match(text,/downloadVerifiedModel/);
  assert.match(text,/type: 'START_CAPTURE'/); assert.match(text,/type: 'START_LIVE_AI_REQUEST'/); assert.match(text,/Turn AI Karaoke Off/);
  assert.match(text,/CPU\/WASM/);
  assert.doesNotMatch(text,/requestAdapter/); assert.doesNotMatch(text,/powerPreference/);
  assert.doesNotMatch(text,/Range: 'bytes=0-0'/);
});

test('session TypeError maps to a recoverable worker init error', () => {
  const detail = normalizeLiveAiError(new TypeError("Cannot read properties of undefined (reading 'session')"));
  assert.equal(detail.code, LIVE_AI_ERROR_CODES.WORKER_INIT_FAILED);
  assert.match(detail.message,/could not create a session/i);
  const wrapped = liveAiError(LIVE_AI_ERROR_CODES.UNKNOWN, "Cannot read properties of undefined (reading 'session')", 'Turn AI Karaoke off, keep normal Audio+ enabled, and try again.');
  assert.equal(normalizeLiveAiError(wrapped).code, LIVE_AI_ERROR_CODES.WORKER_INIT_FAILED);
});

test('live AI errors are structured and side panel displays recovery actions', async () => {
  const errors=await read('live-ai-errors.js'); const host=await read('live-ai-offscreen.js'); const background=await read('live-ai-background.js'); const ui=await read('v3-live.js');
  assert.match(errors,/BASE_CAPTURE_MISSING/); assert.match(errors,/CPU_TOO_SLOW/); assert.match(errors,/MODEL_INVALID/); assert.match(errors,/WORKER_INIT_FAILED/); assert.match(errors,/WEBGPU_UNAVAILABLE/); assert.match(errors,/reading 'session'/); assert.match(errors,/normalizeLiveAiError/);
  assert.match(host,/liveAiStatusFromError/); assert.match(host,/errorCode/); assert.match(host,/action/); assert.match(host,/type: 'LIVE_AI_STATUS'/);
  assert.match(background,/liveAiStatusFromError/); assert.match(background,/BASE_NOT_ENABLED/); assert.match(background,/did not answer the start request/); assert.match(background,/LIVE_AI_STATUS/);
  assert.match(ui,/actionableErrorText/); assert.match(ui,/state\.action/);
});

test('model store keeps verified weights local in IndexedDB', async () => {
  const text=await read('live-ai-model-store.js');
  assert.match(text,/indexedDB\.open/); assert.match(text,/bytes: buffer\.slice\(0\)/);
  assert.match(text,/fetchPackagedModelBuffer/); assert.match(text,/packagedModelUrlCandidates/);
  assert.match(text,/loadPackagedModelBytes/); assert.match(text,/fetchArrayBufferNoStore/);
  assert.match(text,/assertModelByteLength/); assert.match(text,/coerceModelBytes/);
  assert.match(text,/globalThis\.chrome\?\.runtime\?\.getURL/);
  assert.doesNotMatch(text,/typeof chrome\?\.runtime/);
  assert.doesNotMatch(text,/Range:/);
});

test('side panel has explicit AI off path and Fast Karaoke Off control', async () => {
  const html=await read('sidepanel.html'); const live=await read('v3-live.js');
  assert.match(html,/id="liveAiButton"/); assert.match(html,/data-vocal-preset="0"[^>]*>Off</); assert.match(live,/STOP_LIVE_AI_REQUEST/); assert.match(live,/Turn AI Karaoke Off/);
});

test('side panel target sync reloads existing panel when user selects another source tab', async () => {
  const text=await read('sidepanel-target-sync.js'); const worker=await read('service-worker.js');
  assert.match(text,/SIDE_PANEL_TARGET_CHANGED/); assert.match(text,/location\.reload/);
  assert.match(worker,/SIDE_PANEL_TARGET_CHANGED/); assert.match(worker,/audioPlus\.sidePanelTarget/);
});

test('offscreen host preflights packaged worker and restores base audio', async () => {
  const text=await read('live-ai-offscreen.js');
  assert.match(text,/assertLiveRuntimePackaged/); assert.match(text,/dist\/live-ai-worker\.js/); assert.match(text,/ort-wasm-simd-threaded\.asyncify\.wasm/); assert.match(text,/npm install && npm run build/);
  assert.doesNotMatch(text,/Range:/); assert.doesNotMatch(text,/UVR-MDX-NET-Inst_HQ_3\.onnx/);
  assert.match(text,/target: 'offscreen', type: 'APPLY_SETTINGS'/); assert.match(text,/muteBase: \(\) => applyBaseSettings\(tabId, \{ volume: 0 \}\)/); assert.match(text,/restoreBase: \(\) => applyBaseSettings\(tabId, originalSettings\)/);
});

test('offscreen page loads capture bridge before base and live AI hosts', async () => {
  const html=await read('offscreen.html');
  const bridge=html.indexOf('capture-bridge.js'); const base=html.indexOf('offscreen.js'); const live=html.indexOf('live-ai-offscreen.js');
  assert.ok(bridge >= 0 && bridge < base && base < live);
});
