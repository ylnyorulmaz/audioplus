# Audio+

Audio+ is a local-first Chrome audio enhancement extension. It captures only the tab the user explicitly enables and processes its audio on-device.

Current version: **V3 AI Karaoke prototype / 0.9.0**.

## V3 prototype: client-side 2-stem ONNX + WebGPU

V3 starts with an intentionally narrow **AI Karaoke Lab**. The goal is to prove that a 2-stem source-separation ONNX model can be loaded and benchmarked entirely inside the Chrome extension before Audio+ attempts real-time stem playback.

The prototype currently provides:

- WebGPU capability detection;
- ONNX Runtime Web 1.29.0 bundled locally with the extension;
- local `.onnx` file selection with no upload;
- strict WebGPU session creation;
- model input/output metadata inspection;
- a bounded synthetic benchmark for one fixed-shape `float32` input;
- model/session release controls;
- the existing Fast Karaoke DSP as the fallback product path.

The prototype **does not yet separate the currently playing song**. MDX-style models require a model-specific audio pipeline around ONNX inference: STFT, chunking, overlap-add, model inference, iSTFT, buffering, and finally playback routing. The lab exists to validate the browser/runtime/model layer before those pieces are connected.

No model weights are bundled in this prototype. A user chooses a local ONNX file. Before Audio+ ships or automatically downloads a specific model, that model's weight provenance and redistribution license must be verified independently from the ONNX Runtime library license.

### AI Karaoke Lab workflow

1. Open Audio+ and choose **AI Karaoke Lab · Experimental**.
2. Check whether the browser/device exposes WebGPU.
3. Choose a local `.onnx` model.
4. Inspect its input/output graph metadata.
5. If it has one fixed-shape float32 input within the prototype memory limit, run the synthetic WebGPU benchmark.
6. Use the result to decide whether that exact model/profile is viable for the next audio-pipeline prototype.

### Planned next step

Once one licensed 2-stem model profile is locked:

```text
Tab PCM
  -> chunk + overlap
  -> STFT / model-specific tensor packing
  -> ONNX Runtime WebGPU
  -> Vocals + Instrumental tensors
  -> iSTFT / overlap-add
  -> look-ahead buffer
  -> Instrumental playback
```

The target UX is a local **AI Karaoke** mode with a short preparation/look-ahead buffer rather than pretending a source-separation model is a zero-latency Web Audio filter.

## V2 final feature set

The existing lightweight audio toolkit remains intact:

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

### Smart Fix

**FIX THIS AUDIO** analyzes roughly 1.3 seconds of original tab input and measures RMS/peak plus broad spectral regions. A deterministic rule engine scores practical conditions such as Muddy, Thin, Harsh, and Quiet. Automatic correction uses a dedicated 10-band layer and each Smart Fix band is limited to ±3 dB.

### Fast Karaoke / Vocal Reduction

The V2 fast path uses frequency-selective stereo center attenuation:

- below ~180 Hz: Keep Bass can leave centered low-frequency content intact;
- ~180 Hz to 6.5 kHz: strongest center attenuation;
- above ~6.5 kHz: gentler attenuation to retain more cymbals, air, and ambience.

Shortcuts remain Light 45%, Karaoke 82%, and Instrumental 100%. This is stereo DSP, not source separation, so mono/off-center/doubled/reverb-heavy vocals may remain.

## Build and run locally

V3 adds a build step because executable ONNX Runtime JavaScript/WASM must be packaged with the Manifest V3 extension rather than loaded from a CDN.

```bash
npm install
npm run build
npm test
```

Then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this repository. Keep the generated `dist/` and `vendor/` directories present while loading the extension.

## V3 prototype acceptance test

- `npm run build` creates `dist/ai-karaoke-lab.js` and local `vendor/ort/` WASM/runtime assets.
- Main Audio+ V2 processing still loads and behaves normally.
- **Open AI Karaoke Lab** opens a stable extension page rather than trying to run a large model inside the popup lifecycle.
- Check WebGPU reports a compatible adapter on a supported machine.
- Selecting a local ONNX file creates a WebGPU session or reports a useful compatibility error.
- Model bytes are read with `File.arrayBuffer()` and are not fetched or uploaded.
- Input/output metadata is displayed.
- Fixed-shape float32 models can run the bounded synthetic benchmark.
- Dynamic-shape or unsupported models are reported honestly instead of receiving invented benchmark numbers.
- Closing/releasing the model frees the inference session.

CI validates buildability, packaged runtime assets, deterministic tests, and JavaScript syntax. Real WebGPU inference still requires a compatible Chrome/GPU machine and therefore remains a manual prototype test.

## Privacy and MV3 packaging

Audio+, Smart Fix, spectrum analysis, and this V3 model lab remain local. The V3 prototype adds no server, account, analytics, telemetry, or audio upload.

Manifest V3 does not permit remotely hosted executable extension code, so ONNX Runtime JavaScript/WASM is built into the extension package. The lab accepts model weights as local data from the user's file picker. See [PRIVACY.md](PRIVACY.md).

## License

Audio+ is MIT licensed. Third-party runtime/model licenses remain their own; do not infer a model-weight license from the license of the app or runtime loading it.
