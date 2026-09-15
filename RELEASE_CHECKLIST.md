# Audio+ V1 Release Checklist

## Automated

- [ ] `npm test` passes.
- [ ] `manifest.json` parses and version matches the planned release.
- [ ] No host permissions or remote-code dependencies were added.

## Manual audio smoke test

Test with normal playback already running before enabling Audio+.

- [ ] YouTube: enable, presets, EQ, bypass, disable.
- [ ] YouTube Music: same-tab track changes keep processing.
- [ ] Spotify Web: playback continues after capture starts.
- [ ] SoundCloud or another HTML5-audio site: basic processing works.
- [ ] A speech/video site: Voice and Podcast presets are audible.
- [ ] `Bass +12 dB`, EQ boost, and Volume 150% do not produce obvious hard digital clipping on normal material.
- [ ] Bypass restores approximately original tone and level and neutralizes peak protection.

## Lifecycle / edge cases

- [ ] Close and reopen the popup while processing; audio keeps playing.
- [ ] Pause/resume playback; processor remains usable.
- [ ] Navigate to another media item in the same tab; processor remains usable.
- [ ] Close a captured tab; its processor is cleaned up.
- [ ] Disable Audio+; direct tab playback resumes normally.
- [ ] Reload the extension; stale capture state does not leave broken audio.
- [ ] Restricted Chrome pages show unsupported state instead of attempting capture.

## Profiles and persistence

- [ ] Global settings survive popup close and Chrome restart.
- [ ] Two hostnames can retain different site profiles.
- [ ] Custom preset save/update/delete survives Chrome restart.

## Chrome Web Store readiness

- [ ] Privacy policy text matches actual behavior.
- [ ] Store description does not claim perfect restoration, mastering, or vocal removal.
- [ ] Screenshots show only implemented features.
- [ ] Extension icon assets are present at required sizes before submission.
- [ ] Manual tests completed on current stable Chrome on Windows.

## Known non-goals for V1

- Karaoke / vocal isolation
- Smart Fix / automatic mastering
- Night Mode dynamics profile
- Server-side processing
- Accounts, payments, analytics
