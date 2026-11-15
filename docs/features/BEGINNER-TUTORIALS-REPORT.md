# Beginner tutorials for Pad Station, Beatbox and Rhythm Studio

Date: 15 November 2026 (Asia/Jakarta).

## Delivered behavior

Each tool has a native, keyboard-accessible tutorial near the top of the page. The tutorial starts collapsed, remains readable without JavaScript, and keeps its open state during a same-page language change. All content is available in Indonesian and English. Shared copy uses the existing localization system without replacing the workspace DOM.

- Pad Station: visible three-step introduction, independent readiness of the five main groups, a four-count kick/snare exercise, additional-instrument selection, master volume, mute/stop, keyboard controls, connection/silence recovery, and playing across independent devices. A link explains how to move on to Rhythm Studio for pattern creation and WAV export.
- Rhythm Studio: definitions of rows, columns, patterns and chains; a complete first-beat exercise; mixer and live-pad distinctions; extending the chain; naming, making and downloading WAV; editable JSON backups; demos and troubleshooting.
- Beatbox: audio readiness, building a Bumi/Cicik/Dum mix, A/B variations and next-bar changes, pause/reset, project backups, WAV export, keyboard controls and troubleshooting.

While the Beatbox tutorial is open, its transport uses normal document flow so the sticky panel cannot cover the reading text. Closing the tutorial restores the existing sticky transport.

## First-beat example

Start with a blank pattern A and one A bar in the chain. Save an existing project before clearing its pattern or adjusting its chain. Choose Ruang, 100 BPM and Swing 0.

| Row        | Enabled columns           |
| ---------- | ------------------------- |
| Kick       | 1, 5, 9, 13               |
| Snare      | 5, 13                     |
| Closed hat | 1, 3, 5, 7, 9, 11, 13, 15 |

Add A to the chain three more times, for A → A → A → A. Play, pause, name the project, make the chain WAV and download it. The four-bar example lasts 9.6 seconds.

## Verification

- Full Node suite: 659 passed, no skips. Run outside the Windows sandbox when its junction/localhost restrictions prevent the existing test fixtures from operating.
- Existing browser regression: 14 checks and 64 viewport cases passed.
- Local tutorial acceptance: 66 checks passed, with four actual WAV downloads and no browser errors. `npm run test:tutorials` checks six localized routes, native keyboard operation, no autoplay during reading, language and DOM continuity, reading without JavaScript, eight viewport widths (320–1920), Pad Station practice and additional instruments, and actual Studio/Beatbox WAV downloads. The Studio example produced 48 kHz, 16-bit stereo WAVs lasting exactly 9.6 seconds; Beatbox produced the expected 10-second four-bar WAVs.
- The acceptance runner reads the existing CSP, applies it to local documents, and suppresses analytics only in its isolated browser when checking production.
- Local screenshots and downloaded audio are stored under `qa-artifacts/tutorials-20261115/`, outside the release source.

The tests use headless Chrome and emulated viewport widths. Physical devices, human listening, spoken screen-reader use, and usability sessions with new users remain unverified.

## Release

Use the existing GitHub main → Cloudflare Pages integration. Confirm `https://perkusi.com/version.json` matches the merged source commit, then run the tutorial acceptance suite against production with `PERKUSI_TUTORIAL_BASE_URL=https://perkusi.com` and a separate `PERKUSI_TUTORIAL_QA_DIR`.

The production acceptance run writes its observed results and downloaded WAV metadata to `qa-artifacts/tutorials-20261115/production/evidence.json`. The live version endpoint identifies the deployed source revision.
