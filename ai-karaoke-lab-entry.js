import * as ort from 'onnxruntime-web/webgpu';

const runtimePath = chrome.runtime.getURL('vendor/ort/');
ort.env.wasm.wasmPaths = runtimePath;
ort.env.wasm.numThreads = 1;

const deviceStatus = document.querySelector('#deviceStatus');
const runtimeStatus = document.querySelector('#runtimeStatus');
const modelStatus = document.querySelector('#modelStatus');
const benchmarkStatus = document.querySelector('#benchmarkStatus');
const modelFile = document.querySelector('#modelFile');
const checkDeviceButton = document.querySelector('#checkDeviceButton');
const benchmarkButton = document.querySelector('#benchmarkButton');
const releaseModelButton = document.querySelector('#releaseModelButton');
const metadataOutput = document.querySelector('#metadataOutput');

const MAX_MODEL_BYTES = 1024 * 1024 * 1024;
const MAX_SYNTHETIC_FLOATS = 20_000_000;
const BENCHMARK_RUNS = 3;

let session = null;
let loadedFile = null;

function setStatus(element, text, tone = '') {
  element.textContent = text;
  element.dataset.tone = tone;
}

function humanBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown size';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function metadataToPlain(metadata = []) {
  return metadata.map((item) => ({
    name: item?.name ?? 'unnamed',
    type: item?.isTensor ? item.type : 'non-tensor',
    shape: item?.isTensor ? [...item.shape] : []
  }));
}

function renderMetadata() {
  if (!session) {
    metadataOutput.textContent = 'Load a local .onnx model to inspect its graph inputs and outputs.';
    return;
  }

  metadataOutput.textContent = JSON.stringify({
    file: loadedFile ? { name: loadedFile.name, size: humanBytes(loadedFile.size) } : null,
    inputs: metadataToPlain(session.inputMetadata),
    outputs: metadataToPlain(session.outputMetadata)
  }, null, 2);
}

async function checkWebGpu() {
  if (!navigator.gpu) {
    setStatus(deviceStatus, 'WebGPU is not exposed by this browser/device.', 'error');
    return null;
  }

  setStatus(deviceStatus, 'Checking WebGPU adapter…');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    setStatus(deviceStatus, 'No compatible WebGPU adapter was returned.', 'error');
    return null;
  }

  const maxBuffer = adapter.limits?.maxBufferSize;
  const suffix = Number.isFinite(maxBuffer) ? ` · max buffer ${humanBytes(maxBuffer)}` : '';
  setStatus(deviceStatus, `WebGPU adapter available${suffix}`, 'success');
  return adapter;
}

async function releaseSession() {
  if (session) {
    await session.release();
    session = null;
  }
  loadedFile = null;
  benchmarkButton.disabled = true;
  releaseModelButton.disabled = true;
  setStatus(modelStatus, 'No model loaded.');
  setStatus(benchmarkStatus, 'Load a compatible model before benchmarking.');
  renderMetadata();
}

async function loadModel(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.onnx')) {
    throw new Error('Choose an .onnx model file.');
  }
  if (file.size <= 0 || file.size > MAX_MODEL_BYTES) {
    throw new Error('Model must be between 1 byte and 1 GB for this prototype.');
  }

  const adapter = await checkWebGpu();
  if (!adapter) throw new Error('WebGPU is required for this prototype.');

  await releaseSession();
  setStatus(runtimeStatus, 'Loading bundled ONNX Runtime Web…');
  setStatus(modelStatus, `Reading ${file.name} (${humanBytes(file.size)})…`);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const started = performance.now();
  session = await ort.InferenceSession.create(bytes, {
    executionProviders: ['webgpu'],
    graphOptimizationLevel: 'all'
  });
  const elapsed = performance.now() - started;
  loadedFile = file;

  setStatus(runtimeStatus, 'ONNX Runtime WebGPU session created locally.', 'success');
  setStatus(modelStatus, `${file.name} loaded in ${elapsed.toFixed(0)} ms.`, 'success');
  benchmarkButton.disabled = false;
  releaseModelButton.disabled = false;
  setStatus(benchmarkStatus, 'Ready for a synthetic fixed-shape inference benchmark.');
  renderMetadata();
}

