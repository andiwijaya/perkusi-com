# New pattern and reset safety review

Date: 17 November 2026 (Asia/Jakarta).

## Production findings

On main commit `5beb5fcab8b166f3024977d24ad96f8a71c7ce2c`, Beatbox Reset and Studio Clear pattern and Delete pattern changed the active project without confirmation. Studio Load demo checked only the current undo history; a recovered active draft has no undo entries and was replaced without a prompt. All four behaviors were reproduced through public controls with synthetic projects, with zero dialogs, zero downloads, zero file choosers and no browser errors. Evidence: `qa-artifacts/project-reset-20261117/before/evidence.json`.

## Changes

Beatbox Reset now always asks before clearing characters and returning variations to A. The dialog names the active project and explains that its name, volume, WAV length and saved projects remain. Cancelling announces that the active edits are retained.

Studio Clear pattern, Load demo and Delete pattern now always ask before changing the active work, including after refresh or with only a playback-mode edit. Dialogs identify the project and selected pattern where applicable, explain the scope, and advise saving first. Cancelling changes neither the score, current settings nor playback. Names containing literal dollar signs are preserved in the messages.

Studio New pattern adds an empty pattern and preserves existing patterns and the chain. Return to start pauses and rewinds without clearing the beat. These actions retain their direct behavior. Saving a new named project still creates a browser save; it does not clear the active session. The Indonesian and English Beatbox reset and Studio demo tutorial instructions explain the new confirmation step.

## Verification

`npm run test:reset-projects` starts the normal built application in an isolated browser. Six main journeys cover both tools on Indonesian/English desktop (1440 px) and an Indonesian phone viewport (390 px). Each edits an active project, waits for autosave, refreshes to clear undo history, then cancels every destructive action and compares the full draft and visible controls. Confirmed operations are compared against their precise expected scope and checked again after refresh. Studio New pattern preserves existing patterns and chain; Undo restores the original score, and Return to start preserves it.

Four further journeys type a title and immediately open Reset, Clear pattern, Load demo or Delete pattern before the autosave timer fires. Cancelling and refreshing must retain the entire edited project. Two playback journeys verify that cancellation keeps the beat playing and preserves the full project through a subsequent refresh.

Saved collections, the other tool's active draft, legacy saves/drafts, transfer archives and a synthetic preference are compared directly as browser storage data. No Download, Upload, Import, Share or WAV export controls are used. Browser contexts disable downloads, count download/file-chooser events, and collect page errors. This is browser viewport emulation and data verification, not physical-device testing or a new WAV/audio comparison.

For production, the runner first checks live `version.json` against the expected merged main SHA, then repeats the same UI and storage journeys against the real site. Local and production JSON evidence belongs under `qa-artifacts/project-reset-20261117/`.

## Local results

All 39 browser check groups passed across twelve isolated contexts, with zero downloads, zero file choosers and no page errors. The full project survived every cancelled operation, immediate-edit cancellation, playback cancellation and refresh. Confirmed operations matched their stated scope, and all protected stores remained unchanged. Evidence: `qa-artifacts/project-reset-20261117/local/evidence.json`.

All 703 unit tests, lint and the final production build passed. Build receipt: `qa-artifacts/build-retention/runs/af8e2df5-1024-48d5-9974-2e10471e9ef6.json`. The unit suite needs localhost sockets and temporary junctions on this Windows host; its restricted-shell attempt could not perform those OS operations, and the normal host run passed all tests.
