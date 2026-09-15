const processors = new Map();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

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
    processor.bassFilter.disconnect();
    processor.masterGain.disconnect();
  } catch {
    // Nodes may already be disconnected during teardown.
  }

  if (processor.context.state !== 'closed') {
    await processor.context.close();
  }

  if (notify) await notifyStatus(tabId, false);
}

function applySettings(processor, settings) {
  processor.settings = {
    ...processor.settings,
    ...settings
  };

  const bypass = Boolean(processor.settings.bypass);
  const bassDb = clamp(processor.settings.bassDb ?? 0, -12, 12);
  const volume = clamp(processor.settings.volume ?? 100, 0, 150);

  smoothParam(
    processor.bassFilter.gain,
    bypass ? 0 : bassDb,
    processor.context
  );

  smoothParam(
    processor.masterGain.gain,
    bypass ? 1 : volume / 100,
    processor.context
  );
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
    const bassFilter = context.createBiquadFilter();
    const masterGain = context.createGain();

    bassFilter.type = 'lowshelf';
    bassFilter.frequency.value = 120;
    bassFilter.gain.value = 0;
    masterGain.gain.value = 1;

    source.connect(bassFilter);
    bassFilter.connect(masterGain);
    masterGain.connect(context.destination);

    const processor = {
      tabId,
      context,
      stream,
      source,
      bassFilter,
      masterGain,
      settings: {
        bassDb: 0,
        volume: 100,
        bypass: false
      }
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

      case 'SET_BASS': {
        const processor = processors.get(message.tabId);
        if (!processor) throw new Error('No active processor for this tab.');
        applySettings(processor, { bassDb: message.value });
        sendResponse({ ok: true });
        return;
      }

      case 'SET_VOLUME': {
        const processor = processors.get(message.tabId);
        if (!processor) throw new Error('No active processor for this tab.');
        applySettings(processor, { volume: message.value });
        sendResponse({ ok: true });
        return;
      }

      case 'SET_BYPASS': {
        const processor = processors.get(message.tabId);
        if (!processor) throw new Error('No active processor for this tab.');
        applySettings(processor, { bypass: message.value });
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
