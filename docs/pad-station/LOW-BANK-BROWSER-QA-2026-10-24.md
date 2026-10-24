# Five-bank Pad Station browser/native verification

Software verification completed on 2026-10-24 for application checkpoint `321835ec1481ab9b12a76f840114d240638f986f` (tree `ee44a3f20ef1a2fe5bbe792df74b6fba399b1578`). Ready for parent review and audition. No push or deployment. This report introduces no application, DSP, media, license, global-master, Studio-bank, or project-schema change.

| Standalone bank | Gain change | Native maximum isolated peak at master 0.75 |
| --- | ---: | ---: |
| Kempul Pelog | +2 dB | 0.8746458292 |
| Kempul Slendro | +6 dB | 0.8789221644 |
| Gong ageng | +2 dB | 0.4510604739 |
| Slenthem Pelog | +3 dB | 0.5445179939 |
| Slenthem Slendro | +4 dB | 0.7180273533 |

## Readiness and isolation

The directly exposed `mcp__cua_repl.js` was callable although absent from the nested tool catalog. Its current browser/local-development/viewport documentation was read. The task created hidden IAB browser 2, own tabs 1 and 2, and successfully read/actioned its own Pad Station. No Properti.cc repository, process, port, tab, native window, or performance was inspected.

The source server was rooted at `C:/PerkusiDotCom`, PID 46240, OS-assigned `127.0.0.1:49675`. Production previews were own PIDs 29016/53628 at random ports 57035/57571. All own tabs and servers were closed; the temporary viewport override was reset. No firewall, security setting, shell browser automation, package installation, or deployment was used. Sandbox-limited Git and own-loopback reads used scoped approvals successfully. No action was rejected by automatic approval review and no approval remains pending.

The six original source/test/doc SHA256 pins matched before and after verification. Git initially and finally showed only the same unrelated pre-existing untracked deliverables. Canonical source/media were reused. The retained Slenthem baseline build was untouched.

## Native audio and UI evidence

The source-native suite passed 13 gates in 37,445 ms, with 40 isolated cases covering all 20 target notes at master 0.65 and 0.75. Actual FLAC decode, frames, channels, full duration, all20 runtime gain buses, and per-bank UI routing were checked at native 48,000 Hz. Native OfflineAudioContext used the original decoded buffers and existing voice/output factories. Candidate peaks match the offline model; maximum sample discrepancy from the independent scalar transfer calculation was `1.788139343261719e-7`. Native baseline comparison used the original baseline gain values on those same decoded buffers/rate, rather than claiming a full baseline-browser audition.

Real DOM handler checks covered repeated/overlapping synthetic pointers, Enter/Space, input guards, same-bank no-op, cross-bank changes, master controls, mute, Stop, fresh intent, and all21 core pads. The five bank totals were 27/26/22/26/24. All five banks were checked in ID and EN at widths390/1440 with no horizontal document overflow. Width390 is viewport emulation, not a phone test.

Warm-cache repeats caused no new decode. Observed extra-bank bounds were at most4 non-releasing voices, within8 owned/releasing; Gong retrigger had1 non-releasing and up to2 owned voices. Maximum observed aggregate retained cache was33,166,088 bytes, below32MiB (33,554,432 bytes). Cache/native-lease counters are not total browser memory or proof of physical RAM reclamation.

Cold fetch Stop/replacement, held resume Stop, held decode-completion cancellation, pending dispose, pagehide/reopen, and natural retirement passed. A cancelled native-decode lease remained owned until its completion promise settled, then returned to0. This does not claim cancellation of the native decoder. A fresh cold-clock probe observed running/currentTime0, immediate Stop admitted no late voice, and a fresh gesture then succeeded; it does not establish a general fix for historical timing observations.

Source-native cleanup ended with172 created/172 disposed,0 voices,0 cache and a closed context. Production-native checks independently exercised all20 actual compiled mappings/gain buses, all21 core pads, controls,64-source mixing, Stop and pagehide:130 starts/130 ended,0 active, closed48kHz context, no captured warning/error in that run. The observational script was added only to marked preview responses; all307 compiled files were verified unchanged afterward. Production CSP, frame-ancestors none, X-Frame-Options DENY and permission restrictions were retained.

## Limiting and perceptual limits

The supported64-voice stress fixture admitted exactly64 voices synchronously and skipped the next extra hit. Both native output channels peaked at0.8816059828, below0.9. Stop and disposal settled them without queued later hits. The phase-aligned56-kick plus8-extra stress has strong nonlinear limiting: sampled mono pre-knee peak27.2123, knee fraction51.69%, input-domain clamp fraction46.05%. These analyser-window samples are not exact unique-frame occupancy and are a different extreme fixture from the earlier offline400ms mix.

