import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('service worker composes live AI bridge before legacy background listener', async () => {
  const text = await source('service-worker.js');
  assert.match(text, /^import '\.\/live-ai-background\.js';\nimport '\.\/background\.js';/);
});

test('build emits a dedicated classic live AI worker bundle', async () => {
  const text = await source('scripts/build.mjs');
  assert.match(text, /entryPoints: \['live-ai-worker-entry\.js'\]/);
  assert.match(text, /format: 'iife'/);
  assert.match(text, /outfile: join\(distDir, 'live-ai-worker\.js'\)/);
});

test('live AI worker is strict WebGPU HQ3 and returns measured RTF', async () => {
  const text = await source('live-ai-worker-entry.js');
  assert.match(text, /onnxruntime-web\/webgpu/);
  assert.match(text, /executionProviders: \['webgpu'\]/);
  assert.match(text, /MDX_INST_HQ3\.sha256/);
  assert.match(text, /mdxGenerationSize/);
  assert.match(text, /rtf: elapsedMs \/ audioMs/);
  assert.match(text, /PROCESS_CHUNK/);
});

test('live AI controller hard-bounds memory and falls back above real time', async () => {
  const text = await source('live-ai-controller.js');
  assert.match(text, /const MAX_RTF = 1\.0/);
  assert.match(text, /const GOOD_RTF = 0\.6/);
  assert.match(text, /RING_CAPACITY_SAMPLES = mdxChunkSize\(MDX_INST_HQ3\) \* 3/);
  assert.match(text, /ring buffer reached its hard limit/);
  assert.match(text, /underrun/);
  assert.match(text, /state\.lastRtf > MAX_RTF/);
  assert.match(text, /await state\.restoreBase/);
});

test('live model store keeps verified weights local in IndexedDB', async () => {
  const text = await source('live-ai-model-store.js');
  assert.match(text, /indexedDB\.open/);
  assert.match(text, /bytes: buffer\.slice\(0\)/);
  assert.doesNotMatch(text, /fetch\(/);
});

test('AI lab installs only the hash-verified HQ3 model for live use', async () => {
  const text = await source('ai-karaoke-lab-entry.js');
  assert.match(text, /hash !== MDX_INST_HQ3\.sha256/);
  assert.match(text, /installLiveAiModel\(buffer/);
  assert.match(text, /installed locally for Live AI Karaoke/);
});

test('offscreen host uses a separate 44.1 kHz capture and restores base audio', async () => {
  const text = await source('live-ai-offscreen.js');
  assert.match(text, /chromeMediaSource: 'tab'/);
  assert.match(text, /target: 'offscreen', type: 'APPLY_SETTINGS'/);
  assert.match(text, /muteBase: \(\) => applyBaseSettings\(tabId, \{ volume: 0 \}\)/);
  assert.match(text, /restoreBase: \(\) => applyBaseSettings\(tabId, originalSettings\)/);
});

test('popup exposes Live AI beta, fallback policy, and latency warning', async () => {
  const html = await source('popup.html');
  const js = await source('v3-live.js');
  assert.match(html, /Live AI Karaoke · Beta/);
  assert.match(html, /RTF &gt; 1\.0×/);
  assert.match(html, /video lip-sync is not preserved/);
  assert.match(html, /src="v3-live\.js"/);
  assert.match(js, /audioPlus\.liveAi\./);
  assert.match(js, /STOP_LIVE_AI_REQUEST/);
});

test('offscreen page loads the live AI host alongside the stable V2 graph', async () => {
  const html = await source('offscreen.html');
  assert.match(html, /src="offscreen\.js"/);
  assert.match(html, /src="live-ai-offscreen\.js"/);
});
