import * as ort from 'onnxruntime-web/webgpu';
import { MDX_INST_HQ3, mdxChunkSize, mdxGenerationSize, mdxTrim } from './mdx-profile.js';
import { MdxStft } from './mdx-stft.js';
import { BoundedStereoRing, liveRtfDecision } from './live-buffer.js';

const MAX_BUFFER_SECONDS = 20;
const MAX_OUTPUT_QUEUE_SECONDS = 12;
const FALLBACK_RTF = 0.98;
const ROLLING_FALLBACK_RTF = 1.05;
const UNDERRUN_TOLERANCE_SECONDS = 0.4;
const FAST_FALLBACK_AMOUNT = 0.82;

function disposeOutputs(outputs) {
  for (const value of Object.values(outputs ?? {})) {
    if (value && typeof value.dispose === 'function') value.dispose();
  }
}

export async function processLiveMdxWindow({ session, inputName, outputName, stft, left, right, profile = MDX_INST_HQ3 }) {
  const features = stft.forwardStereo(left, right);
  const tensor = new ort.Tensor('float32', features, profile.expectedInputShape);
  let outputs;
  try {
    outputs = await session.run({ [inputName]: tensor });
    const output = outputs[outputName] ?? Object.values(outputs)[0];
    if (!output?.data) throw new Error('MDX model returned no audio tensor.');
    const reconstructed = stft.inverseStereo(output.data);
    const trim = mdxTrim(profile);
    const generation = mdxGenerationSize(profile);
    const outLeft = new Float32Array(generation);
    const outRight = new Float32Array(generation);
    for (let i = 0; i < generation; i += 1) {
      outLeft[i] = reconstructed.left[trim + i] * profile.compensate;
      outRight[i] = reconstructed.right[trim + i] * profile.compensate;
    }
    return { left: outLeft, right: outRight };
  } finally {
    tensor.dispose();
    disposeOutputs(outputs);
  }
}

function buildFastFallback(context, source) {
  const splitter = context.createChannelSplitter(2);
  const leftToLeft = context.createGain();
  const rightToLeft = context.createGain();
  const leftToRight = context.createGain();
  const rightToRight = context.createGain();
  const merger = context.createChannelMerger(2);
  const direct = 1 - FAST_FALLBACK_AMOUNT / 2;
  const cross = -FAST_FALLBACK_AMOUNT / 2;
  leftToLeft.gain.value = direct;
  rightToRight.gain.value = direct;
  rightToLeft.gain.value = cross;
  leftToRight.gain.value = cross;
  source.connect(splitter);
  splitter.connect(leftToLeft, 0);
  splitter.connect(leftToRight, 0);
  splitter.connect(rightToLeft, 1);
  splitter.connect(rightToRight, 1);
  leftToLeft.connect(merger, 0, 0);
  rightToLeft.connect(merger, 0, 0);
  leftToRight.connect(merger, 0, 1);
  rightToRight.connect(merger, 0, 1);
  merger.connect(context.destination);
  return [splitter, leftToLeft, rightToLeft, leftToRight, rightToRight, merger];
}

export class LiveAiKaraoke {
  constructor({ session, inputName, outputName, targetTabId, siteKey = null, profile = MDX_INST_HQ3, onStatus = () => {}, onMetrics = () => {}, onFallback = () => {} }) {
    this.session = session;
    this.inputName = inputName;
    this.outputName = outputName;
    this.targetTabId = targetTabId;
    this.siteKey = siteKey;
    this.profile = profile;
    this.onStatus = onStatus;
    this.onMetrics = onMetrics;
    this.onFallback = onFallback;
    this.context = null;
    this.stream = null;
    this.source = null;
    this.captureNode = null;
    this.fastFallbackNodes = [];
    this.ring = new BoundedStereoRing(Math.ceil(profile.sampleRate * MAX_BUFFER_SECONDS));
    this.stft = new MdxStft(profile);
    this.running = false;
    this.processing = false;
    this.nextPlaybackTime = 0;
    this.scheduled = new Set();
    this.firstChunk = true;
    this.startedAt = 0;
    this.rollingRtf = 0;
    this.processedChunks = 0;
    this.fallingBack = false;
    this.pumpTimer = null;
  }

