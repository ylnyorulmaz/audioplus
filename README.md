# Audio+

Audio+ is a local-first Chrome audio enhancement extension. It captures only the tab the user explicitly enables and processes its audio on-device with the Web Audio API.

Current version: **V2.3 / 0.7.0**.

## V2.3: Smart Fix

V2.3 adds **FIX THIS AUDIO**, a one-click local audio-analysis and correction layer for users who do not want to tune an equalizer manually.

Smart Fix does not use an LLM, remote API, or uploaded audio. While Audio+ is enabled and audio is playing, it listens to roughly 1.3 seconds of the tab's original input signal and measures:

- RMS and peak level;
- bass energy;
- low-mid energy;
- mid energy;
- presence energy;
- high-frequency energy;
- air-band energy.

A deterministic rule engine then scores four practical conditions:

- **Muddy** — too much low-mid energy relative to presence;
- **Thin** — too little bass/body relative to presence;
- **Harsh** — excessive high-frequency energy relative to the mids;
- **Quiet** — low measured RMS level. Quiet is reported but V2.3 does not automatically add loudness gain.

### Conservative correction

Smart Fix uses a dedicated 10-band correction layer separate from the user's manual EQ. Each automatic band is hard-limited to **±3 dB**.

Examples of the rules:

- Muddy audio can receive cuts around 250/500 Hz and a small 2 kHz presence lift.
- Thin audio can receive gentle 64/125/250 Hz boosts.
- Harsh audio can receive gentle 4/8 kHz cuts.

Positive Smart Fix boosts are included in Auto Headroom's safety estimate.

Because the automatic layer is separate, **Clear Smart Fix** removes only the automatic correction and leaves the user's manual EQ, presets, Dialogue Boost, Night Mode, Karaoke settings, and volume alone.

## Audio graph

```text
Tab capture
  -> Analyser (original input, local only)
  -> Bass / Mid / Treble
  -> 10-band manual EQ
  -> Dialogue shaping
  -> Frequency-selective Vocal Reduction
       -> low band <180 Hz
       -> aggressive vocal band 180 Hz-6.5 kHz
       -> gentler air band >6.5 kHz
  -> Smart Fix 10-band correction layer (max ±3 dB/band)
  -> Preamp + auto headroom
  -> Night Mode compressor
  -> Master volume
  -> Peak protection
  -> Output
```

Bypass neutralizes the manual EQ, Dialogue Boost, Vocal Reduction, Smart Fix correction, Night Mode, gain changes, and limiter ratio for a cleaner original/processed comparison.

## Persistence

Smart Fix enabled state and its correction curve use the existing Audio+ settings system, so they can persist globally or in a per-site profile. The most recent analysis explanation is kept only in the current tab session. Reset clears Smart Fix together with the other settings.

Built-in and custom tonal presets remain independent: applying Bass+, Voice, Movie, etc. does not silently rewrite the Smart Fix layer.

## Karaoke remains lightweight DSP

V2.2.1's aggressive Karaoke path remains unchanged in V2.3. It uses frequency-selective stereo center attenuation, not AI source separation:

- below ~180 Hz: Keep Bass can leave center content intact;
- ~180 Hz to 6.5 kHz: strongest center reduction;
- above ~6.5 kHz: gentler reduction to retain more air and cymbals.

Shortcuts remain Light 45%, Karaoke 82%, Instrumental 100%.

## Important limitations

Smart Fix is a short-window heuristic analyzer, not mastering software. It can make a conservative tonal correction, but it cannot know artistic intent and should not make large automatic changes. Different sections of the same track can analyze differently; re-run Smart Fix on representative material when needed.

Karaoke remains limited on mono, off-center, doubled, or reverb-heavy vocals. True vocal/instrument separation would require a source-separation model such as a Demucs/MDX-style system, which is outside V2.3.

## Run locally

```bash
npm test
```

Then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, select this repository, play media in a normal tab, and click **Enable Audio+**.

## V2.3 manual acceptance test

- Smart Fix refuses to run until Audio+ capture is active.
- With audible content playing, analysis completes and returns a result instead of raw browser data.
- Muddy/thin/harsh material produces plausible conservative corrections.
- No Smart Fix band exceeds ±3 dB.
- Re-running Smart Fix replaces the previous automatic curve rather than stacking corrections.
- Clear Smart Fix returns the automatic correction layer to flat without changing manual EQ.
- Bypass neutralizes Smart Fix along with the other processing stages.
- Reset disables and clears Smart Fix.
- Site profiles can retain their Smart Fix curve.
- Dialogue Boost, Night Mode, Karaoke, manual EQ, capture lifecycle, and peak protection still work.

## Privacy

Audio analysis and processing stay on the device. V2.3 adds no backend, analytics, account, remote model, remote code, or audio upload. See [PRIVACY.md](PRIVACY.md).

## Next

V2.4 is the productization/release-polish iteration: analyzer visualization, clearer Smart Fix feedback, compatibility/performance testing, and release hardening.

## License

MIT
