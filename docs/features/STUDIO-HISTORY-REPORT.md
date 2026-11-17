# Studio Undo/Redo state restoration

Date: 17 November 2026 (Asia/Jakarta).

## Findings

Production on main commit `cb46e7f2bcd0476dc76475b3a9abe83184268a75` restored score data after Undo, but Undo after Load demo left playback in chain mode and lost the previous fixed programme gain. A Clear → Delete → Demo sequence followed by playback and three Undo steps likewise retained chain mode and lost the original level. The shared score history did not capture current playback metadata at each transition; those values also lived separately in the player. Production evidence: `qa-artifacts/studio-history-20261117/before/evidence.json`. No files were imported, exported or downloaded.

## Changes

The history can capture a validated live snapshot on edit, Undo and Redo without adding an extra undo entry. Each edge retains complete project fields and the playback mode/level belonging to that state. Invalid snapshots leave both stacks intact; normal no-op, branching and bounded-history behavior is preserved.

Studio captures the model state before applying input edits, normalizes level metadata against the actual score, and restores player mode and remembered level from the recovered snapshot. Load demo explicitly records its chain mode within the same history edit. The playback-mode control is also undoable. Keyboard shortcuts and the Undo/Redo buttons share the same guarded restore path.

Scores that have not been played have no calibrated level. Restoring such a score pauses playback until Play prepares it; it does not inherit a later beat's calibration. A previously heard state restores its saved programme gain. Normal project loading and transfer recovery use the same playback-level restoration helper. Existing confirmation controls and saved project data retain their flows.

## Verification method

`npm run test:studio-history` uses isolated synthetic projects, public UI controls and browser data only. The fixture includes three distinct patterns, repeated chain references, drum velocities, Bilah notes, Kendhang, bass, guitar, per-pattern Beatbox loops and A/B variations, instrument/track mixes, pan, mute, kit, tempo, swing, quantization, title, active pattern and fixed programme level.

Eighteen operation journeys cover Clear pattern, Delete pattern and Load demo in both pattern and chain mode, on Indonesian/English desktop (1440 px) and an Indonesian phone viewport (390 px). They cancel once, confirm, cycle Undo/Redo twice, compare every project field and visible control, branch after Undo, then refresh. English desktop uses keyboard shortcuts; the other layouts use buttons. Three series journeys clear, delete, load a demo, actually play the changed demo and then Undo/Redo all three transitions. They also verify undoing/redoing the playback-mode control and a final refresh.

Browser storage comparisons protect saved collections, Beatbox drafts, legacy projects/drafts and transfer archives. The browser disables downloads, records download/file-chooser events, and collects page errors. This is browser viewport emulation and project/player-setting verification; it is not physical-device or new WAV/PCM parity evidence.

Production QA first checks live `version.json` against the merged main commit and repeats the same journeys against perkusi.com. Evidence belongs under `qa-artifacts/studio-history-20261117/`. The existing file-free reset suite is also run against the updated local build to check confirmation and active-project safety.

## Local results

All 135 history browser check groups passed across 21 journeys, with zero downloads, zero file choosers and no page errors. Full score/settings snapshots and visible controls were restored after each operation and repeated Undo/Redo. Multi-level restoration survived an intervening played demo with a newly measured level. New edits correctly discarded the former redo branch, and the restored project persisted through refresh. Protected stores remained unchanged. Evidence: `qa-artifacts/studio-history-20261117/local/evidence.json`.

The file-free reset regression suite passed all 39 checks, also with zero downloads, file choosers and page errors. All 710 unit tests passed, including seven new snapshot-history tests for live state, later calibration, invalid snapshots, no-ops, branching and isolation. Lint and the final production build passed. Build receipt: `qa-artifacts/build-retention/runs/e138a593-465e-4349-b965-38cfd0e66925.json`.
