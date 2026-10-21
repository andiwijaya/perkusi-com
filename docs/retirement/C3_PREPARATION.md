# C3 preparation — retained data/shared assertions

Local preparation complete; independent review and a separate removal slice remain required. **No source/test deletion, commit, push, deployment or permanent QA cleanup.** HEAD stays `68d289eb03af75eaf071ae1b9c20a5f23194b732`. C3 changes tests/fixtures only, leaving product runtime, recovery, media and engineering render QA untouched.

## Changes and reviewer corrections

`tests/helpers/canonical-fixtures.js` now reads the eight existing pinned schema specimens; its registry and synthetic `fixturePCM` remain. Four small JSON snapshots under `tests/fixtures/retirement-data/` total **193,112 bytes**. A one-time QA generator checked exact equality against the original model/recording/overdub setups before replacing imports. No retired implementation was copied into a replacement helper. The new helper only clones JSON data. The generator stays in QA and is not a test/runtime dependency.

Three retained data files were refactored: `canonical-metadata.test.js`, `v5-canonical-contract.test.js`, `v5-audio-document.test.js`. All original assertions are accounted for. The eight-programme fixture preserves the exact eight independently titled origins/sources and all existing lane assertions.

**AudioDocument was not merely a fixture rewrite.** Its original185 group included LoopHistory at194–197 and a TakePool read at218. The retained test explicitly persists the pinned empty/current snapshots without asserting a replacement history implementation. LoopHistory construction/commit/undo/redo is designated retired setup; the original file is preserved in the QA baseline and recoverable from Git. Source PCM and copied PCM now have separate actual `AudioMemory` leases. Exact old PCM SHA/geometry/negative zero are verified before testing. Document save/reload, bundle roundtrip, cancellation, quota/CAS, corruption refusal and native resolver ownership/release assertions remain. The fixture checks that releasing the copy leaves its source lease, then releases that source to zero. The actual `AudioDocument.resolve()` buffer lease still has its original explicit idempotent-release and ledger assertions. An additional malformed-JSON read refusal verifies original text and audio remain unchanged; the old title mentioned this case without exercising it.

**Recorded reader722 is split at assertion level.** The new `tests/retained-v5-recorded-reader.test.js` keeps original730–745: both `instrumentVoice` geometry refusals and zero allocated sources. Original746 onward is a retired Loop controller failure/restart scenario, retained in the original file pending review. The new test imports neither controller nor any candidate source. Its unit audio mocks are preserved test scaffolding, not an alternate engine or native validation.

Thirteen new `tests/retained-*.test.js` files extract the listed stable/data groups. All thirteen mixed originals remain byte-identical to C2. The three earlier programme/limiter extractions remain unchanged. Origin/route helper compatibility tests are explicitly titled as helper tests; they do not authorize Preview activation in the normal app.

## Evidence and disposition

- Original three data suites: **76/76 PASS** before changes.
- Final affected cohort: **112/112 PASS**, zero skipped/cancelled/failed; **full lint PASS**. The final cohort includes all retained data and extracted shared tests. This is not a claim that historical retired-engine suites pass or that fewer tests prove repaired playback.
- `ASSERTION-DISPOSITION.json` maps all **732 original callback declaration groups and 4,479 assertion call sites** from the109-module ledger: **391** retained with exact normalized assertion AST identity (including previous extractions/helper assertions); **4,088** explicitly marked retired-feature scenarios. Counts are declaration/call sites, not runtime iterations. New fixture/malformed-input ownership checks are additional, not substituted matches.
- Retained graph: **75 JS modules**, zero direct/transitive imports or literal worker/source references to the136 candidates. JSON and dynamic fixture inputs are pinned separately in the same graph receipt.
- All136 source working Git blobs still match HEAD. All109 original test/helper identities were checked; only the three retained data files and fixture helper changed as expected. All original paths remain.
- All494 C2 sealed members remain exact, using archived pre-C3 originals for the four changed files; all72 B1 members remain exact. Recovery35/registry9, media, `render-qa.js` and the engineering closure remain protected. No native/build run was needed for test-only preparation.

## Exact next removal plan — proposed, not executed

`qa-artifacts/retirement-c3-prep-2026-10-21/REMOVAL-PLAN.json` records the136 source paths and **106 original test/helper paths** with HEAD/current Git blobs, raw SHA256, sizes, retained replacements and inbound references.105 come from the original ledger (89 failed-feature test files,13 mixed originals after extraction,3 helpers).

One additional indirect helper was found: `tests/helpers/canonical-finish-fixtures.js`, HEAD blob `63a600d0e0babaf663c8a979b029f828749a274c`. It consumes the old score fixture and is used only by `canonical-finish`, `canonical-finite-clock-job`, `canonical-shared-master` tests already in the failed-feature batch. Its extra inclusion requires independent review; it has not been deleted. No other external consumer was found for the proposed source/helper batch.

Before any future removal, verify the exact current identities and inbound graph again. Restore only named paths from the recorded HEAD/blob if necessary; never reset/clean unrelated work or rewrite Git history. Keep the four refactored originals, all extracted tests, fixtures, qualified recovery, media and engineering closure. Additional newly orphaned Gamelan code, production payload/distribution policy, final build/functional regression/publication and any irreversible QA cleanup are excluded from this preparation gate.

Evidence directory: `qa-artifacts/retirement-c3-prep-2026-10-21/` — baseline originals/log, `FIXTURE-PINS.json`, `EXTRACTIONS.json`, `ASSERTION-DISPOSITION.json`, `GRAPH-AND-PRESERVATION.json`, `REMOVAL-PLAN.json`, `AFFECTED-TESTS.log`, `TEST-COHORT.json`, `LINT.log`, manifest/seal. Intermediate audit failures (relative QA import, BigInt AST serialization, indirect helper discovery) did not run product actions; final audit supersedes them. No model setting was changed. Stop for parent review here.
