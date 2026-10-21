# Phase A — project recovery assessment

Decision: preserve recovery while retiring failed playback. No personal browser profile, localStorage or IndexedDB was opened, exported, cleared or migrated during Phase A. Their actual user content remains UNKNOWN; fresh isolated QA contexts do not prove those stores are empty.

| Data family | Exact storage identity | Existing handling and required disposition |
| --- | --- | --- |
| Beatbox V1/V1.1 | localStorage `perkusi.projects.v1`, `perkusi.draft.v1` | Keep ordinary `ProjectStore`, schema0/1 validation, file export and current browser data. |
| Studio V2/V3 | `perkusi.projects.studio.v2`, `.v3`; `perkusi.draft.studio.v2`, `.v3` | Keep `CompositionStore` migration, original composition/Beatbox conversion and complete JSON export. |
| V3 mode transfer | `perkusi.mode-transfer.v3`, session `perkusi.mode-transfer.pending.v3`, per-mode `perkusi.mode-transfer.receipt.${target}.v1` | Stable functionality, not failed V5. Keep backup/original/draft handling and idempotent delivery. |
| Gamelan V4 | `perkusi.workspace.gamelan.v4`, `perkusi.workspace.instrument-route.v4` | Existing instrument store/export belongs to the route to be retired. Before removing it, provide readonly original JSON/backup export or explicitly preserve a small data-only reader. Do not silently convert into V3. |
| Loop metadata/profile | `perkusi.loop-station.draft.v5`, `perkusi.loop-station.incoming.v4`, `perkusi.loop-station.device-profiles.v1` | Preserve raw metadata and profile settings. Offset profiles are not hardware calibration or audio takes. |
| Loop audio V5 | IndexedDB `perkusi.loop-audio.v1`, DB version1; stores `documents`, `audio`, `credits` | Existing `legacy-loop-recovery.js` uses readonly transactions with upgrade-abort and `AudioDocument.portable()`. Its imports include data helpers in `src/loop-station/`; extract/retain these before deleting that directory. |
| Unified composition | IndexedDB `perkusi.composition.v6`, DB version1; stores `documents`, `blobs`, `credits`, `refs`, `pointers` | `CanonicalRecoveryStorage` opens existing DB only, aborts upgrade, validates stores/version, exposes readonly list/load and rejects save. Preserve complete original/take blobs and package export. Wire schema6 is not a V6 product acceptance claim. |
| Complete handoff originals | IndexedDB `perkusi.canonical-handoff.v1`, version1, `transfers` | Beatbox `canonicalOrigin` recovery currently uses `CanonicalHandoffStore`; reader is readonly but class `open()` creates/upgrades a missing DB and also carries mutation methods. Isolate existing-store readonly export/list before detaching this optional Beatbox integration. Do not lose original `.perkusi` blobs. |

The current `/studio/recovery/` and `/en/studio/recovery/` ESM closure has37 files, of which8 overlap the stable closure and29 are recovery-only. It contains no `AudioEngine`, canonical native/stream/job/worklet-frame-clock or capture processor. It does carry data validation/packaging and resource-accounting helpers plus a registered-asset descriptor registry; retaining those is not retaining a playback engine. Some class imports contain unused writer methods, so a later data-only extraction must restrict the exposed interface rather than claim file-level absence of write code today.

The current dedicated recovery UI covers composition + older Loop audio; it does not itself expose all Gamelan localStorage documents or the independent handoff inbox. Those are explicit gaps to close before Phase C. Existing live finite recovery evidence remains historical; Phase A did not rerun the full schema6 or real-user recovery matrix.

Per-file data dependencies: `FILE_PLAN.csv`, with exact edges in `qa-artifacts/retirement-a-2026-10-21/DEPENDENCIES.json`. Keep package validators/credits/original hashes and referenced media descriptors. Recovery should export original data without Play, mic, new DB creation, write transactions or lossy down-conversion. Phase B tests should seed isolated stores for each family, verify exact export/original/take hashes, missing/future/corrupt data refusal and zero upgrades/writes/audio contexts. Never test by altering a user's real profile.

No recovery implementation was changed in Phase A. Runtime retirement and any new deletion remain held behind the relevant later gates.
