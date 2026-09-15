# Audio+

Audio+ is a local-first Chrome audio enhancement extension. It captures only the tab the user explicitly enables and processes its audio on-device with the Web Audio API.

Current version: **V2.2 / 0.6.0**.

## V2.2 features

Everything from V2.1 remains available: EQ, presets, custom presets, per-site profiles, Dialogue Boost, Night Mode, volume, bypass, auto headroom, and peak protection.

V2.2 adds **Vocal Reduction / Karaoke**.

### Vocal Reduction

Vocal Reduction uses lightweight stereo center attenuation. It does not download an AI model and does not upload audio.

The 0-100% control progressively attenuates content common to the left and right channels while preserving stereo side information. Three shortcuts are included:

- **Light** — 35%
- **Karaoke** — 70%
- **Instrumental** — 100%

This works best when the lead vocal is mixed near the stereo center. It is intentionally called Vocal Reduction rather than Vocal Removal because results vary by recording.

### Keep Bass

Center attenuation can also weaken centered kick and bass. **Keep Bass** preserves the original low-frequency region below roughly 180 Hz while applying vocal reduction mainly above that crossover.

Keep Bass is enabled by default.

## Important karaoke limitations

V2.2 is DSP, not stem separation. Results can be weak when:

- the source is mono;
- the vocal is panned away from center;
- the vocal has wide stereo doubling, delay, or reverb;
- instruments share the same centered frequency content;
- the mix already contains phase-processing or unusual stereo mastering.

At aggressive settings, some centered drums, bass harmonics, or instruments may still be reduced.

## Audio graph

```text
Tab capture
  -> Bass / Mid / Treble
  -> 10-band EQ
  -> Dialogue shaping
  -> Stereo Vocal Reduction
       -> optional bass-preservation crossover
  -> Preamp + auto headroom
  -> Night Mode compressor
  -> Master volume
  -> Peak protection
  -> Output
```

Bypass neutralizes EQ, Dialogue Boost, Vocal Reduction, Night Mode, gain changes, and limiter ratio for a cleaner original/processed comparison.

## Persistence

Vocal Reduction and Keep Bass are normal Audio+ settings. They persist globally and inside per-site profiles. Reset returns Vocal Reduction to 0% and Keep Bass to On.

## Run locally

```bash
npm test
```

Then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, select this repository, play media in a normal tab, and click **Enable Audio+**.

## V2.2 manual acceptance test

- 0% Vocal Reduction sounds neutral.
- Light, Karaoke, and Instrumental progressively reduce a centered lead vocal.
- Keep Bass On retains noticeably more kick/bass than Keep Bass Off on suitable material.
- Mono content does not crash the processor, even if the effect is limited.
- Bypass restores approximately original stereo balance and level.
- Vocal settings persist globally and in site profiles.
- Reset restores Vocal Reduction 0% and Keep Bass On.
- Dialogue Boost, Night Mode, V1 EQ, profiles, capture lifecycle, and limiter still work.

## Privacy

Audio stays on the device. V2.2 adds no backend, analytics, account, remote code, model download, or audio upload. See [PRIVACY.md](PRIVACY.md).

## Next

V2.3 is planned around **Smart Fix / automatic audio analysis**. AI stem separation remains outside this lightweight V2.2 karaoke implementation.

## License

MIT
