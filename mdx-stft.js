import FFT from 'fft.js';
import { MDX_INST_HQ3, mdxChunkSize, mdxTrim } from './mdx-profile.js';

const RADIX = 3;

export class MixedRadix6144FFT {
  constructor(size = 6144) {
    if (size % RADIX !== 0 || (size / RADIX & (size / RADIX - 1)) !== 0) {
      throw new Error('MixedRadix6144FFT expects 3 × power-of-two FFT size.');
    }
    this.size = size;
    this.innerSize = size / RADIX;
    this.inner = new FFT(this.innerSize);
    this.inputs = Array.from({ length: RADIX }, () => this.inner.createComplexArray());
    this.outputs = Array.from({ length: RADIX }, () => this.inner.createComplexArray());
    this.combined = new Float64Array(size * 2);
    this.inverseInput = new Float64Array(size * 2);
  }

  forwardReal(data) {
    if (data.length !== this.size) throw new Error(`FFT input must contain ${this.size} samples.`);
    for (let radix = 0; radix < RADIX; radix += 1) {
      const input = this.inputs[radix];
      for (let m = 0; m < this.innerSize; m += 1) {
        input[2 * m] = data[RADIX * m + radix];
        input[2 * m + 1] = 0;
      }
      this.inner.transform(this.outputs[radix], input);
    }
    return this.#combine(false);
  }

  forwardComplex(data) {
    if (data.length !== this.size * 2) throw new Error(`Complex FFT input must contain ${this.size * 2} values.`);
    for (let radix = 0; radix < RADIX; radix += 1) {
      const input = this.inputs[radix];
      for (let m = 0; m < this.innerSize; m += 1) {
        const source = 2 * (RADIX * m + radix);
        input[2 * m] = data[source];
        input[2 * m + 1] = data[source + 1];
      }
      this.inner.transform(this.outputs[radix], input);
    }
    return this.#combine(false);
  }

  inverseComplex(data) {
    if (data.length !== this.size * 2) throw new Error(`Complex inverse FFT input must contain ${this.size * 2} values.`);
    for (let i = 0; i < this.size; i += 1) {
      this.inverseInput[2 * i] = data[2 * i];
      this.inverseInput[2 * i + 1] = -data[2 * i + 1];
    }
    const transformed = this.forwardComplex(this.inverseInput);
    for (let i = 0; i < this.size; i += 1) {
      transformed[2 * i] /= this.size;
      transformed[2 * i + 1] = -transformed[2 * i + 1] / this.size;
    }
    return transformed;
  }

  #combine() {
    const n = this.size;
    const mSize = this.innerSize;
    for (let k = 0; k < n; k += 1) {
      const m = k % mSize;
      let real = this.outputs[0][2 * m];
      let imag = this.outputs[0][2 * m + 1];
      for (let radix = 1; radix < RADIX; radix += 1) {
        const angle = -2 * Math.PI * radix * k / n;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const yr = this.outputs[radix][2 * m];
        const yi = this.outputs[radix][2 * m + 1];
        real += yr * cos - yi * sin;
        imag += yr * sin + yi * cos;
      }
      this.combined[2 * k] = real;
      this.combined[2 * k + 1] = imag;
    }
    return this.combined;
  }
}

function periodicHann(size) {
  const window = new Float64Array(size);
  for (let n = 0; n < size; n += 1) window[n] = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / size);
  return window;
}

function reflectedSample(samples, index) {
  const length = samples.length;
  if (index >= 0 && index < length) return samples[index];
  let current = index;
  while (current < 0 || current >= length) {
    if (current < 0) current = -current;
    if (current >= length) current = 2 * length - current - 2;
  }
  return samples[current];
}

function modelIndex(channel, frequency, time, profile) {
  return ((channel * profile.dimF + frequency) * profile.dimT) + time;
}

export class MdxStft {
  constructor(profile = MDX_INST_HQ3) {
    this.profile = profile;
    this.fft = new MixedRadix6144FFT(profile.nFft);
    this.window = periodicHann(profile.nFft);
    this.frame = new Float64Array(profile.nFft);
    this.complexFrame = new Float64Array(profile.nFft * 2);
  }

  forwardStereo(left, right) {
    const { profile } = this;
    const chunkSize = mdxChunkSize(profile);
    if (left.length !== chunkSize || right.length !== chunkSize) {
      throw new Error(`MDX chunk must contain exactly ${chunkSize} stereo samples.`);
    }

    const tensor = new Float32Array(profile.modelChannels * profile.dimF * profile.dimT);
    const channels = [left, right];
    const trim = mdxTrim(profile);

    for (let channel = 0; channel < profile.channels; channel += 1) {
      const samples = channels[channel];
      for (let time = 0; time < profile.dimT; time += 1) {
        const frameStart = time * profile.hopLength - trim;
        for (let n = 0; n < profile.nFft; n += 1) {
          this.frame[n] = reflectedSample(samples, frameStart + n) * this.window[n];
        }
        const spectrum = this.fft.forwardReal(this.frame);
        const realChannel = channel * 2;
        const imagChannel = realChannel + 1;
        for (let frequency = profile.zeroLowBins; frequency < profile.dimF; frequency += 1) {
          tensor[modelIndex(realChannel, frequency, time, profile)] = spectrum[2 * frequency];
          tensor[modelIndex(imagChannel, frequency, time, profile)] = spectrum[2 * frequency + 1];
        }
      }
    }
    return tensor;
  }

  inverseStereo(tensor) {
    const { profile } = this;
    const expected = profile.modelChannels * profile.dimF * profile.dimT;
    if (tensor.length !== expected) throw new Error(`MDX output must contain ${expected} floats.`);

    const chunkSize = mdxChunkSize(profile);
    const trim = mdxTrim(profile);
    const paddedLength = chunkSize + 2 * trim;
    const outputs = [new Float32Array(paddedLength), new Float32Array(paddedLength)];
    const envelopes = [new Float64Array(paddedLength), new Float64Array(paddedLength)];

    for (let channel = 0; channel < profile.channels; channel += 1) {
      const realChannel = channel * 2;
      const imagChannel = realChannel + 1;
      const output = outputs[channel];
      const envelope = envelopes[channel];

      for (let time = 0; time < profile.dimT; time += 1) {
        this.complexFrame.fill(0);
        for (let frequency = 0; frequency < profile.dimF; frequency += 1) {
          const real = tensor[modelIndex(realChannel, frequency, time, profile)];
          const imag = tensor[modelIndex(imagChannel, frequency, time, profile)];
          this.complexFrame[2 * frequency] = real;
          this.complexFrame[2 * frequency + 1] = imag;
          if (frequency > 0) {
            const mirror = profile.nFft - frequency;
            this.complexFrame[2 * mirror] = real;
            this.complexFrame[2 * mirror + 1] = -imag;
          }
        }

        const frame = this.fft.inverseComplex(this.complexFrame);
        const frameStart = time * profile.hopLength;
        for (let n = 0; n < profile.nFft; n += 1) {
          const position = frameStart + n;
          if (position >= paddedLength) break;
          const window = this.window[n];
          output[position] += frame[2 * n] * window;
          envelope[position] += window * window;
        }
      }

      for (let i = 0; i < paddedLength; i += 1) {
        if (envelope[i] > 1e-10) output[i] /= envelope[i];
      }
    }

    return {
      left: outputs[0].slice(trim, trim + chunkSize),
      right: outputs[1].slice(trim, trim + chunkSize)
    };
  }
}
