import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { MDX_INST_HQ3, mdxChunkSize, mdxGenerationSize, mdxShapeMatches, mdxTrim, validateMdxMetadata } from '../mdx-profile.js';
import { MixedRadix6144FFT } from '../mdx-stft.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('V3 pins local ONNX Runtime, mixed-radix FFT, and build tool versions', async () => {
  const pkg=JSON.parse(await read('package.json'));
  assert.equal(pkg.dependencies['onnxruntime-web'],'1.29.0');
  assert.equal(pkg.dependencies['fft.js'],'4.0.4');
  assert.equal(pkg.devDependencies.esbuild,'0.25.9');
  assert.equal(pkg.scripts.build,'node scripts/build.mjs');
});

test('UVR-MDX-NET-Inst_HQ_3 profile is locked to verified parameters', () => {
  assert.equal(MDX_INST_HQ3.fileName,'UVR-MDX-NET-Inst_HQ_3.onnx');
  assert.equal(MDX_INST_HQ3.sha256,'317554b07fe1ea5279a77f2b1520a41ea4b93432560c4ffd08792c30fddf9adc');
  assert.equal(MDX_INST_HQ3.expectedByteLength,66759214);
  assert.equal(MDX_INST_HQ3.sampleRate,44100); assert.equal(MDX_INST_HQ3.nFft,6144); assert.equal(MDX_INST_HQ3.hopLength,1024);
  assert.equal(MDX_INST_HQ3.dimF,3072); assert.equal(MDX_INST_HQ3.dimT,256); assert.equal(MDX_INST_HQ3.compensate,1.022);
  assert.deepEqual(MDX_INST_HQ3.expectedInputShape,[1,4,3072,256]); assert.deepEqual(MDX_INST_HQ3.expectedOutputShape,[1,4,3072,256]);
  assert.equal(mdxChunkSize(),261120); assert.equal(mdxTrim(),3072); assert.equal(mdxGenerationSize(),254976);
});

test('MDX metadata accepts symbolic batch_size from UVR ONNX export', () => {
  assert.equal(mdxShapeMatches(['batch_size', 4, 3072, 256], MDX_INST_HQ3.expectedInputShape), true);
  assert.equal(mdxShapeMatches([1, 4, 3072, 256], MDX_INST_HQ3.expectedInputShape), true);
  assert.equal(mdxShapeMatches([-1, 4, 3072, 256], MDX_INST_HQ3.expectedInputShape), true);
  assert.equal(mdxShapeMatches([1, 4, 3072, 128], MDX_INST_HQ3.expectedInputShape), false);
  const contract = validateMdxMetadata({
    inputNames: ['input'],
    outputNames: ['output'],
    inputMetadata: [{ name: 'input', isTensor: true, type: 'float32', shape: ['batch_size', 4, 3072, 256] }],
    outputMetadata: [{ name: 'output', isTensor: true, type: 'float32', shape: ['batch_size', 4, 3072, 256] }]
  });
  assert.deepEqual(contract, { inputName: 'input', outputName: 'output' });
});

test('6144 mixed-radix FFT round-trips complex data', () => {
  const fft=new MixedRadix6144FFT(); const input=new Float64Array(6144*2);
  for (let i=0;i<6144;i+=1) { input[2*i]=Math.sin(i*0.017)+0.25*Math.cos(i*0.071); input[2*i+1]=0.1*Math.sin(i*0.031); }
  const spectrum=new Float64Array(fft.forwardComplex(input)); const restored=new Float64Array(fft.inverseComplex(spectrum));
  let maxError=0; for (let i=0;i<input.length;i+=1) maxError=Math.max(maxError,Math.abs(input[i]-restored[i]));
  assert.ok(maxError < 1e-9, `FFT round-trip max error ${maxError}`);
});

test('MV3 CSP permits packaged WASM without remote executable script sources', async () => {
  const manifest=JSON.parse(await read('manifest.json')); const csp=manifest.content_security_policy?.extension_pages ?? '';
  assert.match(csp,/script-src 'self' 'wasm-unsafe-eval'/); assert.match(csp,/object-src 'self'/); assert.doesNotMatch(csp,/https?:/);
});

test('AI diagnostics page still verifies local model hash and strict WebGPU execution provider', async () => {
  const source=await read('ai-karaoke-lab-entry.js');
  assert.match(source,/from 'onnxruntime-web\/webgpu'/); assert.match(source,/crypto\.subtle\.digest\('SHA-256'/); assert.match(source,/hash !== MDX_INST_HQ3\.sha256/);
  assert.match(source,/executionProviders: \['webgpu'\]/); assert.match(source,/validateMdxMetadata/); assert.match(source,/separateMdxStereo/); assert.match(source,/decodeAudioFile/);
});

test('MDX separator uses STFT, WebGPU inference, overlap-add, compensation, and residual vocals', async () => {
  const source=await read('mdx-separator.js');
  assert.match(source,/stft\.forwardStereo/); assert.match(source,/session\.run/); assert.match(source,/stft\.inverseStereo/); assert.match(source,/symmetricHann/); assert.match(source,/profile\.compensate/);
  assert.match(source,/vocalsLeft\[i\] = left\[i\] - instrumentalLeft\[i\]/);
});

test('MDX STFT matches channel-as-complex layout and zeros first three bins', async () => {
  const source=await read('mdx-stft.js');
  assert.match(source,/const realChannel = channel \* 2/); assert.match(source,/const imagChannel = realChannel \+ 1/); assert.match(source,/frequency = profile\.zeroLowBins/); assert.match(source,/periodicHann/); assert.match(source,/reflectedSample/);
});

test('build script packages both AI surfaces and ORT executable assets locally', async () => {
  const source=await read('scripts/build.mjs');
  assert.match(source,/node_modules\/onnxruntime-web\/dist/); assert.match(source,/vendor\/ort/); assert.match(source,/\^ort-wasm/);
  assert.match(source,/entryPoints: \['ai-karaoke-lab-entry\.js'\]/); assert.match(source,/outfile: join\(distDir, 'ai-karaoke-lab\.js'\)/);
  assert.match(source,/entryPoints: \['live-ai-worker-entry\.js'\]/); assert.match(source,/outfile: join\(distDir, 'live-ai-worker\.js'\)/);
});

test('AI Lab is advanced diagnostics, not a prerequisite for normal AI Karaoke', async () => {
  const popup=await read('popup.html'); const live=await read('v3-live.js'); const lab=await read('ai-lab.html');
  assert.match(popup,/AI Karaoke/); assert.match(popup,/Advanced \/ Power user/); assert.match(popup,/Open AI diagnostics \/ local file separator/);
  assert.doesNotMatch(popup,/Install \/ verify AI model in Lab/);
  assert.match(live,/downloadVerifiedModel/); assert.match(live,/START_LIVE_AI_REQUEST/);
  assert.doesNotMatch(live,/Range: 'bytes=0-0'/);
  assert.match(lab,/UVR-MDX-NET-Inst_HQ_3/); assert.match(lab,/id="audioFile"/); assert.match(lab,/id="separateButton"/); assert.match(lab,/dist\/ai-karaoke-lab\.js/);
});
