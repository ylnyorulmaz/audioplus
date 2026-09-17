# Audio+ Privacy

Audio+ is designed to process browser audio and user-selected local audio entirely on the user's device.

## Data Audio+ processes

- Audio from the browser tab the user explicitly chooses to process.
- Equalizer and audio-control settings.
- User-created preset names and preset settings.
- Hostnames for sites where the user explicitly enables a site-specific profile.
- Short-lived local measurements used by Smart Fix, such as broad spectral energy, RMS, and peak level.
- Short-lived live-spectrum measurements shown while the popup's Advanced panel is open.
- In AI Karaoke Lab, an ONNX model file the user explicitly chooses from their own device.
- In AI Karaoke Lab, an audio file the user explicitly chooses for local stem separation.

## Where processing happens

Tab audio is processed locally in Chrome with the Web Audio API. Smart Fix analysis and the live spectrum use the same local tab-audio processing graph.

AI Karaoke Lab uses packaged ONNX Runtime Web code, packaged DSP code, and WebGPU on the user's device. The selected ONNX model is read locally with the browser file API. Selected audio is decoded locally, transformed to MDX spectrogram tensors, inferred locally through WebGPU, reconstructed locally, and exposed as local browser Blob URLs for preview/download.

Audio+ does not upload, transmit, sell, or share captured tab audio, local audio files, generated stems, audio-analysis measurements, or user-selected ONNX model bytes.

## Storage

Audio+ uses Chrome extension storage for:

- global audio settings;
- custom presets;
- per-site profile settings;
- Smart Fix enabled state and its correction curve;
- temporary per-tab runtime state and the latest Smart Fix explanation.

Live spectrum snapshots are not stored as a history. AI Karaoke Lab does not persist the selected ONNX model, selected audio, or generated stem audio in extension storage. Model sessions and generated Blob URLs are released when the lab page is closed or explicitly released.

These settings remain inside Chrome's extension storage unless the user removes the extension or clears its data.

## Network access

Audio+ does not require a backend service and does not send analytics or telemetry. AI Karaoke Lab does not use a remote LLM, remote audio-processing service, remote model download, model upload, or audio upload.

Executable ONNX Runtime JavaScript/WASM is packaged locally with the extension rather than loaded from a CDN.

## Permissions

- `activeTab`: identify the tab the user explicitly activates Audio+ on.
- `tabCapture`: capture audio from that user-selected tab.
- `offscreen`: keep the local Web Audio processing graph alive after the popup closes.
- `storage`: remember settings, presets, Smart Fix curves, and per-site profiles locally.

AI Karaoke Lab adds no new Chrome permission.

## Contact

For bugs or privacy questions, open an issue in this repository.
