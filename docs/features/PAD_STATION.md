# Pad Station

Local feature awaiting review/publication. Routes: `/pad-station/` and
`/en/pad-station/`, with a homepage card and shared navigation.

The page exposes the existing 21 pads (8 drums, 5 Bilah, 2 Kendhang Ciblon,
3 bass, 3 nylon guitar), Stop, master level, mute and sound attribution/source
links. Each device plays independently. There is no network synchronization,
recording, pattern editor, sequencer UI, loop editor, project storage or export.

## Shared audio and UI

- `src/studio/live-pads.js` and `live-pads.css` render and handle both surfaces.
  Bilah shortcuts outside the pad panel are explicitly enabled only for Pad
  Station; Studio retains its editor shortcut behavior. Typing, modifiers,
  repeat and dialogs remain guarded.
- `src/studio/playback.js` constructs the same AudioEngine, CompositionPlayback,
  sample packs and output stage for either page. Owners and contexts are never
  shared across documents. No alternate engine or new media is introduced.
- `src/pads/owner.js` supplies a validated empty sound configuration because the
  existing drum/instrument mixers use that schema. Its transport remains
  dormant: the page never calls Play, pumps a score or starts a scheduler timer.
  Quantize is disabled, so audition is immediate.
- `src/pads/main.js` owns view listeners and page lifecycle. Stop invalidates
  old intent through the retained R1 guards; hidden pages stop and pagehide
  disposes the owner. A bfcache restoration reloads a fresh owner. Locale
  changes update labels without rebuilding the audio owner.

Master mute remembers the chosen level. Existing voice policies and cache/
decode reservations apply. Logical view cancellation does not claim to cancel
uncancellable native decode/resume work; audit R2/R3 remain separate work.

## Data and verification boundaries

The page has no project store, IndexedDB owner, mic input or export pipeline.
Existing saved Studio/Beatbox data is not read or rewritten. Media licenses,
provenance and source packages remain available, including Kendhang CC BY 3.0
and applicable package notices.

Local evidence is under `qa-artifacts/pad-station-2026-10-23/`: phased gates,
final browser checks, retained R1/Studio regressions, matched pad performance,
artifact/source pins and review report. Browser touch emulation is not physical
phone or listening qualification. No claim of synchronized multi-phone timing
or a historical engine fault being fixed follows from this feature.