  async start() {
    if (this.running) return;
    if (!Number.isInteger(this.targetTabId)) throw new Error('Open AI Karaoke from the Audio+ popup on a normal media tab.');

    const streamIdPromise = chrome.tabCapture.getMediaStreamId({ targetTabId: this.targetTabId });
    await chrome.runtime.sendMessage({ type: 'STOP_CAPTURE', tabId: this.targetTabId, siteKey: this.siteKey });
    const streamId = await streamIdPromise;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
      video: false
    });

    this.context = new AudioContext({ sampleRate: this.profile.sampleRate, latencyHint: 'playback' });
    if (this.context.sampleRate !== this.profile.sampleRate) throw new Error(`Live AI Karaoke requires ${this.profile.sampleRate} Hz AudioContext; Chrome created ${this.context.sampleRate} Hz.`);
    await this.context.audioWorklet.addModule(chrome.runtime.getURL('audio-capture-worklet.js'));
    if (this.context.state === 'suspended') await this.context.resume();

    this.source = this.context.createMediaStreamSource(this.stream);
    this.captureNode = new AudioWorkletNode(this.context, 'audio-plus-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit'
    });
    this.source.connect(this.captureNode);
    this.captureNode.connect(this.context.destination);
    this.captureNode.port.onmessage = (event) => this.#acceptPcm(event.data);

    for (const track of this.stream.getTracks()) track.onended = () => this.stop().catch(() => {});

    this.running = true;
    this.startedAt = performance.now();
    this.onStatus({ state: 'buffering', message: `Buffering ${(mdxChunkSize(this.profile) / this.profile.sampleRate).toFixed(1)} s for the first MDX window…` });
  }

  #acceptPcm(data) {
    if (!this.running || !data?.left || !data?.right) return;
    const left = data.left instanceof Float32Array ? data.left : new Float32Array(data.left);
    const right = data.right instanceof Float32Array ? data.right : new Float32Array(data.right);
    if (!this.ring.push(left, right)) {
      this.#fallback('Live AI input buffer reached its 20 s hard limit.').catch(() => {});
      return;
    }
    this.#pump().catch((error) => this.#fallback(error?.message ?? String(error)));
  }

  #queueSeconds() {
    return this.context ? Math.max(0, this.nextPlaybackTime - this.context.currentTime) : 0;
  }

  #retryPumpSoon() {
    if (this.pumpTimer || !this.running) return;
    this.pumpTimer = setTimeout(() => {
      this.pumpTimer = null;
      this.#pump().catch((error) => this.#fallback(error?.message ?? String(error)));
    }, 200);
  }

  async #pump() {
    if (!this.running || this.processing || this.fallingBack) return;
    if (this.#queueSeconds() >= MAX_OUTPUT_QUEUE_SECONDS) {
      this.#retryPumpSoon();
      return;
    }
    const chunkSize = mdxChunkSize(this.profile);
    if (this.ring.available < chunkSize) return;

    this.processing = true;
    try {
      const window = this.ring.peek(chunkSize);
      const started = performance.now();
      const instrumental = await processLiveMdxWindow({ session: this.session, inputName: this.inputName, outputName: this.outputName, stft: this.stft, left: window.left, right: window.right, profile: this.profile });
      const elapsedSeconds = (performance.now() - started) / 1000;
      const generationSeconds = mdxGenerationSize(this.profile) / this.profile.sampleRate;
      const rtf = elapsedSeconds / generationSeconds;
      this.ring.discard(mdxGenerationSize(this.profile));
      this.processedChunks += 1;
      this.rollingRtf = this.processedChunks === 1 ? rtf : (this.rollingRtf * 0.7 + rtf * 0.3);

      if (this.firstChunk) {
        const decision = liveRtfDecision(rtf);
        if (decision.mode === 'fallback' || rtf >= FALLBACK_RTF) {
          await this.#fallback(`WebGPU is too slow for continuous MDX playback (RTF ${rtf.toFixed(2)}×).`);
          return;
        }
        this.firstChunk = false;
        const startupLatency = (performance.now() - this.startedAt) / 1000;
        this.onStatus({ state: decision.level === 'warning' ? 'warning' : 'live', message: `Live AI Karaoke started · RTF ${rtf.toFixed(2)}× · processed audio latency ~${startupLatency.toFixed(1)} s.` });
      } else if (this.rollingRtf >= ROLLING_FALLBACK_RTF) {
        await this.#fallback(`Sustained MDX RTF rose to ${this.rollingRtf.toFixed(2)}×.`);
        return;
      }

      if (this.nextPlaybackTime && this.context.currentTime - this.nextPlaybackTime > UNDERRUN_TOLERANCE_SECONDS) {
        await this.#fallback('AI playback could not stay ahead of the audio clock.');
        return;
      }

      this.#schedule(instrumental.left, instrumental.right);
      this.onMetrics({ rtf, rollingRtf: this.rollingRtf, ringSeconds: this.ring.available / this.profile.sampleRate, queueSeconds: this.#queueSeconds(), chunks: this.processedChunks });
    } finally {
      this.processing = false;
    }

    if (this.running && this.ring.available >= mdxChunkSize(this.profile)) queueMicrotask(() => this.#pump().catch((error) => this.#fallback(error?.message ?? String(error))));
  }

  #schedule(left, right) {
    const buffer = this.context.createBuffer(2, left.length, this.profile.sampleRate);
    buffer.copyToChannel(left, 0);
    buffer.copyToChannel(right, 1);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const startAt = this.nextPlaybackTime > 0 ? Math.max(this.nextPlaybackTime, this.context.currentTime + 0.03) : this.context.currentTime + 0.08;
    source.start(startAt);
    this.nextPlaybackTime = startAt + buffer.duration;
    this.scheduled.add(source);
    source.onended = () => this.scheduled.delete(source);
  }

  #stopScheduled() {
    for (const scheduled of this.scheduled) {
      try { scheduled.stop(); } catch {}
      try { scheduled.disconnect(); } catch {}
    }
    this.scheduled.clear();
    this.nextPlaybackTime = 0;
  }

  async #fallback(reason) {
    if (this.fallingBack || !this.context || !this.source) return;
    this.fallingBack = true;
    this.running = false;
    this.ring.clear();
    if (this.pumpTimer) clearTimeout(this.pumpTimer);
    this.pumpTimer = null;
    this.#stopScheduled();
    if (this.captureNode) {
      this.captureNode.port.onmessage = null;
      try { this.source.disconnect(this.captureNode); } catch {}
      try { this.captureNode.disconnect(); } catch {}
      this.captureNode = null;
    }
    this.fastFallbackNodes = buildFastFallback(this.context, this.source);
    this.onStatus({ state: 'fallback', message: `${reason} Fast Karaoke 82% is now running on the same capture stream.` });
    this.onMetrics({ rtf: this.rollingRtf || 0, rollingRtf: this.rollingRtf || 0, ringSeconds: 0, queueSeconds: 0, chunks: this.processedChunks });
    await this.onFallback(reason);
  }

  async stop() {
    this.running = false;
    this.processing = false;
    this.ring.clear();
    if (this.pumpTimer) clearTimeout(this.pumpTimer);
    this.pumpTimer = null;
    this.#stopScheduled();

    for (const node of this.fastFallbackNodes) {
      try { node.disconnect(); } catch {}
    }
    this.fastFallbackNodes = [];
    if (this.captureNode) {
      this.captureNode.port.onmessage = null;
      try { this.captureNode.disconnect(); } catch {}
      this.captureNode = null;
    }
    if (this.source) {
      try { this.source.disconnect(); } catch {}
      this.source = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.onended = null;
        track.stop();
      }
      this.stream = null;
    }
    if (this.context && this.context.state !== 'closed') await this.context.close();
    this.context = null;
    this.fallingBack = false;
  }
}
