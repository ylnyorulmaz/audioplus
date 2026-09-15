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
const VOCAL_CROSSOVER_HZ = 180;

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

function disconnectVocalReducer(reducer) {
  for (const node of [
    reducer.splitter,
    reducer.leftToLeft,
    reducer.rightToLeft,
    reducer.leftToRight,
    reducer.rightToRight,
    reducer.merger,
    reducer.processedFullGain,
    reducer.processedHighpass,
    reducer.processedHighGain,
    reducer.originalLowpass,
    reducer.bassPreserveGain,
    reducer.output
  ]) {
    try { node.disconnect(); } catch {}
  }
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
    processor.bassMacro.disconnect();
    processor.midMacro.disconnect();
    processor.trebleMacro.disconnect();
    for (const filter of processor.eqFilters) filter.disconnect();
    processor.dialogueMudCut.disconnect();
    processor.dialoguePresence.disconnect();
    disconnectVocalReducer(processor.vocalReducer);
    processor.preampGain.disconnect();
    processor.nightCompressor.disconnect();
    processor.masterGain.disconnect();
    processor.peakLimiter.disconnect();
  } catch {}
  processor.context.onstatechange = null;
  if (processor.context.state !== 'closed') await processor.context.close();
  if (notify) await notifyStatus(tabId, false);
}

function applyVocalReduction(processor, settings) {
  const reducer = processor.vocalReducer;
  const amount = settings.bypass ? 0 : settings.vocalReduction / 100;
  const directCoefficient = 1 - amount / 2;
  const crossCoefficient = -amount / 2;

  smoothParam(reducer.leftToLeft.gain, directCoefficient, processor.context);
  smoothParam(reducer.rightToRight.gain, directCoefficient, processor.context);
  smoothParam(reducer.rightToLeft.gain, crossCoefficient, processor.context);
  smoothParam(reducer.leftToRight.gain, crossCoefficient, processor.context);

  const preserveBass = amount > 0 && settings.keepBass && !settings.bypass;
  smoothParam(reducer.processedFullGain.gain, preserveBass ? 0 : 1, processor.context);
  smoothParam(reducer.processedHighGain.gain, preserveBass ? 1 : 0, processor.context);
  smoothParam(reducer.bassPreserveGain.gain, preserveBass ? 1 : 0, processor.context);
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
  const splitter = context.createChannelSplitter(2);
  const leftToLeft = context.createGain();
  const rightToLeft = context.createGain();
  const leftToRight = context.createGain();
  const rightToRight = context.createGain();
  const merger = context.createChannelMerger(2);
  const processedFullGain = context.createGain();
  const processedHighpass = context.createBiquadFilter();
  const processedHighGain = context.createGain();
  const originalLowpass = context.createBiquadFilter();
  const bassPreserveGain = context.createGain();
  const output = context.createGain();

  processedHighpass.type = 'highpass';
  processedHighpass.frequency.value = VOCAL_CROSSOVER_HZ;
  processedHighpass.Q.value = 0.707;
  originalLowpass.type = 'lowpass';
  originalLowpass.frequency.value = VOCAL_CROSSOVER_HZ;
  originalLowpass.Q.value = 0.707;
  processedFullGain.gain.value = 1;
  processedHighGain.gain.value = 0;
  bassPreserveGain.gain.value = 0;

  input.connect(splitter);
  splitter.connect(leftToLeft, 0);
  splitter.connect(leftToRight, 0);
  splitter.connect(rightToLeft, 1);
  splitter.connect(rightToRight, 1);
  leftToLeft.connect(merger, 0, 0);
  rightToLeft.connect(merger, 0, 0);
  leftToRight.connect(merger, 0, 1);
  rightToRight.connect(merger, 0, 1);

  merger.connect(processedFullGain);
  processedFullGain.connect(output);
  merger.connect(processedHighpass);
  processedHighpass.connect(processedHighGain);
  processedHighGain.connect(output);
  input.connect(originalLowpass);
  originalLowpass.connect(bassPreserveGain);
  bassPreserveGain.connect(output);

  return {
    splitter,
    leftToLeft,
    rightToLeft,
    leftToRight,
    rightToRight,
    merger,
    processedFullGain,
    processedHighpass,
    processedHighGain,
    originalLowpass,
    bassPreserveGain,
    output
  };
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
    const bassMacro = context.createBiquadFilter();
    bassMacro.type = 'lowshelf'; bassMacro.frequency.value = 180;
    const midMacro = context.createBiquadFilter();
    midMacro.type = 'peaking'; midMacro.frequency.value = 1000; midMacro.Q.value = 0.7;
    const trebleMacro = context.createBiquadFilter();
    trebleMacro.type = 'highshelf'; trebleMacro.frequency.value = 4500;
    const eqFilters = EQ_FREQUENCIES.map((frequency) => createEqFilter(context, frequency));
    const dialogueMudCut = createDialogueFilter(context, 280, 0.9);
    const dialoguePresence = createDialogueFilter(context, 2600, 0.85);
    const preampGain = context.createGain();
    const nightCompressor = createCompressor(context, NIGHT_DYNAMICS.off);
    const masterGain = context.createGain();
    const peakLimiter = createCompressor(context, LIMITER_ACTIVE);

    source.connect(bassMacro); bassMacro.connect(midMacro); midMacro.connect(trebleMacro);
    let previous = trebleMacro;
    for (const filter of eqFilters) { previous.connect(filter); previous = filter; }
    previous.connect(dialogueMudCut);
    dialogueMudCut.connect(dialoguePresence);
    const vocalReducer = createVocalReducer(context, dialoguePresence);
    vocalReducer.output.connect(preampGain);
    preampGain.connect(nightCompressor);
    nightCompressor.connect(masterGain);
    masterGain.connect(peakLimiter);
    peakLimiter.connect(context.destination);

    const processor = { tabId, context, stream, source, bassMacro, midMacro, trebleMacro, eqFilters, dialogueMudCut, dialoguePresence, vocalReducer, preampGain, nightCompressor, masterGain, peakLimiter, settings: sanitizeSettings(DEFAULT_SETTINGS) };
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
          audioTracks: processor.stream.getAudioTracks().length
        });
        return;
      }
      default: sendResponse({ ok: false, error: `Unknown offscreen message type: ${message.type}` });
    }
  })().catch((error) => { console.error('[Audio+] offscreen error', error); sendResponse({ ok: false, error: error?.message ?? String(error) }); });
  return true;
});
