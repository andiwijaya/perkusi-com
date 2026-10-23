# Nylon guitar — local three-note slice

This follows the separately qualified local electric bass checkpoint, on Git HEAD `f7fb5ce7397d015669ac6e1e3f38f1d5948602d4`. Neither instrument is published by this work. No retired V5/V6 engine is used.

## Pattern and musical contract

The panel after bass offers the recorded **B2/E3/G3** pitches, with one velocity-sensitive 16-step row per pattern. This is a small plucked-note set, not a complete guitar or chord library. Different pitches may ring together; retriggering the same pitch fades that pitch's previous voice over **10 ms**. This differs deliberately from bass's all-pitch monophony. There is no repitching, generated missing pitch, sustain control or time stretch. One note can be entered at each step; ringing tails can form a limited voicing across steps.

Each pattern owns `guitarNotes`, sixteen null or `{pitch, velocity}` values. Optional schema-3 project `guitar` pins pack/version/credits and global volume/pan/mute/solo, matching existing instrument mixer scope. Opening old projects adds silent guitar rows without modifying their original files. Duplicate deep-copies notes; Clear clears selected pattern content including guitar. Undo/redo, local save/reopen and portable JSON preserve all rows. Beatbox derived-copy conversion explicitly warns about omitted guitar content and retains the original project backup.

Editing steps pauses playback. Editor selection remains independent of the sounding pattern during chain playback. Existing transport, swing, repeat, operation fencing, loading queue, memory and 64-voice admission guards are retained. Cancelling a future same-pitch retrigger restores the current note's natural endpoint. Stop owns and retires all its voices.

## Media and envelope

The retained 48 kHz mono deliveries last B2 **3.8673541667 s**, E3 **4.7501666667 s**, G3 **4.6613125 s**. Full originals and processed deliveries remain unchanged. Independent short derivatives keep the first **1.8 s**, with a final **80 ms half-cosine fade**; the first 1.72 s is sample-preserved. This leaves more ringing time than the 1.2 s bass, while preventing long guitar tails accumulating. The existing 0.6 ms attack and final short engine fade also apply. Human musical balance/listening is unverified.

Three Float32 mono 48 kHz WAVs total **1,036,932 encoded bytes / 1,036,800 decoded bytes**. Loading is lazy and deduplicated by used pitch. They fit the unchanged two-second sample admission guard. `scripts/make-guitar-short.mjs` reproduces them using retained inputs and Node builtins. `internal/guitar-short/manifest.json` binds original FLAC, processed WAV, derivative, recipe and license hashes. No downloads or dependencies were added.

## Source and permissions

Roberto / FreePats nylon guitar, version 2019-06-18; source https://freepats.zenvoid.org/Guitar/acoustic-guitar.html . CC0-1.0 permits commercial use and raw redistribution; attribution is optional. Complete retained evidence: `internal/loop-instruments/source-forms/guitar/cc0.txt`, with the publisher's assignment/source/recording notices in the adjacent `readme.txt` and original SFZ mapping. Those originals remain intact and are pinned by the local qualification receipt. The publisher reports noise-reduction filters and imperfect recording conditions; optimization is not proof of listening quality. Courtesy source/modification notices accompany the panel, JSON project and guitar-containing WAV metadata. Local license and provenance downloads remain accessible.

## Verification scope

The final local receipt is `qa-artifacts/guitar-2026-10-23/REPORT.md`. Qualification distinguishes deterministic scheduling/PCM checks, native browser user journeys and decoded memory/renderer heap observations from human listening, total memory and audio-thread CPU. The immutable bass-only preview/artifact remains separate for comparison. Publication needs separate approval. Physical devices, Safari, background/OS interruption and extended reliability are not qualified by a short local run.
