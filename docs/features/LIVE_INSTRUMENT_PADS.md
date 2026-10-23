# Live instrument pads — local slice,23 October 2026

This extends the existing Rhythm Studio live-pad section on production baseline `891a3ea02dc817c039b7e65e1c6149fee2da57fe`. It is local and unpublished pending review. There is no recording, microphone, new instrument, engine, sample download, project-schema change or retired V5/V6 runtime.

## Playing and editing stay separate

The main pad section contains Drum8, Bilah5(D4/F4/G4/A4/C5), Kendhang2(TAK/THUNG), Bass3(E1/G1/B1), Nylon3(B2/E3/G3):21buttons. Each named instrument group wraps responsively; mobile drums use4columns, Bilah3, Kendhang2, bass/guitar3. All targets are at least44px. Existing inline sequencer note selectors retain their select-and-audition behavior.

Main pads audition only. They do not select editor notes, change the active pattern, write notes, alter project JSON or add undo history. WAV export remains a render of the saved patterns; live improvised taps are excluded. Project-wide instrument mixer/master/mute/solo still apply. Existing velocity1 audition semantics are retained; no pressure velocity or sustain mode was introduced.

Pointerdown triggers once per pointer. The subsequent synthesized click is suppressed, while assistive activation remains available. Pointerup/cancel/lost-capture release visual ownership; normal release does not truncate a one-shot. Multiple fingers can trigger different pads. Keyboard hold/repeat does not retrigger; native Enter/Space activation is handled once. Blur/visibility loss clear pressed states. Export/import/receiving/disposal locks refuse input. AbortController owns the delegated input listeners; disposal clears pressed/loading state and handlers.

## Keyboard contract

- 1–8 remain drum shortcuts.
- A/S: Kendhang; D/F/G: bass; H/J/K: nylon guitar.
- Z/X/C/V/B inside the focused main pad area audition Bilah without changing editor selection. Outside this newly added context, the existing Bilah shortcut behavior still selects/auditions its editor note. The old listener ignores already-handled/main-pad events, preventing duplicate triggers.
- Typing/editable controls, open dialogs, Ctrl/Meta/Alt/Shift and key-repeat do not trigger main pads. Standard outside-control transport and undo shortcuts remain.

“Pad mengikuti grid” retains its existing project-wide meaning: while the transport runs, a pad schedules on the next swung sixteenth step; otherwise it schedules directly using the existing small audio-clock lead. This is scheduling behavior, not an acoustic latency guarantee. A cold sample loads before scheduling; Stop/replace generation fencing prevents a cancelled load from sounding later.

## Audio/resources

The existing AudioEngine and CompositionPlayback.pad route are reused, with the same AudioContext and SampleBanks. There are no extra sample copies/banks, warm re-decodes or default voices. Bass retains all-pitch monophony and20ms retrigger fade; guitar retains different-pitch ringing/same-pitch10ms fade; existing Bilah/Kendhang policies are unchanged. Existing64-voice and32MiB admission guards remain. Global programme gain handling matches drum-pad audition when not playing.

## Sequential qualification

Kendhang→bass→nylon→Bilah were implemented and qualified sequentially before advancing: focused unit tests, an official guarded build and native Edge E2E per slice. Gates covered pointer/keyboard/touch, repeated input, swing/quantize, real output mute/solo/master, unmodified project/WAV, warm sample deduplication, cold-loadStop/retry and ID/EN desktop/mobile. Final shared-input regression checks all21pads/keys and modifier handling, explicit non-default editor selections, touch cancellation, export locks, a combined saved song and the existing Beatbox.

See `qa-artifacts/live-pads-2026-10-23/REPORT.md`, `CHECKLIST.md`, per-instrument closures, final source/artifact pins and performance summary for exact results and preserved failed dev-navigation evidence. All binary assets/licenses/originals remain unchanged. Human listening, physical devices, Safari, background/OS interruption and extended reliability are not qualified by automation; mobile/touch checks are emulation, and JS heap excludes native/total memory. No publication is authorized by this local slice.
