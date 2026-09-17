import * as ort from 'onnxruntime-web/webgpu';
import { coerceModelBytes, fetchPackagedModelBuffer, getInstalledLiveAiModel } from './live-ai-model-store.js';
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

async function probeWebGpuAdapter() {
  const gpu = globalThis.navigator?.gpu;
  if (!gpu?.requestAdapter) {
    webgpuFallbackReason = 'WebGPU is not exposed by this browser/device.';
    return null;
  }
  try {
    const adapter =
      (await gpu.requestAdapter({ powerPreference: 'high-performance' })) ??
      (await gpu.requestAdapter());
    if (!adapter) {
      webgpuFallbackReason = 'No compatible WebGPU adapter was returned.';
      return null;
    }
    return adapter;
  } catch (error) {
    webgpuFallbackReason = errorMessage(error);
    return null;
  }
}

async function createOnnxSession(modelBytes, executionProvider) {
  if (typeof ort?.InferenceSession?.create !== 'function') {
    throw new Error('ONNX Runtime InferenceSession.create is not available in the AI worker.');
  }
  const created = await ort.InferenceSession.create(modelBytes, {
    executionProviders: [executionProvider],
    graphOptimizationLevel: 'all'
  });
  if (!created) throw new Error(`${executionProvider} session factory returned no session.`);
  return created;
}

async function createInferenceSession(modelBytes) {
  webgpuFallbackReason = null;
  const adapter = await probeWebGpuAdapter();

  if (adapter) {
    try {
      return { session: await createOnnxSession(modelBytes, 'webgpu'), backend: 'webgpu' };
    } catch (error) {
      webgpuFallbackReason = errorMessage(error);
    }
  }

  try {
    return { session: await createOnnxSession(modelBytes, 'wasm'), backend: 'wasm' };
  } catch (error) {
    const gpuDetail = webgpuFallbackReason ? ` WebGPU: ${webgpuFallbackReason}` : '';
    throw new Error(`Could not initialize local AI on WebGPU or WASM/CPU.${gpuDetail} CPU: ${errorMessage(error)}`);
  }
}

async function init(runtimePath, modelUrl = null, transferredModelBytes = null) {
  if (session) return;
  if (!ort?.env) throw new Error('ONNX Runtime did not expose an environment in the AI worker.');
  ort.env.wasm = ort.env.wasm ?? {};
  ort.env.webgpu = ort.env.webgpu ?? {};
  ort.env.wasm.proxy = false;
  // Keep CPU fallback single-threaded. Nested ORT pthread/module workers are unreliable
  // inside Chrome extension workers and surface as "fetching the script".
  ort.env.wasm.numThreads = 1;

  const wasmBase = runtimePath?.endsWith('/') ? runtimePath : `${runtimePath ?? ''}/`;
  const wasmFile = 'ort-wasm-simd-threaded.asyncify.wasm';
  const wasmResponse = await fetch(new URL(wasmFile, wasmBase).href, { cache: 'force-cache' });
  if (!wasmResponse.ok) {
    throw new Error(`Missing ${wasmFile} in vendor/ort. Run npm install && npm run build, then reload Audio+.`);
  }
  ort.env.wasm.wasmBinary = await wasmResponse.arrayBuffer();
  // Avoid string wasmPaths: that makes ORT dynamic-import a second asyncify module which
  // tries to spawn nested module workers (broken in extension workers).
  delete ort.env.wasm.wasmPaths;

  let modelBytes = coerceModelBytes(transferredModelBytes);
  if (!modelBytes) modelBytes = await fetchPackagedModelBuffer(modelUrl);
  if (!modelBytes) {
    const installed = await getInstalledLiveAiModel();
    modelBytes = coerceModelBytes(installed?.bytes);
    if (modelBytes && installed.sha256 !== MDX_INST_HQ3.sha256) modelBytes = null;
  }
  if (!modelBytes) {
    throw new Error(
      `The verified UVR-MDX-NET-Inst_HQ_3 model was not received by the AI worker ` +
      `(got ${transferredModelBytes == null ? 'null' : typeof transferredModelBytes}).`
    );
  }
  if (modelBytes.byteLength !== MDX_INST_HQ3.expectedByteLength) {
    throw new Error(
      `AI worker received ${modelBytes.byteLength} model bytes, expected ${MDX_INST_HQ3.expectedByteLength}.`
    );
  }
  const hash = await sha256Hex(modelBytes);
  if (hash !== MDX_INST_HQ3.sha256) throw new Error('Installed AI model bytes failed SHA-256 verification. Reinstall the model.');

  const created = await createInferenceSession(new Uint8Array(modelBytes));
  if (!created?.session || !created.backend) {
    throw new Error(`Local AI session factory returned an incomplete result (${created?.backend ?? 'no backend'}).`);
  }
  session = created.session;
  backend = created.backend;
  modelContract = validateMdxMetadata(session, MDX_INST_HQ3);
  stft = new MdxStft(MDX_INST_HQ3);

  // One silent inference measures RTF before we touch live audio.
  // Inst HQ_3 on single-thread WASM is usually >1× and cannot stay live safely.
  const probe = await measureRealtimeProbe();
  if (probe.rtf > 1.0) {
    const engine = backend === 'webgpu' ? 'WebGPU' : 'CPU/WASM';
    const gpuNote = webgpuFallbackReason ? ` WebGPU unavailable (${webgpuFallbackReason}).` : '';
    const detail =
      `${engine} probe RTF ${probe.rtf.toFixed(2)}× exceeds the real-time budget ` +
      `(need ≤ 1.00×).${gpuNote} Use Fast Karaoke on this device, or enable Chrome hardware acceleration and retry AI Karaoke.`;
    await dispose();
    throw new Error(detail);
  }
}

async function measureRealtimeProbe() {
  const chunkSize = MDX_INST_HQ3.hopLength * (MDX_INST_HQ3.dimT - 1);
  const generationSize = mdxGenerationSize(MDX_INST_HQ3);
  const left = new Float32Array(chunkSize);
  const right = new Float32Array(chunkSize);
  const features = stft.forwardStereo(left, right);
  const tensor = new ort.Tensor('float32', features, MDX_INST_HQ3.expectedInputShape);
  const started = performance.now();
  let outputs;
  try {
    outputs = await session.run({ [modelContract.inputName]: tensor });
  } finally {
    tensor.dispose?.();
    disposeOutputs(outputs);
  }
  const elapsedMs = performance.now() - started;
  const audioMs = generationSize / MDX_INST_HQ3.sampleRate * 1000;
  return { rtf: elapsedMs / audioMs, elapsedMs, audioMs };
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
      await init(message.runtimePath, message.modelUrl ?? null, message.modelBytes ?? null);
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
