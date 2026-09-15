export const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const DEFAULT_SETTINGS = Object.freeze({
  bassDb: 0,
  midDb: 0,
  trebleDb: 0,
  eqBands: Object.freeze(EQ_FREQUENCIES.map(() => 0)),
  preampDb: 0,
  autoHeadroom: true,
  volume: 100,
  bypass: false
});

export function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

export function sanitizeSettings(input = {}) {
  const incomingBands = Array.isArray(input.eqBands) ? input.eqBands : DEFAULT_SETTINGS.eqBands;

  return {
    bassDb: clamp(input.bassDb ?? DEFAULT_SETTINGS.bassDb, -12, 12),
    midDb: clamp(input.midDb ?? DEFAULT_SETTINGS.midDb, -12, 12),
    trebleDb: clamp(input.trebleDb ?? DEFAULT_SETTINGS.trebleDb, -12, 12),
    eqBands: EQ_FREQUENCIES.map((_, index) => clamp(incomingBands[index] ?? 0, -12, 12)),
    preampDb: clamp(input.preampDb ?? DEFAULT_SETTINGS.preampDb, -12, 6),
    autoHeadroom: input.autoHeadroom ?? DEFAULT_SETTINGS.autoHeadroom,
    volume: clamp(input.volume ?? DEFAULT_SETTINGS.volume, 0, 150),
    bypass: Boolean(input.bypass ?? DEFAULT_SETTINGS.bypass)
  };
}

export function calculateHeadroomDb(settings) {
  const safe = sanitizeSettings(settings);
  if (!safe.autoHeadroom || safe.bypass) return 0;

  const maxEqBoost = Math.max(0, ...safe.eqBands);
  const maxMacroBoost = Math.max(0, safe.bassDb, safe.midDb, safe.trebleDb);
  const positivePreamp = Math.max(0, safe.preampDb);
  const estimatedBoost = maxEqBoost + maxMacroBoost + positivePreamp;

  return -Math.min(18, estimatedBoost);
}

export function effectivePreampDb(settings) {
  const safe = sanitizeSettings(settings);
  if (safe.bypass) return 0;
  return clamp(safe.preampDb + calculateHeadroomDb(safe), -24, 12);
}

export function dbToGain(db) {
  return 10 ** (Number(db) / 20);
}
