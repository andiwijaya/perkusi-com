# Instrument articles delivery report

Date: 15 November 2026 (Asia/Jakarta).

## Delivered scope

The local implementation includes 16 instrument topics in Indonesian and English, two localized index pages, 16 original ImageGen covers, an independent playable pad on each article and a fourth homepage card after Pad Station. This is 32 localized articles plus two localized index pages. The user authorized production publication after the local checks passed; deployment verification is recorded below.

The topics are Drum, Bilah, Kendhang Ciblon, electric bass, nylon guitar, Kethuk, Kempyang, Kenong, Bonang panerus, Peking, Saron barung, Bonang barung, Demung, Kempul, Gong ageng and Slenthem. Each locale has six substantive sections, four introductory exercise steps, geographic/traditional context, construction and technique facts, a listening note, and three or four editorial references. Bilah is explicitly identified as Perkusi.com's original synthetic voice. A digital drum voice inventory is not represented as eight physical drum-kit components.

Articles are available at `/instrumen/<slug>/` and `/en/instrumen/<slug>/`. Their main reading content is rendered in HTML at build time, with localized canonical/alternate metadata, article-specific social images, JSON-LD Article metadata, source links and related reading. Index search and category filters work without replacing the navigation or audio owner. Without JavaScript, all article reading and the complete index remain available.

## Images

All 16 covers were generated with the built-in ImageGen tool using original factual prompts. No reference photograph was uploaded or copied. The illustrations use a consistent dark green editorial style, are labelled as AI illustrations, and are not presented as documentary photographs or measured diagrams. The drum cover was regenerated after a visible pedal-position error; the rejected candidate is retained in QA evidence.

Final WebP covers are 1536×1024, total 2,233,608 bytes, with each below 300 KB. Final assets: `public/images/instruments/`. Exact prompts, factual reference URLs, per-image visual reviews, dimensions, hashes and original locations: `src/instruments/image-provenance.json`. Original PNGs: `qa-artifacts/instrument-articles/images-original/`.

## Audio behavior

The inventory contains 110 curated strikes/pitches: Drum 8, Bilah 5, Kendhang 2, bass 3, guitar 3, Kethuk 2, Kempyang 2, Kenong 11, Bonang panerus 10, Peking 12, Saron barung 12, Bonang barung 8, Demung 12, Kempul 11, Gong ageng 1 and Slenthem 8. Pelog and Slendro remain separate selections where applicable. Available degrees are identified as curated subsets rather than complete instruments or universal tuning.

No audio fetch or source playback occurs before explicit preparation. The article imports only its selected descriptor and loads only that bank's samples. Preparation shows progress and supports retry. Pads support click, emulated touch and numeric shortcuts; text/range/select inputs do not trigger those shortcuts. Stop silences current voices while preserving prepared samples. Volume uses the existing master range. Bass changes fade the previous note, repeated pitches fade older voices, and closed hi-hat chokes the open hi-hat voice. Same-page language changes preserve the prepared player. Bank replacement and page exit dispose the previous owner.

The adapter reuses SampleBank validation, load/decode queues, AudioEngine context ownership and aggregate memory admission, existing voice envelopes, fixed calibration and programme output protection. Its playable bank is registered as an independent instrument bank, as in the existing composition architecture. This resolved an initial failure where three independent bass notes were treated as simultaneous loop stems. No shared audio safety limits were weakened.

Recording attribution, CC BY 3.0 / Artistic 2.0 notices, CC0 sources, manifests and corresponding-source archive links remain available in article audio credits.

## Verification

| Check                        | Final result                                                                                                                                                                 | Evidence                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Full Node suite              | 659 passed, 0 failed, 0 skipped                                                                                                                                              | `qa-artifacts/instrument-articles/unit-tests.log`                          |
| Four new focused regressions | Passed: independent note admission, complete long-tail buffer, Stop during resume, static bilingual content/pads                                                             | `tests/instrument-articles.test.js`                                        |
| Lint                         | Passed                                                                                                                                                                       | `npm run lint`                                                             |
| Production build             | Passed                                                                                                                                                                       | `qa-artifacts/instrument-articles/build.log` and its managed build receipt |
| Article browser suite        | 38 grouped checks passed, no unexpected errors                                                                                                                               | `qa-artifacts/instrument-articles/browser-evidence.json`                   |
| All sound output             | 220 assertions: every one of 110 strikes/pitches in both languages creates a non-looping source and measurable final output within the output ceiling                        | `browser-evidence.json`                                                    |
| Loading and lifecycle        | Passed: no fetch before prepare, no autoplay, 503 failure/retry, slow loading, rapid scale replacement, Stop, language/history preservation and context closure on page exit | `browser-evidence.json`                                                    |
| Responsive article journeys  | 48 views across ID/EN, home/index/article, at 320/360/390/430/768/1280/1440/1920 pixels; no horizontal overflow                                                              | `browser-evidence.json`, screenshots                                       |
| Static reading               | 32 localized articles checked without JavaScript; sources, metadata and initial disabled controls remain present                                                             | `browser-evidence.json`                                                    |
| Existing browser regressions | 14 checks and 64 viewport views passed                                                                                                                                       | `qa-artifacts/instrument-articles/regression/browser.json`                 |
| Touch emulation              | All 16 instruments tapped successfully; range input shortcut guard and all 16 lazy-image decodes passed                                                                      | `qa-artifacts/instrument-articles/touch-evidence.json`                     |

The existing browser runner had stale assumptions about a missing space in the homepage heading and about all visited tools never loading audio. Its heading expectation now matches the rendered text. Homepage asset isolation is still tested strictly in a fresh homepage context, while ordinary Studio/Beatbox preparation remains allowed on their own pages.

The Windows sandbox blocked junction creation and localhost connections during the first unit run, and blocked the managed dist rename during a build. Those checks were rerun with the same project scripts outside the sandbox and passed. These were environment limitations, not bypassed assertions.

Editorial links were also checked separately: no source returned HTTP 404. Some institutions returned anti-automation 403/429 responses or transport errors; these remain verification limits, not evidence that their references disappeared. Full results are in `qa-artifacts/instrument-articles/source-links.json`.

## Limits and release state

Browser checks used installed Chrome 157 and emulated viewport/touch settings. No physical phone, Safari/iOS, spoken screen reader, expert cultural review or human listening session was performed. Measured browser output establishes functional playback, not speaker quality or a complete simulation of physical playing technique. AI illustrations were visually reviewed but are not expert-certified instrument diagrams. ImageGen use alone is not a legal guarantee; reference/provenance records are retained.

The work is complete in the current checkout, with a successful local production build. Production publication uses the existing GitHub main → Cloudflare Pages integration, as authorized by the user. Existing unrelated untracked files were preserved.

Progress checklist: `docs/features/INSTRUMENT-ARTICLES-CHECKLIST.md`.
