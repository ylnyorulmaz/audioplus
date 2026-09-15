# Audio+ V2 Final Release Checklist

Target: **V2.4 / 0.8.0**.

## Automated

- [ ] `npm test` passes.
- [ ] `manifest.json` and `package.json` both report `0.8.0`.
- [ ] Manifest stays MV3 with only `activeTab`, `offscreen`, `storage`, and `tabCapture` permissions.
- [ ] No `host_permissions`, remote code, backend dependency, analytics, or telemetry were added.
- [ ] Smart Fix automatic EQ remains capped at ±3 dB per band.
- [ ] Live spectrum reuses the existing input analyser rather than opening a second capture.

## Core audio smoke test

Test with normal playback already running before enabling Audio+.

- [ ] YouTube: enable/disable, EQ, presets, volume, bypass, reset.
- [ ] YouTube Music: same-tab track changes keep processing.
- [ ] Spotify Web: playback continues after capture starts.
- [ ] SoundCloud or another HTML5-audio site: basic processing works.
- [ ] Speech/video material: Dialogue Boost is clearly audible without obvious distortion.
- [ ] Night Mode Light/Strong reduce loud jumps without unacceptable pumping.
- [ ] Aggressive EQ + Volume 150% does not produce obvious uncontrolled clipping on normal material.
- [ ] Bypass restores approximately original tone/level and neutralizes the safety-processing path.

## Smart Fix

- [ ] Smart Fix refuses to run until Audio+ is enabled.
- [ ] Audible material analyzes successfully.
- [ ] Muddy/thin/harsh results are plausible on representative material.
- [ ] Re-run replaces the previous Smart Fix curve rather than stacking it.
- [ ] Clear Smart Fix leaves manual EQ, presets, Dialogue Boost, Night Mode, Karaoke, and volume unchanged.
- [ ] Two simultaneous Smart Fix runs on the same tab cannot race.
- [ ] Quiet/silent sections produce a useful error/result rather than broken settings.

## Karaoke

- [ ] 0% Vocal Reduction sounds neutral.
- [ ] Light 45%, Karaoke 82%, and Instrumental 100% become progressively more aggressive.
- [ ] Keep Bass On retains more kick/bass fundamentals than Keep Bass Off.
- [ ] Centered modern vocals are reduced noticeably.
- [ ] Mono/wide/reverb-heavy vocals may remain but do not crash or destabilize processing.
- [ ] Aggressive modes are checked for unacceptable loss of centered drums/instruments.

## Live spectrum / performance

- [ ] Advanced shows 10 responsive spectrum bars while audio is playing.
- [ ] RMS and peak readouts react plausibly.
- [ ] Closing Advanced stops active spectrum polling.
- [ ] Closing the popup stops spectrum polling entirely.
- [ ] Analyzer does not create a second tab capture.
- [ ] Extended playback does not show steadily increasing CPU/memory usage.
- [ ] Test on an older/low-power Windows machine as well as a current machine.

## Lifecycle / navigation

- [ ] Close/reopen popup while processing; audio keeps playing.
- [ ] Pause/resume playback; processor remains usable.
- [ ] Same-host SPA navigation keeps processing.
- [ ] Navigate to a different hostname in the same tab; the correct global/site profile is applied.
- [ ] Close a captured tab; its processor is cleaned up.
- [ ] Disable Audio+; direct tab playback resumes normally.
- [ ] Reload the extension; stale state does not leave broken audio.
- [ ] Restricted Chrome pages show unsupported state instead of attempting capture.

## Profiles and persistence

- [ ] Global settings survive popup close and Chrome restart.
- [ ] Two hostnames retain different site profiles.
- [ ] V2 settings (Dialogue Boost, Night Mode, Vocal Reduction, Keep Bass, Smart Fix curve) persist correctly.
- [ ] Custom preset save/update/delete survives Chrome restart.
- [ ] Built-in/custom tonal presets do not silently overwrite Smart Fix or master volume.

## Chrome Web Store preparation

- [ ] Privacy policy matches actual V2 behavior.
- [ ] Store copy does not claim perfect mastering or perfect vocal removal.
- [ ] Screenshots show only implemented features.
- [ ] Required extension icon assets are present before submission.
- [ ] Manual tests completed on current stable Chrome on Windows.
- [ ] A final unpacked-extension install is tested from a clean folder/checkout.

## Explicit V2 non-goals

- AI stem separation / Demucs / MDX
- server-side audio processing
- accounts or payments
- cloud sync
- analytics or telemetry

AI source separation is a possible V3 experiment, preferably client-side ONNX/WebGPU where hardware support is adequate.
