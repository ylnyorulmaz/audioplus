import * as ort from 'onnxruntime-web/webgpu';
import { MDX_INST_HQ3, mdxGenerationSize, mdxTrim, validateMdxMetadata } from './mdx-profile.js';
import { MdxStft } from './mdx-stft.js';

let session = null;
let modelContract = null;
let stft = null;
let busy = false;

function post(type, payload = {}, transfer = []) {
  globalThis.postMessage({ type, ...payload }, transfer);
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function disposeOutputs(outputs) {
  for (const value of Object.values(outputs ?? {})) {
    if (value && typeof value.dispose === 'function') value.dispose();
  }
}

async function init(runtimePath, modelUrl) {
  if (session) return;
  ort.env.wasm.wasmPaths = runtimePath;
  ort.env.wasm.numThreads = 1;

  if (!modelUrl) throw new Error('Packaged AI model URL is missing.');
  const response = await fetch(modelUrl);
  if (!response.ok) throw new Error('Packaged AI model is missing. Rebuild/reinstall Audio+ so all AI assets are included.');
  const modelBytes = await response.arrayBuffer();
  const hash = await sha256Hex(modelBytes);
  if (hash !== MDX_INST_HQ3.sha256) throw new Error('Packaged AI model failed integrity verification. Rebuild/reinstall Audio+.');

  session = await ort.InferenceSession.create(new Uint8Array(modelBytes), {
    executionProviders: ['webgpu'],
    graphOptimizationLevel: 'all'
  });
  modelContract = validateMdxMetadata(session, MDX_INST_HQ3);
  stft = new MdxStft(MDX_INST_HQ3);
}

async function processChunk(left, right, sequence) {
  if (!session || !modelContract || !stft) throw new Error('Live AI worker is not initialized.');
  if (busy) throw new Error('Live AI worker received overlapping inference requests.');
  if (!(left instanceof Float32Array) || !(right instanceof Float32Array)) throw new Error('Live AI chunk must be Float32 stereo PCM.');
  if (left.length !== right.length) throw new Error('Live AI stereo chunk lengths differ.');

  busy = true;
  const started = performance.now();
  let tensor;
  let outputs;
  try {
    const features = stft.forwardStereo(left, right);
    tensor = new ort.Tensor('float32', features, MDX_INST_HQ3.expectedInputShape);
    outputs = await session.run({ [modelContract.inputName]: tensor });
    const outputTensor = outputs[modelContract.outputName] ?? Object.values(outputs)[0];
    if (!outputTensor?.data) throw new Error('MDX model did not return an instrumental tensor.');
    const instrumental = stft.inverseStereo(outputTensor.data);

    const trim = mdxTrim(MDX_INST_HQ3);
    const generationSize = mdxGenerationSize(MDX_INST_HQ3);
    const outLeft = new Float32Array(generationSize);
    const outRight = new Float32Array(generationSize);
    for (let i = 0; i < generationSize; i += 1) {
      outLeft[i] = instrumental.left[trim + i] * MDX_INST_HQ3.compensate;
      outRight[i] = instrumental.right[trim + i] * MDX_INST_HQ3.compensate;
    }

    const elapsedMs = performance.now() - started;
    const audioMs = generationSize / MDX_INST_HQ3.sampleRate * 1000;
    post('CHUNK_READY', {
      sequence,
      elapsedMs,
      rtf: elapsedMs / audioMs,
      left: outLeft,
      right: outRight
    }, [outLeft.buffer, outRight.buffer]);
  } finally {
    tensor?.dispose();
    disposeOutputs(outputs);
    busy = false;
  }
}

async function dispose() {
  if (session) await session.release();
  session = null;
  modelContract = null;
  stft = null;
  busy = false;
}

globalThis.onmessage = (event) => {
  const message = event.data ?? {};
  (async () => {
    if (message.type === 'INIT') {
      await init(message.runtimePath, message.modelUrl);
      post('READY', {
        sampleRate: MDX_INST_HQ3.sampleRate,
        chunkSize: MDX_INST_HQ3.hopLength * (MDX_INST_HQ3.dimT - 1),
        generationSize: mdxGenerationSize(MDX_INST_HQ3)
      });
      return;
    }
    if (message.type === 'PROCESS_CHUNK') {
      await processChunk(message.left, message.right, message.sequence);
      return;
    }
    if (message.type === 'DISPOSE') {
      await dispose();
      post('DISPOSED');
    }
  })().catch((error) => post('ERROR', { message: error?.message ?? String(error), sequence: message.sequence ?? null }));
};
