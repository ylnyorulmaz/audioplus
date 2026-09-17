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

test('manifest is MV3 native side-panel 0.16.1 without broad tabs permission', async () => {
  const manifest=JSON.parse(await read('manifest.json'));
  assert.equal(manifest.manifest_version,3); assert.equal(manifest.version,'0.16.1');
  assert.deepEqual([...manifest.permissions].sort(),['activeTab','offscreen','sidePanel','storage','tabCapture'].sort());
  assert.equal(manifest.permissions.includes('tabs'),false);
  assert.deepEqual(manifest.host_permissions,['https://huggingface.co/*','https://*.huggingface.co/*','https://*.hf.co/*']);
  assert.equal(manifest.background.service_worker,'service-worker.js');
  assert.equal(manifest.action.default_popup,undefined);
  assert.equal(manifest.side_panel.default_path,'sidepanel.html');
  assert.match(manifest.description,/karaoke|clearer voices|better everyday sound/i);
});

test('package version matches manifest version', async () => {
  const manifest=JSON.parse(await read('manifest.json')); const pkg=JSON.parse(await read('package.json')); assert.equal(pkg.version,manifest.version);
});

test('toolbar action opens native side panel synchronously and remembers the selected source', async () => {
  const worker=await read('service-worker.js'); const panel=await read('sidepanel.html'); const target=await read('target-tab.js');
  assert.match(worker,/chrome\.action\.onClicked\.addListener\(\(tab\) => \{[\s\S]*?const openPromise = chrome\.sidePanel\.open\(\{ windowId: tab\.windowId \}\);[\s\S]*?selectPanelTarget\(tab\)/);
  const selectTargetBody = worker.match(/async function selectPanelTarget\(tab\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.doesNotMatch(selectTargetBody,/sidePanel\.open|sidePanel\.setOptions/);
  assert.match(worker,/audioPlus\.sidePanelTarget\./);
  assert.doesNotMatch(worker,/chrome\.windows\.create/); assert.doesNotMatch(worker,/type: 'popup'/);
  assert.match(panel,/id="spectrumBars"/); assert.match(panel,/id="toneHeading"/);
  assert.match(target,/PANEL_TARGET_PREFIX/); assert.match(target,/chrome\.storage\.session\.get/); assert.match(target,/chrome\.tabs\.get/);
});

test('side panel is an equalizer with karaoke, not a goal picker', async () => {
  const panel=await read('sidepanel.html'); const js=await read('popup.js');
  assert.match(panel,/Equalizer with karaoke/);
  assert.doesNotMatch(panel,/Start here/); assert.doesNotMatch(panel,/What do you want right now/);
  assert.doesNotMatch(panel,/You're controlling/); assert.doesNotMatch(panel,/Current browser tab/);
  assert.match(panel,/id="toneHeading">Tone</); assert.match(panel,/id="spectrumHeading">Live spectrum</);
  assert.ok(panel.indexOf('id="spectrumPanel"') < panel.indexOf('id="toneZone"'));
  assert.ok(panel.indexOf('id="toneZone"') < panel.indexOf('id="karaokeZone"'));
  assert.doesNotMatch(panel,/<details class="mini-details tone-details">/);
  assert.match(js,/data-spectrum-always-on/);
});

test('equalizer layout keeps spectrum and tone above karaoke', async () => {
  const panel=await read('sidepanel.html');
  assert.ok(panel.indexOf('spectrumPanel') < panel.indexOf('karaokeZone'));
  assert.ok(panel.indexOf('toneZone') < panel.indexOf('karaokeZone'));
  assert.ok(panel.indexOf('karaokeZone') < panel.indexOf('advancedPanel'));
  assert.match(panel,/id="karaokeZoneHeading">Karaoke</);
  assert.match(panel,/>10-band EQ</);
  assert.match(panel,/<details class="section fold"/);
  assert.match(panel,/class="help-tip"/);
  assert.match(panel,/About Live spectrum/);
  assert.match(panel,/About Karaoke/);
});

test('native side panel reloads when the toolbar selects another source tab', async () => {
  const sync=await read('sidepanel-target-sync.js'); const panel=await read('sidepanel.html');
  assert.match(sync,/SIDE_PANEL_TARGET_CHANGED/); assert.match(sync,/location\.reload/);
  assert.match(panel,/sidepanel-target-sync\.js/); assert.match(panel,/sidepanel\.css/);
});

test('Enable Audio+ still works when siteLabel is absent from side panel HTML', async () => {
  const js=await read('popup.js'); const panel=await read('sidepanel.html'); const popup=await read('popup.html');
  assert.doesNotMatch(panel,/id="siteLabel"/); assert.doesNotMatch(popup,/id="siteLabel"/);
  assert.match(js,/if \(els\.siteLabel\) els\.siteLabel\.textContent/);
  assert.match(js,/UI refresh failed before enable/);
});

test('Fast Karaoke has a real Off control in side panel', async () => {
  const panel=await read('sidepanel.html'); const controller=await read('popup.js');
  assert.match(panel,/data-vocal-preset="0"[^>]*>Off</); assert.match(controller,/Fast Karaoke off/);
});

test('side panel uses responsive full-width equalizer layout', async () => {
  const css=await read('sidepanel.css'); const base=await read('control-window.css');
  assert.match(css,/\.panel, \.control-window \{ width: 100%/); assert.match(css,/@media \(max-width: 360px\)/);
  assert.match(css,/\.spectrum-zone/); assert.match(css,/\.persona-zone/); assert.match(css,/\.power-strip/);
  assert.match(base,/\.primary-feature/);
});

test('peak protection and stable V2 processing graph remain intact', async () => {
  const source=await read('offscreen.js');
  assert.match(source,/masterGain\.connect\(peakLimiter\)/); assert.match(source,/peakLimiter\.connect\(context\.destination\)/); assert.match(source,/ratio:\s*20/);
  assert.match(source,/VOCAL_LOW_CROSSOVER_HZ = 250/); assert.match(source,/VOCAL_HIGH_CROSSOVER_HZ = 4000/); assert.match(source,/VOCAL_PRESENCE_HZ = 2500/); assert.match(source,/midPresence/); assert.match(source,/case 'GET_SPECTRUM'/); assert.match(source,/case 'ANALYZE_AUDIO'/);
});
