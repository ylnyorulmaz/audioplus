/**
 * Stereo capture worklet for Live AI Karaoke.
 * Copies each render quantum to the main thread (buffers are reused by the audio thread).
 */
class LiveAiCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input?.length || !input[0]?.length) return true;

    const leftIn = input[0];
    const rightIn = input[1] && input[1].length === leftIn.length ? input[1] : leftIn;
    const left = new Float32Array(leftIn.length);
    const right = new Float32Array(leftIn.length);
    left.set(leftIn);
    right.set(rightIn);
    this.port.postMessage({ left, right }, [left.buffer, right.buffer]);
    return true;
  }
}

registerProcessor('live-ai-capture', LiveAiCaptureProcessor);
