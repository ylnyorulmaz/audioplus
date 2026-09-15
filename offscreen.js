import {
  EQ_FREQUENCIES,
  DEFAULT_SETTINGS,
  sanitizeSettings,
  effectivePreampDb,
  dbToGain
} from './audio-settings.js';

const processors = new Map();

const LIMITER_ACTIVE = Object.freeze({ threshold: -1, knee: 0, ratio: 20, attack: 0.003, release: 0.12 });
const LIMITER_BYPASS = Object.freeze({ threshold: 0, knee: 0, ratio: 1, attack: 0.003, release: 0.12 });
const NIGHT_DYNAMICS = Object.freeze({
  off: Object.freeze({ threshold: 0, knee: 0, ratio: 1, attack: 0.01, release: 0.2 }),
  light: Object.freeze({ threshold: -24, knee: 12, ratio: 3, attack: 0.012, release: 0.25 }),
  strong: Object.freeze({ threshold: -32, knee: 18, ratio: 6, attack: 0.008, release: 0.35 })
});
const VOCAL_LOW_CROSSOVER_HZ = 180;
const VOCAL_HIGH_CROSSOVER_HZ = 6500;
const ANALYSIS_SAMPLES = 12;
const ANALYSIS_INTERVAL_MS = 110;
const ANALYSIS_BANDS = Object.freeze({
  bassDb: [60, 180],
  lowMidDb: [180, 500],
  midDb: [500, 1500],
  presenceDb: [1500, 4000],
  highDb: [4000, 10000],
  airDb: [10000, 16000]
});

function smoothParam(param, value, context, timeConstant = 0.015) {
  const now = context.currentTime;
  param.cancelScheduledValues(now);
  param.setTargetAtTime(value, now, timeConstant);
}

function setCompressorState(compressor, values, context) {
  smoothParam(compressor.threshold, values.threshold, context);
  smoothParam(compressor.knee, values.knee, context);
  smoothParam(compressor.ratio, values.ratio, context);
  smoothParam(compressor.attack, values.attack, context);
  smoothParam(compressor.release, values.release, context);
}

function friendlyCaptureError(error) {
  const name = error?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Chrome blocked access to this tab audio. Reload the page and enable Audio+ again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'This tab did not expose a usable audio stream.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'Tab audio is temporarily unavailable. Stop other capture tools and try again.';
  if (name === 'InvalidStateError') return 'Chrome could not start the audio processor for this tab. Reload the tab and try again.';
  return error?.message ?? String(error);
}

async function notifyStatus(tabId, enabled, error = null) {
  try {
    await chrome.runtime.sendMessage({ type: 'OFFSCREEN_STATUS', tabId, enabled, error });
  } catch (messageError) {
    console.warn('[Audio+] could not sync processor status', messageError);
  }
}

function createStereoCenterReducer(context) {
  const splitter = context.createChannelSplitter(2);
  const leftToLeft = context.createGain();
  const rightToLeft = context.createGain();
  const leftToRight = context.createGain();
  const rightToRight = context.createGain();
  const merger = context.createChannelMerger(2);

  splitter.connect(leftToLeft, 0);
  splitter.connect(leftToRight, 0);
  splitter.connect(rightToLeft, 1);
  splitter.connect(rightToRight, 1);
  leftToLeft.connect(merger, 0, 0);
  rightToLeft.connect(merger, 0, 0);
  leftToRight.connect(merger, 0, 1);
  rightToRight.connect(merger, 0, 1);

  return { splitter, leftToLeft, rightToLeft, leftToRight, rightToRight, merger };
}

function setCenterReduction(matrix, amount, context) {
  const safeAmount = Math.max(0, Math.min(1, amount));
  const directCoefficient = 1 - safeAmount / 2;
  const crossCoefficient = -safeAmount / 2;
  smoothParam(matrix.leftToLeft.gain, directCoefficient, context);
  smoothParam(matrix.rightToRight.gain, directCoefficient, context);
  smoothParam(matrix.rightToLeft.gain, crossCoefficient, context);
  smoothParam(matrix.leftToRight.gain, crossCoefficient, context);
}

