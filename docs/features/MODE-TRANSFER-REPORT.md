# Beatbox and Rhythm Studio transfer review

Date: 17 November 2026 (Asia/Jakarta).

## Findings and changes

A single Bumi loop became 2.5328 dB louder when transferred from Beatbox and played in Studio, despite preserving the numeric master volume. Beatbox's loops have already passed their mastering stage. Conversion now gives the new Studio score a fixed programme gain of 1, so Studio does not independently boost the unchanged incoming mix. The normal Studio rules still discard a level belonging to a different score after unplayed musical edits.

The derived-copy dialog now states that Beatbox receives the loops heard in the selected pattern, A/B choices and master volume. Its unsupported-mix item explicitly names per-instrument level/pan, mute/solo and Studio playback level. The preview continues to disclose voice count, 4/8-bar duration and 96 BPM, with an empty-copy warning when no loops can be heard. It does not claim that custom Studio drum steps, notes, instruments, pattern changes or their mixes survive a Beatbox conversion.

Protected-original menus now include the source tool and project title. Displaced-draft menus include readable project titles where valid; opaque or corrupt raw drafts keep the generic tool label and remain downloadable byte-for-byte. These changes do not rewrite archive data.

Beatbox's stopped status now distinguishes a populated project from an empty stage. After receiving or restoring a populated project, it says the groove is ready and invites the user to press Play, in both Indonesian and English. Browser checks require this status after conversion and after refreshing newer edits.

## Verification method

`npm run test:transfer` uses isolated Chrome contexts with synthetic source projects, named saves and destination drafts. It runs compatible round trips and explicit derived-copy journeys in Indonesian/English desktop layouts and an Indonesian phone viewport. It checks public UI controls and actual downloaded files, without private application hooks.

Compatible round trips compare enabled sounds, each A/B variation, master volume, bar count and the downloaded audio, including a quieter one-voice mix. After both directions, all protected originals must download with identical project fields. The displaced destination draft must download with its original raw formatting and bytes; existing named-save stores must remain unchanged. Cancelling leaves the source unchanged. Reintroducing an old session marker and refreshing must keep newer edits.

Derived-copy cases include multiple patterns, swing, a different kit, custom drums, Bilah, Kendhang, bass, guitar, per-pattern loops, pan and solo. All affected classes must appear in the confirmation dialog. The copy keeps the expected audible loop selections and variations at the supported master volume, while the complete source project and destination backup remain downloadable.

Browser failure cases deny transfer storage and simulate a newer destination edit from another tab before the destination loads. Neither condition may silently replace the protected work. Existing unit coverage also tests bounded retention, exact byte limits, rollback/session failure, interrupted application, duplicate deliveries and acknowledgment/replay protection.

The audio check compares the mono Beatbox output with Studio's corresponding channel after stereo upmix. It excludes the first 40 ms and final 15 ms to separate startup and Studio's final 4 ms fade; channel rate and exact arrangement length are checked independently. Acceptance requires waveform correlation above 0.999, normalized difference below 0.002 and level difference below 0.01 dB.

Evidence is under `qa-artifacts/mode-transfer-20261117/`. Phone checks use browser viewport/touch emulation. Physical devices, recruited users and human listening are outside this test. Production verification matches the live main commit before running the same transfer journeys directly against perkusi.com.

## Local results

All eight browser journeys passed, with nine WAV downloads, 47 project/backup downloads and no browser errors. The quiet Bumi case now has identical compared PCM samples and a 0 dB level difference; the three-voice cases differ by less than 0.000001 dB. Original project fields, named-save bytes and displaced-draft raw bytes remain intact in the tested paths, including the failure cases.

All 667 unit tests passed. Final lint and production build passed; the build receipt is `qa-artifacts/build-retention/runs/8d096121-80c6-4b3d-b8e9-b4f9afabe604.json`.
