import ndarray from 'ndarray';
import ndfft from 'ndarray-fft';
import { MDX_INST_HQ3 } from './mdx-profile.js';

const TWO_PI = Math.PI * 2;

export function periodicHann(size) {
  const window = new Float32Array(size);
  for (let i = 0; i < size; i += 1) window[i] = 0.5 - 0.5 * Math.cos(TWO_PI * i / size);
  return window;
}

export function reflectIndex(index, length) {
  if (length <= 1) return 0;
  let i = index;
  while (i < 0 || i >= length) {
    if (i < 0) i = -i;
    if (i >= length) i = 2 * length - 2 - i;
  }
  return i;
}

function fftTorchConvention(real, imag, inverse = false) {
  if (inverse) {
    for (let i = 0; i < imag.length; i += 1) imag[i] = -imag[i];
    ndfft(-1, ndarray(real, [real.length]), ndarray(imag, [imag.length]));
    return;
  }
  ndfft(1, ndarray(real, [real.length]), ndarray(imag, [imag.length]));
  for (let i = 0; i < imag.length; i += 1) imag[i] = -imag[i];
}

export function fftForwardForTest(samples) {
  const real = Float64Array.from(samples);
  const imag = new Float64Array(real.length);
  fftTorchConvention(real, imag, false);
  return { real, imag };
}

export function fftInverseForTest(realInput, imagInput) {
  const real = Float64Array.from(realInput);
  const imag = Float64Array.from(imagInput);
  fftTorchConvention(real, imag, true);
  return real;
}

function tensorIndex(channel, frequency, frame, profile) {
  return ((channel * profile.dimF + frequency) * profile.dimT) + frame;
}

export function stereoStft(left, right, profile = MDX_INST_HQ3) {
  if (left.length !== profile.chunkSize || right.length !== profile.chunkSize) {
    throw new Error(`MDX chunk must contain exactly ${profile.chunkSize} samples per channel.`);
  }

  const output = new Float32Array(4 * profile.dimF * profile.dimT);
  const window = periodicHann(profile.nFft);
  const pad = profile.nFft >> 1;
  const frameReal = new Float32Array(profile.nFft);
  const frameImag = new Float32Array(profile.nFft);
  const channels = [left, right];

  for (let channel = 0; channel < 2; channel += 1) {
    const source = channels[channel];
    for (let frame = 0; frame < profile.dimT; frame += 1) {
      const frameStart = frame * profile.hopLength - pad;
      frameImag.fill(0);
      for (let i = 0; i < profile.nFft; i += 1) {
        frameReal[i] = source[reflectIndex(frameStart + i, source.length)] * window[i];
      }
      fftTorchConvention(frameReal, frameImag, false);
      const realChannel = channel * 2;
      const imagChannel = realChannel + 1;
      for (let frequency = 0; frequency < profile.dimF; frequency += 1) {
        output[tensorIndex(realChannel, frequency, frame, profile)] = frameReal[frequency];
        output[tensorIndex(imagChannel, frequency, frame, profile)] = frameImag[frequency];
      }
    }
  }
  return output;
}

export function stereoIstft(spectrogram, profile = MDX_INST_HQ3) {
  const expected = 4 * profile.dimF * profile.dimT;
  if (!(spectrogram instanceof Float32Array) || spectrogram.length !== expected) {
    throw new Error(`MDX output must contain ${expected} float32 values.`);
  }

  const window = periodicHann(profile.nFft);
  const pad = profile.nFft >> 1;
  const paddedLength = profile.chunkSize + profile.nFft;
  const channels = [new Float32Array(paddedLength), new Float32Array(paddedLength)];
  const windowSum = new Float32Array(paddedLength);
  const frameReal = new Float32Array(profile.nFft);
  const frameImag = new Float32Array(profile.nFft);

  for (let frame = 0; frame < profile.dimT; frame += 1) {
    const start = frame * profile.hopLength;
    for (let i = 0; i < profile.nFft; i += 1) windowSum[start + i] += window[i] * window[i];

    for (let channel = 0; channel < 2; channel += 1) {
      frameReal.fill(0);
      frameImag.fill(0);
      const realChannel = channel * 2;
      const imagChannel = realChannel + 1;
      for (let frequency = 0; frequency < profile.dimF; frequency += 1) {
        frameReal[frequency] = spectrogram[tensorIndex(realChannel, frequency, frame, profile)];
        frameImag[frequency] = spectrogram[tensorIndex(imagChannel, frequency, frame, profile)];
      }
      // dim_f=3072 intentionally excludes the Nyquist bin (3072); restore the negative-frequency half.
      for (let frequency = 1; frequency < profile.dimF; frequency += 1) {
        const mirror = profile.nFft - frequency;
        frameReal[mirror] = frameReal[frequency];
        frameImag[mirror] = -frameImag[frequency];
      }
      fftTorchConvention(frameReal, frameImag, true);
      const target = channels[channel];
      for (let i = 0; i < profile.nFft; i += 1) target[start + i] += frameReal[i] * window[i];
    }
  }

  const left = new Float32Array(profile.chunkSize);
  const right = new Float32Array(profile.chunkSize);
  for (let i = 0; i < profile.chunkSize; i += 1) {
    const paddedIndex = i + pad;
    const norm = Math.max(windowSum[paddedIndex], 1e-8);
    left[i] = channels[0][paddedIndex] / norm;
    right[i] = channels[1][paddedIndex] / norm;
  }
  return { left, right };
}

