import { EQ_FREQUENCIES, DEFAULT_SETTINGS, sanitizeSettings } from './audio-settings.js';

export const PRESET_SETTING_KEYS = Object.freeze([
  'bassDb',
  'midDb',
  'trebleDb',
  'eqBands',
  'preampDb',
  'autoHeadroom'
]);

function tonalPreset(patch = {}) {
  const safe = sanitizeSettings({ ...DEFAULT_SETTINGS, ...patch });
  return Object.freeze({
    bassDb: safe.bassDb,
    midDb: safe.midDb,
    trebleDb: safe.trebleDb,
    eqBands: Object.freeze([...safe.eqBands]),
    preampDb: safe.preampDb,
    autoHeadroom: safe.autoHeadroom
  });
}

export const BUILTIN_PRESETS = Object.freeze([
  Object.freeze({ id: 'flat', name: 'Flat', settings: tonalPreset() }),
  Object.freeze({
    id: 'balanced',
    name: 'Balanced',
    settings: tonalPreset({ bassDb: 1, midDb: 0.5, trebleDb: 1 })
  }),
  Object.freeze({
    id: 'bass-plus',
    name: 'Bass+',
    settings: tonalPreset({ bassDb: 5, midDb: -0.5, trebleDb: 1 })
  }),
  Object.freeze({
    id: 'voice',
    name: 'Voice',
    settings: tonalPreset({ bassDb: -2, midDb: 3, trebleDb: 1.5 })
  }),
  Object.freeze({
    id: 'movie',
    name: 'Movie',
    settings: tonalPreset({ bassDb: 2, midDb: 1.5, trebleDb: 1 })
  }),
  Object.freeze({
    id: 'podcast',
    name: 'Podcast',
    settings: tonalPreset({ bassDb: -2.5, midDb: 3.5, trebleDb: 1 })
  }),
  Object.freeze({
    id: 'bright',
    name: 'Bright',
    settings: tonalPreset({ bassDb: -0.5, midDb: 0, trebleDb: 4 })
  })
]);

export function presetSnapshot(settings = DEFAULT_SETTINGS) {
  const safe = sanitizeSettings(settings);
  return {
    bassDb: safe.bassDb,
    midDb: safe.midDb,
    trebleDb: safe.trebleDb,
    eqBands: EQ_FREQUENCIES.map((_, index) => safe.eqBands[index]),
    preampDb: safe.preampDb,
    autoHeadroom: safe.autoHeadroom
  };
}

export function sanitizePresetName(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

export function presetMatches(settings, presetSettings) {
  const current = presetSnapshot(settings);
  const preset = presetSnapshot(presetSettings);
  return PRESET_SETTING_KEYS.every((key) => {
    if (key === 'eqBands') {
      return current.eqBands.every((value, index) => Math.abs(value - preset.eqBands[index]) < 0.001);
    }
    return current[key] === preset[key];
  });
}
