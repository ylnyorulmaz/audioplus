class AudioPlusCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.blockSize = 4096;
    this.left = new Float32Array(this.blockSize);
    this.right = new Float32Array(this.blockSize);
    this.offset = 0;
  }

  flush() {
    if (this.offset === 0) return;
    const left = this.left.slice(0, this.offset);
    const right = this.right.slice(0, this.offset);
    this.port.postMessage({ left, right }, [left.buffer, right.buffer]);
    this.left = new Float32Array(this.blockSize);
    this.right = new Float32Array(this.blockSize);
    this.offset = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    for (const channel of output) channel.fill(0);

    const leftInput = input[0];
    const rightInput = input[1] ?? input[0];
    if (!leftInput || !rightInput) return true;

    for (let i = 0; i < leftInput.length; i += 1) {
      this.left[this.offset] = leftInput[i];
      this.right[this.offset] = rightInput[i];
      this.offset += 1;
      if (this.offset === this.blockSize) this.flush();
    }
    return true;
  }
}

registerProcessor('audio-plus-capture', AudioPlusCaptureProcessor);
