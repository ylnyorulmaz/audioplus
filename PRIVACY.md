# Audio+ Privacy

Audio+ is designed to process browser audio and user-selected local audio entirely on the user's device.

## Data Audio+ processes

- Audio from the browser tab the user explicitly chooses to process.
- Equalizer and audio-control settings.
- User-created preset names and preset settings.
- Hostnames for sites where the user explicitly enables a site-specific profile.
- Short-lived local measurements used by Smart Fix, such as broad spectral energy, RMS, and peak level.
- Short-lived live-spectrum measurements shown while the popup's Advanced panel is open.
- In AI Karaoke Lab, the verified UVR-MDX-NET-Inst_HQ_3 ONNX model file the user explicitly chooses from their own device.
- In AI Karaoke Lab, an audio file the user explicitly chooses for local stem separation.
- In Live AI Karaoke beta, short bounded PCM chunks from the user-selected browser tab plus locally reconstructed Instrumental audio.

## Where processing happens

Tab audio is processed locally in Chrome with the Web Audio API. Smart Fix analysis and the live spectrum use the local tab-audio graph.

AI Karaoke uses packaged ONNX Runtime Web code, packaged DSP code, and WebGPU on the user's device. The exact HQ3 model is SHA-256 verified before use. Local-file separation and Live AI Karaoke perform STFT, ONNX inference, iSTFT, and reconstruction on-device.

Live AI Karaoke uses a dedicated local worker and a bounded in-memory ring buffer. If the model cannot keep up in real time, the buffer reaches its hard limit, or playback underruns, AI processing stops and Audio+ restores the normal local audio path.

Audio+ does not upload, transmit, sell, or share captured tab audio, local audio files, generated stems, audio-analysis measurements, or ONNX model bytes.

## Storage

Audio+ uses Chrome extension storage for:

- global audio settings;
- custom presets;
- per-site profile settings;
- Smart Fix enabled state and its correction curve;
- temporary per-tab runtime state and Live AI Karaoke status.

After the user explicitly selects and verifies the exact HQ3 model in AI Karaoke Lab, Audio+ stores a local copy of that verified model in the extension origin's IndexedDB so Live AI Karaoke can work after the Lab page closes. The model is not uploaded or fetched remotely by Audio+.

Live spectrum snapshots, captured PCM chunks, local audio files, and generated stem audio are not stored as histories. Live PCM buffers are bounded and discarded as playback advances or Live AI Karaoke stops.

## Network access

Audio+ does not require a backend service and does not send analytics or telemetry. AI Karaoke does not use a remote LLM, remote audio-processing service, remote model inference, model upload, or audio upload.

Executable ONNX Runtime JavaScript/WASM is packaged locally with the extension rather than loaded from a CDN.

## Permissions

- `activeTab`: identify the tab the user explicitly activates Audio+ on.
- `tabCapture`: capture audio from that user-selected tab.
- `offscreen`: keep local audio and bounded AI processing alive after the popup closes.
- `storage`: remember settings, presets, Smart Fix curves, and temporary Live AI state locally.

Live AI Karaoke adds no new Chrome permission.

## Contact

For bugs or privacy questions, open an issue in this repository.
