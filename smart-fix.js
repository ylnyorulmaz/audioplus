import { EQ_FREQUENCIES, SMART_FIX_MAX_DB, clamp } from './audio-settings.js';

function score(value) {
  return Math.round(clamp(value, 0, 100));
}

function strength(scoreValue, threshold) {
  if (scoreValue <= threshold) return 0;
  return clamp((scoreValue - threshold) / (100 - threshold), 0, 1);
}

function roundedBands(bands) {
  return bands.map((value) => Math.round(clamp(value, -SMART_FIX_MAX_DB, SMART_FIX_MAX_DB) * 10) / 10);
}

export function scoreSmartFixMetrics(metrics = {}) {
  const bassDb = Number(metrics.bassDb ?? -60);
  const lowMidDb = Number(metrics.lowMidDb ?? -60);
  const midDb = Number(metrics.midDb ?? -60);
  const presenceDb = Number(metrics.presenceDb ?? -60);
  const highDb = Number(metrics.highDb ?? -60);
  const rmsDb = Number(metrics.rmsDb ?? -60);

  const muddy = score(50 + (lowMidDb - presenceDb) * 8);
  const thin = score(35 + (presenceDb - bassDb - 3) * 7);
  const harsh = score(40 + (highDb - midDb - 1) * 8);
  const quiet = score((-rmsDb - 18) * 5);

  return { muddy, thin, harsh, quiet };
}

export function buildSmartFix(metrics = {}) {
  const scores = scoreSmartFixMetrics(metrics);
  const bands = EQ_FREQUENCIES.map(() => 0);
  const issues = [];

  const muddyStrength = strength(scores.muddy, 58);
  if (muddyStrength > 0) {
    bands[3] -= 1.1 + 1.4 * muddyStrength; // 250 Hz
    bands[4] -= 0.6 + 1.0 * muddyStrength; // 500 Hz
    bands[6] += 0.3 + 0.6 * muddyStrength; // 2 kHz
    issues.push({ id: 'muddy', label: 'Muddy', score: scores.muddy });
  }

  const thinStrength = strength(scores.thin, 64);
  if (thinStrength > 0) {
    bands[1] += 0.4 + 0.6 * thinStrength; // 64 Hz
    bands[2] += 0.8 + 1.2 * thinStrength; // 125 Hz
    bands[3] += 0.4 + 0.7 * thinStrength; // 250 Hz
    issues.push({ id: 'thin', label: 'Thin', score: scores.thin });
  }

  const harshStrength = strength(scores.harsh, 62);
  if (harshStrength > 0) {
    bands[7] -= 0.8 + 1.3 * harshStrength; // 4 kHz
    bands[8] -= 0.7 + 1.4 * harshStrength; // 8 kHz
    issues.push({ id: 'harsh', label: 'Harsh', score: scores.harsh });
  }

  if (scores.quiet >= 65) {
    issues.push({ id: 'quiet', label: 'Quiet', score: scores.quiet });
  }

  issues.sort((a, b) => b.score - a.score);
  const smartFixBands = roundedBands(bands);
  const hasCorrection = smartFixBands.some((value) => Math.abs(value) >= 0.1);
  const labels = issues.slice(0, 3).map((issue) => issue.label);

  return {
    bands: smartFixBands,
    scores,
    issues,
    summary: labels.length > 0 ? labels.join(' + ') : 'Balanced',
    hasCorrection
  };
}
