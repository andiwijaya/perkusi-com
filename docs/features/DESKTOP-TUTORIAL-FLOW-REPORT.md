# Desktop tutorial flow review

Date: 17 November 2026 (Asia/Jakarta).

## Review and changes

The review followed the Pad Station, Rhythm Studio and Beatbox tutorials in a desktop browser, with a manual viewport of 1280 × 800 and automated checks at 1280, 1440 and 1920 pixels wide. It is a review of the implementation and interface, not a study with recruited new users.

- Pad Station showed large keyboard numbers above much smaller sound names. Those numbers could be confused with the four practice counts, whose third count calls for Kick rather than pad key 3. Sound names now appear first and larger, with smaller key-shaped shortcut badges underneath. The desktop exercise explicitly gives the keyboard sequence 1 → 2 → 1 → 2 and distinguishes keys from counts.
- Rhythm Studio's practice card used one vertical column despite substantial horizontal room. At desktop widths from 1100 pixels, its explanation and return link now sit beside the recipe table. The revised card measured approximately 275 pixels tall at 1280 pixels wide, leaving more grid rows visible beneath it.
- Beatbox's stage reminder included phone-row directions on desktop and did not explain the keyboard route for the first mix. Desktop now shows that keys 1–6 follow character order and that keys 3 and 4 add Cicik and Dum once Bumi is enabled. Phone-row directions appear only at narrow widths.

The existing tutorial links, return-to-step behavior, browser Back, project editing and audio controls are retained. Phone practice cards keep their stacked layout and hide desktop-only keyboard hints.

## Validation workflow

`npm run test:tutorials:desktop` checks both languages at three desktop widths using mouse activation, Enter, browser Back, focus placement, sticky-control clearance, readable sound labels and the compact recipe layout. It also follows the first-beat workflow with mouse/keyboard editing, uses Pad Station's 1–2–1–2 keyboard exercise, and starts Beatbox with Bumi before adding voices through keys 3 and 4. Studio and Beatbox must both produce actual WAV downloads.

The ordinary `npm run test:tutorials` suite remains the phone and general tutorial regression check. `npm run test:e2e` covers the existing site navigation, locale and layout contracts.

Local evidence is under `qa-artifacts/desktop-tutorials-20261117/`. Production desktop validation uses `PERKUSI_TUTORIAL_BASE_URL=https://perkusi.com` and a separate `PERKUSI_DESKTOP_QA_DIR`; the isolated browser suppresses analytics.

Release through GitHub main → Cloudflare Pages and match the live `version.json` to the merge commit. Production desktop results are recorded in `qa-artifacts/desktop-tutorials-20261117/desktop-production/evidence.json`.

## Local results

- `npm run check`: lint and production build passed.
- `npm test`: 659 passed, no skips.
- `npm run test:tutorials:desktop`: 24 checks passed with four WAV downloads and no browser errors. The Studio files are 9.6-second stereo WAVs and the Beatbox files are 10-second mono WAVs, all 48 kHz/16-bit with nonzero PCM.
- `npm run test:tutorials`: all 84 general and phone tutorial checks passed, including four more WAV downloads.
- `npm run test:e2e`: 14 checks and 64 viewport cases passed.

Human listening, spoken screen readers and recruited-user usability sessions remain unverified.
