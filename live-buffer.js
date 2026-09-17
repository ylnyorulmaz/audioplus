export class BoundedStereoRing {
  constructor(maxSamples) {
    if (!Number.isInteger(maxSamples) || maxSamples <= 0) throw new Error('maxSamples must be a positive integer.');
    this.maxSamples = maxSamples;
    this.left = new Float32Array(maxSamples);
    this.right = new Float32Array(maxSamples);
    this.head = 0;
    this.length = 0;
  }

  get available() { return this.length; }
  get free() { return this.maxSamples - this.length; }

  clear() {
    this.head = 0;
    this.length = 0;
  }

  push(left, right) {
    if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || left.length !== right.length) {
      throw new Error('Stereo chunks must be matching Float32Array channels.');
    }
    if (left.length > this.free) return false;

    let tail = (this.head + this.length) % this.maxSamples;
    for (let i = 0; i < left.length; i += 1) {
      this.left[tail] = left[i];
      this.right[tail] = right[i];
      tail = (tail + 1) % this.maxSamples;
    }
    this.length += left.length;
    return true;
  }

  peek(count) {
    if (!Number.isInteger(count) || count < 0 || count > this.length) throw new Error('Requested samples are not available.');
    const left = new Float32Array(count);
    const right = new Float32Array(count);
    let index = this.head;
    for (let i = 0; i < count; i += 1) {
      left[i] = this.left[index];
      right[i] = this.right[index];
      index = (index + 1) % this.maxSamples;
    }
    return { left, right };
  }

  discard(count) {
    if (!Number.isInteger(count) || count < 0 || count > this.length) throw new Error('Cannot discard unavailable samples.');
    this.head = (this.head + count) % this.maxSamples;
    this.length -= count;
  }
}

export function liveRtfDecision(rtf) {
  if (!Number.isFinite(rtf) || rtf <= 0) return { mode: 'fallback', level: 'invalid' };
  if (rtf < 0.65) return { mode: 'live', level: 'good' };
  if (rtf < 0.98) return { mode: 'live', level: 'warning' };
  return { mode: 'fallback', level: 'slow' };
}
