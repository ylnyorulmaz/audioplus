import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('service worker composes audio bridges and opens a persistent control window', async () => {
  const text=await read('service-worker.js');
  assert.match(text,/^import '\.\/live-ai-background\.js';\nimport '\.\/background\.js';/);
  assert.match(text,/chrome\.action\.onClicked/); assert.match(text,/chrome\.windows\.create/); assert.match(text,/type: 'popup'/); assert.match(text,/popup\.html\?tabId=/);
});

test('target resolver keeps persistent window bound to the original browser tab', async () => {
  const text=await read('target-tab.js');
  assert.match(text,/tabId/); assert.match(text,/chrome\.tabs\.get/); assert.match(text,/protocol === 'http:'/);
});

test('build emits a dedicated classic live AI worker bundle', async () => {
  const text=await read('scripts/build.mjs');
  assert.match(text,/entryPoints: \['live-ai-worker-entry\.js'\]/); assert.match(text,/format: 'iife'/); assert.match(text,/outfile: join\(distDir, 'live-ai-worker\.js'\)/);
});

test('live AI worker is strict WebGPU HQ3 and returns measured RTF', async () => {
  const text=await read('live-ai-worker-entry.js');
  assert.match(text,/onnxruntime-web\/webgpu/); assert.match(text,/executionProviders: \['webgpu'\]/); assert.match(text,/MDX_INST_HQ3\.sha256/); assert.match(text,/mdxGenerationSize/); assert.match(text,/rtf: elapsedMs \/ audioMs/); assert.match(text,/PROCESS_CHUNK/);
});

test('live AI controller hard-bounds memory and falls back above real time', async () => {
  const text=await read('live-ai-controller.js');
  assert.match(text,/const MAX_RTF = 1\.0/); assert.match(text,/const GOOD_RTF = 0\.6/); assert.match(text,/RING_CAPACITY_SAMPLES = mdxChunkSize\(MDX_INST_HQ3\) \* 3/);
  assert.match(text,/ring buffer reached its hard limit/); assert.match(text,/underrun/); assert.match(text,/state\.lastRtf > MAX_RTF/); assert.match(text,/await state\.restoreBase/);
});

test('one-click AI Karaoke auto-downloads, verifies, installs, enables Audio+, and starts live AI', async () => {
  const text=await read('v3-live.js');
  assert.match(text,/huggingface\.co\/seanghay\/uvr_models\/resolve/); assert.match(text,/crypto\.subtle\.digest\('SHA-256'/); assert.match(text,/hash !== MDX_INST_HQ3\.sha256/);
  assert.match(text,/installLiveAiModel/); assert.match(text,/type: 'START_CAPTURE'/); assert.match(text,/type: 'START_LIVE_AI_REQUEST'/); assert.match(text,/Turn AI Karaoke Off/);
});

test('model store keeps verified weights local in IndexedDB', async () => {
  const text=await read('live-ai-model-store.js');
  assert.match(text,/indexedDB\.open/); assert.match(text,/bytes: buffer\.slice\(0\)/); assert.doesNotMatch(text,/fetch\(/);
});

test('popup has explicit AI off path and Fast Karaoke Off control', async () => {
  const html=await read('popup.html'); const live=await read('v3-live.js');
  assert.match(html,/id="liveAiButton"/); assert.match(html,/data-vocal-preset="0"[^>]*>Off</); assert.match(live,/STOP_LIVE_AI_REQUEST/); assert.match(live,/Turn AI Karaoke Off/);
});

test('offscreen host uses separate 44.1 kHz capture and restores base audio', async () => {
  const text=await read('live-ai-offscreen.js');
  assert.match(text,/chromeMediaSource: 'tab'/); assert.match(text,/target: 'offscreen', type: 'APPLY_SETTINGS'/); assert.match(text,/muteBase: \(\) => applyBaseSettings\(tabId, \{ volume: 0 \}\)/); assert.match(text,/restoreBase: \(\) => applyBaseSettings\(tabId, originalSettings\)/);
});

test('offscreen page loads live AI host alongside stable V2 graph', async () => {
  const html=await read('offscreen.html'); assert.match(html,/src="offscreen\.js"/); assert.match(html,/src="live-ai-offscreen\.js"/);
});
