import { MDX_INST_HQ3, mdxChunkSize, mdxGenerationSize } from './mdx-profile.js';
import { loadPackagedModelBytes } from './live-ai-model-store.js';
import { diagnoseWebGpu } from './webgpu-diagnose.js';

const MAX_RTF = 1.0;
const GOOD_RTF = 0.6;
const RING_CAPACITY_SAMPLES = mdxChunkSize(MDX_INST_HQ3) * 2;
const START_DELAY_SECONDS = 0.05;
const GENERATED_AUDIO_MS = mdxGenerationSize(MDX_INST_HQ3) / MDX_INST_HQ3.sampleRate * 1000;
const INFERENCE_WATCHDOG_MS = Math.ceil(GENERATED_AUDIO_MS * 1.15);

class StereoRingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.left = new Float32Array(capacity);
    this.right = new Float32Array(capacity);
    this.read = 0;
    this.write = 0;
    this.length = 0;
  }

  push(left, right) {
    if (left.length !== right.length) throw new Error('Stereo block lengths differ.');
    if (left.length > this.capacity - this.length) return false;
    for (let i = 0; i < left.length; i += 1) {
      this.left[this.write] = left[i];
      this.right[this.write] = right[i];
      this.write = (this.write + 1) % this.capacity;
    }
    this.length += left.length;
    return true;
  }

  peek(count) {
    if (count > this.length) return null;
    const left = new Float32Array(count);
    const right = new Float32Array(count);
    let cursor = this.read;
    for (let i = 0; i < count; i += 1) {
      left[i] = this.left[cursor];
      right[i] = this.right[cursor];
      cursor = (cursor + 1) % this.capacity;
    }
    return { left, right };
  }

  consume(count) {
    if (count > this.length) throw new Error('Cannot consume beyond ring buffer length.');
    this.read = (this.read + count) % this.capacity;
    this.length -= count;
  }

  clear() {
    this.read = 0;
    this.write = 0;
    this.length = 0;
  }
}

