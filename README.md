# Audio+

Audio+ is a lightweight Chrome extension that processes the audio of the current browser tab locally on the user's device.

This repository currently contains **V1 / Iteration 4**: release hardening for the manual equalizer product.

## V1 scope

- Manifest V3 Chrome extension
- User-initiated current-tab audio capture
- Persistent offscreen Web Audio processing after the popup closes
- Bass / Mid / Treble macro controls (`-12 dB` to `+12 dB`)
- 10-band graphic EQ: 32, 64, 125, 250, 500, 1k, 2k, 4k, 8k, 16k Hz
- Per-band gain from `-12 dB` to `+12 dB`
- Manual preamp (`-12 dB` to `+6 dB`)
- Auto headroom compensation based on positive EQ/tone boosts
- Master volume (`0%` to `150%`)
- Peak protection after the master-volume stage
- True bypass for processed/original comparison
- Built-in quick modes: Flat, Balanced, Bass+, Voice, Movie, Podcast, Bright
- Up to 12 locally stored custom presets
- Per-site hostname profiles
- Basic-first popup with Advanced EQ controls
- Local-only settings and processing; no backend or telemetry

Not included: karaoke/vocal reduction, Night Mode, Smart Fix, accounts, payments, analytics.

## Architecture

```text
Popup (user gesture)
  -> MV3 service worker
  -> resolve global or per-site settings
  -> chrome.tabCapture.getMediaStreamId()
  -> offscreen document
  -> getUserMedia(tab stream)
  -> AudioContext
  -> Bass / Mid / Treble filters
  -> 10 x peaking EQ filters
  -> Preamp + automatic headroom compensation
  -> Master volume
  -> Peak protection
  -> audio output
```

## Peak protection

Iteration 4 adds a conservative `DynamicsCompressorNode` safety stage after master volume. It uses a high ratio and a threshold close to digital full scale to reduce obvious hard clipping when users combine aggressive EQ boosts with volume above 100%.

This is **not** a mastering-grade brick-wall limiter and does not make arbitrary gain safe. Auto headroom remains the first line of defense. Bypass neutralizes EQ, gain changes, and the peak-protection ratio for a cleaner A/B comparison.

## Capture hardening

The offscreen processor now:

- verifies that Chrome actually returned an audio track;
- maps common capture failures to clearer messages;
- cleans up the limiter and AudioContext with the rest of the graph;
- exposes lightweight local diagnostics for debugging;
- reports unexpected AudioContext closure back to the extension state.

## Quick modes and profiles

Built-in presets describe listening goals rather than music genres: Flat, Balanced, Bass+, Voice, Movie, Podcast, and Bright. Preset switching keeps the user's master volume unchanged.

Custom presets store tone/EQ/preamp choices. Per-site profiles store full settings for a hostname such as `music.youtube.com` or `open.spotify.com`. Chrome still requires an explicit user gesture to begin tab capture.

## Run locally

There is no build step.

```bash
npm test
```

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this repository folder.
4. Open a normal media page and start playback.
5. Open Audio+ and click **Enable Audio+**.

## Iteration 4 acceptance test

- `npm test` passes.
- Audio continues after capture starts and after the popup closes.
- Presets, Tone, 10-band EQ, preamp, volume, site profiles, custom presets, bypass, and reset still work.
- Peak protection sits after master volume and reduces obvious hard clipping on aggressive settings.
- Bypass neutralizes tone/gain processing and peak-protection ratio without ending capture.
- Capture failure messages are understandable instead of exposing raw browser errors where possible.
- Closing the captured tab cleans up its processor.
- Restricted browser pages remain non-capturable.
- No backend, remote code, analytics, or host permissions are introduced.

See [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) for the manual compatibility matrix.

## Privacy

Audio+ processes audio locally in Chrome. It does not upload tab audio and V1 sends no analytics or telemetry. Settings, custom presets, and optional hostname-based profiles are stored in Chrome extension storage.

See [PRIVACY.md](PRIVACY.md).

## Known limitations

- Chrome requires a user gesture before tab capture can start.
- Peak protection is conservative Web Audio dynamics processing, not a mastering-grade true-peak limiter.
- Very aggressive EQ/preamp/volume combinations can still sound distorted because distortion may already exist in the source or earlier in the signal chain.
- Protected/DRM playback environments may behave differently.
- Minimum Chrome version is 116.

## Next

V1 manual equalizer scope is now feature-complete enough for real-user validation. Higher-value product experiments should be separate follow-up iterations:

- Vocal Reduction / Karaoke
- Dialogue / Night Mode
- Smart Fix / automatic audio analysis

## License

MIT
