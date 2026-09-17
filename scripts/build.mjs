import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';

const distDir = 'dist';
const ortDir = 'vendor/ort';
const ortSourceDir = 'node_modules/onnxruntime-web/dist';
const modelDir = 'models';
const modelName = 'UVR-MDX-NET-Inst_HQ_3.onnx';
const modelPath = join(modelDir, modelName);
const modelSha256 = '317554b07fe1ea5279a77f2b1520a41ea4b93432560c4ffd08792c30fddf9adc';
const modelUrl = 'https://huggingface.co/masszhou/mdxnet/resolve/main/UVR-MDX-NET-Inst_HQ_3.onnx?download=true';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function ensureVerifiedModel() {
  await mkdir(modelDir, { recursive: true });
  try {
    const existing = await readFile(modelPath);
    if (sha256(existing) === modelSha256) {
      console.log(`Verified packaged model ${modelPath}.`);
      return;
    }
    console.warn('Existing HQ3 model hash is wrong; replacing it.');
  } catch {}

  console.log('Downloading verified UVR-MDX-NET-Inst_HQ_3 model for the extension package…');
  const response = await fetch(modelUrl, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Could not download HQ3 model: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== modelSha256) throw new Error(`HQ3 SHA-256 mismatch: expected ${modelSha256}, got ${actual}`);
  await writeFile(modelPath, bytes);
  console.log(`Downloaded and verified ${modelName} (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB).`);
}

await rm(distDir, { recursive: true, force: true });
await rm('vendor', { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await mkdir(ortDir, { recursive: true });

await ensureVerifiedModel();

await build({
  entryPoints: ['ai-karaoke-lab-entry.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome116'],
  outfile: join(distDir, 'ai-karaoke-lab.js'),
  sourcemap: false,
  minify: false,
  logLevel: 'info'
});

await build({
  entryPoints: ['live-ai-worker-entry.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome116'],
  outfile: join(distDir, 'live-ai-worker.js'),
  sourcemap: false,
  minify: false,
  logLevel: 'info'
});

const runtimeFiles = (await readdir(ortSourceDir)).filter((name) =>
  /^ort-wasm.*\.(?:wasm|mjs)$/.test(name)
);

if (runtimeFiles.length === 0) throw new Error('No ONNX Runtime Web WASM assets were found.');

for (const name of runtimeFiles) {
  await copyFile(join(ortSourceDir, name), join(ortDir, name));
}

console.log(`Copied ${runtimeFiles.length} ONNX Runtime Web assets to ${ortDir}.`);
