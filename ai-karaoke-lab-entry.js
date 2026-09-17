import * as ort from 'onnxruntime-web/webgpu';
import { MDX_INST_HQ3, validateMdxMetadata } from './mdx-profile.js';
import { decodeAudioFile, stemFileName, stereoWavBlob } from './mdx-audio.js';
import { separateMdxStereo } from './mdx-separator.js';
import { installLiveAiModel } from './live-ai-model-store.js';

const runtimePath = chrome.runtime.getURL('vendor/ort/');
ort.env.wasm.wasmPaths = runtimePath;
ort.env.wasm.numThreads = 1;

const deviceStatus = document.querySelector('#deviceStatus');
const runtimeStatus = document.querySelector('#runtimeStatus');
const modelStatus = document.querySelector('#modelStatus');
const benchmarkStatus = document.querySelector('#benchmarkStatus');
const separationStatus = document.querySelector('#separationStatus');
const modelFile = document.querySelector('#modelFile');
const audioFile = document.querySelector('#audioFile');
const checkDeviceButton = document.querySelector('#checkDeviceButton');
const benchmarkButton = document.querySelector('#benchmarkButton');
const releaseModelButton = document.querySelector('#releaseModelButton');
const separateButton = document.querySelector('#separateButton');
const cancelButton = document.querySelector('#cancelButton');
const separationProgress = document.querySelector('#separationProgress');
const metadataOutput = document.querySelector('#metadataOutput');
const stemResults = document.querySelector('#stemResults');
const instrumentalPlayer = document.querySelector('#instrumentalPlayer');
const vocalsPlayer = document.querySelector('#vocalsPlayer');
const instrumentalDownload = document.querySelector('#instrumentalDownload');
const vocalsDownload = document.querySelector('#vocalsDownload');

const MAX_MODEL_BYTES = 1024 * 1024 * 1024;
const BENCHMARK_RUNS = 3;

let session = null;
let loadedFile = null;
let modelContract = null;
let separationController = null;
let outputUrls = [];

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
    metadataOutput.textContent = 'Load the verified UVR-MDX-NET-Inst_HQ_3 model to inspect its graph metadata.';
    return;
  }
  metadataOutput.textContent = JSON.stringify({
    profile: {
      name: MDX_INST_HQ3.displayName,
      sampleRate: MDX_INST_HQ3.sampleRate,
      nFft: MDX_INST_HQ3.nFft,
      hopLength: MDX_INST_HQ3.hopLength,
      dimF: MDX_INST_HQ3.dimF,
      dimT: MDX_INST_HQ3.dimT,
      compensate: MDX_INST_HQ3.compensate,
      primaryStem: MDX_INST_HQ3.primaryStem
    },
    file: loadedFile ? { name: loadedFile.name, size: humanBytes(loadedFile.size), sha256: MDX_INST_HQ3.sha256 } : null,
    inputs: metadataToPlain(session.inputMetadata),
    outputs: metadataToPlain(session.outputMetadata)
  }, null, 2);
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
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

function updateSeparationAvailability() {
  separateButton.disabled = !session || !(audioFile.files?.length) || Boolean(separationController);
}

function clearStemResults() {
  for (const url of outputUrls) URL.revokeObjectURL(url);
  outputUrls = [];
  instrumentalPlayer.removeAttribute('src');
  vocalsPlayer.removeAttribute('src');
  instrumentalDownload.removeAttribute('href');
  vocalsDownload.removeAttribute('href');
  stemResults.hidden = true;
}

async function releaseSession() {
  if (separationController) separationController.abort();
  if (session) await session.release();
  session = null;
  loadedFile = null;
  modelContract = null;
  benchmarkButton.disabled = true;
  releaseModelButton.disabled = true;
  setStatus(modelStatus, 'No model loaded. The verified live model, if installed, remains stored locally.');
  setStatus(benchmarkStatus, 'Load the verified model before benchmarking.');
  updateSeparationAvailability();
  renderMetadata();
}

