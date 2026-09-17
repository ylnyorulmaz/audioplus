import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { EQ_FREQUENCIES, DEFAULT_SETTINGS, SMART_FIX_MAX_DB, calculateHeadroomDb, effectivePreampDb, sanitizeSettings } from '../audio-settings.js';
import { BUILTIN_PRESETS, presetSnapshot, sanitizePresetName } from '../presets.js';
import { buildSmartFix, scoreSmartFixMetrics } from '../smart-fix.js';

test('10-band EQ frequencies stay stable', () => assert.deepEqual(EQ_FREQUENCIES, [32,64,125,250,500,1000,2000,4000,8000,16000]));

test('settings clamp unsafe input including Smart Fix controls', () => {
  const safe = sanitizeSettings({
    bassDb:99, midDb:-99, preampDb:99, volume:999, dialogueBoost:999, nightMode:'nonsense',
    vocalReduction:999, keepBass:0, smartFixEnabled:1, smartFixBands:Array(10).fill(99), eqBands:Array(10).fill(99)
  });
  assert.equal(safe.bassDb,12); assert.equal(safe.midDb,-12); assert.equal(safe.preampDb,6); assert.equal(safe.volume,150);
  assert.equal(safe.dialogueBoost,100); assert.equal(safe.nightMode,'off'); assert.equal(safe.vocalReduction,100); assert.equal(safe.keepBass,false);
  assert.equal(safe.smartFixEnabled,true); assert.ok(safe.smartFixBands.every((value)=>value===SMART_FIX_MAX_DB));
  assert.ok(safe.eqBands.every((value)=>value===12));
});

test('defaults keep Smart Fix and vocal reduction neutral', () => {
  const safe = sanitizeSettings(DEFAULT_SETTINGS);
  assert.equal(safe.vocalReduction,0);
  assert.equal(safe.keepBass,true);
  assert.equal(safe.smartFixEnabled,false);
  assert.deepEqual(safe.smartFixBands, Array(10).fill(0));
});

test('auto headroom includes dialogue and positive Smart Fix boosts', () => {
  const settings = sanitizeSettings({
    ...DEFAULT_SETTINGS,
    bassDb:6,
    eqBands:[0,0,3,0,0,0,0,0,0,0],
    preampDb:1,
    dialogueBoost:100,
    smartFixEnabled:true,
    smartFixBands:[0,0,0,0,0,0,3,0,0,0]
  });
  assert.equal(calculateHeadroomDb(settings),-16);
  assert.equal(effectivePreampDb(settings),-15);
});

test('bypass neutralizes effective preamp', () => assert.equal(effectivePreampDb({ ...DEFAULT_SETTINGS, preampDb:6, bypass:true }),0));

test('built-in presets remain tonal snapshots and never store volume or Smart Fix', () => {
  assert.equal(BUILTIN_PRESETS.length,7);
  for (const preset of BUILTIN_PRESETS) {
    const snapshot=presetSnapshot(preset.settings);
    assert.equal(Object.hasOwn(snapshot,'volume'),false);
    assert.equal(Object.hasOwn(snapshot,'smartFixBands'),false);
    assert.equal(snapshot.eqBands.length,10);
  }
});

test('preset names are normalized and capped', () => {
  assert.equal(sanitizePresetName('  My   Speakers  '),'My Speakers');
  assert.equal(sanitizePresetName('x'.repeat(100)).length,40);
});

test('Smart Fix scores muddy audio and cuts low mids conservatively', () => {
  const metrics={ bassDb:-31, lowMidDb:-20, midDb:-28, presenceDb:-32, highDb:-36, rmsDb:-18 };
  const scores=scoreSmartFixMetrics(metrics);
  const fix=buildSmartFix(metrics);
  assert.ok(scores.muddy >= 90);
  assert.ok(fix.bands[3] < -1);
  assert.ok(fix.bands[4] < 0);
  assert.ok(fix.bands[6] > 0);
  assert.ok(fix.bands.every((value)=>Math.abs(value)<=SMART_FIX_MAX_DB));
});

test('Smart Fix can recognize thin and harsh profiles', () => {
  const thin=buildSmartFix({ bassDb:-46, lowMidDb:-35, midDb:-31, presenceDb:-24, highDb:-32, rmsDb:-20 });
  assert.ok(thin.scores.thin >= 80);
  assert.ok(thin.bands[2] > 0);
  const harsh=buildSmartFix({ bassDb:-30, lowMidDb:-32, midDb:-36, presenceDb:-29, highDb:-20, rmsDb:-19 });
  assert.ok(harsh.scores.harsh >= 80);
  assert.ok(harsh.bands[7] < 0);
  assert.ok(harsh.bands[8] < 0);
});

