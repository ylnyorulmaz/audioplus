import { MDX_INST_HQ3 } from './mdx-profile.js';

export const MAX_AUDIO_SECONDS = 10 * 60;

export async function decodeAudioFile(file, profile = MDX_INST_HQ3) {
  if (!file || file.size <= 0) throw new Error('Choose an audio file first.');
  const AudioContextCtor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContextCtor) throw new Error('Web Audio decoding is unavailable in this browser.');

  const context = new AudioContextCtor({ sampleRate: profile.sampleRate });
  try {
    const bytes = await file.arrayBuffer();
    const buffer = await context.decodeAudioData(bytes.slice(0));
    if (buffer.duration > MAX_AUDIO_SECONDS) {
      throw new Error(`Prototype limit is ${MAX_AUDIO_SECONDS / 60} minutes per audio file.`);
    }
    if (buffer.sampleRate !== profile.sampleRate) {
      throw new Error(`Decoded sample rate is ${buffer.sampleRate} Hz; expected ${profile.sampleRate} Hz.`);
    }

    const left = new Float32Array(buffer.getChannelData(0));
    const right = buffer.numberOfChannels > 1
      ? new Float32Array(buffer.getChannelData(1))
      : new Float32Array(left);

    return {
      left,
      right,
      sampleRate: buffer.sampleRate,
      duration: buffer.duration,
      originalChannels: buffer.numberOfChannels
    };
  } finally {
    await context.close();
  }
}

function clamp16(value) {
  const sample = Math.max(-1, Math.min(1, value));
  return sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
}

export function stereoWavBlob(left, right, sampleRate = MDX_INST_HQ3.sampleRate) {
  if (left.length !== right.length) throw new Error('WAV channels must have the same length.');
  const dataBytes = left.length * 4;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeText = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < left.length; i += 1) {
    view.setInt16(offset, clamp16(left[i]), true);
    view.setInt16(offset + 2, clamp16(right[i]), true);
    offset += 4;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export function stemFileName(originalName, stem) {
  const base = (originalName || 'audio').replace(/\.[^.]+$/, '');
  return `${base} - ${stem}.wav`;
}