function waitForWorkerReady(worker) {
  return new Promise((resolve, reject) => {
    // Packaged ONNX load + session create can take well over 30s on CPU/WASM.
    const timeout = setTimeout(() => finishReject(new Error('AI worker initialization timed out.')), 180000);

    const cleanup = () => {
      clearTimeout(timeout);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    };
    const finishReject = (error) => {
      cleanup();
      reject(error);
    };
    const onError = (event) => {
      const detail = event?.error?.message ?? event?.message ?? 'AI worker failed to load.';
      const filename = event?.filename ? ` (${event.filename})` : '';
      finishReject(new Error(/fetching the script/i.test(detail)
        ? `The local AI worker script could not load${filename}. Reload Audio+ after npm run build.`
        : `${detail}${filename}`));
    };
    const onMessage = (event) => {
      const message = event.data ?? {};
      if (message.type === 'READY') {
        cleanup();
        resolve(message);
      } else if (message.type === 'ERROR') {
        finishReject(new Error(message.message ?? 'AI worker initialization failed.'));
      }
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
  });
}

function clearInferenceWatchdog(state) {
  if (!state.inferenceTimer) return;
  clearTimeout(state.inferenceTimer);
  state.inferenceTimer = null;
}

function scheduleInstrumental(state, left, right) {
  const { aiContext } = state;
  const buffer = aiContext.createBuffer(2, left.length, MDX_INST_HQ3.sampleRate);
  buffer.copyToChannel(left, 0);
  buffer.copyToChannel(right, 1);
  const source = aiContext.createBufferSource();
  source.buffer = buffer;
  source.connect(state.outputGain);

  const now = aiContext.currentTime;
  if (state.nextPlaybackTime && state.nextPlaybackTime < now - 0.15) {
    throw new Error('Live AI Karaoke underrun: this device cannot keep up in real time.');
  }
  const startAt = state.nextPlaybackTime ? Math.max(state.nextPlaybackTime, now + 0.01) : now + START_DELAY_SECONDS;
  source.start(startAt);
  state.nextPlaybackTime = startAt + buffer.duration;
  state.playbackSources.add(source);
  source.onended = () => state.playbackSources.delete(source);
}

function maybeDispatch(state) {
  if (state.stopped || state.inFlight) return;
  const chunkSize = mdxChunkSize(MDX_INST_HQ3);
  const generationSize = mdxGenerationSize(MDX_INST_HQ3);
  if (state.ring.length < chunkSize) return;

  const chunk = state.ring.peek(chunkSize);
  if (!chunk) return;
  state.ring.consume(generationSize);
  state.inFlight = true;
  const sequence = state.sequence++;
  clearInferenceWatchdog(state);
  state.inferenceTimer = setTimeout(() => {
    failToFallback(
      state,
      `${state.backend === 'wasm' ? 'CPU/WASM' : 'WebGPU'} inference exceeded the real-time budget; switching back before Chrome can bog down.`
    ).catch(console.error);
  }, INFERENCE_WATCHDOG_MS);
  state.worker.postMessage({ type: 'PROCESS_CHUNK', sequence, left: chunk.left, right: chunk.right }, [chunk.left.buffer, chunk.right.buffer]);
}

async function failToFallback(state, reason) {
  if (state.stopped) return;
  clearInferenceWatchdog(state);
  state.status = {
    active: false,
    phase: 'fallback',
    reason,
    rtf: state.lastRtf,
    quality: 'fallback',
    backend: state.backend
  };
  state.onStatus(state.status);
  await stopLiveAi(state, { restoreBase: true, preserveStatus: true });
}

export async function startLiveAi({ stream, onStatus = () => {}, muteBase = async () => {}, restoreBase = async () => {} } = {}) {
  if (!stream) throw new Error('Live AI Karaoke requires a captured tab stream.');

  onStatus({ active: true, phase: 'warming', reason: 'Checking WebGPU…', rtf: null, quality: 'warming', backend: null });
  const gpu = await diagnoseWebGpu();
  if (!gpu.ok) {
    const error = new Error(`WebGPU required for live AI Karaoke. ${gpu.reason}`);
    error.code = 'WEBGPU_UNAVAILABLE';
    error.action = gpu.action;
    throw error;
  }

  // Load the ~67 MB ONNX in the offscreen page (has chrome.runtime). Module workers
  // often cannot fetch large extension resources reliably on their own.
  onStatus({ active: true, phase: 'warming', reason: 'Loading local AI model…', rtf: null, quality: 'warming', backend: null });
  const modelBytes = await loadPackagedModelBytes();

  const aiContext = new AudioContext({ sampleRate: MDX_INST_HQ3.sampleRate, latencyHint: 'playback' });
  if (aiContext.state === 'suspended') await aiContext.resume();

  await aiContext.audioWorklet.addModule(chrome.runtime.getURL('live-ai-capture-worklet.js'));

  const worker = new Worker(chrome.runtime.getURL('dist/live-ai-worker.js'), { type: 'module' });
  const ring = new StereoRingBuffer(RING_CAPACITY_SAMPLES);
  const captureSource = aiContext.createMediaStreamSource(stream);
  const captureNode = new AudioWorkletNode(aiContext, 'live-ai-capture', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit'
  });
  const silentGain = aiContext.createGain();
  const outputGain = aiContext.createGain();
  const limiter = aiContext.createDynamicsCompressor();
  silentGain.gain.value = 0;
  outputGain.gain.value = 1;
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.12;

  // Keep the graph wired, but only accept capture frames after the worker is READY.
  // Starting ScriptProcessor/Worklet fill before INIT caused "worker is not initialized".
  captureSource.connect(captureNode);
  captureNode.connect(silentGain);
  silentGain.connect(aiContext.destination);
  outputGain.connect(limiter);
  limiter.connect(aiContext.destination);

  const state = {
    stream,
    aiContext,
    worker,
    ring,
    captureSource,
    captureNode,
    silentGain,
    outputGain,
    limiter,
    playbackSources: new Set(),
    inFlight: false,
    inferenceTimer: null,
    sequence: 0,
    firstChunkAccepted: false,
    captureArmed: false,
    baseMuted: false,
    nextPlaybackTime: 0,
    lastRtf: null,
    backend: null,
    stopped: false,
    status: { active: true, phase: 'warming', reason: null, rtf: null, quality: 'warming', backend: null },
    onStatus,
    muteBase,
    restoreBase
  };

  onStatus(state.status);

  worker.addEventListener('message', async (event) => {
    const message = event.data ?? {};
    if (state.stopped) return;
    if (message.type === 'ERROR') {
      clearInferenceWatchdog(state);
      state.inFlight = false;
      await failToFallback(state, message.message ?? 'AI worker failed.');
      return;
    }
    if (message.type !== 'CHUNK_READY') return;

    clearInferenceWatchdog(state);
    state.inFlight = false;
    state.backend = message.backend ?? state.backend;
    state.lastRtf = Number(message.rtf);
    if (!Number.isFinite(state.lastRtf) || state.lastRtf > MAX_RTF) {
      await failToFallback(state, `RTF ${Number.isFinite(state.lastRtf) ? state.lastRtf.toFixed(2) : 'invalid'}× is too slow for bounded live playback.`);
      return;
    }

    try {
      if (!state.firstChunkAccepted) {
        state.firstChunkAccepted = true;
        await state.muteBase();
        state.baseMuted = true;
      }
      scheduleInstrumental(state, message.left, message.right);
      state.status = {
        active: true,
        phase: 'live',
        reason: null,
        rtf: state.lastRtf,
        quality: state.lastRtf <= GOOD_RTF ? 'good' : 'warning',
        backend: state.backend,
        bufferedSeconds: state.ring.length / MDX_INST_HQ3.sampleRate,
        queueSeconds: Math.max(0, state.nextPlaybackTime - aiContext.currentTime)
      };
      onStatus(state.status);
      maybeDispatch(state);
    } catch (error) {
      await failToFallback(state, error?.message ?? String(error));
    }
  });

  captureNode.port.onmessage = (event) => {
    if (state.stopped || !state.captureArmed) return;
    const left = event.data?.left;
    const right = event.data?.right;
    if (!(left instanceof Float32Array) || !(right instanceof Float32Array)) return;
    if (!ring.push(left, right)) {
      failToFallback(state, 'Live AI ring buffer reached its hard limit; falling back before memory/latency can grow.').catch(console.error);
      return;
    }
    maybeDispatch(state);
  };

  const readyPromise = waitForWorkerReady(worker);
  // Transfer a copy so a failed worker cannot leave us with a detached buffer on retry paths.
  const transferable = modelBytes.slice(0);
  worker.postMessage({
    type: 'INIT',
    runtimePath: chrome.runtime.getURL('vendor/ort/'),
    modelUrl: chrome.runtime.getURL(MDX_INST_HQ3.fileName),
    modelBytes: transferable
  }, [transferable]);

  try {
    const ready = await readyPromise;
    state.backend = ready.backend ?? null;
    state.captureArmed = true;
    state.status = {
      ...state.status,
      phase: 'buffering',
      backend: state.backend,
      backendNote: ready.webgpuFallbackReason ?? null
    };
    onStatus(state.status);
    return state;
  } catch (error) {
    await stopLiveAi(state, { restoreBase: false, preserveStatus: true }).catch(() => {});
    throw error;
  }
}

