# Instrument articles delivery checklist

Started: 15 November 2026 (Asia/Jakarta). Scope: 16 instrument topics in Indonesian and English, 16 original ImageGen covers, an instrument-only playable pad on every article, an index, and a new homepage card. Existing unrelated untracked files are outside this change.

## Progress

- [x] Inspect current routes, localization, build pipeline, audio ownership and existing sample inventory.
- [x] Verify instrument-specific editorial sources and record image briefs.
- [x] Generate, inspect, save and optimize all 16 ImageGen covers.
- [x] Write and review all 16 Indonesian articles and their English versions.
- [x] Add static article routes, metadata, sources, related reading and index filters.
- [x] Add the instrument-only pad: explicit prepare, progress, retry, scale selection, touch/keyboard, volume, stop and navigation disposal.
- [x] Add the Artikel Instrumen / Instrument Articles homepage card.
- [x] Verify all 110 available strikes/pitches and both locales.
- [x] Verify failure/retry, slow loading, no autoplay, stop, navigation and language behavior.
- [x] Verify responsive layouts, keyboard accessibility, images, metadata, sitemap and no-JavaScript reading.
- [x] Run lint, unit tests, production build and browser regression checks; resolve failures.
- [x] Record final evidence and remaining verification limits.
- [x] Publish through the existing GitHub main → Cloudflare Pages integration and verify the production commit, article routes, images and pads.

## Per-topic status

| Topic           | ID   | EN   | ImageGen image | Playable pad | Browser QA |
| --------------- | ---- | ---- | -------------- | ------------ | ---------- |
| Drum            | done | done | done           | done         | PASS       |
| Bilah           | done | done | done           | done         | PASS       |
| Kendhang Ciblon | done | done | done           | done         | PASS       |
| Electric bass   | done | done | done           | done         | PASS       |
| Nylon guitar    | done | done | done           | done         | PASS       |
| Kethuk          | done | done | done           | done         | PASS       |
| Kempyang        | done | done | done           | done         | PASS       |
| Kenong          | done | done | done           | done         | PASS       |
| Bonang panerus  | done | done | done           | done         | PASS       |
| Peking          | done | done | done           | done         | PASS       |
| Saron barung    | done | done | done           | done         | PASS       |
| Bonang barung   | done | done | done           | done         | PASS       |
| Demung          | done | done | done           | done         | PASS       |
| Kempul          | done | done | done           | done         | PASS       |
| Gong ageng      | done | done | done           | done         | PASS       |
| Slenthem        | done | done | done           | done         | PASS       |

## Acceptance notes

Implementation status: all 32 localized articles and both index pages render at build time. Covers are 1536×1024 WebP files totaling 2,233,608 bytes; original PNGs and rejected drum candidate remain in ignored QA evidence. Exact prompts, references, hashes and visual-review notes are in `src/instruments/image-provenance.json`.

During first browser QA, independent bass notes were incorrectly subjected to simultaneous-loop headroom admission. The article adapter now registers its playable bank as a separate instrument bank, matching the existing composition architecture. Shared memory admission, PCM inspection, envelopes and output ceiling remain active. Four focused regression tests cover note admission, complete long tails, Stop during pending resume, and substantive localized static articles.

Final evidence: all 659 unit tests pass (655 existing plus four new). Article browser QA passes 38 grouped checks, 32 localized article journeys, 220 measured sound-output assertions, 48 responsive views and 32 no-JavaScript article views. Ordinary browser regression passes 14 checks and 64 viewport views. Touch emulation passes for all 16 instruments; all 16 lazy images decode after scrolling. Tests ran outside the Windows sandbox because it prevented junction creation and localhost connections. The local production build succeeded after the sandbox had refused the managed dist rename. See `INSTRUMENT-ARTICLES-REPORT.md` for evidence paths and verification limits. Production release `6628c92bbebee9343e0978c5ded0a0bbe9f29641` is live and the full 38-check article suite also passed against perkusi.com, including 220 sound-output assertions and all 16 image hashes. Closing-commit verification is recorded in the live completion evidence.

- Bilah is Perkusi.com's synthetic voice; never describe it as a documented traditional artifact.
- Separate cultural origins from recording provenance and from later geographic spread.
- Pelog/slendro are source labels; available pads are curated subsets, not complete gamelan sets or a claim of shared tuning with Bilah.
- AI illustrations are labelled and checked for anatomy; references are not copied.
- Preserve sample attribution, licenses and corresponding source links.
- Browser audio inspection establishes functioning playback, not a claim of physical-device or expert listening validation.
