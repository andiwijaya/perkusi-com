# C3 — exact Git-restorable retirement and local release gates

**Local gates PASS; parent review required before commit/push/deploy.** HEAD remains `68d289eb03af75eaf071ae1b9c20a5f23194b732`, branch `main`; index is unchanged. This slice retires the independently accepted136 source +106 test/helper paths. It does not declare the historical V5/V6 failure repaired or the whole retirement programme complete.

## Exact removals and recovery

Removed **242/242 tracked files**, **2,136,454 logical bytes**, zero failures/skips, no directories or outside paths. Every path, raw hash and Git-filtered identity was checked before action, and its reachable HEAD recovery blob was read/verified. No reset, clean, prune, history rewrite or new permanent QA batch occurred.

The106 test/helper files comprise102 root test modules (89 failed-feature files plus13 mixed originals whose retained assertions were extracted) and4 helper modules, including the separately reviewed indirect finish-fixture helper. Root suite modules therefore changed177→75. The four refactored retained files and all23 C3-preparation additions/edits remain exact. The independently accepted disposition preserves391 original assertion call sites; removing retired scenarios is intentional, not a smaller-suite repair claim.

`REMOVAL-PREFLIGHT.json`, `REMOVED.jsonl` and `GIT-RECOVERY-VERIFICATION.json` bind every deleted path to its exact Git blob and original bytes.239 original working files reproduce directly from blob bytes. Three original test files used CRLF while Git stores normalized text: `v5-instrument-input`, `v5-waveform`, `v5-workspace-owner`. Their recorded UTF8 LF→CRLF rehydration recipes reproduce the old SHA256 exactly. Thus raw restoration is explicit; do not claim all242 raw blobs already have identical line endings. Restore only selected named paths; never reset the checkout over unrelated work.

Observed disk free space at the source-removal operation: **82,552,864,768→82,554,851,328 bytes**, delta **1,986,560 bytes**. This is the measured source-unlink delta, not a QA cleanup estimate or the net space effect of later builds/tests. One7.27MB candidate and small logs were subsequently generated. Large QA cleanup remains a separate phase.

## Production build path

`npm run build` now selects `retirement-release`. The existing Pages main command's historical mode spelling resolves to that same mode through `pages-release-policy.mjs`; unsupported review/final/prototype modes remain refused on main, and commit identity is still required. No Cloudflare settings, Actions, DNS, GA, security headers, audio gains or dependencies were changed.

The official managed production build uses the ordinary supported entries plus isolated qualified full-project/raw recovery and six script-free retired routes. It is **not** the former small nondeployable review subset. No audio/archive copy plugin is enabled for this release. Disk admission and ownership protections remain; cleanup was explicitly deferred.

Candidate: `qa-artifacts/retirement-c3-removal-2026-10-21/release/`

- Build ID `a13ae56e-8cda-4acc-8a90-7ae761a15730`; source before/after `83caa75b48f50c10a47e26a0f70988d235c8853c980bf4f634cbc269ca25cf98`.
- **107 files /7,271,346 bytes**, all107 bodies identical to accepted C2.41 stable WAV files remain exact. No archived media-library, Gamelan audio bank, FLAC/ZIP/WebM/raw-float payload was deployed into the candidate.
- **11 JS files /617,082 bytes total**. Ordinary two-tool reachability covers **221,775 JS bytes**; standalone recovery UI chunks are excluded. Normal source/import graph:57 JS/CSS/JSON dependency files, zero reach to the136 removed source paths.
- Version is honestly `local/local`; it is not a new production SHA. Final normalized commit/artifact identity and deployment verification are later gates.
- Fresh free space before build82,549,080,064 bytes; unchanged conservative guard3,332,099,164 bytes. Build exit0, identical source fingerprints, no automatic cleanup.

Legacy off-main build compatibility utilities and additional previously deferred Gamelan orphan files were outside the exact deletion plan. They remain review exceptions, not approval for another deletion batch or a supported public feature. The normal release does not load them.

## Retained regression evidence

