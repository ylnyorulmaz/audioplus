# Audio+ Privacy

Audio+ is designed to process browser-tab audio locally on the user's device.

## Data Audio+ processes

- Audio from the browser tab the user explicitly chooses to process.
- Equalizer and audio-control settings.
- User-created preset names and preset settings.
- Hostnames for sites where the user explicitly enables a site-specific profile.

## Where processing happens

Tab audio is processed locally in Chrome with the Web Audio API. Audio+ does not upload, transmit, sell, or share captured tab audio.

## Storage

Audio+ uses Chrome extension storage for:

- global audio settings;
- custom presets;
- per-site profile settings;
- temporary per-tab runtime state.

These values remain inside Chrome's extension storage unless the user removes the extension or clears its data.

## Network access

Audio+ V1 does not require a backend service and does not send analytics or telemetry.

## Permissions

- `activeTab`: identify the tab the user explicitly activates Audio+ on.
- `tabCapture`: capture audio from that user-selected tab.
- `offscreen`: keep the Web Audio processing graph alive after the popup closes.
- `storage`: remember settings, presets, and per-site profiles locally.

## Contact

For bugs or privacy questions, open an issue in this repository.
