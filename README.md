# Audio+

Audio+ is a local-first Chrome audio enhancement extension. It captures only the tab the user explicitly enables and processes its audio on-device.

Current version: **0.16.1** (equalizer-first side panel).

## What’s shipping now

- Bass / Mid / Treble and master volume
- 10-band EQ, preamp, Auto Headroom, peak protection
- Dialogue Boost and Night Mode
- Smart Fix (local tonal analysis)
- Live spectrum
- Presets and per-site profiles
- Bypass / Reset

## Karaoke — work in progress (coming soon)

**Fast Karaoke**, **AI Karaoke**, and **AI Lab** are **not enabled in the current public UI**. They are marked **Work in progress / Coming soon**.

Related code and tests may still exist in the repository so the feature can be re-enabled later. Do not treat store copy, screenshots, or the live side panel as shipping karaoke today.

Planned directions (not product promises yet):

- Fast Karaoke: lightweight stereo center / vocal reduction DSP
- AI Karaoke: local ONNX / WebGPU instrumental separation for capable devices
- AI Lab: advanced local file diagnostics

Until karaoke ships again, use Tone, EQ, Dialogue, Night Mode, and Smart Fix for everyday listening.

## Build and run locally

```bash
npm install
npm run build
npm test
```

Then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this repository. Keep generated `dist/` and `vendor/` directories present when working on AI experimental paths.

## Privacy

Audio processing stays on-device. See [PRIVACY.md](PRIVACY.md).

## License

Audio+ is MIT licensed. `onnxruntime-web` and `fft.js` are separately licensed dependencies. Model-weight licensing/provenance remains a separate distribution concern from the extension's own license.
