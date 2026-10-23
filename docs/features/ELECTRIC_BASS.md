# Electric bass — local three-note slice

This feature is local only, based on release `f7fb5ce7397d015669ac6e1e3f38f1d5948602d4`. Nylon guitar is not implemented in this slice. No publication is authorized yet.

## Musical and project contract

The UI beside the existing instruments offers exactly E1/G1/B1 from the recorded FreePats Bass Guitar YR set. It is a limited three-note short picked bass, not a chromatic/full bass library. Choose/audition a pitch, then fill one 16-step note row per pattern. Each note stores its original pitch ID and velocity; there is no pitch shift, generated missing note, held-sustain or time stretch.

Each pattern owns `bassNotes`, a 16-element array of null or `{pitch, velocity}`. Optional strict schema-3 project metadata `bass` pins pack/version/provenance and the global bass volume/pan/mute/solo, matching Bilah/Kendhang mixer scope. Old project formats keep their existing migration paths; opening them in the editor adds only silent bass rows without modifying their original file. Unknown/invalid new data is rejected without dropping it. Duplicate deep-copies the notes; Clear clears the selected pattern's bass alongside its existing content. Undo/redo, local save/reopen and portable JSON include all patterns. Beatbox derived-copy conversion explicitly identifies omitted bass notes and retains its original-project backup.

Editing bass notes pauses playback, disclosed in ID/EN. The editor pattern remains distinct from the sounding chain pattern. Bass does not impose the Beatbox loop's 96 BPM restriction; it uses the existing tempo/swing clock and repeat behavior.

## Tail and ownership decision

Retained 48 kHz source deliveries last E1 4.58958 s, G1 3.24881 s and B1 2.81915 s. To prevent those tails accumulating, new independent short derivatives retain the first **1.2 s**, with an explicit **50 ms half-cosine fade** at the end. The first 1.15 s is byte/sample-preserved. Original FLAC and full WAVs remain untouched.

Bass is monophonic across all three pitches. A new note fades the previous one over 20 ms; same-grid rapid pads are last-note-wins. That intentional short crossfade is the only intended overlap. Cancellation restores a current voice's natural short endpoint if a future note/choke is removed. Existing voices keep the original 4 ms default fade. Stop/replace generation fencing and resource ownership use the existing engine. No new engine or retired V5/V6 runtime is activated.

Three delivery WAVs total 691,332 encoded bytes / 691,200 decoded Float32 bytes at 48 kHz. Samples load lazily by used pitch and are deduplicated across patterns. They fit the unchanged two-second one-shot source guard; the existing loading queue, 64-voice and 32 MiB memory limits remain intact.

## Source and permissions

Creator: Andrea Biasior; FreePats integration edits by Roberto, version 2019-09-30. Source: https://freepats.zenvoid.org/ElectricGuitar/clean-electric-bass.html . CC0-1.0, commercial use and raw redistribution allowed; attribution optional. Courtesy provenance/transform notices remain in the panel, project JSON and bass-containing WAV metadata. UI links expose the local complete CC0 text and exact sample provenance manifest.

`internal/bass-short/manifest.json` pins retained original FLAC identity, full processed input WAV, short derivative, geometry, license evidence and recipe hash. `scripts/make-bass-short.mjs` reproduces the three explicit edits using Node builtins only. No download, dependency or external service was used. This recipe's measured fidelity is not human-listening approval.

## Qualification

Local unit/integration, native Edge E2E, matched cache/heap/playback measurements and exact build/source pins are recorded in `qa-artifacts/bass-2026-10-23/REPORT.md`. Acceptance uses unchanged legacy musical data, frame/timing correctness, bounded tails/cache, zero owned voices/timer after Stop, and zero cache/loading jobs after dispose. Browser heap and CDP renderer task counters are not total memory or audio-thread CPU guarantees. Old-project WAV precision is checked at identical positions within the one-LSB native variability independently established before this feature; no alignment or missing-frame allowance is made.

Human listening/musical balance, physical devices, Safari, background/OS interruption and long-duration reliability remain unverified. Parent review/audition is required before guitar work, and publication requires separate approval. Morning QA and preview must stop by 08:00 WIB, with the local preview capped at 07:55 WIB.
