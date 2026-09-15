# Audio+ Privacy

Audio+ is designed to process browser-tab audio locally on the user's device.

## Data Audio+ processes

- Audio from the browser tab the user explicitly chooses to process.
- Equalizer and audio-control settings.
- User-created preset names and preset settings.
- Hostnames for sites where the user explicitly enables a site-specific profile.
- Short-lived local measurements used by Smart Fix, such as broad spectral energy, RMS, and peak level.
- Short-lived live-spectrum measurements shown while the popup's Advanced panel is open.

## Where processing happens

Tab audio is processed locally in Chrome with the Web Audio API. Smart Fix analysis and the live spectrum use the same local tab-audio processing graph.

Audio+ does not upload, transmit, sell, or share captured tab audio or audio-analysis measurements.

## Storage

Audio+ uses Chrome extension storage for:

- global audio settings;
- custom presets;
- per-site profile settings;
- Smart Fix enabled state and its correction curve;
- temporary per-tab runtime state and the latest Smart Fix explanation.

Live spectrum snapshots are not stored as a history.

These values remain inside Chrome's extension storage unless the user removes the extension or clears its data.

## Network access

Audio+ V2 does not require a backend service and does not send analytics or telemetry. It does not use a remote LLM, remote audio-processing service, or remote source-separation model.

## Permissions

- `activeTab`: identify the tab the user explicitly activates Audio+ on.
- `tabCapture`: capture audio from that user-selected tab.
- `offscreen`: keep the local Web Audio processing graph alive after the popup closes.
- `storage`: remember settings, presets, Smart Fix curves, and per-site profiles locally.

## Contact

For bugs or privacy questions, open an issue in this repository.
