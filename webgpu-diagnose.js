/** Diagnose WebGPU in the current browsing context (page, offscreen, or worker). */

export function webGpuUnsupportedAction() {
  const linux = /\bLinux\b/i.test(globalThis.navigator?.userAgent ?? '');
  return (
    '1) chrome://settings/system → turn ON “Use graphics acceleration when available”. ' +
    '2) chrome://flags/#enable-unsafe-webgpu → Enabled. ' +
    '3) chrome://flags/#ignore-gpu-blocklist → Enabled. ' +
    (linux ? '4) chrome://flags/#enable-vulkan → Enabled. ' : '') +
    'Then fully quit Chrome (all windows) and reopen. Check chrome://gpu for “WebGPU”. ' +
    'Or use Fast Karaoke. Open AI lab to test WebGPU on this PC.'
  );
}

export async function diagnoseWebGpu() {
  const gpu = globalThis.navigator?.gpu;
  if (!gpu?.requestAdapter) {
    return {
      ok: false,
      adapter: null,
      reason: 'WebGPU is not exposed by this browser/device (navigator.gpu missing).',
      action: webGpuUnsupportedAction()
    };
  }

  try {
    // Do not pass powerPreference: Chrome on Windows ignores it and logs a noisy warning
    // (crbug.com/369219127). Default adapter selection is what live AI gets anyway.
    const adapter = (await gpu.requestAdapter()) ?? null;
    if (!adapter) {
      return {
        ok: false,
        adapter: null,
        reason: 'No WebGPU adapter (null). Often hardware acceleration is off or the GPU is blocklisted.',
        action: webGpuUnsupportedAction()
      };
    }
    return { ok: true, adapter, reason: null, action: null };
  } catch (error) {
    return {
      ok: false,
      adapter: null,
      reason: error?.message ?? String(error),
      action: webGpuUnsupportedAction()
    };
  }
}
