const baseStreams = new Map();
const pendingByStreamId = new Map();

const mediaDevices = navigator.mediaDevices;
const nativeGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);

function streamIdFromConstraints(constraints) {
  return constraints?.audio?.mandatory?.chromeMediaSourceId ?? null;
}

function rememberBaseStream(tabId, stream) {
  const numericTabId = Number(tabId);
  if (!Number.isInteger(numericTabId) || !stream) return;
  baseStreams.set(numericTabId, stream);

  for (const track of stream.getTracks()) {
    track.addEventListener('ended', () => {
      if (baseStreams.get(numericTabId) === stream) baseStreams.delete(numericTabId);
    }, { once: true });
  }
}

mediaDevices.getUserMedia = async function audioPlusGetUserMedia(constraints) {
  const stream = await nativeGetUserMedia(constraints);
  const streamId = streamIdFromConstraints(constraints);
  const tabId = streamId ? pendingByStreamId.get(streamId) : null;
  if (Number.isInteger(tabId)) {
    pendingByStreamId.delete(streamId);
    rememberBaseStream(tabId, stream);
  }
  return stream;
};

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.target !== 'offscreen') return;

  if (message.type === 'START_CAPTURE' && Number.isInteger(Number(message.tabId)) && message.streamId) {
    pendingByStreamId.set(message.streamId, Number(message.tabId));
    return;
  }

  if (message.type === 'STOP_CAPTURE' && Number.isInteger(Number(message.tabId))) {
    baseStreams.delete(Number(message.tabId));
  }
});

globalThis.audioPlusCaptureBridge = Object.freeze({
  cloneBaseStream(tabId) {
    const numericTabId = Number(tabId);
    const stream = baseStreams.get(numericTabId);
    if (!stream) throw new Error('Audio+ base capture is not active for this tab. Enable Audio+ first.');
    if (!stream.getAudioTracks().some((track) => track.readyState === 'live')) {
      baseStreams.delete(numericTabId);
      throw new Error('Audio+ base capture ended. Re-enable Audio+ and try AI Karaoke again.');
    }
    const clone = stream.clone();
    if (clone.getAudioTracks().length === 0) {
      for (const track of clone.getTracks()) track.stop();
      throw new Error('Audio+ could not clone the active tab audio stream.');
    }
    return clone;
  },
  hasActiveBaseStream(tabId) {
    const stream = baseStreams.get(Number(tabId));
    return Boolean(stream?.getAudioTracks().some((track) => track.readyState === 'live'));
  }
});
