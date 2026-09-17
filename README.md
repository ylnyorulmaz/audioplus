# Audio+

Audio+ is a local-first Chrome audio enhancement extension. It captures only the tab the user explicitly enables and processes its audio on-device.

Current version: **V3 AI Karaoke separation prototype / 0.10.0**.

## V3: client-side 2-stem MDX + WebGPU

The experimental **AI Karaoke Lab** now performs real offline 2-stem separation entirely inside Chrome using **UVR-MDX-NET-Inst_HQ_3**, ONNX Runtime Web 1.29.0, WebGPU, a browser-side STFT/iSTFT implementation, and overlap-add chunk reconstruction.

The model profile is intentionally locked instead of trying to guess arbitrary MDX settings:

- model: `UVR-MDX-NET-Inst_HQ_3.onnx`
- expected SHA-256: `317554b07fe1ea5279a77f2b1520a41ea4b93432560c4ffd08792c30fddf9adc`
- sample rate: 44,100 Hz
- FFT size: 6,144
- hop: 1,024
- `dim_f`: 3,072
- `dim_t`: 256
- model tensor: `float32 [1, 4, 3072, 256]`
- channel layout: L real, L imaginary, R real, R imaginary
- first 3 frequency bins zeroed before inference
- primary model stem: Instrumental
- output compensation: 1.022
- Vocals stem: original mix minus compensated Instrumental

These values mirror the UVR MDX model data and processing path rather than being inferred from filename alone.

### Real pipeline

```text
Local audio file
  -> browser decode / 44.1 kHz stereo
  -> UVR-style overlapping ~5.9 s chunks
  -> centered periodic-Hann STFT
  -> [1,4,3072,256] complex-as-channels tensor
  -> ONNX Runtime WebGPU
  -> predicted Instrumental spectrogram
  -> iSTFT
  -> 1.022 compensation
  -> overlap-add reconstruction
  -> Instrumental WAV
  -> original - Instrumental
  -> Vocals WAV
```

Because 6,144 is not a power of two, Audio+ uses a mixed-radix FFT: `6144 = 3 × 2048`. The inner radix-2 transforms use the pinned MIT-licensed `fft.js` package; Audio+ combines the three 2,048-point transforms with radix-3 twiddle factors.

### AI Karaoke Lab workflow

1. Open Audio+ and choose **AI Karaoke Lab · Experimental**.
2. Check WebGPU support.
3. Select your local `UVR-MDX-NET-Inst_HQ_3.onnx` file.
4. Audio+ verifies the exact SHA-256 and graph shape before enabling separation.
5. Optionally benchmark the real MDX tensor shape on WebGPU.
6. Choose a local audio file, up to 10 minutes in this prototype.
7. Run **Separate Vocals + Instrumental**.
8. Preview or download the locally generated WAV stems.

No model or audio bytes are uploaded.

### Why the model is still selected locally

Audio+ does not bundle or automatically download the ~66.8 MB model weight yet. Public mirrors label the model/repositories MIT, but the extension keeps the weight user-selected until redistribution provenance is treated as a separate release decision. The expected SHA-256 prevents accidentally running a different MDX model with the wrong DSP profile.

### Current boundary

The V3 lab now proves **real client-side separation**, not merely synthetic ONNX inference. It is still an offline-file prototype. Live tab AI Karaoke requires a streaming/look-ahead execution path that continuously buffers tab PCM, separates ahead of playback, and handles underruns/navigation. The existing lightweight **Fast Karaoke** DSP remains the instant fallback and is unchanged.

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

The V2 fast path uses frequency-selective stereo center attenuation. It remains much cheaper than AI separation and works without WebGPU, but mono/off-center/doubled/reverb-heavy vocals may remain.

## Build and run locally

V3 has a build step because ONNX Runtime JavaScript/WASM must be packaged with the Manifest V3 extension rather than loaded from a CDN.

```bash
npm install
npm run build
npm test
```

Then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this repository. Keep the generated `dist/` and `vendor/` directories present while loading the extension.

## V3 acceptance test

- `npm run build` creates `dist/ai-karaoke-lab.js` and local `vendor/ort/` runtime assets.
- Main Audio+ V2 processing still behaves normally.
- AI Karaoke Lab reports WebGPU capability.
- The exact Inst HQ 3 model hash and `[1,4,3072,256]` tensor contract are enforced.
- The 6,144-point mixed-radix FFT passes deterministic round-trip testing.
- A local audio file can be separated into playable/downloadable Instrumental and Vocals WAV files.
- Progress and cancellation remain responsive between chunks.
- No network fetch is used for model or audio processing.
- Releasing the model frees the inference session.

CI validates buildability, packaged runtime assets, deterministic DSP/profile tests, and JavaScript syntax. Actual WebGPU model execution and listening quality still require a compatible Chrome/GPU machine.

## Privacy and MV3 packaging

Audio+, Smart Fix, spectrum analysis, and V3 separation remain local. There is no backend, account, analytics, telemetry, model upload, or audio upload.

Manifest V3 does not permit remotely hosted executable extension code, so ONNX Runtime JavaScript/WASM is built into the extension package. See [PRIVACY.md](PRIVACY.md).

## License

Audio+ is MIT licensed. `onnxruntime-web` and `fft.js` are separately licensed dependencies. Model-weight licensing/provenance remains a separate distribution concern from the extension's own license.