function disconnectMatrix(matrix) {
  for (const node of [matrix.splitter, matrix.leftToLeft, matrix.rightToLeft, matrix.leftToRight, matrix.rightToRight, matrix.merger]) {
    try { node.disconnect(); } catch {}
  }
}

function disconnectVocalReducer(reducer) {
  for (const node of [
    reducer.dryGain,
    reducer.lowpass,
    reducer.lowGain,
    reducer.midHighpass,
    reducer.midLowpass,
    reducer.midGain,
    reducer.highpass,
    reducer.highGain,
    reducer.output
  ]) {
    try { node.disconnect(); } catch {}
  }
  disconnectMatrix(reducer.lowMatrix);
  disconnectMatrix(reducer.midMatrix);
  disconnectMatrix(reducer.highMatrix);
}

async function stopProcessor(tabId, { notify = true } = {}) {
  const processor = processors.get(tabId);
  if (!processor) {
    if (notify) await notifyStatus(tabId, false);
    return;
  }
  processors.delete(tabId);
  for (const track of processor.stream.getTracks()) {
    track.onended = null;
    track.stop();
  }
  try {
    processor.source.disconnect();
    processor.analyser.disconnect();
    processor.bassMacro.disconnect();
    processor.midMacro.disconnect();
    processor.trebleMacro.disconnect();
    for (const filter of processor.eqFilters) filter.disconnect();
    processor.dialogueMudCut.disconnect();
    processor.dialoguePresence.disconnect();
    disconnectVocalReducer(processor.vocalReducer);
    for (const filter of processor.smartFixFilters) filter.disconnect();
    processor.preampGain.disconnect();
    processor.nightCompressor.disconnect();
    processor.masterGain.disconnect();
    processor.peakLimiter.disconnect();
  } catch {}
  processor.context.onstatechange = null;
  if (processor.context.state !== 'closed') await processor.context.close();
  if (notify) await notifyStatus(tabId, false);
}

function aggressiveVocalAmount(normalized) {
  if (normalized <= 0) return 0;
  return Math.min(1, Math.pow(normalized, 0.72) * 1.08);
}

function applyVocalReduction(processor, settings) {
  const reducer = processor.vocalReducer;
  const normalized = settings.bypass ? 0 : settings.vocalReduction / 100;
  const active = normalized > 0.001;
  const aggressive = aggressiveVocalAmount(normalized);

  smoothParam(reducer.dryGain.gain, active ? 0 : 1, processor.context);
  smoothParam(reducer.lowGain.gain, active ? 1 : 0, processor.context);
  smoothParam(reducer.midGain.gain, active ? 1 : 0, processor.context);
  smoothParam(reducer.highGain.gain, active ? 1 : 0, processor.context);

  const lowAmount = settings.keepBass ? 0 : aggressive * 0.28;
  const midAmount = aggressive;
  const highAmount = aggressive * 0.42;
  setCenterReduction(reducer.lowMatrix, lowAmount, processor.context);
  setCenterReduction(reducer.midMatrix, midAmount, processor.context);
  setCenterReduction(reducer.highMatrix, highAmount, processor.context);
}

function applySettings(processor, incoming) {
  const settings = sanitizeSettings({ ...processor.settings, ...incoming });
  processor.settings = settings;
  const bypass = settings.bypass;
  smoothParam(processor.bassMacro.gain, bypass ? 0 : settings.bassDb, processor.context);
  smoothParam(processor.midMacro.gain, bypass ? 0 : settings.midDb, processor.context);
  smoothParam(processor.trebleMacro.gain, bypass ? 0 : settings.trebleDb, processor.context);
  processor.eqFilters.forEach((filter, index) => smoothParam(filter.gain, bypass ? 0 : settings.eqBands[index], processor.context));

  const dialogueAmount = bypass ? 0 : settings.dialogueBoost / 100;
  smoothParam(processor.dialogueMudCut.gain, -2 * dialogueAmount, processor.context);
  smoothParam(processor.dialoguePresence.gain, 3 * dialogueAmount, processor.context);
  applyVocalReduction(processor, settings);

  processor.smartFixFilters.forEach((filter, index) => {
    const gain = !bypass && settings.smartFixEnabled ? settings.smartFixBands[index] : 0;
    smoothParam(filter.gain, gain, processor.context);
  });

  smoothParam(processor.preampGain.gain, bypass ? 1 : dbToGain(effectivePreampDb(settings)), processor.context);
  setCompressorState(processor.nightCompressor, bypass ? NIGHT_DYNAMICS.off : NIGHT_DYNAMICS[settings.nightMode], processor.context);
  smoothParam(processor.masterGain.gain, bypass ? 1 : settings.volume / 100, processor.context);
  setCompressorState(processor.peakLimiter, bypass ? LIMITER_BYPASS : LIMITER_ACTIVE, processor.context);
}

