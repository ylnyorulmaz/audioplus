# Audio+

Audio+ is a lightweight Chrome extension that processes the audio of the current browser tab locally on the user's device.

This repository currently contains **V1 / Iteration 2**: a usable browser equalizer built on top of the Iteration 1 capture engine.

## Iteration 2 scope

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
- Reset
- Persistent audio settings via `chrome.storage.local`
- Per-tab runtime/capture state via `chrome.storage.session`
- No server and no audio upload

Not included yet: presets, per-site profiles, karaoke, night mode, smart fix, spectrum visualization, accounts, payments, analytics.

## Architecture

```text
Popup (user gesture)
  -> MV3 service worker
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

## Auto headroom

Positive EQ boosts can push digital audio above available headroom and cause clipping. When **Auto headroom** is enabled, Audio+ estimates the largest positive tone/EQ boost and applies an opposite preamp compensation before master volume.

This is intentionally conservative. It preserves relative EQ changes rather than promising a brick-wall limiter. Peak protection/limiting remains planned for a later iteration.

## Persistent settings

Tone, EQ, preamp, headroom, volume, and bypass settings are stored locally in Chrome and reused when Audio+ is opened again. Capture itself never starts automatically: Chrome still requires the user to enable tab capture.

Per-site profiles are intentionally deferred to Iteration 3.

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
10. Try Bass/Mid/Treble, then expand **Advanced EQ** for the 10-band controls.

## Iteration 2 acceptance test

- Audio continues playing after Audio+ is enabled.
- Bass, Mid, and Treble controls are immediately audible.
- Every 10-band EQ slider changes only its intended frequency region enough to be audible on appropriate material.
- Preamp changes overall level before the master volume stage.
- Enabling Auto headroom shows negative compensation when positive EQ boosts are added.
- Bypass returns to approximately original tonal balance and 100% gain without ending capture.
- Reset returns all EQ/tone/preamp controls to flat, volume to 100%, headroom ON, and bypass OFF.
- Closing and reopening the popup preserves settings.
- Restarting Chrome preserves audio settings, but does not silently restart capture.
- Closing the popup does not stop active processing.
- Navigating to another video in the same captured tab does not stop processing.
- Closing the captured tab cleans up its processor.

## Known limitations

- Chrome requires a user gesture before tab capture can begin. Audio+ cannot silently enable itself on arbitrary tabs.
- Chrome replaces the tab's direct audio playback while it is being captured; Audio+ explicitly plays the captured stream back through Web Audio.
- Auto headroom is an estimate, not a true peak limiter. Master volume above 100% can still clip loud source material.
- Some protected/DRM playback environments may behave differently and are not part of the current compatibility guarantee.
- Minimum Chrome version is 116 because the MV3 service-worker-to-offscreen stream-ID flow is supported there.

## Next iteration

V1 / Iteration 3 will focus on product UX:

- Presets
- Custom presets
- Per-site profiles
- Basic / Advanced UI refinement
- Better error states and enable/disable UX

Karaoke and Smart Fix remain later product iterations, not V1 scope.

## Privacy

Audio+ processes audio locally in the browser. It does not upload tab audio to a server. Settings are stored locally in Chrome.

## License

MIT
