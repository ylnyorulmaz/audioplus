import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Live AI offscreen preflights generated worker and ORT assets with actionable rebuild guidance', async () => {
  const source = await readFile(new URL('../live-ai-offscreen.js', import.meta.url), 'utf8');
  assert.match(source, /dist\/live-ai-worker\.js/);
  assert.match(source, /vendor\/ort\/ort-wasm-simd-threaded\.jsep\.wasm/);
  assert.match(source, /fetch\(url, \{ cache: 'no-store' \}\)/);
  assert.match(source, /npm install/);
  assert.match(source, /npm run build/);
  assert.match(source, /chrome:\/\/extensions/);
});

test('generated Live AI assets remain build outputs rather than committed source files', async () => {
  const ignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.match(ignore, /^dist\/$/m);
  assert.match(ignore, /^vendor\/$/m);
});
