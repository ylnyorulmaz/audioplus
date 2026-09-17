import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { EQ_FREQUENCIES, DEFAULT_SETTINGS, SMART_FIX_MAX_DB, calculateHeadroomDb, effectivePreampDb, sanitizeSettings } from '../audio-settings.js';
import { BUILTIN_PRESETS, presetSnapshot, sanitizePresetName } from '../presets.js';
import { buildSmartFix, scoreSmartFixMetrics } from '../smart-fix.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('10-band EQ frequencies stay stable', () => assert.deepEqual(EQ_FREQUENCIES, [32,64,125,250,500,1000,2000,4000,8000,16000]));

test('settings clamp unsafe input including Smart Fix controls', () => {
  const safe = sanitizeSettings({ bassDb:99, midDb:-99, preampDb:99, volume:999, dialogueBoost:999, nightMode:'nonsense', vocalReduction:999, keepBass:0, smartFixEnabled:1, smartFixBands:Array(10).fill(99), eqBands:Array(10).fill(99) });
  assert.equal(safe.bassDb,12); assert.equal(safe.midDb,-12); assert.equal(safe.preampDb,6); assert.equal(safe.volume,150);
  assert.equal(safe.dialogueBoost,100); assert.equal(safe.nightMode,'off'); assert.equal(safe.vocalReduction,100); assert.equal(safe.keepBass,false);
  assert.equal(safe.smartFixEnabled,true); assert.ok(safe.smartFixBands.every((value)=>value===SMART_FIX_MAX_DB)); assert.ok(safe.eqBands.every((value)=>value===12));
});

test('defaults keep Smart Fix and vocal reduction neutral', () => {
  const safe=sanitizeSettings(DEFAULT_SETTINGS); assert.equal(safe.vocalReduction,0); assert.equal(safe.keepBass,true); assert.equal(safe.smartFixEnabled,false); assert.deepEqual(safe.smartFixBands,Array(10).fill(0));
});

test('auto headroom includes dialogue and positive Smart Fix boosts', () => {
  const settings=sanitizeSettings({ ...DEFAULT_SETTINGS, bassDb:6, eqBands:[0,0,3,0,0,0,0,0,0,0], preampDb:1, dialogueBoost:100, smartFixEnabled:true, smartFixBands:[0,0,0,0,0,0,3,0,0,0] });
  assert.equal(calculateHeadroomDb(settings),-16); assert.equal(effectivePreampDb(settings),-15);
});

test('presets remain safe snapshots and names are normalized', () => {
  assert.equal(BUILTIN_PRESETS.length,7);
  for (const preset of BUILTIN_PRESETS) { const snapshot=presetSnapshot(preset.settings); assert.equal(Object.hasOwn(snapshot,'volume'),false); assert.equal(Object.hasOwn(snapshot,'smartFixBands'),false); assert.equal(snapshot.eqBands.length,10); }
  assert.equal(sanitizePresetName('  My   Speakers  '),'My Speakers');
});

test('Smart Fix remains conservative', () => {
  const metrics={ bassDb:-31, lowMidDb:-20, midDb:-28, presenceDb:-32, highDb:-36, rmsDb:-18 };
  const scores=scoreSmartFixMetrics(metrics); const fix=buildSmartFix(metrics);
  assert.ok(scores.muddy>=90); assert.ok(fix.bands.every((value)=>Math.abs(value)<=SMART_FIX_MAX_DB));
});

test('manifest is MV3 multi-tab-aware 0.14.0 without broad tabs permission', async () => {
  const manifest=JSON.parse(await read('manifest.json'));
  assert.equal(manifest.manifest_version,3); assert.equal(manifest.version,'0.14.0');
  assert.deepEqual([...manifest.permissions].sort(),['activeTab','offscreen','storage','tabCapture'].sort());
  assert.equal(manifest.permissions.includes('tabs'),false);
  assert.deepEqual(manifest.host_permissions,['https://huggingface.co/*','https://*.huggingface.co/*','https://*.hf.co/*']);
  assert.equal(manifest.background.service_worker,'service-worker.js');
  assert.equal(manifest.action.default_popup,undefined);
  assert.match(manifest.description,/WebGPU-first safe CPU fallback/);
});

test('package version matches manifest version', async () => {
  const manifest=JSON.parse(await read('manifest.json')); const pkg=JSON.parse(await read('package.json')); assert.equal(pkg.version,manifest.version);
});

test('persistent controller opens, can minimize/close, and shows selected audio source', async () => {
  const worker=await read('service-worker.js'); const popup=await read('popup.html'); const controller=await read('popup.js');
  assert.match(worker,/chrome\.action\.onClicked/); assert.match(worker,/chrome\.windows\.create/); assert.match(worker,/\?tabId=\$\{encodeURIComponent\(tabId\)\}/);
  assert.match(popup,/id="minimizeWindowButton"/); assert.match(popup,/id="closeWindowButton"/); assert.match(popup,/id="sourceName"/); assert.match(popup,/id="audibleTabsBadge"/); assert.match(popup,/id="sessionsBadge"/);
  assert.match(controller,/state: 'minimized'/); assert.match(controller,/chrome\.windows\.remove/); assert.match(controller,/getTargetTab/);
});

test('Fast Karaoke has a real Off control', async () => {
  const popup=await read('popup.html'); const controller=await read('popup.js');
  assert.match(popup,/data-vocal-preset="0"[^>]*>Off</); assert.match(controller,/Fast Karaoke off/);
});

test('control window uses full-width card layout instead of old fixed popup shell', async () => {
  const css=await read('control-window.css');
  assert.match(css,/\.control-window \{ width: 100%/); assert.match(css,/\.source-card/); assert.match(css,/\.primary-feature/); assert.match(css,/\.control-window \.section/);
});

test('peak protection and stable V2 processing graph remain intact', async () => {
  const source=await read('offscreen.js');
  assert.match(source,/masterGain\.connect\(peakLimiter\)/); assert.match(source,/peakLimiter\.connect\(context\.destination\)/); assert.match(source,/ratio:\s*20/);
  assert.match(source,/VOCAL_LOW_CROSSOVER_HZ = 180/); assert.match(source,/VOCAL_HIGH_CROSSOVER_HZ = 6500/); assert.match(source,/case 'GET_SPECTRUM'/); assert.match(source,/case 'ANALYZE_AUDIO'/);
});
