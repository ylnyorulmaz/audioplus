# Audio+ Privacy

Audio+ processes browser audio locally on the user's device.

## Data Audio+ processes

- Audio from the browser tab the user explicitly chooses to process.
- Equalizer, enhancement, preset, and site-profile settings.
- Short-lived local measurements used by Smart Fix and the live spectrum.

## Karaoke status

**Karaoke / Vocal Reduction and AI Karaoke are Work in progress / Coming soon.** They are not enabled in the current public UI.

When those features ship, related privacy details (local DSP, optional local AI model storage, and any first-use model download) will be updated here before store submission. Until then, Audio+ does not expose karaoke controls and does not request Hugging Face host access in the shipped manifest.

## Where processing happens

Tab audio is processed locally in Chrome with Web Audio. Smart Fix and spectrum analysis use the local tab-audio graph.

## Storage

Audio+ uses Chrome extension storage for settings, custom presets, per-site profiles, Smart Fix state, and temporary per-tab runtime state.

Captured PCM chunks and live spectrum snapshots are not kept as histories.

## Network access

Audio+ has no backend service, account system, analytics, telemetry, remote LLM, remote audio processing, or remote inference in the current equalizer-first release.

Executable DSP code is packaged locally with the extension.

## Permissions

- `activeTab`: identify the tab the user explicitly opens Audio+ for.
- `tabCapture`: capture audio from that selected tab.
- `offscreen`: keep local audio processing alive while the control window remains independent of page focus.
- `storage`: remember settings and temporary runtime state locally.
- `sidePanel`: open the native Chrome side panel UI.

## Contact

For bugs or privacy questions, open an issue in this repository.