test('manifest is MV3 Live AI Karaoke beta 0.11.0 with minimum audio permissions', async () => {
  const manifest=JSON.parse(await readFile(new URL('../manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.manifest_version,3);
  assert.equal(manifest.version,'0.11.0');
  assert.deepEqual([...manifest.permissions].sort(),['activeTab','offscreen','storage','tabCapture'].sort());
  assert.equal(manifest.host_permissions,undefined);
  assert.equal(manifest.background.service_worker,'service-worker.js');
});

test('package version matches manifest version', async () => {
  const manifest=JSON.parse(await readFile(new URL('../manifest.json',import.meta.url),'utf8'));
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(pkg.version,manifest.version);
});

test('peak protection remains after master gain', async () => {
  const source=await readFile(new URL('../offscreen.js',import.meta.url),'utf8');
  assert.match(source,/masterGain\.connect\(peakLimiter\)/); assert.match(source,/peakLimiter\.connect\(context\.destination\)/); assert.match(source,/ratio:\s*20/);
});

test('V2.1 dialogue and Night Mode graph remains intact', async () => {
  const source=await readFile(new URL('../offscreen.js',import.meta.url),'utf8');
  assert.match(source,/createDialogueFilter\(context, 280/); assert.match(source,/createDialogueFilter\(context, 2600/);
  assert.match(source,/preampGain\.connect\(nightCompressor\)/); assert.match(source,/nightCompressor\.connect\(masterGain\)/);
});

test('V2.2.1 karaoke keeps frequency-selective center reduction', async () => {
  const source=await readFile(new URL('../offscreen.js',import.meta.url),'utf8');
  assert.match(source,/VOCAL_LOW_CROSSOVER_HZ = 180/); assert.match(source,/VOCAL_HIGH_CROSSOVER_HZ = 6500/);
  assert.match(source,/const midAmount = aggressive/); assert.match(source,/const highAmount = aggressive \* 0\.42/);
  assert.match(source,/settings\.keepBass \? 0 : aggressive \* 0\.28/);
});

test('Smart Fix graph analyzes dry input and inserts a separate correction layer', async () => {
  const source=await readFile(new URL('../offscreen.js',import.meta.url),'utf8');
  assert.match(source,/const analyser = context\.createAnalyser\(\)/); assert.match(source,/source\.connect\(analyser\)/);
  assert.match(source,/analyser\.connect\(bassMacro\)/); assert.match(source,/const smartFixFilters = EQ_FREQUENCIES\.map/);
  assert.match(source,/previous = vocalReducer\.output/); assert.match(source,/for \(const filter of smartFixFilters\)/); assert.match(source,/case 'ANALYZE_AUDIO'/);
});

test('V2.4 exposes low-overhead spectrum snapshots from the existing analyser', async () => {
  const source=await readFile(new URL('../offscreen.js',import.meta.url),'utf8');
  assert.match(source,/function spectrumSnapshot\(processor\)/); assert.match(source,/case 'GET_SPECTRUM'/);
  assert.match(source,/frequencies: \[\.\.\.EQ_FREQUENCIES\]/); assert.equal((source.match(/context\.createAnalyser\(\)/g) ?? []).length,1);
});

test('V2.4 resumes a suspended AudioContext and keeps cleanup paths', async () => {
  const source=await readFile(new URL('../offscreen.js',import.meta.url),'utf8');
  assert.match(source,/context\.state === 'suspended'/); assert.match(source,/context\.resume\(\)/);
  assert.match(source,/processor\.analyser\.disconnect\(\)/); assert.match(source,/track\.onended = null/);
});

test('V2.4 background prevents overlapping Smart Fix runs and syncs hostname navigation', async () => {
  const source=await readFile(new URL('../background.js',import.meta.url),'utf8');
  assert.match(source,/const smartFixRuns = new Set\(\)/); assert.match(source,/smartFixRuns\.has\(message\.tabId\)/);
  assert.match(source,/smartFixRuns\.delete\(message\.tabId\)/); assert.match(source,/chrome\.tabs\.onUpdated\.addListener/);
  assert.match(source,/siteKeyFromUrl\(changeInfo\.url\)/); assert.match(source,/syncTabSiteContext\(tabId, siteKey\)/);
});

test('V2.4 popup exposes live spectrum controls and productization script', async () => {
  const html=await readFile(new URL('../popup.html',import.meta.url),'utf8');
  assert.match(html,/id="spectrumBars"/); assert.match(html,/id="spectrumStatus"/); assert.match(html,/id="spectrumMetrics"/); assert.match(html,/src="v2-productization\.js"/);
});

test('V2.4 spectrum polling only runs when popup is visible and Advanced is open', async () => {
  const source=await readFile(new URL('../v2-productization.js',import.meta.url),'utf8');
  assert.match(source,/const POLL_MS = 240/); assert.match(source,/document\.visibilityState !== 'visible'/);
  assert.match(source,/!advancedPanel\.open/); assert.match(source,/type: 'GET_SPECTRUM'/);
});
