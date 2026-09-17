export const MDX_INST_HQ3 = Object.freeze({
  id: 'uvr-mdx-net-inst-hq-3',
  displayName: 'UVR-MDX-NET-Inst_HQ_3',
  fileName: 'UVR-MDX-NET-Inst_HQ_3.onnx',
  sha256: '317554b07fe1ea5279a77f2b1520a41ea4b93432560c4ffd08792c30fddf9adc',
  // Exact packaged weight size used to reject truncated / cache-poisoned reads.
  expectedByteLength: 66759214,
  primaryStem: 'Instrumental',
  secondaryStem: 'Vocals',
  sampleRate: 44100,
  nFft: 6144,
  hopLength: 1024,
  dimF: 3072,
  dimT: 256,
  channels: 2,
  modelChannels: 4,
  compensate: 1.022,
  zeroLowBins: 3,
  outerOverlapSamples: 6144,
  expectedInputShape: Object.freeze([1, 4, 3072, 256]),
  expectedOutputShape: Object.freeze([1, 4, 3072, 256])
});

export function mdxChunkSize(profile = MDX_INST_HQ3) {
  return profile.hopLength * (profile.dimT - 1);
}

export function mdxTrim(profile = MDX_INST_HQ3) {
  return Math.floor(profile.nFft / 2);
}

export function mdxGenerationSize(profile = MDX_INST_HQ3) {
  return mdxChunkSize(profile) - 2 * mdxTrim(profile);
}

/** True when ONNX reports a dynamic/symbolic batch (or fixed batch matching expected). */
export function mdxDimMatches(actual, expected) {
  if (actual === expected) return true;
  if (typeof actual === 'bigint' && Number(actual) === expected) return true;
  // UVR MDX exports batch as a symbolic dim ("batch_size"); ORT may also use -1/0.
  if (expected === 1 && (typeof actual === 'string' || actual === -1 || actual === 0)) return true;
  return false;
}

export function mdxShapeMatches(actual, expected) {
  const shape = [...(actual ?? [])];
  return shape.length === expected.length && shape.every((value, index) => mdxDimMatches(value, expected[index]));
}

export function validateMdxMetadata(session, profile = MDX_INST_HQ3) {
  if (!session || session.inputMetadata?.length !== 1 || session.outputMetadata?.length !== 1) {
    throw new Error('Expected exactly one MDX tensor input and one tensor output.');
  }

  const input = session.inputMetadata[0];
  const output = session.outputMetadata[0];
  const describe = (meta) => `${meta?.type ?? 'unknown'} [${[...(meta?.shape ?? [])].join(', ')}]`;

  if (!input?.isTensor || input.type !== 'float32' || !mdxShapeMatches(input.shape, profile.expectedInputShape)) {
    throw new Error(
      `Unexpected model input ${describe(input)}. Expected float32 [${profile.expectedInputShape.join(', ')}] ` +
      `(batch may be symbolic).`
    );
  }
  if (!output?.isTensor || output.type !== 'float32' || !mdxShapeMatches(output.shape, profile.expectedOutputShape)) {
    throw new Error(
      `Unexpected model output ${describe(output)}. Expected float32 [${profile.expectedOutputShape.join(', ')}] ` +
      `(batch may be symbolic).`
    );
  }

  return { inputName: session.inputNames[0], outputName: session.outputNames[0] };
}
