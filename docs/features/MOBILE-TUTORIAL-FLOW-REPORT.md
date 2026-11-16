# Mobile tutorial flow review

Date: 16 November 2026 (Asia/Jakarta).

## Observed difficulties

The review followed the public Indonesian tutorials at a 390 × 844 CSS-pixel viewport, then checked the revised flows with touch emulation in both languages. This is an implementation and usability review, not a study with recruited new users or a physical-phone test.

- Pad Station's expanded tutorial was about 2,264 pixels tall. Reaching Drum from the first instruction required scrolling through the remaining instructions and controls. The keyboard numbers were much more prominent than the sound names on phone-sized pads.
- Rhythm Studio's expanded tutorial was about 2,972 pixels tall. Its recipe and grid were far apart, and reaching the export section required passing the additional instrument editors and mixer. Its sticky transport occupied about 292 pixels at this phone width.
- Beatbox required moving between the tutorial, transport, character rows and saving section. On the two-column phone layout, Cicik and Dum are in the second row. The previous sound-pack note also made the playable trial sound as if it were unavailable.

## Changes

- Each actionable tutorial step links directly to its corresponding controls, pads, grid, chain or export section. Following a link collapses the full guide, opens the relevant practice panel and moves keyboard focus to the destination.
- Return links remember the last tutorial step read. Browser Back returns to the source step as well. Hash navigation and same-page language changes retain the workspace DOM and musical choices.
- Pad Station has an optional four-count practice panel immediately above Drum: Kick → Snare → Kick → Snare. Phone pads emphasize sound names; keyboard badges remain on wider screens. The phone transport has a compact stop/mute row and one volume row, measuring about 131 pixels at 390 pixels wide.
- Rhythm Studio has an optional copy of the first-beat recipe beside the grid, direct links onward to the chain and WAV section, and a concise export reminder. At widths up to 700 pixels, its transport stays in normal document flow to leave room for the editor.
- Beatbox has a three-character reminder near the stage, directions to the second phone row, direct links to sound controls and saving, and a clear trial-version note that retains its evaluation status.

The navigation controls do not start playback, load a demo, clear a pattern or replace a project. They support native links as a fallback when JavaScript is unavailable.

## Verification

- `npm run check`: lint and production build passed.
- `npm test`: 659 passed, no skips.
- `npm run test:e2e`: 14 checks and 64 viewport cases passed.
- `npm run test:tutorials`: 84 checks passed locally with no browser errors and four real WAV downloads. The suite includes native keyboard use, static reading, both languages, eight layout widths, touch navigation and browser Back at 360/390/430 pixels, and complete phone flows through the music controls and export.
- The first-beat flow uses touch events in a fresh 390 × 844 mobile context. It follows the tutorial links, creates the 14 drum cells, builds four A bars at 100 BPM, plays/pauses and downloads a 9.6-second stereo WAV. Beatbox's corresponding four-bar download lasts 10 seconds.
- Interactive browser review checked Pad Station's exercise alongside the actual pads, focus/return behavior, the Studio recipe near its grid, and Beatbox's Bumi/Cicik/Dum mix.

Local evidence: `qa-artifacts/mobile-tutorials-20261116/local/evidence.json`.

Release through the existing GitHub main → Cloudflare Pages integration. Match the live `version.json` to the merge commit and rerun the same suite with `PERKUSI_TUTORIAL_BASE_URL=https://perkusi.com`; production results are recorded in `qa-artifacts/mobile-tutorials-20261116/production/evidence.json`.

Physical devices, human listening, spoken screen readers and recruited-user usability sessions remain unverified.