function copyChunk(source, start, size) {
  const chunk = new Float32Array(size);
  const count = Math.max(0, Math.min(size, source.length - start));
  if (count > 0) chunk.set(source.subarray(start, start + count));
  return chunk;
}

export async function separateStereoMdx({ left, right, runModel, onProgress, profile = MDX_INST_HQ3 }) {
  if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || left.length !== right.length) {
    throw new Error('Separation expects equally sized stereo Float32Array channels.');
  }
  if (typeof runModel !== 'function') throw new Error('runModel callback is required.');

  const length = left.length;
  const overlap = Math.max(profile.hopLength, Math.round(profile.chunkSize * profile.overlapRatio));
  const stride = profile.chunkSize - overlap;
  const starts = [];
  for (let start = 0; start < length; start += stride) starts.push(start);

  const instLeft = new Float32Array(length);
  const instRight = new Float32Array(length);
  const weightSum = new Float32Array(length);

  for (let chunkIndex = 0; chunkIndex < starts.length; chunkIndex += 1) {
    const start = starts[chunkIndex];
    const mixLeft = copyChunk(left, start, profile.chunkSize);
    const mixRight = copyChunk(right, start, profile.chunkSize);
    const input = stereoStft(mixLeft, mixRight, profile);
    const predicted = await runModel(input, profile.inputShape);
    const instrumental = stereoIstft(predicted, profile);
    const valid = Math.min(profile.chunkSize, length - start);

    for (let i = 0; i < valid; i += 1) {
      let weight = 1;
      if (start > 0 && i < overlap) weight = Math.min(weight, i / overlap);
      if (start + profile.chunkSize < length && i >= profile.chunkSize - overlap) {
        weight = Math.min(weight, (profile.chunkSize - i) / overlap);
      }
      const target = start + i;
      instLeft[target] += instrumental.left[i] * profile.compensation * weight;
      instRight[target] += instrumental.right[i] * profile.compensation * weight;
      weightSum[target] += weight;
    }
    onProgress?.({ completed: chunkIndex + 1, total: starts.length, start, length });
  }

  const vocalsLeft = new Float32Array(length);
  const vocalsRight = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const norm = Math.max(weightSum[i], 1e-8);
    instLeft[i] /= norm;
    instRight[i] /= norm;
    vocalsLeft[i] = left[i] - instLeft[i];
    vocalsRight[i] = right[i] - instRight[i];
  }

  return {
    instrumental: { left: instLeft, right: instRight },
    vocals: { left: vocalsLeft, right: vocalsRight }
  };
}

export function encodeStereoWav(left, right, sampleRate = MDX_INST_HQ3.sampleRate) {
  if (left.length !== right.length) throw new Error('WAV channels must have equal length.');
  const frames = left.length;
  const bytesPerSample = 2;
  const dataBytes = frames * 2 * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeText = (offset, value) => { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)); };
  writeText(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); writeText(8, 'WAVE'); writeText(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true); writeText(36, 'data'); view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let i = 0; i < frames; i += 1) {
    for (const sample of [left[i], right[i]]) {
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, Math.round(clamped < 0 ? clamped * 32768 : clamped * 32767), true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