async function loadModel(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.onnx')) throw new Error('Choose an .onnx model file.');
  if (file.size <= 0 || file.size > MAX_MODEL_BYTES) throw new Error('Model must be between 1 byte and 1 GB.');
  const adapter = await checkWebGpu();
  if (!adapter) throw new Error('WebGPU is required for AI Karaoke.');

  await releaseSession();
  setStatus(runtimeStatus, 'Reading local model and verifying SHA-256…');
  setStatus(modelStatus, `${file.name} · ${humanBytes(file.size)}`);
  const buffer = await file.arrayBuffer();
  const hash = await sha256Hex(buffer);
  if (hash !== MDX_INST_HQ3.sha256) {
    throw new Error(`Wrong model hash. Expected UVR-MDX-NET-Inst_HQ_3 (${MDX_INST_HQ3.sha256.slice(0, 12)}…), got ${hash.slice(0, 12)}….`);
  }

  const started = performance.now();
  session = await ort.InferenceSession.create(new Uint8Array(buffer), {
    executionProviders: ['webgpu'],
    graphOptimizationLevel: 'all'
  });
  try {
    modelContract = validateMdxMetadata(session, MDX_INST_HQ3);
  } catch (error) {
    await session.release();
    session = null;
    throw error;
  }

  await installLiveAiModel(buffer, { fileName: file.name, size: file.size, sha256: hash });
  loadedFile = file;
  const elapsed = performance.now() - started;
  setStatus(runtimeStatus, 'Bundled ONNX Runtime WebGPU session active.', 'success');
  setStatus(modelStatus, `${MDX_INST_HQ3.displayName} verified, loaded, and installed locally for Live AI Karaoke in ${elapsed.toFixed(0)} ms.`, 'success');
  benchmarkButton.disabled = false;
  releaseModelButton.disabled = false;
  setStatus(benchmarkStatus, 'Ready for the real MDX tensor benchmark.');
  updateSeparationAvailability();
  renderMetadata();
}

function disposeOutputs(outputs) {
  for (const value of Object.values(outputs ?? {})) {
    if (value && typeof value.dispose === 'function') value.dispose();
  }
}

async function runBenchmark() {
  if (!session || !modelContract) throw new Error('Load the verified model first.');
  const size = MDX_INST_HQ3.expectedInputShape.reduce((total, value) => total * value, 1);
  const tensor = new ort.Tensor('float32', new Float32Array(size), MDX_INST_HQ3.expectedInputShape);
  benchmarkButton.disabled = true;
  setStatus(benchmarkStatus, `Warming up [${MDX_INST_HQ3.expectedInputShape.join(' × ')}]…`);
  try {
    let outputs = await session.run({ [modelContract.inputName]: tensor });
    disposeOutputs(outputs);
    const timings = [];
    for (let run = 0; run < BENCHMARK_RUNS; run += 1) {
      const start = performance.now();
      outputs = await session.run({ [modelContract.inputName]: tensor });
      timings.push(performance.now() - start);
      disposeOutputs(outputs);
    }
    const average = timings.reduce((sum, value) => sum + value, 0) / timings.length;
    setStatus(benchmarkStatus, `${BENCHMARK_RUNS} WebGPU runs · avg ${average.toFixed(1)} ms · min ${Math.min(...timings).toFixed(1)} · max ${Math.max(...timings).toFixed(1)}`, 'success');
  } finally {
    tensor.dispose();
    benchmarkButton.disabled = !session;
  }
}

function progressText(stage, index, total) {
  const current = Math.min(total, index + 1);
  if (stage === 'stft') return `Chunk ${current}/${total}: STFT…`;
  if (stage === 'inference') return `Chunk ${current}/${total}: WebGPU inference…`;
  if (stage === 'istft') return `Chunk ${current}/${total}: iSTFT…`;
  return `Processed ${index}/${total} chunks…`;
}