export async function stopLiveAi(state, { restoreBase = true, preserveStatus = false } = {}) {
  if (!state || state.stopped) return;
  state.stopped = true;
  clearInferenceWatchdog(state);

  state.captureArmed = false;
  try { if (state.captureNode?.port) state.captureNode.port.onmessage = null; } catch {}
  for (const source of state.playbackSources) {
    try { source.stop(); } catch {}
  }
  state.playbackSources.clear();
  for (const track of state.stream.getTracks()) {
    try { track.stop(); } catch {}
  }
  for (const node of [state.captureSource, state.captureNode, state.silentGain, state.outputGain, state.limiter]) {
    try { node?.disconnect(); } catch {}
  }
  try { state.worker.postMessage({ type: 'DISPOSE' }); } catch {}
  try { state.worker.terminate(); } catch {}
  if (state.aiContext.state !== 'closed') await state.aiContext.close();
  state.ring.clear();

  if (restoreBase && state.baseMuted) {
    await state.restoreBase().catch(() => {});
    state.baseMuted = false;
  }
  if (!preserveStatus) {
    state.status = { active: false, phase: 'off', reason: null, rtf: state.lastRtf, quality: 'off', backend: state.backend };
    state.onStatus(state.status);
  }
}

export const LIVE_AI_LIMITS = Object.freeze({
  maxRtf: MAX_RTF,
  goodRtf: GOOD_RTF,
  inferenceWatchdogMs: INFERENCE_WATCHDOG_MS,
  ringCapacitySeconds: RING_CAPACITY_SAMPLES / MDX_INST_HQ3.sampleRate,
  modelChunkSeconds: mdxChunkSize(MDX_INST_HQ3) / MDX_INST_HQ3.sampleRate,
  generatedChunkSeconds: mdxGenerationSize(MDX_INST_HQ3) / MDX_INST_HQ3.sampleRate
});
