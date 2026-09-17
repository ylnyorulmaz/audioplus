import * as ort from 'onnxruntime-web/webgpu';
import { MDX_INST_HQ3, mdxChunkSize, mdxGenerationSize, mdxTrim } from './mdx-profile.js';
import { MdxStft } from './mdx-stft.js';

function symmetricHann(size) {
  const window = new Float32Array(size);
  if (size <= 1) {
    if (size === 1) window[0] = 1;
    return window;
  }
  for (let n = 0; n < size; n += 1) window[n] = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / (size - 1));
  return window;
}

function paddedMix(channel, profile) {
  const trim = mdxTrim(profile);
  const genSize = mdxGenerationSize(profile);
  const remainder = channel.length % genSize;
  const pad = genSize + trim - remainder;
  const output = new Float32Array(trim + channel.length + pad);
  output.set(channel, trim);
  return output;
}

function cropOriginalLength(channel, originalLength, profile) {
  const trim = mdxTrim(profile);
  return channel.slice(trim, trim + originalLength);
}

export async function separateMdxStereo({
  session,
  inputName,
  outputName,
  left,
  right,
  profile = MDX_INST_HQ3,
  onProgress = () => {},
  signal
}) {
  if (!session) throw new Error('MDX WebGPU session is not loaded.');
  if (left.length !== right.length) throw new Error('Stereo input channel lengths must match.');
  if (left.length === 0) throw new Error('Audio input is empty.');

  const chunkSize = mdxChunkSize(profile);
  const step = mdxGenerationSize(profile);
  const paddedLeft = paddedMix(left, profile);
  const paddedRight = paddedMix(right, profile);
  const resultLeft = new Float32Array(paddedLeft.length);
  const resultRight = new Float32Array(paddedRight.length);
  const divider = new Float32Array(paddedLeft.length);
  const stft = new MdxStft(profile);
  const starts = [];
  for (let start = 0; start < paddedLeft.length; start += step) starts.push(start);

  for (let index = 0; index < starts.length; index += 1) {
    if (signal?.aborted) throw new DOMException('Separation cancelled.', 'AbortError');
    const start = starts[index];
    const end = Math.min(start + chunkSize, paddedLeft.length);
    const actualSize = end - start;
    const chunkLeft = new Float32Array(chunkSize);
    const chunkRight = new Float32Array(chunkSize);
    chunkLeft.set(paddedLeft.subarray(start, end));
    chunkRight.set(paddedRight.subarray(start, end));

    onProgress({ stage: 'stft', index, total: starts.length, fraction: index / starts.length });
    const features = stft.forwardStereo(chunkLeft, chunkRight);
    const tensor = new ort.Tensor('float32', features, profile.expectedInputShape);

    let outputs;
    try {
      onProgress({ stage: 'inference', index, total: starts.length, fraction: index / starts.length });
      outputs = await session.run({ [inputName]: tensor });
      const outputTensor = outputs[outputName] ?? Object.values(outputs)[0];
      if (!outputTensor?.data) throw new Error('MDX model did not return a tensor output.');

      onProgress({ stage: 'istft', index, total: starts.length, fraction: index / starts.length });
      const instrumental = stft.inverseStereo(outputTensor.data);
      const window = symmetricHann(actualSize);
      for (let i = 0; i < actualSize; i += 1) {
        const weight = window[i];
        const destination = start + i;
        resultLeft[destination] += instrumental.left[i] * profile.compensate * weight;
        resultRight[destination] += instrumental.right[i] * profile.compensate * weight;
        divider[destination] += weight;
      }
    } finally {
      tensor.dispose();
      for (const output of Object.values(outputs ?? {})) {
        if (output && typeof output.dispose === 'function') output.dispose();
      }
    }

    onProgress({ stage: 'chunk-complete', index: index + 1, total: starts.length, fraction: (index + 1) / starts.length });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  for (let i = 0; i < divider.length; i += 1) {
    if (divider[i] > 1e-8) {
      resultLeft[i] /= divider[i];
      resultRight[i] /= divider[i];
    }
  }

  const instrumentalLeft = cropOriginalLength(resultLeft, left.length, profile);
  const instrumentalRight = cropOriginalLength(resultRight, right.length, profile);
  const vocalsLeft = new Float32Array(left.length);
  const vocalsRight = new Float32Array(right.length);
  for (let i = 0; i < left.length; i += 1) {
    vocalsLeft[i] = left[i] - instrumentalLeft[i];
    vocalsRight[i] = right[i] - instrumentalRight[i];
  }

  return {
    instrumental: { left: instrumentalLeft, right: instrumentalRight },
    vocals: { left: vocalsLeft, right: vocalsRight },
    chunks: starts.length
  };
}
