# C2 — static Gamelan retirement routes and exact C3 plan

**C2 route gate PASS locally; C3 source/test removal is proposed only. No source/test removal, commit/push/deploy or permanent QA cleanup occurred.** The previous C1R acceptance and its console-only first-ID raw evidence limitation remain unchanged. No broad raw/audio replay or historical engine investigation was started.

## Four preserved URLs, no failed audio activation

`gamelan/index.html`, `gamelan/credits/index.html`, `en/gamelan/index.html` and `en/gamelan/credits/index.html` now contain script-free retired notices. They keep the same URLs, ID/EN alternatives, ordinary tool navigation and same-tab links to raw/handoff recovery and complete-project recovery. No new tab is requested, so the original tab's Gamelan route/session data remains accessible.

Credits preserve all101 original recording attributions, source URLs, source SHA256 values, license URLs and seven quality observations. Existing culture/listening/device uncertainty is retained; the pages do not imply a playback repair or renewed acceptance. Eleven fixed small legal/provenance files are emitted byte-for-byte in the local review build, under their existing `/internal/gamelan-delivery/…`, `/internal/gamelan-flac/…` and source-archive-manifest paths. The original library/source-commit links remain. No audio, ZIP bank or source archive was copied. Full historical archives remain in canonical local storage; their bulk distribution is outside this small review artifact, and the old production build/copy policy remains unchanged pending the final release gate.

Implementation delta: four HTML entries; a fixed-file `scripts/retirement-provenance.mjs` plugin; four explicit review build inputs; protection against old candidate metadata transforms reviving retired pages; and small text-wrapping rules in `public/retired.css`. Existing qualified recovery code,9 registry/manifest JSON, media, V3 mode transfer, raw/handoff adapters and engineering entry closure remain intact. The partial B2 generic serializer remains unreferenced.

Verification: **143/143 focused tests + lint PASS**, plus **3/3 newly retained shared tests + targeted lint PASS**. Managed local builds use the unchanged disk/ownership guard and defer cleanup. Four browser profiles—ID/EN desktop Chrome and mobile Edge viewport—verify both retired entries, no scripts, exact provenance-file hashes, same-tab raw local/session export and zero unexpected writes/audio/mic/database opens. The first EN harness used a case-sensitive `retired` title check against correctly capitalized `Retired`; its failure was preserved and only the EN assertion was corrected, without a product edit or repeating completed ID profiles. Final CSS wrapping has a separate mobile check; exact artifact comparison preserves the already completed functional evidence.

The first targeted wrapping measurement found an unbroken quality-observation token still overflowing the mobile credits page. That failure is retained; wrapping now applies to retired-page main text as well as code tokens. No playback/recovery JS changed during those layout corrections.

Final local artifact: `qa-artifacts/retirement-c2-2026-10-21/build-reviewed/`,107 files/7,271,346 bytes, source fingerprint `da5cd98e149f50aa5b4cb4b7d9d44e8bc8c33583da504023727cb1bce2f659ff`. It remains a **local review build, not a production publication approval**. Main's release policy, source history and current live release are unchanged. Browser checks are viewport emulation, not physical-device/listening/Safari qualification.

## Classification — 109 modules,330 references,732 test groups

The reference audit covers root tests and four helper modules. It reproduces the reviewer's109 modules/330 textual references:329 standalone path literals and **one embedded import string used to construct a VM fixture** at `tests/v5-capture-bridge.test.js:34`;308 are direct ESM import edges. The embedded string is not a comment—the earlier progress shorthand was corrected in the final ledger. Counts alone do not authorize removal.

`C3-PLAN-REVIEW.json` contains every module, group title/line range, assertion excerpts, local-helper dependency trace, source reference and action. It separates retained package/schema/provenance/programme contracts from scenarios whose SUT is the failed editor/owner/processor/capture pipeline. Resource/Transport observations in a retired-owner scenario are not treated as independent tests of those shared helpers; their standalone current contracts remain protected. Local helper assertions used by a retained group must be retained too.

