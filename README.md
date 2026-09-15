# Audio+

Audio+ is a local-first Chrome audio enhancement extension. It captures only the tab the user explicitly enables and processes its audio on-device with the Web Audio API.

Current version: **V2.2.1 / 0.6.1**.

## V2.2.1: Aggressive Karaoke refinement

V2.2.1 strengthens Vocal Reduction without adding AI stem separation.

The previous V2.2 implementation used one broadband center-cancel matrix. V2.2.1 splits the signal into three regions so center attenuation can be stronger where lead vocals usually dominate and gentler where damage is more obvious:

- **Below ~180 Hz** — center reduction is disabled when Keep Bass is on. With Keep Bass off, only mild center reduction is applied.
- **~180 Hz to 6.5 kHz** — strongest center attenuation. This is the main vocal-target band.
- **Above ~6.5 kHz** — lighter center attenuation to retain more cymbal energy, air, ambience, and stereo detail.

The Vocal Reduction control remains 0-100%, but the internal response is now deliberately more aggressive than linear. The shortcuts are also stronger:

- **Light** — 45%
- **Karaoke** — 82%
- **Instrumental** — 100%

At 0%, Audio+ uses the untouched dry path so the karaoke graph does not color the sound when the feature is off.

### Keep Bass

Keep Bass leaves the center below roughly 180 Hz intact. This protects kick, bass fundamentals, and other low-frequency center content while the vocal band is reduced much more strongly.

Keep Bass remains enabled by default.

## Important limitations

This is still stereo DSP, not source separation. It works best when the lead vocal is strongly centered and the instrumental arrangement has useful stereo separation.

Results may still be limited when:

- the source is mono;
- vocals are panned, doubled, or spread in stereo;
- vocal reverb/delay is wide;
- centered guitars, snare, synths, or other instruments occupy the same band;
- unusual phase processing is already present in the master.

Aggressive Karaoke and Instrumental modes can remove more non-vocal center content than V2.2. That trade-off is intentional.

## Other V2 features

Everything from V2.1 and V2.2 remains available:

- Bass / Mid / Treble and 10-band EQ
- custom presets and per-site profiles
- Dialogue Boost
- Night Mode
- master volume and auto headroom
- peak protection
- Vocal Reduction and Keep Bass
- bypass and reset

## Audio graph

```text
Tab capture
  -> Bass / Mid / Treble
  -> 10-band EQ
  -> Dialogue shaping
  -> Frequency-selective Vocal Reduction
       -> low band <180 Hz
       -> aggressive vocal band 180 Hz-6.5 kHz
       -> gentler air band >6.5 kHz
  -> Preamp + auto headroom
  -> Night Mode compressor
  -> Master volume
  -> Peak protection
  -> Output
```

Bypass neutralizes EQ, Dialogue Boost, Vocal Reduction, Night Mode, gain changes, and limiter ratio for a cleaner original/processed comparison.

## Persistence

Vocal Reduction and Keep Bass remain normal Audio+ settings. They persist globally and inside per-site profiles. Reset returns Vocal Reduction to 0% and Keep Bass to On.

## Run locally

```bash
npm test
```

Then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, select this repository, play media in a normal tab, and click **Enable Audio+**.

## V2.2.1 manual acceptance test

- 0% Vocal Reduction sounds neutral.
- Light, Karaoke, and Instrumental progressively reduce a centered lead vocal.
- Karaoke is audibly stronger than V2.2's previous 70% shortcut.
- Keep Bass On retains more kick and bass than Keep Bass Off.
- Cymbals and stereo ambience survive better than with full-band center cancellation.
- Mono or wide-vocal content does not crash the processor, even if cancellation is limited.
- Bypass restores approximately original stereo balance and level.
- Dialogue Boost, Night Mode, EQ, profiles, capture lifecycle, and limiter still work.

## Privacy

Audio stays on the device. V2.2.1 adds no backend, analytics, account, remote code, model download, or audio upload. See [PRIVACY.md](PRIVACY.md).

## Next

V2.3 is planned around **Smart Fix / automatic audio analysis**. AI stem separation remains outside this lightweight karaoke path.

## License

MIT
