# Audio+

Audio+ is a local-first Chrome audio enhancement extension. It captures only the tab the user explicitly enables and processes its audio on-device with the Web Audio API.

Current version: **V2.4 / 0.8.0**.

## V2 final feature set

Audio+ V2 turns the original equalizer into a practical browser audio toolkit:

- Bass / Mid / Treble controls
- 10-band manual EQ and preamp
- quick tonal presets and custom presets
- per-site profiles
- Dialogue Boost
- Night Mode dynamics
- aggressive client-side Vocal Reduction / Karaoke
- Keep Bass protection for Karaoke
- Smart Fix local audio analysis and conservative automatic correction
- live 10-band input spectrum analyzer
- master volume, Auto Headroom, bypass, reset, and peak protection

All processing remains local. V2 has no backend, account, analytics, telemetry, LLM call, or audio upload.

## Smart Fix

**FIX THIS AUDIO** analyzes roughly 1.3 seconds of the original tab input and measures RMS/peak plus broad spectral regions. A deterministic rule engine scores practical conditions such as Muddy, Thin, Harsh, and Quiet.

Automatic correction uses a dedicated 10-band layer separate from the manual EQ. Each Smart Fix band is limited to **±3 dB**. Re-running replaces the previous automatic curve rather than stacking corrections. Clear Smart Fix removes only the automatic layer.

Quiet is detected and reported but V2 does not automatically add loudness gain.

## Live spectrum analyzer

V2.4 adds a 10-band live input spectrum inside **Advanced**.

The analyzer reuses the existing input `AnalyserNode`; it does not create a second capture or processing graph. The popup requests snapshots only while:

- Audio+ is active;
- the popup is visible; and
- Advanced is open.

Polling stops when those conditions are not met, so the visualization does not keep running in the background after the popup closes.

## Dialogue Boost and Night Mode

Dialogue Boost applies a conservative low-mid reduction and speech-presence lift. Night Mode adds a separate dynamics stage with Off, Light, and Strong profiles for content with large volume jumps.

## Karaoke / Vocal Reduction

V2.2.1's frequency-selective stereo center attenuation remains in the V2 final release:

- below ~180 Hz: Keep Bass can leave centered low-frequency content intact;
- ~180 Hz to 6.5 kHz: strongest center attenuation;
- above ~6.5 kHz: gentler attenuation to retain more cymbals, air, and ambience.

Shortcuts:

- Light — 45%
- Karaoke — 82%
- Instrumental — 100%

This is still stereo DSP, not AI source separation. Mono, off-center, doubled, or stereo-reverb-heavy vocals may remain. Aggressive settings can also remove centered non-vocal material.

## V2.4 lifecycle hardening

V2.4 also closes several product-level edge cases:

- hostname changes are detected even when the popup is closed, so site profiles can switch during navigation;
- same-host SPA navigation keeps the existing processor and settings;
- overlapping Smart Fix analyses on the same tab are rejected instead of racing;
- a suspended AudioContext is asked to resume;
- tab/track cleanup paths remain explicit;
- stale navigation state falls back to a clear re-enable message if the processor disappeared.

## Audio graph

```text
Tab capture
  -> Analyser (original input; Smart Fix + live spectrum)
  -> Bass / Mid / Treble
  -> 10-band manual EQ
  -> Dialogue shaping
  -> Frequency-selective Vocal Reduction
       -> low band <180 Hz
       -> aggressive vocal band 180 Hz-6.5 kHz
       -> gentler air band >6.5 kHz
  -> Smart Fix 10-band correction layer (max ±3 dB/band)
  -> Preamp + Auto Headroom
  -> Night Mode compressor
  -> Master volume
  -> Peak protection
  -> Output
```

Bypass neutralizes manual EQ, Dialogue Boost, Vocal Reduction, Smart Fix, Night Mode, gain changes, and peak protection for a cleaner original/processed comparison.

## Persistence

Global settings and per-site profiles can retain all normal V2 controls, including Dialogue Boost, Night Mode, Vocal Reduction, Keep Bass, and the latest Smart Fix correction curve.

The explanatory Smart Fix analysis result itself is tab-session state rather than permanent history. Built-in tonal presets remain independent from Smart Fix and master volume.

## Run locally

```bash
npm test
```

Then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, select this repository, play media in a normal tab, and click **Enable Audio+**.

## V2.4 manual acceptance test

- Enable Audio+ on YouTube, YouTube Music, Spotify Web, and a normal HTML5-audio/video page.
- Open Advanced: live spectrum responds to playing audio and stops polling when Advanced/popup is closed.
- Smart Fix produces plausible conservative corrections and no automatic band exceeds ±3 dB.
- Re-running Smart Fix replaces the previous automatic curve.
- Clear Smart Fix leaves manual EQ and other controls unchanged.
- Dialogue Boost and Night Mode remain audible and stable.
- Karaoke 82% is clearly stronger than Light and Keep Bass retains more low-frequency center content.
- Navigate within the same host and between hosts in the same tab; site settings remain coherent.
- Pause/resume playback, reopen the popup, and keep playback running for an extended session.
- Close the captured tab and confirm its processor is cleaned up.
- Bypass and Reset return processing to the expected neutral states.

These browser/audio checks are manual; the repository test suite covers deterministic settings, graph wiring, Smart Fix rules, analyzer plumbing, and lifecycle code paths but does not replace listening tests.

## Privacy

Tab audio, Smart Fix analysis, and live-spectrum measurements stay on the device. Audio+ V2 adds no backend, analytics, account, remote model, remote code, or audio upload. See [PRIVACY.md](PRIVACY.md).

## Beyond V2

A future V3 can experiment with **AI Karaoke / source separation**, preferably with an optional client-side 2-stem ONNX/WebGPU path where hardware allows it. That is intentionally outside the lightweight V2 release.

## License

MIT
