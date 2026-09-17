# Audio+

Audio+ is a local-first Chrome audio enhancement extension. It captures only the tab the user explicitly enables and processes its audio on-device.

Current version: **V3.2 Live AI Karaoke beta / 0.11.0**.

## V3.2: bounded Live AI Karaoke beta

Audio+ can now feed a captured browser tab into the verified **UVR-MDX-NET-Inst_HQ_3** WebGPU pipeline continuously instead of limiting AI separation to local files.

The live path is deliberately guarded so it cannot grow memory/latency without bounds:

- the verified HQ3 model is selected once in AI Karaoke Lab, SHA-256 checked, then stored locally in extension IndexedDB;
- the live model session runs in a dedicated Worker so STFT / ONNX WebGPU / iSTFT does not sit on the normal popup/audio-control path;
- input uses a fixed ~5.9 second HQ3 model window;
- a three-window hard-cap keeps the PCM ring buffer below roughly 18 seconds;
- the first completed chunk is also the real device benchmark;
- **RTF <= 0.6×** is healthy;
- **RTF 0.6–1.0×** is allowed but shown as near the live limit;
- **RTF > 1.0×** immediately aborts AI mode;
- queue underrun or ring-buffer overflow also aborts AI mode;
- on abort, Audio+ restores the existing normal/Fast Karaoke audio path instead of leaving silence or an ever-growing queue.

### Live pipeline

```text
Captured tab audio
  -> separate 44.1 kHz AI AudioContext
  -> bounded stereo ring buffer
  -> overlapping 6144 / hop-1024 MDX window
  -> dedicated Worker
       -> STFT
       -> [1,4,3072,256]
       -> ONNX Runtime WebGPU
       -> iSTFT
       -> Instrumental
  -> short scheduled Instrumental queue
  -> peak limiter
  -> speakers
```

The normal Audio+ graph keeps playing while the first AI chunk is buffered and benchmarked. Only after the first chunk passes the RTF gate does Audio+ temporarily mute the normal graph. If AI later falls behind, normal audio is restored.

### Important latency boundary

`UVR-MDX-NET-Inst_HQ_3` needs about 5.9 seconds of context per model input. Therefore this beta is genuinely continuous tab processing, but it is **not low-latency video-synchronized karaoke**. The AI output is delayed by multiple seconds relative to the source tab.

That makes this beta most appropriate for **YouTube Music, Spotify Web, SoundCloud, radio/music streams, or cases where picture sync is not important**. On a YouTube music video, vocals can be removed continuously but lip-sync / on-screen lyric sync will not be preserved. Solving that requires a much lower-context separator or deeper control of media playback timing; the extension does not pretend otherwise.

## V3.1: verified client-side 2-stem MDX + WebGPU

AI Karaoke Lab performs real offline 2-stem separation entirely inside Chrome using **UVR-MDX-NET-Inst_HQ_3**, ONNX Runtime Web 1.29.0, WebGPU, browser-side STFT/iSTFT, and overlap-add reconstruction.

Locked model profile:

- model: `UVR-MDX-NET-Inst_HQ_3.onnx`
- expected SHA-256: `317554b07fe1ea5279a77f2b1520a41ea4b93432560c4ffd08792c30fddf9adc`
- sample rate: 44,100 Hz
- FFT size: 6,144
- hop: 1,024
- `dim_f`: 3,072
- `dim_t`: 256
- tensor: `float32 [1, 4, 3072, 256]`
- channel layout: L real, L imaginary, R real, R imaginary
- first 3 frequency bins zeroed before inference
- primary stem: Instrumental
- output compensation: 1.022
- Vocals: original mix minus compensated Instrumental

Because 6,144 is not a power of two, Audio+ uses a mixed-radix FFT: `6144 = 3 × 2048`. The inner radix-2 transforms use pinned `fft.js`; Audio+ combines them with radix-3 twiddle factors.

### AI Karaoke Lab workflow

1. Open **AI Karaoke Lab**.
2. Check WebGPU support.
3. Select local `UVR-MDX-NET-Inst_HQ_3.onnx`.
4. Audio+ verifies the exact SHA-256 and graph shape.
5. The verified model is installed locally in extension IndexedDB for Live AI Karaoke.
6. Optionally benchmark the real MDX tensor or separate a local file into Instrumental + Vocals WAV stems.

No model or audio bytes are uploaded.

## Fast Karaoke and the V2 audio toolkit

The lightweight path remains intact and is still the fallback on old/unsupported hardware:

- Bass / Mid / Treble controls
- 10-band manual EQ and preamp
- presets and per-site profiles
- Dialogue Boost
- Night Mode
- frequency-selective Fast Karaoke / Vocal Reduction
- Keep Bass
- Smart Fix
- live spectrum analyzer
- volume, Auto Headroom, bypass, reset, and peak protection

Fast Karaoke is stereo DSP rather than source separation, so it is less effective on some mixes but starts instantly and does not require WebGPU.

## Build and run locally

```bash
npm install
npm run build
npm test
```

Then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this repository. Keep generated `dist/` and `vendor/` directories present.

## V3.2 acceptance test

- build creates both `dist/ai-karaoke-lab.js` and `dist/live-ai-worker.js`;
- verified HQ3 weights persist locally after Lab closes;
- Live AI requires normal Audio+ capture to already be enabled;
- normal audio continues during first-chunk buffering;
- first real chunk produces an RTF measurement;
- RTF > 1.0× triggers fallback rather than unbounded buffering;
- ring capacity is fixed to three model windows;
- underrun/overflow restores normal audio;
- stopping Live AI restores the exact prior Audio+ settings;
- Fast Karaoke remains unchanged;
- no backend/model upload/audio upload is introduced.

CI validates buildability, worker packaging, deterministic DSP/profile tests, bounded live policy, and JavaScript syntax. Actual WebGPU quality and device-specific performance still require manual Chrome listening tests.

## Privacy

Audio, AI model weights, PCM chunks, and generated stems remain local. See [PRIVACY.md](PRIVACY.md).

## License

Audio+ is MIT licensed. `onnxruntime-web` and `fft.js` are separately licensed dependencies. Model-weight licensing/provenance remains a separate distribution concern from the extension's own license.
