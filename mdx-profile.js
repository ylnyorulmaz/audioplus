export const MDX_INST_HQ3 = Object.freeze({
  id: 'uvr-mdx-net-inst-hq-3',
  displayName: 'UVR-MDX-NET-Inst_HQ_3',
  fileName: 'UVR-MDX-NET-Inst_HQ_3.onnx',
  sha256: '317554b07fe1ea5279a77f2b1520a41ea4b93432560c4ffd08792c30fddf9adc',
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

export function validateMdxMetadata(session, profile = MDX_INST_HQ3) {
  if (!session || session.inputMetadata?.length !== 1 || session.outputMetadata?.length !== 1) {
    throw new Error('Expected exactly one MDX tensor input and one tensor output.');
  }

  const input = session.inputMetadata[0];
  const output = session.outputMetadata[0];
  const sameShape = (actual, expected) => actual.length === expected.length && actual.every((value, index) => value === expected[index]);

  if (!input?.isTensor || input.type !== 'float32' || !sameShape([...input.shape], profile.expectedInputShape)) {
    throw new Error(`Unexpected model input. Expected float32 [${profile.expectedInputShape.join(', ')}].`);
  }
  if (!output?.isTensor || output.type !== 'float32' || !sameShape([...output.shape], profile.expectedOutputShape)) {
    throw new Error(`Unexpected model output. Expected float32 [${profile.expectedOutputShape.join(', ')}].`);
  }

  return { inputName: session.inputNames[0], outputName: session.outputNames[0] };
}
