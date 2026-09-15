# Audio+ Privacy

Audio+ is designed to process browser-tab audio locally on the user's device.

## Data Audio+ processes

- Audio from the browser tab the user explicitly chooses to process.
- Equalizer and audio-control settings.
- User-created preset names and preset settings.
- Hostnames for sites where the user explicitly enables a site-specific profile.
- Short-lived local measurements used by Smart Fix, such as broad spectral energy, RMS, and peak level.
- Short-lived live-spectrum measurements shown while the popup's Advanced panel is open.
- In the experimental AI Karaoke Lab, an ONNX model file the user explicitly chooses from their own device.

## Where processing happens

Tab audio is processed locally in Chrome with the Web Audio API. Smart Fix analysis and the live spectrum use the same local tab-audio processing graph.

The V3 AI Karaoke Lab uses packaged ONNX Runtime Web code and WebGPU on the user's device. The selected ONNX model is read locally with the browser file API for the lifetime of the lab page/session.

Audio+ does not upload, transmit, sell, or share captured tab audio, audio-analysis measurements, or user-selected ONNX model bytes.

## Storage

Audio+ uses Chrome extension storage for:

- global audio settings;
- custom presets;
- per-site profile settings;
- Smart Fix enabled state and its correction curve;
- temporary per-tab runtime state and the latest Smart Fix explanation.

Live spectrum snapshots are not stored as a history. The current V3 prototype does not persist the selected ONNX model in extension storage; closing/releasing the lab session discards the in-memory model session.

These settings remain inside Chrome's extension storage unless the user removes the extension or clears its data.

## Network access

Audio+ does not require a backend service and does not send analytics or telemetry. The current V3 prototype does not use a remote LLM, remote audio-processing service, remote model download, or audio upload.

Executable ONNX Runtime JavaScript/WASM is packaged locally with the extension rather than loaded from a CDN.

## Permissions

- `activeTab`: identify the tab the user explicitly activates Audio+ on.
- `tabCapture`: capture audio from that user-selected tab.
- `offscreen`: keep the local Web Audio processing graph alive after the popup closes.
- `storage`: remember settings, presets, Smart Fix curves, and per-site profiles locally.

The V3 lab adds no new Chrome permission.

## Contact

For bugs or privacy questions, open an issue in this repository.
