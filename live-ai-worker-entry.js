import * as ort from 'onnxruntime-web/webgpu';
import { getInstalledLiveAiModel } from './live-ai-model-store.js';
import { MDX_INST_HQ3, mdxGenerationSize, mdxTrim, validateMdxMetadata } from './mdx-profile.js';
import { MdxStft } from './mdx-stft.js';

let session = null;
let modelContract = null;
let stft = null;
let backend = null;
let webgpuFallbackReason = null;
let busy = false;

function post(type, payload = {}, transfer = []) {
  globalThis.postMessage({ type, ...payload }, transfer);
}

function errorMessage(error) {
  return error?.message ?? String(error);
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

async function createInferenceSession(modelBytes) {
  webgpuFallbackReason = null;

  if (globalThis.navigator?.gpu) {
    try {
      const gpuSession = await ort.InferenceSession.create(modelBytes, {
        executionProviders: ['webgpu'],
        graphOptimizationLevel: 'all'
      });
      return { session: gpuSession, backend: 'webgpu' };
    } catch (error) {
      webgpuFallbackReason = errorMessage(error);
    }
  } else {
    webgpuFallbackReason = 'WebGPU is not exposed by this browser/device.';
  }

  try {
    const cpuSession = await ort.InferenceSession.create(modelBytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all'
    });
    return { session: cpuSession, backend: 'wasm' };
  } catch (error) {
    const gpuDetail = webgpuFallbackReason ? ` WebGPU: ${webgpuFallbackReason}` : '';
    throw new Error(`Could not initialize local AI on WebGPU or WASM/CPU.${gpuDetail} CPU: ${errorMessage(error)}`);
  }
}

async function init(runtimePath) {
  if (session) return;
  ort.env.wasm.wasmPaths = runtimePath;
  // This worker already isolates inference from the UI. Keep CPU fallback single-threaded
  // so an old/weak laptop cannot fan out across every core and make Chrome unresponsive.
  ort.env.wasm.numThreads = 1;

  const installed = await getInstalledLiveAiModel();
  if (!installed?.bytes) throw new Error('The verified UVR-MDX-NET-Inst_HQ_3 model is not installed locally.');
  if (installed.sha256 !== MDX_INST_HQ3.sha256) throw new Error('Installed AI model metadata does not match UVR-MDX-NET-Inst_HQ_3.');
  const hash = await sha256Hex(installed.bytes);
  if (hash !== MDX_INST_HQ3.sha256) throw new Error('Installed AI model bytes failed SHA-256 verification. Reinstall the model.');

  const created = await createInferenceSession(new Uint8Array(installed.bytes));
  session = created.session;
  backend = created.backend;
  modelContract = validateMdxMetadata(session, MDX_INST_HQ3);
  stft = new MdxStft(MDX_INST_HQ3);
}

async function processChunk(left, right, sequence) {
  if (!session || !modelContract || !stft || !backend) throw new Error('Live AI worker is not initialized.');
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
      backend,
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
  backend = null;
  webgpuFallbackReason = null;
  busy = false;
}

globalThis.onmessage = (event) => {
  const message = event.data ?? {};
  (async () => {
    if (message.type === 'INIT') {
      await init(message.runtimePath);
      post('READY', {
        backend,
        webgpuFallbackReason,
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
      return;
    }
  })().catch((error) => post('ERROR', { message: errorMessage(error), sequence: message.sequence ?? null }));
};
