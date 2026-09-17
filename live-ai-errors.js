export const LIVE_AI_ERROR_CODES = Object.freeze({
  BASE_NOT_ENABLED: 'BASE_NOT_ENABLED',
  BASE_CAPTURE_MISSING: 'BASE_CAPTURE_MISSING',
  BASE_CAPTURE_ENDED: 'BASE_CAPTURE_ENDED',
  RUNTIME_MISSING: 'RUNTIME_MISSING',
  MODEL_MISSING: 'MODEL_MISSING',
  MODEL_INVALID: 'MODEL_INVALID',
  WEBGPU_UNAVAILABLE: 'WEBGPU_UNAVAILABLE',
  CPU_TOO_SLOW: 'CPU_TOO_SLOW',
  WORKER_INIT_FAILED: 'WORKER_INIT_FAILED',
  WORKER_FAILED: 'WORKER_FAILED',
  STREAM_ENDED: 'STREAM_ENDED',
  BUFFER_LIMIT: 'BUFFER_LIMIT',
  UNDERRUN: 'UNDERRUN',
  RESTORE_FAILED: 'RESTORE_FAILED',
  UNKNOWN: 'UNKNOWN'
});

export function liveAiError(code, message, action = null, cause = null) {
  const error = new Error(message);
  error.name = 'AudioPlusLiveAiError';
  error.code = code;
  error.action = action;
  if (cause) error.cause = cause;
  return error;
}

export function normalizeLiveAiError(error) {
  const text = String(error?.message ?? error ?? 'Unknown AI Karaoke error.');
  const lower = text.toLowerCase();
  if (lower.includes("reading 'session'") || lower.includes('no available backend') || lower.includes('session factory')) {
    return { code: LIVE_AI_ERROR_CODES.WORKER_INIT_FAILED, message: 'The local AI engine could not create a session on this device.', action: 'Reload Audio+ in chrome://extensions. If this is an unpacked build, run npm install && npm run build first, then try again.' };
  }
  if (error?.name === 'AudioPlusLiveAiError' && error.code) {
    return { code: error.code, message: error.message, action: error.action ?? null };
  }
  if (error?.code === LIVE_AI_ERROR_CODES.WEBGPU_UNAVAILABLE || error?.code === 'WEBGPU_UNAVAILABLE') {
    return {
      code: LIVE_AI_ERROR_CODES.WEBGPU_UNAVAILABLE,
      message: error.message ?? 'WebGPU is required for AI Karaoke on this device.',
      action: error.action ?? null
    };
  }
  if (lower.includes('active stream') || lower.includes('capture')) {
    return { code: LIVE_AI_ERROR_CODES.BASE_CAPTURE_MISSING, message: 'Audio+ could not reuse the tab audio stream.', action: 'Turn Audio+ off and on once, then try AI Karaoke again.' };
  }
  if (lower.includes('rtf') || lower.includes('real-time budget') || lower.includes('cannot keep up') || lower.includes('exceeds the real-time')) {
    return {
      code: LIVE_AI_ERROR_CODES.CPU_TOO_SLOW,
      message: 'This computer cannot run AI Karaoke in real time safely.',
      action: 'Use Fast Karaoke instead. For AI Karaoke, turn on Chrome hardware acceleration (WebGPU) and try again.'
    };
  }
  if (lower.includes('fetching the script') || lower.includes('worker script could not load')) {
    return { code: LIVE_AI_ERROR_CODES.WORKER_INIT_FAILED, message: 'The local AI worker could not load.', action: 'Run npm run build, reload Audio+ in chrome://extensions, then try AI Karaoke again.' };
  }
  if (lower.includes('webgpu') || lower.includes('gpu adapter') || lower.includes('no compatible webgpu') || lower.includes('no available adapter') || lower.includes('webgpu required')) {
    return {
      code: LIVE_AI_ERROR_CODES.WEBGPU_UNAVAILABLE,
      message: 'WebGPU is required for AI Karaoke on this device.',
      action: error?.action ?? 'Turn on Chrome hardware acceleration, enable ignore-gpu-blocklist + unsafe-webgpu, fully restart Chrome, check chrome://gpu, or use Fast Karaoke.'
    };
  }
  if (lower.includes('worker is not initialized')) {
    return { code: LIVE_AI_ERROR_CODES.WORKER_INIT_FAILED, message: 'AI Karaoke started before the local model finished loading.', action: 'Turn AI Karaoke off, wait a few seconds, then try again. If it keeps failing, reload Audio+ in chrome://extensions.' };
  }
  if (lower.includes('sha-256') || lower.includes('integrity') || lower.includes('verification') || (lower.includes('expected') && lower.includes('bytes'))) {
    return { code: LIVE_AI_ERROR_CODES.MODEL_INVALID, message: text, action: 'Reload Audio+ in chrome://extensions (do not Range-download the model), keep UVR-MDX-NET-Inst_HQ_3.onnx in the folder, then try again.' };
  }
  if (lower.includes('.onnx') || lower.includes('packaged ai model') || lower.includes('model was not received') || lower.includes('not installed locally')) {
    return { code: LIVE_AI_ERROR_CODES.MODEL_MISSING, message: text, action: 'Keep UVR-MDX-NET-Inst_HQ_3.onnx in the Audio+ folder, reload the extension, then try again.' };
  }
  if (lower.includes('ring buffer') || lower.includes('hard limit')) {
    return { code: LIVE_AI_ERROR_CODES.BUFFER_LIMIT, message: 'AI Karaoke stopped before audio latency could grow too large.', action: 'Use Fast Karaoke on this device.' };
  }
  if (lower.includes('underrun')) {
    return { code: LIVE_AI_ERROR_CODES.UNDERRUN, message: 'AI Karaoke could not produce audio fast enough.', action: 'Use Fast Karaoke or close heavy apps and try again.' };
  }
  return { code: LIVE_AI_ERROR_CODES.UNKNOWN, message: text, action: 'Turn AI Karaoke off, keep normal Audio+ enabled, and try again.' };
}

export function liveAiStatusFromError(error) {
  const detail = normalizeLiveAiError(error);
  return {
    active: false,
    phase: 'error',
    quality: 'fallback',
    reason: detail.message,
    errorCode: detail.code,
    action: detail.action
  };
}
