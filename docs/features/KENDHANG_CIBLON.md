# Kendhang Ciblon — local feature

This local feature adds TAK and THUNG below Bilah in ordinary Rhythm Studio. It uses the existing shared WebAudio transport, SampleBank, one-shot envelope, voice limit, loading queue and WAV renderer. It does not activate the retired V5/V6 engines. Publication requires separate approval.

## Project and editing contract

Each pattern has independent `kendhang.tak` and `kendhang.thung` arrays of 16 velocities (0–1; zero means no hit). Both articulations may occur at the same step. A project-level `kendhang` object identifies the pinned pack/version/credits and volume/pan/mute/solo, matching Bilah's global mixer scope. Tempo, swing, drum/Bilah mix and Beatbox loops retain their existing ownership.

The optional strict schema-3 extension is installed when an old project opens in the editor. Old validators/data paths remain supported without rewriting their original files; every old pattern receives zero hits. Old clients reject the unfamiliar extension rather than silently discarding it. Duplicate deep-copies hits; Clear clears the selected pattern's drums, Bilah notes, loops and kendhang hits. Undo/redo, local save/load and portable JSON include the new data. Beatbox derived-copy conversion explicitly warns that kendhang hits are omitted; its original-project backup remains available.

Editing kendhang steps pauses playback, as stated in both languages. Editor pattern selection remains separate from the sounding chain pattern. Chain/pattern-only repeat schedules one-shots on the existing swung step clock. TAK and THUNG have independent voices; retriggering the same articulation fades its prior voice through the existing 4 ms envelope. Different articulations may overlap intentionally. Pause/Stop/restart and generation interruption reuse the engine's existing ownership and cancellation.

## Media, provenance and delivery

Only retained 48 kHz stereo PCM24 FLAC `s261992.flac` (TAK, 42,780 frames) and `s261991.flac` (THUNG, 32,821 frames) are registered. Encoded total: 234,470 bytes; fully decoded stereo Float32 total: 604,808 bytes. Loading is lazy and per required articulation, deduplicated across patterns. No new media was downloaded, optimized, retuned or destructively modified.

Recordings are Digitopia_CdM / Digitópia Casa da Música, CC BY 3.0; source work pages are https://freesound.org/people/Digitopia_CdM/sounds/261992/ and https://freesound.org/people/Digitopia_CdM/sounds/261991/. Original library packaging is Artistic 2.0. The UI retains source/creator/license/modification notices and links to both work-source ZIPs and complete recording/package licenses. Portable JSON includes pinned attribution; WAVs using kendhang append standard RIFF LIST/INFO/ICMT attribution without copying/changing the PCM payload or adding time to the arrangement. Existing waveform metadata remains unchanged when kendhang has no hits.

## Qualification criteria and scope

Before edits: native Edge, the existing four-pattern Fusion demo at 96 BPM, warm load, ten Play/Stop cycles, then 60 seconds of chain repeat. After edits: the same workload with empty kendhang, then the same demo plus TAK/THUNG. Acceptance: no observed scheduler gaps or unintended duplicate loop sources; all owned voices/timers released after Stop; no decoded-cache growth during each repeat; zero cache/loading jobs after dispose. Added decoded memory must match the actual retained sample geometry, not an invented percentage. JavaScript heap, DOM/listener and CDP main-thread counters are contextual measurements; they do not measure total browser memory or real-time audio-thread CPU.

Detailed measurements, exact build/source pins, native frame comparisons, browser journeys and first-failure records are in `qa-artifacts/kendhang-2026-10-22/`. The native renderer's own repeated old-build WAV exports differed at four 16-bit samples by one LSB, while fresh old/new exports were byte-identical. Full old-project comparisons therefore require the exact header/frame count and direct same-position sample comparison within one LSB, with the measured differences reported; no alignment, missing-frame allowance or listening equivalence is inferred.

Physical listening/devices, Safari, background/OS interruption and long-duration reliability are not qualified by these bounded automated checks. This feature makes no historical V5/V6 root-cause or fix claim.
