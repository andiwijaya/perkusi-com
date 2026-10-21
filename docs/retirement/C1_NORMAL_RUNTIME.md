# C1 — ordinary runtime separation, with explicit recovery exceptions

**PASS for ordinary Studio disconnection and the tested local review subset. HOLD for complete Gamelan route/runtime retirement and publication.** No commit, push, deploy, source-module removal, media move, user-data change or permanent QA deletion occurred. Existing production build policy and package command remain unchanged. The small `retirement-review` mode is local-only and is rejected by the production-main policy.

## Integration delta

- `src/studio/main.js` no longer imports/activates canonical panel/workspace/entry/router code or accepts a `canonicalCandidate`. Both ordinary Studio URLs and `candidate=canonical` run the ordinary editor. Old candidate/workspace requests show an ID/EN notice; a Gamelan workspace request links to temporary legacy export access rather than converting data.
- `src/main.js` no longer switches ordinary Studio to the Gamelan workspace. Beatbox and Studio still load their ordinary owners. `src/app/localization.js` no longer rewrites experimental promotional navigation.
- `src/studio/page.js` retains an explicit recovery link using the small stable `src/app/legacy-recovery-link.js`. Its ID/EN URL matches the old recovery helper; it imports no experimental classes.
- `scripts/gamelan-public-pages.mjs` leaves ordinary page navigation unchanged even in old candidate build modes, preventing Gamelan promotion from being injected again. `vite.config.js` now includes the original recovery entries independently of all feature flags. The original reader implementation and HTML remain byte-for-byte unchanged.
- `/loop-station/` and `/en/loop-station/` now have lightweight ID/EN notices linking to the two ordinary tools and the retained recovery reader. They contain no scripts. A marker prevents the old production transform from rewriting their titles/metadata as an active Preview. `public/retired.css` is the only new public asset.

The ordinary V1–V3 engine, output stages, catalogs, schema, stores and `src/project/mode-transfer.js` were not changed. V3 mode transfer remains distinct from the experimental handoff inbox. B2's partially qualified utility stays isolated/unreferenced; it is not a production input.

## Required exceptions and exact residual footprint

1. **Existing recovery:**35 source files for the public reader plus2 handoff-only files form37 retained files. The reader continues exporting original complete packages, sources and recorded takes. Nine registry/manifest JSON imports of `canonical-registered-assets.js` and the data-only Loop helpers remain intact. Their exact paths/hashes are pinned in `BUILD-AND-REGISTRY-PINS.json` and the final manifest.
2. **Beatbox handoff:**`src/beatbox/canonical-origin.js` and `src/project/canonical-handoff.js` remain reachable through the original explicit `canonicalOrigin` query. The source-download control is retained and tested, not replaced with a link or the B2 utility. Its26-file transitive data closure mostly overlaps the reader. `CanonicalHandoffStore.open()` can create a missing DB; this historical behavior was not adopted as a new readonly reader or claimed fixed. Native fixture tests use an existing seeded inbox, not a missing user DB.
3. **Gamelan:**the original ID/EN Gamelan and credits HTML were restored to their verified baseline after the review guardrail arrived. Their raw-document export access remains. The root module closure retains93 files, including failed playback dependencies, as a temporary legacy exception. It is deliberately omitted only from the local small review subset; that subset is not publishable.

Important storage correction for the next gate: the4MiB Gamelan workspace is in localStorage, but `perkusi.workspace.instrument-route.v4` is a3MiB **sessionStorage** envelope. B2's localStorage-key prototype does not replace that session data access. A future same-origin export slice must preserve both exact raw strings, including corrupt/future data, without clearing/converting them or loading playback. Until reviewed, do not remove the last Gamelan export route, its dependencies or its media. Keep the original handoff download until a same-origin readonly replacement is proven too. No additional recovery framework was started in C1.

AST evidence: ordinary entry closure71 source modules, ordinary Studio34, dedicated reader35, handoff26. The union of reader+handoff is37. There are no unexpected failed-runtime modules outside the documented data exceptions in the ordinary closure; Studio and recovery do not import canonical controller/native/stream/capture/worklet owners. Remaining canonical-named compiled chunks are data/package/recovery code, not evidence that Preview is active. Exact per-file residual lists are in `GRAPH-FINAL.json`.

`NEXT-SOURCE-CANDIDATES.json` lists137 tracked source candidates outside the ordinary, reader, handoff and held-Gamelan closures. This is a next-review list, not deletion permission. Internal engineering entries/tests and shared dependencies must be checked before removal; no source files have been deleted.

## Evidence and artifact identity

Final focused tests: **131/131 PASS**, lint PASS. This is the124-test stable baseline,2 production-policy tests and5 focused C1 boundary tests. Tests verify stable recovery URL equivalence, absence of candidate activation, unchanged handoff access, independent recovery build entries, no unqualified B2 input, non-script Loop notices and preservation of ordinary/retired metadata across build modes. Historical failed-feature tests were not represented as a passing full suite.

Managed local build uses the unchanged disk/ownership guard and `cleanupAfterBuild:false`. Final artifact is `qa-artifacts/retirement-c1-2026-10-21/build-r3/`,88 files/6,586,818 bytes. All41 stable WAVs total5,452,684 bytes and match canonical source hashes. No Gamelan/Loop bank or source-form archives were copied. Production remains unchanged; this small subset size is not the size of a complete new deployment or browser download.

Chrome155.0.8059.85 ID/1366 and Edge155.0.4283.62 EN/390 both pass finite native journeys on the first pinned small artifact:

- Homepage two-tool cards/links, ordinary Studio default, old candidate/workspace queries opening the ordinary editor with accurate notices.
- Pattern and chain repeat across two cycles, Pause/resume/Stop, Beatbox repeat/variant/Pause/Reset/restart.
- Save/load, downloaded project equality, reload persistence,10-second48kHz PCM16 non-silent WAV exports from both tools. Studio peak≈0.4270 and Beatbox≈0.8732, below the existing0.95 guard.
- Retained handoff download:110,155 bytes, SHA256 `9e69de673482c20a21f0b833bce8e6c0d124dbe5d93f15f7a879bf5e625bfdea`, exact original fixture bytes.
- Original recovery UI exports a3,917,798-byte complete package with one original source and two synthetic recorded PCM assets; project fields, provenance, source/take hashes and the separate original-source download match the independent fixture. No user profile was opened. Fixtures reuse existing test constructors; these are not physical-microphone recordings.

The final configuration corrections affect only the Loop notice marker or build-time navigation handling. The final artifact is byte-identical to `build-r2` for all88 files, and86 files—including every JS/CSS/WAV/recovery output—are byte-identical to the full-journey artifact. Only the two Loop HTML markers changed; dedicated native checks verify their final ID/EN titles and zero scripts. Thus closed playback journeys were not rerun unnecessarily. `ARTIFACT-DELTA-AND-LOOP.json` and `FINAL-ARTIFACT.json` bind this reuse precisely.

Owned QA browsers/servers close. No physical-device, Safari, listening, long-session reliability or historical root-cause fix is claimed. Initial launcher/fixture mistakes occurred before browser admission and are retained as QA diagnostics; no product correction or green claim derives from them.

## Next smallest review gate

Review the ordinary disconnection and the137 candidate list independently. Separately authorize the smallest same-origin data-export protection for Gamelan localStorage plus sessionStorage, and the handoff inbox if its current access is to be removed. Keep the explicit exceptions until those gates close. Only afterward can final route/build retirement remove the old feature payloads and qualify a complete release. No production publication is requested by this C1 receipt.
