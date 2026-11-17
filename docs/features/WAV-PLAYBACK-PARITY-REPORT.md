# WAV playback parity review

Date: 17 November 2026 (Asia/Jakarta).

## Confirmed problems and changes

Both tools left the previous WAV available after changes to the current beat. Rhythm Studio was reproduced through the visible interface: render a kick, change the grid, and the earlier download remains visible. Both tools now invalidate that download when its sound choices, mix, tempo, arrangement length or filename change. Editor pattern selection and pad quantization do not invalidate an otherwise unchanged arrangement. A job that completes after the beat was edited also discards its outdated result and asks the user to make a new WAV. Beatbox rechecks immediately before download/share as well as during its normal UI updates.

Rhythm Studio also recalibrated an export independently of the programme gain used by the sounding beat. After lowering all three drum mixer levels during playback, then pausing and exporting, the test WAV was 11.804 dB louder than the recorded playback. The arrangement export now reuses the fixed gain heard for that same project and audio context, including live mixer edits. A changed project that has not been played, a newly loaded project, or a pattern-only preview keeps the ordinary arrangement calibration. Export gain remains bounded by the existing programme limit and the same output safety curve.

## Verification method

`npm run test:wav` imports isolated synthetic projects through the normal project file controls, starts playback, captures the final real-time graph with a test-only AudioWorklet, pauses, renders WAV through the normal UI, and downloads the file. It compares decoded 48 kHz/16-bit PCM against the Float32 live capture, including each stereo channel. The sample count must match the complete render-thread clock span. Intermediate block timestamp corrections are recorded separately; an observed one-quantum label correction must not be mistaken for missing PCM. Alignment controls detect an intentional 53-frame offset, and a deliberately halved WAV level must fail the level comparison.

The comparison excludes the opening 40 ms and closing 15 ms, covering the rest of each exported arrangement. Studio deliberately fades the final 4 ms rather than appending hidden tail bars; live playback continues looping. File duration and channel count are checked separately. The live mixer edit case compares the next complete arrangement cycle after editing, avoiding slider transitions.

Chromium worklet module fetches bypass Playwright routing. The suite therefore serves a local capture module alongside byte-identical responses from its selected upstream, preserving the actual CSP. Production runs fetch the live JavaScript and audio assets through that proxy and record SHA-256 hashes in `resources.json`. This is a production-asset test in an isolated local origin; the ordinary tutorial suite checks downloads directly on the deployed origin. The worklet and graph capture hooks are never part of the product build, and no microphone is used.

Cases cover Beatbox's three-voice first mix and all six roles with mixed A/B variations at 4/8 bars; Studio's 100 BPM first beat, live mixer changes, 137 BPM/swing/mute/solo/pan, and per-pattern loop changes with Bilah, Kendhang, bass and guitar. They also check old-file invalidation and edits while native rendering is still pending.

Evidence is saved under `qa-artifacts/wav-parity-20261117/`. Human listening, hardware output routing and physical devices remain outside this signal comparison.

## Local signal results

All six scenarios passed, with results consolidated in `local-summary.json` from the named case evidence. The lowest waveform correlation was 0.9999998895. The largest output-level difference was 0.00004947 dB, in the live mixer edit case that previously differed by 11.804 dB. The largest normalized PCM difference was 0.00047005 (0.0471%). All cases invalidated the old download after an edit; the first-beat cases also rejected a render that finished after another edit.

| Scenario                                          | WAV                      | Result |
| ------------------------------------------------- | ------------------------ | ------ |
| Beatbox first three-voice mix                     | 4 bars, 10 s, mono       | Passed |
| Beatbox six roles, mixed A/B                      | 8 bars, 20 s, mono       | Passed |
| Studio first beat, 100 BPM                        | 4 bars, 9.6 s, stereo    | Passed |
| Studio mixer edited during playback               | 4 bars, 9.6 s, stereo    | Passed |
| Studio 137 BPM, swing, mute/solo and pan          | 4 bars, 7.0073 s, stereo | Passed |
| Studio pattern loops plus all instrument families | 4 bars, 10 s, stereo     | Passed |

Lint and production build passed. Build receipt: `qa-artifacts/build-retention/runs/0e7ff234-5fbf-453b-96e7-ffffb152b77f.json`.

The final unit suite passed all 662 tests with no skips. The general/phone tutorial regression suite passed 84 checks, including four real WAV downloads, with no browser errors. Production release verification matches `version.json` to the merged main commit, runs the PCM suite against live upstream assets, and separately runs the desktop tutorial/download suite directly against the deployed origin.