function createEqFilter(context, frequency) {
  const filter = context.createBiquadFilter();
  filter.type = 'peaking';
  filter.frequency.value = frequency;
  filter.Q.value = 1.4;
  filter.gain.value = 0;
  return filter;
}

function createDialogueFilter(context, frequency, q) {
  const filter = context.createBiquadFilter();
  filter.type = 'peaking';
  filter.frequency.value = frequency;
  filter.Q.value = q;
  filter.gain.value = 0;
  return filter;
}

function createCompressor(context, values) {
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = values.threshold;
  compressor.knee.value = values.knee;
  compressor.ratio.value = values.ratio;
  compressor.attack.value = values.attack;
  compressor.release.value = values.release;
  return compressor;
}

function createVocalReducer(context, input) {
  const dryGain = context.createGain();
  const output = context.createGain();

  const lowpass = context.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = VOCAL_LOW_CROSSOVER_HZ;
  lowpass.Q.value = 0.707;
  const lowMatrix = createStereoCenterReducer(context);
  const lowGain = context.createGain();

  const midHighpass = context.createBiquadFilter();
  midHighpass.type = 'highpass';
  midHighpass.frequency.value = VOCAL_LOW_CROSSOVER_HZ;
  midHighpass.Q.value = 0.707;
  const midLowpass = context.createBiquadFilter();
  midLowpass.type = 'lowpass';
  midLowpass.frequency.value = VOCAL_HIGH_CROSSOVER_HZ;
  midLowpass.Q.value = 0.707;
  const midMatrix = createStereoCenterReducer(context);
  const midGain = context.createGain();

  const highpass = context.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = VOCAL_HIGH_CROSSOVER_HZ;
  highpass.Q.value = 0.707;
  const highMatrix = createStereoCenterReducer(context);
  const highGain = context.createGain();

  dryGain.gain.value = 1;
  lowGain.gain.value = 0;
  midGain.gain.value = 0;
  highGain.gain.value = 0;

  input.connect(dryGain);
  dryGain.connect(output);

  input.connect(lowpass);
  lowpass.connect(lowMatrix.splitter);
  lowMatrix.merger.connect(lowGain);
  lowGain.connect(output);

  input.connect(midHighpass);
  midHighpass.connect(midLowpass);
  midLowpass.connect(midMatrix.splitter);
  midMatrix.merger.connect(midGain);
  midGain.connect(output);

  input.connect(highpass);
  highpass.connect(highMatrix.splitter);
  highMatrix.merger.connect(highGain);
  highGain.connect(output);

  return {
    dryGain,
    lowpass,
    lowMatrix,
    lowGain,
    midHighpass,
    midLowpass,
    midMatrix,
    midGain,
    highpass,
    highMatrix,
    highGain,
    output
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bandPower(frequencyData, sampleRate, fftSize, lowHz, highHz) {
  const binHz = sampleRate / fftSize;
  const start = Math.max(1, Math.floor(lowHz / binHz));
  const end = Math.min(frequencyData.length - 1, Math.ceil(highHz / binHz));
  let power = 0;
  let count = 0;
  for (let index = start; index <= end; index += 1) {
    const db = frequencyData[index];
    if (!Number.isFinite(db)) continue;
    power += 10 ** (db / 10);
    count += 1;
  }
  return count > 0 ? power / count : 1e-10;
}

function powerToDb(power) {
  return 10 * Math.log10(Math.max(power, 1e-10));
}

function roundMetric(value) {
  return Math.round(value * 10) / 10;
}

async function analyzeProcessor(processor) {
  if (processor.context.state === 'suspended') await processor.context.resume();

  const frequencyData = new Float32Array(processor.analyser.frequencyBinCount);
  const timeData = new Float32Array(processor.analyser.fftSize);
  const bandTotals = Object.fromEntries(Object.keys(ANALYSIS_BANDS).map((key) => [key, 0]));
  let rmsPowerTotal = 0;
  let peak = 0;
  let validSamples = 0;

  for (let sample = 0; sample < ANALYSIS_SAMPLES; sample += 1) {
    processor.analyser.getFloatFrequencyData(frequencyData);
    processor.analyser.getFloatTimeDomainData(timeData);

    let sumSquares = 0;
    let samplePeak = 0;
    for (const value of timeData) {
      sumSquares += value * value;
      samplePeak = Math.max(samplePeak, Math.abs(value));
    }
    const rmsPower = sumSquares / timeData.length;

    if (rmsPower > 1e-8) {
      validSamples += 1;
      rmsPowerTotal += rmsPower;
      peak = Math.max(peak, samplePeak);
      for (const [key, [lowHz, highHz]] of Object.entries(ANALYSIS_BANDS)) {
        bandTotals[key] += bandPower(frequencyData, processor.context.sampleRate, processor.analyser.fftSize, lowHz, highHz);
      }
    }

    if (sample < ANALYSIS_SAMPLES - 1) await wait(ANALYSIS_INTERVAL_MS);
  }

  if (validSamples < 3) throw new Error('Not enough audible content to analyze. Play audio and try Smart Fix again.');

  const rmsDb = powerToDb(rmsPowerTotal / validSamples);
  if (rmsDb < -65) throw new Error('Audio is too quiet to analyze. Play a louder section and try again.');

  const metrics = {};
  for (const key of Object.keys(ANALYSIS_BANDS)) {
    metrics[key] = roundMetric(powerToDb(bandTotals[key] / validSamples));
  }
  metrics.rmsDb = roundMetric(rmsDb);
  metrics.peakDb = roundMetric(20 * Math.log10(Math.max(peak, 1e-6)));
  metrics.crestDb = roundMetric(metrics.peakDb - metrics.rmsDb);

  return metrics;
}

async function startProcessor(tabId, streamId, settings) {
  await stopProcessor(tabId, { notify: false });
  let context;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
      video: false
    });
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) throw new DOMException('No audio track was returned for this tab.', 'NotFoundError');
    context = new AudioContext({ latencyHint: 'interactive' });
    if (context.state === 'suspended') await context.resume();

    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.minDecibels = -100;
    analyser.maxDecibels = -20;
    analyser.smoothingTimeConstant = 0.5;

    const bassMacro = context.createBiquadFilter();
    bassMacro.type = 'lowshelf'; bassMacro.frequency.value = 180;
    const midMacro = context.createBiquadFilter();
    midMacro.type = 'peaking'; midMacro.frequency.value = 1000; midMacro.Q.value = 0.7;
    const trebleMacro = context.createBiquadFilter();
    trebleMacro.type = 'highshelf'; trebleMacro.frequency.value = 4500;
    const eqFilters = EQ_FREQUENCIES.map((frequency) => createEqFilter(context, frequency));
    const dialogueMudCut = createDialogueFilter(context, 280, 0.9);
    const dialoguePresence = createDialogueFilter(context, 2600, 0.85);
    const smartFixFilters = EQ_FREQUENCIES.map((frequency) => createEqFilter(context, frequency));
    const preampGain = context.createGain();
    const nightCompressor = createCompressor(context, NIGHT_DYNAMICS.off);
    const masterGain = context.createGain();
    const peakLimiter = createCompressor(context, LIMITER_ACTIVE);

    source.connect(analyser);
    analyser.connect(bassMacro);
    bassMacro.connect(midMacro); midMacro.connect(trebleMacro);
    let previous = trebleMacro;
    for (const filter of eqFilters) { previous.connect(filter); previous = filter; }
    previous.connect(dialogueMudCut);
    dialogueMudCut.connect(dialoguePresence);
    const vocalReducer = createVocalReducer(context, dialoguePresence);
    previous = vocalReducer.output;
    for (const filter of smartFixFilters) { previous.connect(filter); previous = filter; }
    previous.connect(preampGain);
    preampGain.connect(nightCompressor);
    nightCompressor.connect(masterGain);
    masterGain.connect(peakLimiter);
    peakLimiter.connect(context.destination);

    const processor = {
      tabId,
      context,
      stream,
      source,
      analyser,
      bassMacro,
      midMacro,
      trebleMacro,
      eqFilters,
      dialogueMudCut,
      dialoguePresence,
      vocalReducer,
      smartFixFilters,
      preampGain,
      nightCompressor,
      masterGain,
      peakLimiter,
      settings: sanitizeSettings(DEFAULT_SETTINGS)
    };
    processors.set(tabId, processor);
    applySettings(processor, settings ?? {});

    context.onstatechange = () => {
      if (!processors.has(tabId)) return;
      if (context.state === 'closed') {
        processors.delete(tabId);
        notifyStatus(tabId, false, 'The browser audio processor closed unexpectedly.').catch(console.error);
      }
    };
    for (const track of audioTracks) track.onended = () => { if (processors.get(tabId) === processor) stopProcessor(tabId).catch(console.error); };
    await notifyStatus(tabId, true);
    return { ok: true, diagnostics: { sampleRate: context.sampleRate, contextState: context.state, audioTracks: audioTracks.length } };
  } catch (error) {
    if (stream) for (const track of stream.getTracks()) track.stop();
    if (context && context.state !== 'closed') await context.close();
    const message = friendlyCaptureError(error);
    await notifyStatus(tabId, false, message);
    return { ok: false, error: message };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== 'offscreen') return;
  (async () => {
    switch (message.type) {
      case 'START_CAPTURE': sendResponse(await startProcessor(message.tabId, message.streamId, message.settings)); return;
      case 'STOP_CAPTURE': await stopProcessor(message.tabId); sendResponse({ ok: true }); return;
      case 'APPLY_SETTINGS': {
        const processor = processors.get(message.tabId);
        if (!processor) throw new Error('No active processor for this tab.');
        applySettings(processor, message.settings ?? {}); sendResponse({ ok: true }); return;
      }
      case 'ANALYZE_AUDIO': {
        const processor = processors.get(message.tabId);
        if (!processor) throw new Error('Enable Audio+ before running Smart Fix.');
        const metrics = await analyzeProcessor(processor);
        sendResponse({ ok: true, metrics });
        return;
      }
      case 'GET_PROCESSOR_DIAGNOSTICS': {
        const processor = processors.get(message.tabId);
        if (!processor) { sendResponse({ ok: true, active: false }); return; }
        sendResponse({
          ok: true,
          active: true,
          contextState: processor.context.state,
          sampleRate: processor.context.sampleRate,
          nightReductionDb: processor.nightCompressor.reduction,
          limiterReductionDb: processor.peakLimiter.reduction,
          vocalReduction: processor.settings.vocalReduction,
          keepBass: processor.settings.keepBass,
          vocalBandHz: [VOCAL_LOW_CROSSOVER_HZ, VOCAL_HIGH_CROSSOVER_HZ],
          smartFixEnabled: processor.settings.smartFixEnabled,
          smartFixBands: processor.settings.smartFixBands,
          audioTracks: processor.stream.getAudioTracks().length
        });
        return;
      }
      default: sendResponse({ ok: false, error: `Unknown offscreen message type: ${message.type}` });
    }
  })().catch((error) => { console.error('[Audio+] offscreen error', error); sendResponse({ ok: false, error: error?.message ?? String(error) }); });
  return true;
});
