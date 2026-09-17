# Audio+ Privacy

Audio+ processes browser audio locally on the user's device.

## Data Audio+ processes

- Audio from the browser tab the user explicitly chooses to process.
- Equalizer, enhancement, Karaoke, preset, and site-profile settings.
- Short-lived local measurements used by Smart Fix and the live spectrum.
- In AI Karaoke, short bounded PCM chunks from the selected browser tab and locally reconstructed Instrumental audio.
- In Advanced AI diagnostics, local audio files the user explicitly chooses for stem separation.

## AI model download and local storage

On the first use of AI Karaoke, Audio+ automatically downloads the `UVR-MDX-NET-Inst_HQ_3.onnx` model from Hugging Face. This is model data, not remotely hosted extension code. Audio+ verifies the model against the pinned SHA-256 before installing it.

The verified model is stored locally in the extension origin's IndexedDB so the user does not have to choose or reinstall it on every use. Model inference then runs locally with packaged ONNX Runtime Web code and WebGPU.

Audio+ does not upload the model, captured audio, local audio files, generated stems, Smart Fix measurements, or spectrum measurements.

## Where processing happens

Tab audio is processed locally in Chrome with Web Audio. Smart Fix and spectrum analysis use the local tab-audio graph.

AI Karaoke performs STFT, ONNX inference, iSTFT, and reconstruction on-device. Its live PCM ring buffer is hard-bounded. If the device cannot keep up, playback underruns, or the buffer reaches its limit, AI mode stops and the normal Audio+ audio path is restored.

## Storage

Audio+ uses Chrome extension storage for settings, custom presets, per-site profiles, Smart Fix state, and temporary per-tab runtime state. The verified AI model is stored in IndexedDB.

Captured PCM chunks, live spectrum snapshots, local audio files, and generated stem audio are not kept as histories.

## Network access

Audio+ has no backend service, account system, analytics, telemetry, remote LLM, remote audio processing, or remote inference.

The only AI-related network request in normal use is the first-use download of the pinned HQ3 model from `huggingface.co`. Executable ONNX Runtime JavaScript/WASM and Audio+ DSP code are packaged locally with the extension.

## Permissions

- `activeTab`: identify the tab the user explicitly opens Audio+ for.
- `tabCapture`: capture audio from that selected tab.
- `offscreen`: keep local audio processing alive while the control window remains independent of page focus.
- `storage`: remember settings and temporary runtime state locally.
- `https://huggingface.co/*`: download the pinned AI model on first use.

## Contact

For bugs or privacy questions, open an issue in this repository.
