# Transfer backup deletion review

Date: 17 November 2026 (Asia/Jakarta).

## Findings and changes

The previous deletion handler read the transfer archive before opening the confirmation prompt. A newer transfer written by another tab while that prompt was open could therefore be deleted by the stale confirmation. A second reproduction denied session-marker removal: the handler had already removed the archive, so it reported failure after losing the backups. Production evidence for these failures is under `qa-artifacts/clear-backups-20261117/before-changed/` and `before-denied/`.

Cleanup now compares the exact confirmed archive again before changing storage. The check runs in a new task after the native confirmation closes, allowing queued cross-tab storage updates to reach the document first; checking synchronously after the prompt was insufficient in Chrome. Pending transfers are refused. It removes only the transfer session marker and two receiver receipts before deleting the archive last. On failure, removed metadata is restored when the same archive is still authoritative; rollback does not overwrite another tab's newer archive or receipt. Active drafts, regular saved projects, legacy saves and preferences are outside the cleanup's keys.

The button and bilingual confirmation now explicitly say that all transfer backups in Beatbox and Rhythm Studio are affected. The prompt explains that active projects, saved projects and downloaded files remain. Successful deletion has its own status and returns keyboard focus to the transfer button. Pending transfers, changed archives and cleanup failures have separate actionable messages, with retained backup choices refreshed after refusal.

## Verification method

`npm run test:clear-backups` uses isolated Chrome contexts and synthetic data. Six ordinary journeys cover both tools on Indonesian/English desktop and Indonesian phone layouts. Each downloads the original and displaced draft before cleanup, dismisses the confirmation and checks unchanged transfer metadata, then confirms deletion. Active drafts, saved project stores, legacy Studio V2 drafts/saves and an unrelated preference must remain byte-for-byte unchanged by deletion.

The open project's complete JSON is compared before deletion, after deletion and after refresh. The downloaded WAV must retain channel count, sample rate and frame count; each channel is compared digitally with correlation above 0.999, normalized difference below 0.002 and level difference below 0.01 dB. The first 40 ms and final 15 ms are excluded to isolate startup/end fades. Both tools' regular saves and the legacy Studio save are loaded and checked afterward. Starting another transfer must create a new bounded archive successfully.

Six additional browser cases cover both tools refusing pending transfers, refusing a newer archive written from another tab during the native confirmation, and preserving the archive when session-marker deletion is denied. Nine unit tests cover the exact cleanup-key scope, stale confirmation, pending state, denial at all four deletion points, interruption after archive removal and concurrent archive/receipt changes during rollback.

Evidence is under `qa-artifacts/clear-backups-20261117/`. Production verification matches the live main commit in `version.json` before running the same twelve browser journeys. Phone checks use browser emulation; the digital audio comparisons do not constitute physical-device or human-listening tests.

## Local results

All twelve browser journeys passed on the final build, with 12 WAV downloads, 60 project/backup downloads, nine channel comparisons and no browser errors. Active draft bytes, regular/legacy save bytes and unrelated preferences were preserved by deletion. Open-project JSON survived deletion and refresh, all 18 regular/legacy save loads matched their stored musical data, and fresh transfers succeeded afterward. The largest audio level difference was below 0.000001 dB.

All 676 unit tests passed, including the nine cleanup tests. Lint and the production build passed; the final build receipt is `qa-artifacts/build-retention/runs/14654ab8-7767-4e93-b740-6567d08f0560.json`. The two existing browser failure journeys for transfer storage refusal and a newer destination edit also passed. Final local evidence is `qa-artifacts/clear-backups-20261117/local-final/evidence.json`.
