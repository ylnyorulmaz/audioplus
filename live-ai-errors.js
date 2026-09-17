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
  if (error?.name === 'AudioPlusLiveAiError' && error.code) {
    return { code: error.code, message: error.message, action: error.action ?? null };
  }
  const text = String(error?.message ?? error ?? 'Unknown AI Karaoke error.');
  const lower = text.toLowerCase();
  if (lower.includes('active stream') || lower.includes('capture')) {
    return { code: LIVE_AI_ERROR_CODES.BASE_CAPTURE_MISSING, message: 'Audio+ could not reuse the tab audio stream.', action: 'Turn Audio+ off and on once, then try AI Karaoke again.' };
  }
  if (lower.includes('rtf') || lower.includes('real-time budget') || lower.includes('cannot keep up')) {
    return { code: LIVE_AI_ERROR_CODES.CPU_TOO_SLOW, message: 'This computer cannot run AI Karaoke in real time safely.', action: 'Use Fast Karaoke instead; it is designed for slower computers.' };
  }
  if (lower.includes('worker') && lower.includes('initial')) {
    return { code: LIVE_AI_ERROR_CODES.WORKER_INIT_FAILED, message: 'The local AI engine could not start.', action: 'Reload Audio+ and try again. If this is an unpacked build, run npm run build first.' };
  }
  if (lower.includes('model') && (lower.includes('hash') || lower.includes('invalid') || lower.includes('verify'))) {
    return { code: LIVE_AI_ERROR_CODES.MODEL_INVALID, message: 'The local AI model failed verification.', action: 'Remove/reinstall the local model and try again.' };
  }
  if (lower.includes('model')) {
    return { code: LIVE_AI_ERROR_CODES.MODEL_MISSING, message: 'The local AI model is not ready.', action: 'Keep the internet connection available for the first model install, then try again.' };
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
