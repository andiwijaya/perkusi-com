# Project save and import review

Date: 17 November 2026 (Asia/Jakarta).

## Findings and changes

Rhythm Studio preserved the visible mixer values but did not retain the fixed programme gain heard after a live mixer edit. Downloading that project, importing it into a new browser context and playing it again recalibrated the quieter score. The reproduced WAV became 11.4289 dB louder. The same scenario after the fix produces identical WAV bytes and a 0 dB level difference.

Studio's Play pattern / Play chain choice was also reset to chain by project loading. Optional `playback` metadata now stores the mode and the fixed programme gain for the current score. Browser saves, drafts and downloaded project files use the same snapshot. Renaming a project or pattern keeps its heard level; unplayed sound edits cannot inherit gain from a different score. A pattern preview's level belongs to its selected pattern. Loading remains paused, and existing projects without this metadata retain their original default behavior.

The metadata is validated, restricted to known fields and modes, and bounded by the existing programme gain limit. It is excluded from the drum sequence view. Conversion to Beatbox reports a mix difference when it cannot represent the Studio gain. The original Studio project remains available through the existing conversion workflow.

No data loss was found in the tested Beatbox save/import paths. Sound selection, each A/B variation, master volume and 4/8-bar export length survive browser save/load, draft refresh and import into a fresh browser context.

## Verification

`npm run test:projects` runs seven journeys: both tools at 1440 px in Indonesian and English, both tools at 390 px in Indonesian, and a Studio live-mixer session. Each ordinary journey downloads the project, saves it, deliberately changes it, reloads the saved copy, refreshes its draft and imports the downloaded file into a fresh isolated context. It checks all JSON fields, visible controls, no autoplay on restore, and WAV output before/after. A rejected file must leave the existing project intact. The English Studio journey additionally persists pattern-only playback.

The live-mixer journey changes three mixer levels while playback is running, pauses, names and saves the project, then compares browser load, draft recovery and fresh import. The fixed level is included in all three paths. Legacy-file parsing and malformed/out-of-range metadata have unit coverage.

WAV comparison requires identical channel count, sample rate and PCM length, at most two 16-bit quantization steps per sample, normalized error below 0.001 and level difference below 0.001 dB. Native Float32 summation can move a few samples by one quantization step without changing the score. Checksums remain in evidence; the live-mixer reproduction after the fix is byte-identical.

Evidence is under `qa-artifacts/project-roundtrip-20261117/`. Tests use synthetic projects in isolated Chrome contexts and do not read or overwrite personal production saves. Phone checks use browser viewport/touch emulation; physical devices, recruited users and human listening are not part of this check.

The production build and all 666 unit tests passed. The build receipt is `qa-artifacts/build-retention/runs/b4510712-03f5-473c-af31-39dbf0fbc08b.json`. Release QA matches the live main commit, then runs the project journeys directly against production.

All seven local project journeys passed with 22 WAV downloads and no browser errors. Visible control checks include track levels/pan, mute/solo, kit, active pattern, tempo/swing, quantization, playback mode, character selection/variation, master volume and export bars. Six native playback-versus-WAV regression scenarios also passed after the persistence change.
