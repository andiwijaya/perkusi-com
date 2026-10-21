# B1 — media preservation

**PASS for parent review before B2.** B1 copied18 media files (17,410,563bytes) and39 license/provenance/recipe files. Total:57 independent copies /17,968,268bytes. Originals remain in place. Before/after SHA256 and historical manifest checks match; existing large libraries were not duplicated.

| Canonical location | Contents and status |
| --- | --- |
| `internal/media-library/suling/source-packet/` | Original WebM, native Float32 PCM/WAV, primary source/license page, intake/transform metadata and recipes. Candidate remains NOT PRODUCTION QUALIFIED. |
| `internal/media-library/suling/technical-packet/` | Three raw diagnostic WAVs, complete readable CC BY-SA4.0 license, attribution, extraction/quality records and analysis recipes. Diagnostic status retained. |
| `internal/media-library/beatbox-masters/masters-48k/` | Twelve original authored48kHz masters. Current32kHz delivery is unchanged. |
| `internal/media-library/beatbox-masters/recipe/` | Exact original generator source, with historical workspace-relative paths retained. Not executed. |
| `internal/media-library/beatbox-masters/provenance/` | Original pack/score manifest, CC0 notices, legal code, character-license notice and generation proof. |

`ARCHIVE_MANIFEST.json` records every one of57 original-to-canonical paths, byte counts and SHA256 hashes. Selected Suling source/technical relative layouts are preserved. Historical packet manifests and seals still describe their original complete QA packets; the new archive manifest describes this selected subset. Unrelated rejected-source pages, browser profiles, build trees and large traces were not copied.

`MEDIA_INVENTORY.csv` contains679 rows:622 existing internal files and57 archival copies, including format, bytes, SHA256, source, instrument/role, rate, license, attribution and status. Generated inventory/README/archive-manifest files are excluded from their own row count. It preserves existing source/candidate distinctions; no Suling sample was activated, transformed, retuned, relabeled as an accepted patch or newly certified by listening.

## Git and build exclusion

The only tracked edit is six scoped `.gitignore` lines. All57 archive payload files are ignored. Only the small README, central CSV and archive manifest are Git-visible metadata. None were staged, committed or uploaded.

App/runtime/recovery/build source hashes match Phase A. Current resolved Vite entries and public directory, import references, eight asset globs and the delivery plugin's explicit directories exclude `internal/media-library/`. The existing776-file emitted manifest also contains no archive path. **No fresh build was run**; this is a static/configuration exclusion proof, with emitted-output qualification reserved for the later build gate. A future force-add, import or broadened copy glob would require review.

The first verification attempt stopped on a raw forward-slash/backslash comparison of the same Windows public directory. Evidence is retained in `VERIFY-ATTEMPT1.json`; native path normalization fixes the audit comparison without changing a build guard, source or runtime. Vite's existing custom-resolver deprecation warning remains unchanged.

The following verification completed copy, Git/build-exclusion and622 existing-file hash checks, then stopped because its generated report would overwrite this already-written report. That refusal is retained in `VERIFY-ATTEMPT2.json`. Final closure reuses those recorded checks and independently reconciles all57 copies/originals and source/Git state; media was not copied a second time.

## Preservation and boundaries

Post-copy checks cover all18 media,39 copied metadata files and622 existing internal files. Copies are distinct files/inodes, not hardlinks. Suling retains its original attribution and CC BY-SA4.0 notices; Beatbox master media retains original CC0 notices. Future mixed exports/adaptations still need the license treatment appropriate to their content.

HEAD remains `68d289eb03af75eaf071ae1b9c20a5f23194b732`. No runtime/recovery changes, source removal, media move/deletion, QA deletion, engine/model change, commit/push/deploy or physical listening claim occurred. This is a local preservation copy, not an off-device backup.

Next is parent review, then B2 readonly original-data export coverage. Gamelan raw documents and handoff originals still require that protection before runtime/routes are retired. B1 grants no new permanent-deletion permission.