async function runSeparation() {
  if (!session || !modelContract) throw new Error('Load the verified model first.');
  const [file] = audioFile.files ?? [];
  if (!file) throw new Error('Choose an audio file first.');

  clearStemResults();
  separationController = new AbortController();
  separateButton.disabled = true;
  cancelButton.hidden = false;
  separationProgress.value = 0;
  setStatus(separationStatus, 'Decoding audio locally to stereo 44.1 kHz…');
  const started = performance.now();

  try {
    const decoded = await decodeAudioFile(file, MDX_INST_HQ3);
    if (separationController.signal.aborted) throw new DOMException('Separation cancelled.', 'AbortError');
    setStatus(separationStatus, `Decoded ${decoded.duration.toFixed(1)} s · ${decoded.originalChannels} source channel(s). Starting MDX…`);

    const result = await separateMdxStereo({
      session,
      inputName: modelContract.inputName,
      outputName: modelContract.outputName,
      left: decoded.left,
      right: decoded.right,
      profile: MDX_INST_HQ3,
      signal: separationController.signal,
      onProgress: ({ stage, index, total, fraction }) => {
        separationProgress.value = fraction;
        setStatus(separationStatus, progressText(stage, index, total));
      }
    });

    separationProgress.value = 1;
    setStatus(separationStatus, 'Encoding local WAV stems…');
    const instrumentalBlob = stereoWavBlob(result.instrumental.left, result.instrumental.right, decoded.sampleRate);
    const vocalsBlob = stereoWavBlob(result.vocals.left, result.vocals.right, decoded.sampleRate);
    const instrumentalUrl = URL.createObjectURL(instrumentalBlob);
    const vocalsUrl = URL.createObjectURL(vocalsBlob);
    outputUrls = [instrumentalUrl, vocalsUrl];
    instrumentalPlayer.src = instrumentalUrl;
    vocalsPlayer.src = vocalsUrl;
    instrumentalDownload.href = instrumentalUrl;
    vocalsDownload.href = vocalsUrl;
    instrumentalDownload.download = stemFileName(file.name, 'Instrumental');
    vocalsDownload.download = stemFileName(file.name, 'Vocals');
    stemResults.hidden = false;

    const elapsedSeconds = (performance.now() - started) / 1000;
    const realTimeFactor = elapsedSeconds / decoded.duration;
    setStatus(separationStatus, `Separated ${decoded.duration.toFixed(1)} s in ${elapsedSeconds.toFixed(1)} s · RTF ${realTimeFactor.toFixed(2)}× · ${result.chunks} chunks.`, 'success');
  } finally {
    separationController = null;
    cancelButton.hidden = true;
    updateSeparationAvailability();
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
    updateSeparationAvailability();
  });
});

audioFile.addEventListener('change', () => {
  clearStemResults();
  updateSeparationAvailability();
  const [file] = audioFile.files ?? [];
  setStatus(separationStatus, file ? `${file.name} selected. Ready when the verified model is loaded.` : 'Choose a local audio file.');
});

benchmarkButton.addEventListener('click', () => {
  runBenchmark().catch((error) => {
    setStatus(benchmarkStatus, error?.message ?? String(error), 'error');
    benchmarkButton.disabled = !session;
  });
});

separateButton.addEventListener('click', () => {
  runSeparation().catch((error) => {
    const cancelled = error?.name === 'AbortError';
    setStatus(separationStatus, cancelled ? 'Separation cancelled.' : (error?.message ?? String(error)), cancelled ? '' : 'error');
  });
});

cancelButton.addEventListener('click', () => separationController?.abort());
releaseModelButton.addEventListener('click', () => {
  releaseSession().catch((error) => setStatus(modelStatus, error?.message ?? String(error), 'error'));
});

window.addEventListener('pagehide', () => {
  separationController?.abort();
  clearStemResults();
  if (session) session.release().catch(() => {});
});

setStatus(runtimeStatus, `Bundled runtime path: ${runtimePath}`);
renderMetadata();
updateSeparationAvailability();