A separate21-core/extra mix peaked at0.8816059828, with sampled mono clamp3.57%/knee8.49%. A small musical fixture peaked0.8783305883 with0 input clamp and sampled knee0.155%. These establish finite bounded output, not unchanged crest shape, absence of distortion, or perceived musical quality. The original soft knee and clamp can audibly alter dense mixes; gain changes were not expanded into an audio redesign.

No human audition, loudness-equality judgment, physical-phone speaker, iOS/Safari, or acoustic output measurement was performed. Gong remains bass-dominant: extra base gain cannot recover frequencies a small phone speaker does not reproduce. No EQ, tail cuts, source normalization, or master change was introduced. Parent audition/review remains necessary before deciding to publish.

## Regressions and build

Existing tests:620/620 pass (8,034.8ms test duration;8,165ms observed shell wall), lint exits0. Source-native regressions passed Studio21 pads/no extra selector, disposable save/reopen, a full32-step two-pattern chain repeat,16-step preview repeat, existing instrument/loop playback, master0 and Stop. Beatbox repeated3play/pause cycles, a variant change and reset. Native Studio WAV output for ruang/arus/fusion was2seconds,48kHz, stereo,96,000 frames and retained2,044 bytes of metadata beyond the PCM/header. Against an independent native manual graph on the same browser/rate, PCM16 differences were at most1 LSB (8/0/2 differing samples). Historical PCM hashes are not treated as portable bit-exact browser results.

The final official-build smoke additionally confirmed Studio21/no extras, imported disposable project playback (observed position18:4), Stop and actual WAV-ready result `Gain-parity-ruang.wav`. Production Beatbox played6 sounds, paused/resumed and reset tobar1/beat1. No real persisted project was accessed; fixtures used the task's own loopback origins.

Official Vite compilation ran once,1.26seconds. Guard receipt `7244b076-0ffb-4f8b-9fc3-c74afce15227` recorded failed directory promotion (`EPERM`), with unchanged source fingerprint. The own dev watcher was stopped; its log had observed the build-candidate tree and page reloads. Guarded recovery `7f09fa74-db82-429a-b836-a315ba9b264f` reused that exact compiled candidate after full source/artifact hash checks, with no second media copy. Recovery statusSUCCESS, exit0, sourceSHA256 `c5c157fc338f511f63b2d812fb1e1dc9cbcaef9f7ab8a6324b4dd93f919bf7c9`. Final artifact: `qa-artifacts/pad-low-bank-balance-2026-10-24/dist`,307 files,444,319,264 bytes; all file hashes matched the pre-promotion compiled manifest after production tests. Stopping the watcher correlated with successful promotion; no OS-level lock owner was proved. Unrelated retained builds were not cleaned.

## Preserved failed probes and workflow observations

Raw first failures remain in `TARGETED-BROWSER-task2.json` / `FOLLOWUP-BROWSER-task2.json`: the first64-voice snapshot waited until12ms release tails ended (60 remained; native peak64); synchronous follow-up observed64. The initial WAV observer waited for a download URL during rendering, whereas the application creates that URL at delivery; observing the exporter result Blob corrected the probe. Its first hash also included the metadata trailer; final comparison hashes only the declared PCM range and compares samples directly. A fast-reload WAV fixture ran before the iframe runtime initialized; explicit runtime/import-completion gates fixed the fixture. These were observation/test-harness repairs, with no sampler/engine change. An unassigned `MutationObserver` console error from an earlier source-fixture navigation was retained as an unexplained observation; the final production run captured no such errors.

The production observation route initially received the app's normal404 response; its QA middleware was ordered before that route handler while retaining all original security headers. No security bypass was used. One successful JSON download/browser call took1,029.6seconds; platform wait/approval cause is not independently established. It completed and was not repeated blindly. A local Codex message attempt to the parent source-thread ID returned `thread not found`; no message was delivered, so progress was stored locally and the final task notification is the handoff. No separate remote task was created.

Own low-cost timings/counters are reported above. No system benchmark or serial reference was run, so there is no measured parallel-project speedup claim. The only observed development collision was this task's own dev watcher versus build-candidate activity, not a collision with Properti.cc.

## Evidence

Bounded JSON/log/fixture/screenshot files are in `qa-artifacts/pad-low-bank-balance-2026-10-24/`: `NATIVE-BROWSER-task2.json`, `TARGETED-BROWSER-task2.json`, `FOLLOWUP-BROWSER-task2.json`, `WAV-NATIVE-PARITY-task2.json`, `PRODUCTION-NATIVE-task2.json`, `PRODUCTION-SMOKE-task2.json`, `LAYOUT-task2.json`, `BUILD-RECOVERY-task2.json`, `BUILD-COMPILED-MANIFEST-task2.json`, unit/lint/build logs, and ID/EN390/1440 JPEGs. Small fixture sources are retained for review; they were controlled via the supported task-owned IAB. Source suites were not rerun after passing except where a recorded fixture defect required a more precise probe. The final report/summary are the only new tracked paths.