| Gate | Outcome |
| --- | --- |
| Full retained unit/integration suite | **570/570 PASS**,75 modules, zero failed/skipped/cancelled |
| Full lint | **PASS** |
| Chrome ID desktop1366 / Edge EN mobile viewport390 core | **PASS both**,20 checkbox/Play/Pause/Resume/Stop transitions each; four distinct patterns, chain≥4,8 track step/mixer controls, kit/BPM/swing, save/load/refresh, WAV |
| Ordinary Studio repeat | Pattern and chain playback cross two boundaries, Pause/Resume/Stop; completed ID evidence reused from the same107-file artifact |
| Beatbox | Six roles/two variations present; real native loop playback crosses two boundaries, variant/Pause/reset/restart, save/reload and WAV |
| V3 transfer | Actual Beatbox→Studio at paused96BPM; incompatible reverse warning/cancel preserves full project; explicitly accepted derived copy keeps exact original download |
| Navigation/locale/SEO/privacy/404/layout |12 foundation checks plus2 closing checks;40 page/language/viewport combinations at320/390/430/1366/1920; no overflow/touch-target regression |
| Retired entries | All six ID/EN Gamelan/credits/Loop pages: zero scripts, same-tab recovery access, local links200, mobile geometry checked |
| Qualified full-project recovery | Both core profiles export original fields, one original and two synthetic test takes with exact bytes;3,917,798-byte package |
| Readonly handoff recovery | Both profiles: missing DB causes no creation/open;67-record discovery over3 pages, File metadata, unsupported-version raw download, old deep links and Beatbox source download |
| Readonly final guards |0 writes/upgrades/handles/object URLs/AudioContext/mic; only readonly existing-DB transactions |

WAV measurements use real browser rendering with muted output, not listening claims. Studio exports are48kHz stereo16-bit,16 seconds, peak0.5239563; Beatbox exports48kHz mono16-bit,10 seconds, peak0.8731689. Both are non-silent with positive RMS and bounded peak. Each browser's hash/RMS is recorded separately; cross-browser byte equality is not claimed.

The pre-existing96BPM lock with enabled Beatbox clips is preserved. The browser proves the field is disabled, turns off all six clip checkboxes through the actual UI, then changes BPM. No forced enabled control, admission bypass or engine change was used.

All initial failures are retained. Restricted execution first failed fixture rename/localhost access; the appropriately authorized local run resolved those environment restrictions. Stale Preview/old npm command assertions were updated to retirement contracts without weakening security/render checks. Native adapter corrections involved an old Gamelan notice href, the documented tempo precondition and an accidental comparison against old `dist/_headers`. Passed core/layout cases were retained by exact artifact pins; only unfinished checks were continued. The original failure receipts remain FAIL; the composite closure cites the precise passing receipts, not rerun-until-green claims.

## Protection, limitations and next gate

B1's72 bound members were rehashed unchanged. Qualified recovery35, registry metadata, C1R raw/handoff access, V3 transfer, engineering closure23 and `render-qa.js` remain. Media and user storage were not removed or migrated. Browser fixtures used fresh isolated QA contexts; no personal profile was opened. Owned browsers/servers closed and all our build-consumer leases released. Old seals are unchanged, but references to removed working files now require recorded Git/blob/EOL rehydration.

Physical mobile, Safari, Firefox, microphone hardware and listening are **UNVERIFIED**; Firefox binaries were absent. Coverage is finite lifecycle/boundary testing, not an extended soak or a guarantee against all playback interruption. Historical experimental playback failure remains **UNKNOWN** in cause and **FAILED/STOPPED** in product status.

Next: parent independently reviews exact removal, seven-file production-policy/test delta, candidate graph and composite browser receipt. Additional Gamelan orphan/legacy compatibility retirement needs its separate scoped decision. Prepare any permanent QA deletion manifest only after source/media safety review; do not delete a new batch without exact action-time approval. No commit, push, deployment or final release label is authorized by this receipt.

Primary evidence: `qa-artifacts/retirement-c3-removal-2026-10-21/` — `SUMMARY.json`, removal/preflight/recovery records, `FINAL-TESTS-R2.log`, `BUILD.json`, `ARTIFACT-GRAPH.json`, `BROWSER-CORE-R3.json`, `layout/browser.json` + `LAYOUT-CLOSURE.json`, `BROWSER-RECOVERY.json`, `NATIVE-RESULT-R4.json`, manifest/seal. No model setting was changed.
