export const MDX_INST_HQ3 = Object.freeze({
  id: 'uvr-mdx-net-inst-hq-3',
  filename: 'UVR-MDX-NET-Inst_HQ_3.onnx',
  sampleRate: 44100,
  nFft: 6144,
  hopLength: 1024,
  dimF: 3072,
  dimT: 256,
  chunkSize: 1024 * (256 - 1),
  overlapRatio: 0.10,
  compensation: 1.022,
  primaryStem: 'instrumental',
  inputShape: Object.freeze([1, 4, 3072, 256]),
  outputShape: Object.freeze([1, 4, 3072, 256]),
  sha256: '317554b07fe1ea5279a77f2b1520a41ea4b93432560c4ffd08792c30fddf9adc',
  license: 'MIT',
  upstream: 'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-MDX-NET-Inst_HQ_3.onnx'
});

export function shapeMatches(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => Number(value) === expected[index]);
}

export function validateInstHq3Session(session) {
  if (!session) throw new Error('No ONNX session loaded.');
  if (session.inputMetadata.length !== 1 || session.outputMetadata.length !== 1) {
    throw new Error('Inst HQ 3 must expose exactly one input and one output tensor.');
  }
  const input = session.inputMetadata[0];
  const output = session.outputMetadata[0];
  if (!input?.isTensor || input.type !== 'float32' || !shapeMatches([...input.shape], MDX_INST_HQ3.inputShape)) {
    throw new Error(`Unexpected model input. Expected float32 ${MDX_INST_HQ3.inputShape.join(' × ')}.`);
  }
  if (!output?.isTensor || output.type !== 'float32' || !shapeMatches([...output.shape], MDX_INST_HQ3.outputShape)) {
    throw new Error(`Unexpected model output. Expected float32 ${MDX_INST_HQ3.outputShape.join(' × ')}.`);
  }
  return true;
}
