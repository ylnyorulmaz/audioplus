import {
  EQ_FREQUENCIES,
  DEFAULT_SETTINGS,
  sanitizeSettings,
  effectivePreampDb,
  dbToGain
} from './audio-settings.js';

const processors = new Map();

function smoothParam(param, value, context, timeConstant = 0.015) {
  const now = context.currentTime;
  param.cancelScheduledValues(now);
  param.setTargetAtTime(value, now, timeConstant);
}

async function notifyStatus(tabId, enabled, error = null) {
  try {
    await chrome.runtime.sendMessage({
      type: 'OFFSCREEN_STATUS',
      tabId,
      enabled,
      error
    });
  } catch (messageError) {
    console.warn('[Audio+] could not sync processor status', messageError);
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
    processor.preampGain.disconnect();
    processor.masterGain.disconnect();
  } catch {
    // Nodes may already be disconnected during teardown.
  }

  if (processor.context.state !== 'closed') {
    await processor.context.close();
  }

  if (notify) await notifyStatus(tabId, false);
}

function applySettings(processor, incoming) {
  const settings = sanitizeSettings({ ...processor.settings, ...incoming });
  processor.settings = settings;

  const bypass = settings.bypass;

  smoothParam(processor.bassMacro.gain, bypass ? 0 : settings.bassDb, processor.context);
  smoothParam(processor.midMacro.gain, bypass ? 0 : settings.midDb, processor.context);
  smoothParam(processor.trebleMacro.gain, bypass ? 0 : settings.trebleDb, processor.context);

  processor.eqFilters.forEach((filter, index) => {
    smoothParam(filter.gain, bypass ? 0 : settings.eqBands[index], processor.context);
  });

  smoothParam(
    processor.preampGain.gain,
    bypass ? 1 : dbToGain(effectivePreampDb(settings)),
    processor.context
  );

  smoothParam(
    processor.masterGain.gain,
    bypass ? 1 : settings.volume / 100,
    processor.context
  );
}

function createEqFilter(context, frequency) {
  const filter = context.createBiquadFilter();
  filter.type = 'peaking';
  filter.frequency.value = frequency;
  filter.Q.value = 1.4;
  filter.gain.value = 0;
  return filter;
}

async function startProcessor(tabId, streamId, settings) {
  await stopProcessor(tabId, { notify: false });

  let context;
  let stream;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });

    context = new AudioContext({ latencyHint: 'interactive' });

    if (context.state === 'suspended') {
      await context.resume();
    }

    const source = context.createMediaStreamSource(stream);

    const bassMacro = context.createBiquadFilter();
    bassMacro.type = 'lowshelf';
    bassMacro.frequency.value = 180;
    bassMacro.gain.value = 0;

    const midMacro = context.createBiquadFilter();
    midMacro.type = 'peaking';
    midMacro.frequency.value = 1000;
    midMacro.Q.value = 0.7;
    midMacro.gain.value = 0;

    const trebleMacro = context.createBiquadFilter();
    trebleMacro.type = 'highshelf';
    trebleMacro.frequency.value = 4500;
    trebleMacro.gain.value = 0;

    const eqFilters = EQ_FREQUENCIES.map((frequency) => createEqFilter(context, frequency));
    const preampGain = context.createGain();
    const masterGain = context.createGain();

    source.connect(bassMacro);
    bassMacro.connect(midMacro);
    midMacro.connect(trebleMacro);

    let previous = trebleMacro;
    for (const filter of eqFilters) {
      previous.connect(filter);
      previous = filter;
    }

    previous.connect(preampGain);
    preampGain.connect(masterGain);
    masterGain.connect(context.destination);

    const processor = {
      tabId,
      context,
      stream,
      source,
      bassMacro,
      midMacro,
      trebleMacro,
      eqFilters,
      preampGain,
      masterGain,
      settings: sanitizeSettings(DEFAULT_SETTINGS)
    };

    processors.set(tabId, processor);
    applySettings(processor, settings ?? {});

    for (const track of stream.getTracks()) {
      track.onended = () => {
        if (processors.get(tabId) === processor) {
          stopProcessor(tabId).catch(console.error);
        }
      };
    }

    await notifyStatus(tabId, true);
    return { ok: true };
  } catch (error) {
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    if (context && context.state !== 'closed') {
      await context.close();
    }

    const message = error?.message ?? String(error);
    await notifyStatus(tabId, false, message);
    return { ok: false, error: message };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== 'offscreen') return;

  (async () => {
    switch (message.type) {
      case 'START_CAPTURE': {
        const result = await startProcessor(message.tabId, message.streamId, message.settings);
        sendResponse(result);
        return;
      }

      case 'STOP_CAPTURE': {
        await stopProcessor(message.tabId);
        sendResponse({ ok: true });
        return;
      }

      case 'APPLY_SETTINGS': {
        const processor = processors.get(message.tabId);
        if (!processor) throw new Error('No active processor for this tab.');
        applySettings(processor, message.settings ?? {});
        sendResponse({ ok: true });
        return;
      }

      default:
        sendResponse({ ok: false, error: `Unknown offscreen message type: ${message.type}` });
    }
  })().catch((error) => {
    console.error('[Audio+] offscreen error', error);
    sendResponse({ ok: false, error: error?.message ?? String(error) });
  });

  return true;
});
