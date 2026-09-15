# Audio+

Audio+ is a lightweight Chrome extension that processes the audio of the current browser tab locally on the user's device.

This repository currently contains **V1 / Iteration 3**: the product-UX layer on top of the tab-capture and equalizer engine.

## Iteration 3 scope

- Manifest V3 Chrome extension
- User-initiated current-tab audio capture
- Persistent offscreen Web Audio processing after the popup closes
- Bass / Mid / Treble macro controls (`-12 dB` to `+12 dB`)
- 10-band graphic EQ: 32, 64, 125, 250, 500, 1k, 2k, 4k, 8k, 16k Hz
- Per-band gain from `-12 dB` to `+12 dB`
- Manual preamp (`-12 dB` to `+6 dB`)
- Auto headroom compensation based on positive EQ/tone boosts
- Master volume (`0%` to `150%`)
- True bypass for quick processed/original comparison
- Built-in quick modes: Flat, Balanced, Bass+, Voice, Movie, Podcast, Bright
- Up to 12 locally stored custom presets
- Per-site profiles such as separate settings for YouTube, YouTube Music, or Spotify Web
- Basic-first popup with the 10-band EQ and preamp moved under Advanced
- Clearer unsupported-tab, starting, active, stopped, success, and error states
- Persistent global settings, custom presets, and site profiles via `chrome.storage.local`
- Per-tab runtime/capture state via `chrome.storage.session`
- No server and no audio upload

Not included yet: karaoke/vocal reduction, night mode/compression, Smart Fix, spectrum visualization, accounts, payments, analytics.

## Architecture

```text
Popup (user gesture)
  -> MV3 service worker
  -> resolve global or per-site settings
  -> chrome.tabCapture.getMediaStreamId()
  -> offscreen document
  -> getUserMedia(tab stream)
  -> AudioContext
  -> Bass lowshelf macro
  -> Mid peaking macro
  -> Treble highshelf macro
  -> 10 x peaking EQ filters
  -> Preamp + automatic headroom compensation
  -> Master volume
  -> audio output
```

The offscreen document exists because Manifest V3 service workers do not expose the DOM/Web Audio environment needed for a persistent `AudioContext`.

## Quick modes

Built-in presets intentionally describe listening goals rather than music genres:

- **Flat** — neutral processing
- **Balanced** — light general-purpose shaping
- **Bass+** — stronger low end
- **Voice** — brings speech/presence forward
- **Movie** — modest low-end and dialogue lift
- **Podcast** — reduces boom and emphasizes speech
- **Bright** — adds high-frequency presence

Built-in and custom presets change tonal settings but deliberately preserve the user's current master volume. This avoids surprise volume jumps while switching presets.

## Custom presets

The current tone, 10-band EQ, preamp, and auto-headroom settings can be saved as a named custom preset. Audio+ stores up to 12 custom presets locally in Chrome. Saving a preset with the same name updates that preset.

Custom presets do not store master volume or bypass state.

## Per-site profiles

Audio+ has one global fallback profile. On a normal `http` or `https` page, **Remember settings for this site** can be enabled.

When enabled:

- the current settings are saved for that hostname;
- future changes on that hostname update only that site profile;
- opening Audio+ on that site restores the site profile;
- other sites continue using their own profile or the global fallback.

Example:

```text
music.youtube.com -> Bass+
youtube.com       -> Voice
open.spotify.com  -> Balanced
other sites       -> Global fallback
```

Chrome still requires an explicit user gesture to start tab capture. Site profiles restore settings, not silent capture.

## Auto headroom

Positive EQ boosts can push digital audio above available headroom and cause clipping. When **Auto headroom** is enabled, Audio+ estimates the largest positive tone/EQ boost and applies an opposite preamp compensation before master volume.

This is intentionally conservative. It is not a brick-wall limiter. Peak protection/limiting remains planned for a later iteration.

## Run locally

There is no build step.

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select this repository folder.
6. Open a YouTube, YouTube Music, Spotify Web, or another normal audio/video tab.
7. Start playback.
8. Click the Audio+ extension icon.
9. Click **Enable Audio+**.
10. Try Quick modes, Tone controls, site profiles, and the Advanced 10-band EQ.

## Iteration 3 acceptance test

- Audio continues playing after Audio+ is enabled.
- Flat, Bass+, Voice, Podcast, Bright, and the other built-in presets audibly differ on suitable material.
- Switching presets does not reset master volume.
- Manual Tone or Advanced EQ edits update the active preset indicator.
- A custom preset can be saved, applied, overwritten by saving the same name, and deleted.
- Custom presets survive closing Chrome.
- Enabling a site profile stores the current settings for the current hostname.
- Two different sites can retain different settings.
- Disabling a site profile removes the site-specific override and leaves the current session unchanged.
- Global settings remain the fallback for sites without profiles.
- 10-band EQ, preamp, auto-headroom, bypass, reset, and volume continue working from Iteration 2.
- Chrome internal/restricted pages show a clear unsupported state instead of attempting capture.
- Closing the popup does not stop active processing.
- Closing the captured tab cleans up its processor.

## Known limitations

- Chrome requires a user gesture before tab capture can begin. Audio+ cannot silently enable itself on arbitrary tabs.
- Chrome replaces the tab's direct audio playback while it is being captured; Audio+ explicitly plays the captured stream back through Web Audio.
- Site profiles are hostname-based and are restored when Audio+ resolves that tab context; they do not silently start capture.
- Auto headroom is an estimate, not a true peak limiter. Master volume above 100% can still clip loud source material.
- Some protected/DRM playback environments may behave differently and are not part of the current compatibility guarantee.
- Minimum Chrome version is 116 because the MV3 service-worker-to-offscreen stream-ID flow is supported there.

## Next

V1 now has the essential manual equalizer product flow. Later product iterations can add higher-value differentiators:

- Vocal Reduction / Karaoke
- Dialogue / Night Mode with dynamics processing
- Peak limiter
- Smart Fix / automatic audio analysis

These should remain separate from the basic equalizer until the current UX is validated with real users.

## Privacy

Audio+ processes audio locally in the browser. It does not upload tab audio to a server. Settings, presets, and site profiles are stored locally in Chrome.

## License

MIT
