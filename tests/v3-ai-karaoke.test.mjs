import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('V3 prototype pins local ONNX Runtime Web and build tool versions', async () => {
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(pkg.dependencies['onnxruntime-web'],'1.29.0');
  assert.equal(pkg.devDependencies.esbuild,'0.25.9');
  assert.equal(pkg.scripts.build,'node scripts/build.mjs');
});

test('MV3 CSP permits packaged WASM without adding remote script sources', async () => {
  const manifest=JSON.parse(await readFile(new URL('../manifest.json',import.meta.url),'utf8'));
  const csp=manifest.content_security_policy?.extension_pages ?? '';
  assert.match(csp,/script-src 'self' 'wasm-unsafe-eval'/);
  assert.match(csp,/object-src 'self'/);
  assert.doesNotMatch(csp,/https?:/);
});

test('AI Karaoke Lab loads only a local ONNX file and strict WebGPU execution provider', async () => {
  const source=await readFile(new URL('../ai-karaoke-lab-entry.js',import.meta.url),'utf8');
  assert.match(source,/from 'onnxruntime-web\/webgpu'/);
  assert.match(source,/navigator\.gpu/);
  assert.match(source,/requestAdapter\(\{ powerPreference: 'high-performance' \}\)/);
  assert.match(source,/file\.arrayBuffer\(\)/);
  assert.match(source,/InferenceSession\.create\(bytes/);
  assert.match(source,/executionProviders: \['webgpu'\]/);
  assert.match(source,/chrome\.runtime\.getURL\('vendor\/ort\/'\)/);
  assert.doesNotMatch(source,/fetch\(/);
});

test('prototype benchmark is bounded and does not pretend dynamic-shape audio is ready', async () => {
  const source=await readFile(new URL('../ai-karaoke-lab-entry.js',import.meta.url),'utf8');
  assert.match(source,/MAX_SYNTHETIC_FLOATS = 20_000_000/);
  assert.match(source,/Synthetic benchmark currently supports exactly one input/);
  assert.match(source,/Input shape is dynamic/);
  assert.match(source,/new ort\.Tensor\('float32'/);
  assert.match(source,/BENCHMARK_RUNS = 3/);
});

test('build script packages ORT executable assets locally', async () => {
  const source=await readFile(new URL('../scripts/build.mjs',import.meta.url),'utf8');
  assert.match(source,/node_modules\/onnxruntime-web\/dist/);
  assert.match(source,/vendor\/ort/);
  assert.match(source,/\^ort-wasm/);
  assert.match(source,/entryPoints: \['ai-karaoke-lab-entry\.js'\]/);
  assert.match(source,/outfile: join\(distDir, 'ai-karaoke-lab\.js'\)/);
});

test('popup and dedicated extension page clearly label the lab experimental', async () => {
  const popup=await readFile(new URL('../popup.html',import.meta.url),'utf8');
  const lab=await readFile(new URL('../ai-lab.html',import.meta.url),'utf8');
  assert.match(popup,/AI Karaoke Lab · Experimental/);
  assert.match(popup,/href="ai-lab\.html"/);
  assert.match(lab,/V3 PROTOTYPE/);
  assert.match(lab,/does not replace Fast Karaoke playback yet|not yet a vocal-separation quality test/i);
  assert.match(lab,/dist\/ai-karaoke-lab\.js/);
});
