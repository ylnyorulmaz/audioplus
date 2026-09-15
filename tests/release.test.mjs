import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { EQ_FREQUENCIES, DEFAULT_SETTINGS, calculateHeadroomDb, effectivePreampDb, sanitizeSettings } from '../audio-settings.js';
import { BUILTIN_PRESETS, presetSnapshot, sanitizePresetName } from '../presets.js';

test('10-band EQ frequencies stay stable', () => assert.deepEqual(EQ_FREQUENCIES, [32,64,125,250,500,1000,2000,4000,8000,16000]));

test('settings clamp unsafe input including V2.2 controls', () => {
  const safe = sanitizeSettings({ bassDb:99, midDb:-99, preampDb:99, volume:999, dialogueBoost:999, nightMode:'nonsense', vocalReduction:999, keepBass:0, eqBands:Array(10).fill(99) });
  assert.equal(safe.bassDb,12); assert.equal(safe.midDb,-12); assert.equal(safe.preampDb,6); assert.equal(safe.volume,150);
  assert.equal(safe.dialogueBoost,100); assert.equal(safe.nightMode,'off'); assert.equal(safe.vocalReduction,100); assert.equal(safe.keepBass,false);
  assert.ok(safe.eqBands.every((value)=>value===12));
});

test('V2.2 defaults keep vocal reduction off and bass preservation on', () => {
  const safe = sanitizeSettings(DEFAULT_SETTINGS);
  assert.equal(safe.vocalReduction,0);
  assert.equal(safe.keepBass,true);
});

test('auto headroom includes dialogue presence boost', () => {
  const settings = sanitizeSettings({ ...DEFAULT_SETTINGS, bassDb:6, eqBands:[0,0,3,0,0,0,0,0,0,0], preampDb:1, dialogueBoost:100 });
  assert.equal(calculateHeadroomDb(settings),-13); assert.equal(effectivePreampDb(settings),-12);
});

test('bypass neutralizes effective preamp', () => assert.equal(effectivePreampDb({ ...DEFAULT_SETTINGS, preampDb:6, bypass:true }),0));

test('built-in presets remain tonal snapshots and never store volume', () => {
  assert.equal(BUILTIN_PRESETS.length,7);
  for (const preset of BUILTIN_PRESETS) { const snapshot=presetSnapshot(preset.settings); assert.equal(Object.hasOwn(snapshot,'volume'),false); assert.equal(snapshot.eqBands.length,10); }
});

test('preset names are normalized and capped', () => { assert.equal(sanitizePresetName('  My   Speakers  '),'My Speakers'); assert.equal(sanitizePresetName('x'.repeat(100)).length,40); });

test('manifest is MV3 V2.2 release 0.6.0 with minimum permissions', async () => {
  const manifest=JSON.parse(await readFile(new URL('../manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.manifest_version,3); assert.equal(manifest.version,'0.6.0');
  assert.deepEqual([...manifest.permissions].sort(),['activeTab','offscreen','storage','tabCapture'].sort()); assert.equal(manifest.host_permissions,undefined);
});

test('peak protection remains after master gain', async () => {
  const source=await readFile(new URL('../offscreen.js',import.meta.url),'utf8');
  assert.match(source,/masterGain\.connect\(peakLimiter\)/); assert.match(source,/peakLimiter\.connect\(context\.destination\)/); assert.match(source,/ratio:\s*20/);
});

test('V2.1 graph still includes dialogue filters and night compressor before master', async () => {
  const source=await readFile(new URL('../offscreen.js',import.meta.url),'utf8');
  assert.match(source,/createDialogueFilter\(context, 280/); assert.match(source,/createDialogueFilter\(context, 2600/);
  assert.match(source,/preampGain\.connect\(nightCompressor\)/); assert.match(source,/nightCompressor\.connect\(masterGain\)/);
});

test('V2.2 graph contains stereo center attenuation and bass preservation crossover', async () => {
  const source=await readFile(new URL('../offscreen.js',import.meta.url),'utf8');
  assert.match(source,/createChannelSplitter\(2\)/);
  assert.match(source,/createChannelMerger\(2\)/);
  assert.match(source,/crossCoefficient = -amount \/ 2/);
  assert.match(source,/VOCAL_CROSSOVER_HZ = 180/);
  assert.match(source,/originalLowpass\.connect\(bassPreserveGain\)/);
  assert.match(source,/vocalReducer\.output\.connect\(preampGain\)/);
});