function benchmarkInput() {
  if (!session) throw new Error('Load a model first.');
  if (session.inputMetadata.length !== 1) {
    throw new Error(`Synthetic benchmark currently supports exactly one input; this model exposes ${session.inputMetadata.length}.`);
  }

  const metadata = session.inputMetadata[0];
  if (!metadata?.isTensor) throw new Error('The model input is not a tensor.');
  if (metadata.type !== 'float32') throw new Error(`Synthetic benchmark currently supports float32 input, not ${metadata.type}.`);

  const dims = [...metadata.shape];
  if (dims.length === 0 || dims.some((dim) => !Number.isInteger(dim) || dim <= 0)) {
    throw new Error(`Input shape is dynamic (${dims.join(' × ') || 'unknown'}). Audio preprocessing must resolve it before benchmarking.`);
  }

  const size = dims.reduce((total, dim) => total * dim, 1);
  if (!Number.isSafeInteger(size) || size > MAX_SYNTHETIC_FLOATS) {
    throw new Error(`Fixed input contains ${size.toLocaleString()} floats; prototype limit is ${MAX_SYNTHETIC_FLOATS.toLocaleString()}.`);
  }

  return {
    name: session.inputNames[0],
    dims,
    tensor: new ort.Tensor('float32', new Float32Array(size), dims),
    size
  };
}

function disposeOutputs(outputs) {
  for (const value of Object.values(outputs ?? {})) {
    if (value && typeof value.dispose === 'function') value.dispose();
  }
}

async function runBenchmark() {
  const input = benchmarkInput();
  benchmarkButton.disabled = true;
  setStatus(benchmarkStatus, `Warming up ${input.dims.join(' × ')} tensor…`);

  try {
    let outputs = await session.run({ [input.name]: input.tensor });
    disposeOutputs(outputs);

    const timings = [];
    for (let run = 0; run < BENCHMARK_RUNS; run += 1) {
      const start = performance.now();
      outputs = await session.run({ [input.name]: input.tensor });
      timings.push(performance.now() - start);
      disposeOutputs(outputs);
    }

    const average = timings.reduce((sum, value) => sum + value, 0) / timings.length;
    const min = Math.min(...timings);
    const max = Math.max(...timings);
    setStatus(
      benchmarkStatus,
      `${BENCHMARK_RUNS} WebGPU runs · avg ${average.toFixed(1)} ms · min ${min.toFixed(1)} · max ${max.toFixed(1)} · input ${humanBytes(input.size * 4)}`,
      'success'
    );
  } finally {
    input.tensor.dispose();
    benchmarkButton.disabled = !session;
  }
}

checkDeviceButton.addEventListener('click', () => {
  checkWebGpu().catch((error) => setStatus(deviceStatus, error?.message ?? String(error), 'error'));
});

modelFile.addEventListener('change', () => {
  const [file] = modelFile.files ?? [];
  loadModel(file).catch((error) => {
    setStatus(modelStatus, error?.message ?? String(error), 'error');
    setStatus(runtimeStatus, 'Runtime/model session was not created.', 'error');
    benchmarkButton.disabled = true;
  });
});

benchmarkButton.addEventListener('click', () => {
  runBenchmark().catch((error) => {
    setStatus(benchmarkStatus, error?.message ?? String(error), 'error');
    benchmarkButton.disabled = !session;
  });
});

releaseModelButton.addEventListener('click', () => {
  releaseSession().catch((error) => setStatus(modelStatus, error?.message ?? String(error), 'error'));
});

window.addEventListener('pagehide', () => {
  if (session) session.release().catch(() => {});
});

setStatus(runtimeStatus, `Bundled runtime path: ${runtimePath}`);
renderMetadata();
