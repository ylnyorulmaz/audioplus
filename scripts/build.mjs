import { build } from 'esbuild';
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const distDir = 'dist';
const ortDir = 'vendor/ort';
const ortSourceDir = 'node_modules/onnxruntime-web/dist';

await rm(distDir, { recursive: true, force: true });
await rm('vendor', { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await mkdir(ortDir, { recursive: true });

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

const runtimeFiles = (await readdir(ortSourceDir)).filter((name) =>
  /^ort-wasm.*\.(?:wasm|mjs)$/.test(name)
);

if (runtimeFiles.length === 0) {
  throw new Error('No ONNX Runtime Web WASM assets were found.');
}

for (const name of runtimeFiles) {
  await copyFile(join(ortSourceDir, name), join(ortDir, name));
}

console.log(`Copied ${runtimeFiles.length} ONNX Runtime Web assets to ${ortDir}.`);
