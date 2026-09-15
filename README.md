# Audio+

Audio+ is a local-first Chrome audio enhancement extension. It captures only the tab the user explicitly enables and processes its audio on-device with the Web Audio API.

Current version: **V2.1 / 0.5.0**.

## V2.1 features

Everything from V1 remains available:

- Bass / Mid / Treble controls
- 10-band graphic EQ
- preamp and auto headroom
- master volume up to 150%
- peak protection
- quick listening presets
- custom presets
- per-site profiles
- bypass and reset

V2.1 adds two practical enhancement tools:

### Dialogue Boost

A 0-100% control that combines a gentle low-mid cut around 280 Hz with a presence lift around 2.6 kHz. At 100%, the current curve is approximately -2 dB low-mid and +3 dB presence. Auto headroom includes the dialogue presence boost in its compensation estimate.

### Night Mode

Three dynamics modes:

- **Off** — neutral 1:1 dynamics stage
- **Light** — moderate compression for everyday evening viewing
- **Strong** — stronger compression for large dialogue/action level differences

Night Mode runs before master volume and the existing peak-protection stage. It is intentionally separate from the limiter: Night Mode changes listening dynamics; peak protection remains a safety stage.

## Audio graph

```text
Tab capture
  -> Bass / Mid / Treble
  -> 10-band EQ
  -> Dialogue low-mid cut
  -> Dialogue presence
  -> Preamp + auto headroom
  -> Night Mode compressor
  -> Master volume
  -> Peak protection
  -> Output
```

Bypass neutralizes EQ/tone/dialogue gain, preamp/master changes, Night Mode compression, and peak-protection ratio for a cleaner original/processed comparison.

## Persistence

Dialogue Boost and Night Mode are normal Audio+ settings, so they participate in global settings and per-site profiles. Reset returns both to Off/0 along with the V1 controls.

Built-in and custom tonal presets intentionally remain focused on EQ/tone; applying Bass+, Voice, Movie, etc. does not unexpectedly switch Night Mode.

## Run locally

There is no build step.

```bash
npm test
```

Then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, select this repository, play media in a normal tab, and click **Enable Audio+**.

## V2.1 manual acceptance test

- Dialogue Boost is clearly audible on speech without extreme coloration.
- 0% Dialogue Boost is neutral.
- Night Off is neutral; Light and Strong progressively reduce large level jumps.
- Night Mode does not replace or disable peak protection.
- Bypass approximately restores original tone, level, and dynamics.
- Dialogue/Night settings persist globally and in site profiles.
- Reset returns Dialogue Boost to 0% and Night Mode to Off.
- V1 EQ, presets, profiles, volume, capture lifecycle, and limiter still work.
- Test long playback and same-tab navigation on YouTube, YouTube Music, and Spotify Web.

## Privacy

Audio stays on the device. V2.1 adds no backend, analytics, account, remote code, or audio upload. See [PRIVACY.md](PRIVACY.md).

## Not in V2.1

- Vocal Reduction / Karaoke
- Smart Fix / automatic audio analysis
- AI stem separation

## License

MIT
