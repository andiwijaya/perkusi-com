# Transfer archive recovery review

Date: 17 November 2026 (Asia/Jakarta).

## Findings and changes

Valid originals and displaced drafts retain their project data in the transfer archive. The missing recovery instructions made it unclear that the downloaded file should be imported in its original tool, especially when recovering a complete Studio project from Beatbox. Recovery now groups originals and displaced drafts separately, explains replacement of the destination's open project, asks users to download that project first, and links to the matching tool's Import button. File names include the tool and project title. Unreadable retained drafts remain downloadable as their original raw bytes, with an explicit warning and no restore link.

Production testing found a persistence defect in both tools. When startup cannot read the active draft, autosave is disabled to protect that unreadable data. A later valid import previously populated the editor without re-enabling draft persistence, so refreshing discarded the recovered beat. Beatbox and Studio now persist explicitly imported or loaded valid projects immediately and enable draft autosave again. Invalid imports and cancelled replacements do not take that path. This does not rewrite protected transfer archives or existing named projects.

The before-fix reproductions are `qa-artifacts/transfer-recovery-20261117/before-damaged-beatbox/` and `before-damaged-studio/`. Each downloaded recovery file matched the full source, and the initial imported editor matched it. The first refresh then returned an empty/default project instead. The failure was reproduced separately in both tools.

## Verification

`npm run test:recovery` uses isolated Chrome contexts and synthetic data. Six journeys restore both an original and a displaced destination draft after Beatbox-to-Studio and Studio-to-Beatbox transfers in Indonesian/English desktop layouts and an Indonesian phone viewport. The English Beatbox journey also switches back and forth before selecting earlier retained originals and drafts, verifying that the recovery help follows the selected archive entry.

Each restoration uses the actual Import button and downloaded file, checks every project field and visible controls, refreshes before making a named save, then saves, changes the open project, and loads the saved recovery. It also verifies that recovery never starts audio automatically, playback can start explicitly, and the protected transfer archive remains byte-for-byte unchanged. Phone journeys first damage the active draft after navigation, reproducing the startup quarantine independently for both tools and archive types.

The full Studio fixture includes separate patterns, selected-pattern/chain playback, remembered playback gain, swing, quantize, kit, per-instrument mix and mute, A/B loop variants and per-pattern loops, custom drum steps, Bilah, Kendhang, bass and guitar notes. A legacy Studio V2 draft at 123 BPM and an unreadable retained draft have separate checks. The legacy file keeps its original raw bytes and restores the same V2 musical fields through migration. The unreadable file is rejected without replacing the current valid beat.

Audio comparisons require the same channel count, sample rate and frame count, then compare every channel with correlation above 0.999, normalized difference below 0.002 and level difference below 0.01 dB. The first 40 ms and final 15 ms are excluded from sample comparison to isolate startup/end fades. Browser phone emulation and digital PCM checks do not constitute physical-device or human-listening tests.

Evidence is under `qa-artifacts/transfer-recovery-20261117/`. Production QA must first match live `version.json` to the merged main commit, then run the same eight recovery journeys directly on perkusi.com.

## Local results

All eight recovery journeys passed. The six main journeys restored 12 originals/drafts with full project-field checks, save/load, refresh and 18 channel comparisons. The legacy Studio draft also restored successfully; the unreadable backup was rejected while preserving the valid current project. There were 24 WAV downloads, 68 project/backup downloads and no browser errors. The largest measured level difference was below 0.000001 dB.

All 667 unit tests passed. Lint and the production build passed; build receipt: `qa-artifacts/build-retention/runs/1245780b-a949-4f39-89d5-8047dff81a53.json`. The final recovery script also passed ESLint after the browser checks were added.

All eight existing transfer-regression journeys also passed, including storage refusal, newer destination edits and replay protection. Evidence: `qa-artifacts/transfer-recovery-20261117/transfer-regression/evidence.json`.