| Proposed module action | Count | C3 condition |
| --- | ---: | --- |
| Archive failed-feature scenario test files |89|Only after referenced SUT retirement and final review; history/evidence retained |
| Split mixed files |13|Extract the listed shared groups and helper assertions first |
| Retain data/recovery test files |3|Rewrite fixture-only imports; preserve all test groups |
| Retire failed-only helpers |3|Only after every consumer has been retired/split |
| Retain/refactor shared fixture helper |1|Use the8 verified existing fixtures; keep registry/PCM exports |

Of732 groups:658 are proposed retired-feature scenarios,71 retain shared/data assertions,2 shared groups are already extracted, and1 mixed group retains its soft-limiter assertions separately from the retired Loop admission assertion. Every explicit keep anchor resolves to a real original group. The first draft's FX-schema line58 was corrected to59 before any removal; both drafts remain as audit evidence.

The three retained whole files are `tests/canonical-metadata.test.js`, `tests/v5-canonical-contract.test.js` and `tests/v5-audio-document.test.js`. The13 mixed files, exact retained groups and proposed destination names are listed in the JSON plan. They cover package/original-byte ownership, trusted catalogs/licenses, legacy recovery URLs, waveform/data validation, programme/FX protection and the relevant shared voice assertions. No mixed file is approved for wholesale deletion.

Three programme/limiter assertions have already been copied into `tests/retained-programme-protection.test.js` while all original tests remain. `SHARED-EXTRACTIONS.json` checks normalized assertion AST equality, not just matching names; the standalone3-test run passes. This preserves accepted output protection without retaining a failed engine as its test setup.

## Exact source admission and recovery identity

All136 specified source candidates and all109 original test/helper modules have explicit HEAD blob identities and current working SHA256 values in the plan. Each Git-filtered working blob matches HEAD `68d289eb03af75eaf071ae1b9c20a5f23194b732`; no unexpected edits were silently selected. Inbound checks across tracked code/build entries, source reads, workers and test helpers find no outside-batch consumer for the136 candidates. Cross-batch test/helper imports are individually recorded and remain blockers until their listed actions are complete. Additional newly unreachable Gamelan source is excluded from this removal scope.

`src/audio/render-qa.js` and the23-module engineering closure rooted at `internal/audio/main.js` and `internal/sound-lab/main.js` are explicitly protected. All media, the qualified35-file recovery closure, its9 registry JSON and C1R raw/handoff access remain protected. Existing tests and source remain on disk; no file was deleted to make an import check pass.

Rollback is Git-based and path-specific: the plan records the exact HEAD commit/blob and pre-removal working hash for each path. Before any later removal, recheck those identities. Restore only the approved named paths from that commit; do not reset/clean the checkout or overwrite unrelated current work. No history rewrite or new large archive is needed.

## Proposed C3 sequence for review

1. **Small fixture/data slice first:** refactor `tests/helpers/canonical-fixtures.js` to read the8 existing immutable schema0–5 fixtures instead of constructing them with retired model/overdub APIs. `FIXTURE-EQUIVALENCE.json` proves all8 have exact semantic equality and pins their bytes/hashes. Keep `fixturePCM` and registry exports. Rewrite only fixture construction in the three retained data test files, then run those complete suites.
2. Extract the explicit retained groups from the13 mixed files into their named destinations, keeping transitive local helper assertions and scenario loops. Preserve the already extracted programme tests. Run the affected retained suites before changing any source imports.
3. Only after those checks and independent review: retire the classified failed-feature tests/helpers and the admitted136 source paths, then rerun dependency, retained-suite, build and actual ordinary/recovery regression gates. Stop any item whose HEAD/working blob changed or whose outside-batch consumer appears.

No deletion is approved by this document. Final production build/payload policy, additional Gamelan source retirement, publication and exact permanent QA cleanup remain separate gates. Stop here for parent review.

Evidence: `qa-artifacts/retirement-c2-2026-10-21/` — `C3-PLAN-REVIEW.json`, `REFERENCE-RECONCILIATION-FINAL.json`, `SHARED-EXTRACTIONS.json`, `FIXTURE-EQUIVALENCE.json`, native receipts, artifact comparison and final manifest/seal.
