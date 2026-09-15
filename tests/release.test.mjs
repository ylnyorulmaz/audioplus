import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  EQ_FREQUENCIES,
  DEFAULT_SETTINGS,
  calculateHeadroomDb,
  effectivePreampDb,
  sanitizeSettings
} from '../audio-settings.js';
import {
  BUILTIN_PRESETS,
  presetSnapshot,
  sanitizePresetName
} from '../presets.js';

test('10-band EQ frequencies stay stable', () => {
  assert.deepEqual(EQ_FREQUENCIES, [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
});

test('settings clamp unsafe input', () => {
  const safe = sanitizeSettings({
    bassDb: 99,
    midDb: -99,
    trebleDb: 4,
    preampDb: 99,
    volume: 999,
    eqBands: Array(10).fill(99)
  });
  assert.equal(safe.bassDb, 12);
  assert.equal(safe.midDb, -12);
  assert.equal(safe.preampDb, 6);
  assert.equal(safe.volume, 150);
  assert.ok(safe.eqBands.every((value) => value === 12));
});

test('auto headroom compensates positive boosts', () => {
  const settings = sanitizeSettings({
    ...DEFAULT_SETTINGS,
    bassDb: 6,
    eqBands: [0, 0, 3, 0, 0, 0, 0, 0, 0, 0],
    preampDb: 1
  });
  assert.equal(calculateHeadroomDb(settings), -10);
  assert.equal(effectivePreampDb(settings), -9);
});

test('bypass neutralizes effective preamp', () => {
  assert.equal(effectivePreampDb({ ...DEFAULT_SETTINGS, preampDb: 6, bypass: true }), 0);
});

test('built-in presets are tonal snapshots and never store volume', () => {
  assert.equal(BUILTIN_PRESETS.length, 7);
  for (const preset of BUILTIN_PRESETS) {
    const snapshot = presetSnapshot(preset.settings);
    assert.equal(Object.hasOwn(snapshot, 'volume'), false);
    assert.equal(snapshot.eqBands.length, 10);
  }
});

test('preset names are normalized and capped', () => {
  assert.equal(sanitizePresetName('  My   Speakers  '), 'My Speakers');
  assert.equal(sanitizePresetName('x'.repeat(100)).length, 40);
});

test('manifest is MV3 release 0.4.0 with minimum permissions', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '0.4.0');
  assert.deepEqual(
    [...manifest.permissions].sort(),
    ['activeTab', 'offscreen', 'storage', 'tabCapture'].sort()
  );
  assert.equal(manifest.host_permissions, undefined);
});

test('peak protection exists after master gain and bypass can neutralize it', async () => {
  const source = await readFile(new URL('../offscreen.js', import.meta.url), 'utf8');
  assert.match(source, /masterGain\.connect\(peakLimiter\)/);
  assert.match(source, /peakLimiter\.connect\(context\.destination\)/);
  assert.match(source, /ratio:\s*20/);
  assert.match(source, /ratio:\s*1/);
});
