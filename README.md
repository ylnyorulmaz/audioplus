# Audio+

Audio+ is a lightweight Chrome extension that processes the audio of the current browser tab locally on the user's device.

This repository currently contains **V1 / Iteration 1**: the smallest working audio engine.

## Iteration 1 scope

- Manifest V3 Chrome extension
- User-initiated current-tab audio capture
- Persistent offscreen Web Audio processing after the popup closes
- Bass control (`-12 dB` to `+12 dB`) using a low-shelf filter at 120 Hz
- Master volume (`0%` to `150%`)
- Bypass
- Reset
- Per-tab runtime state for the current Chrome session
- No server and no audio upload

Not included yet: 10-band EQ, presets, karaoke, smart fix, spectrum visualization, accounts, payments, analytics.

## Architecture

```text
Popup (user gesture)
  -> MV3 service worker
  -> chrome.tabCapture.getMediaStreamId()
  -> offscreen document
  -> getUserMedia(tab stream)
  -> AudioContext
  -> BiquadFilterNode (lowshelf / bass)
  -> GainNode (master volume)
  -> audio output
```

The offscreen document exists because Manifest V3 service workers do not expose the DOM/Web Audio environment needed for a persistent `AudioContext`.

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
10. Move the Bass slider. The difference should be immediately audible.

## Iteration 1 acceptance test

- Audio continues playing after Audio+ is enabled.
- `Bass +12 dB` is clearly different from `Bass -12 dB` on bass-heavy material.
- Volume changes from 0% to 150%.
- Bypass returns to approximately original tonal balance and 100% gain without ending capture.
- Closing the popup does not stop processing.
- Navigating to another video in the same captured tab does not stop processing.
- Disable stops processing and returns playback control to the tab.
- Closing the captured tab cleans up its processor.

## Known limitations

- Chrome requires a user gesture before tab capture can begin. Audio+ cannot silently enable itself on arbitrary tabs.
- Chrome replaces the tab's direct audio playback while it is being captured; Audio+ explicitly plays the captured stream back through Web Audio.
- Volume above 100% can clip on loud source material. Peak protection/limiting is planned for a later iteration.
- Some protected/DRM playback environments may behave differently and are not part of Iteration 1's compatibility guarantee.
- Minimum Chrome version is currently 116 because the MV3 service-worker-to-offscreen stream-ID flow is supported there.

## Next iteration

V1 / Iteration 2 will add:

- 10-band graphic EQ
- Bass / Mid / Treble macro controls
- Preamp
- Basic headroom protection
- Persistent EQ settings

## Privacy

Audio+ V1 processes audio locally in the browser. It does not upload tab audio to a server.

## License

MIT
