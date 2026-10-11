# Rhythm Studio V2

S7 local candidate; independent S8 engineering review precedes publication. The
retained V1.1 main SHA is `e4b8e07f4bdf42ac114a3fea6f664c40c3a38546`, Cloudflare
deployment `2055088c-ee5f-4221-ba0d-89bcd1db29ee`. No S7 publication is authorized.

## Shared audio ownership

The existing `AudioEngine` now accepts a validated Studio sequence in addition to
its unchanged Beatbox loop mode. Both modes use its native context lifecycle,
lookahead pump, absolute `Transport`, `SampleBank` admission/cancellation/cache,
master-volume range, capture, pause/suspend, statistics, and disposal. There is no
separate Studio context manager or frame-driven audio clock. Animation only reads
the shared transport. Kit changes pause safely and preserve patterns; Play loads
the selected official kit. Loop samples and Beatbox's Bumi preparation stay in
Beatbox. Studio's sixteen distinct one-shots use playbackRate 1 at any supported
BPM. No arbitrary tempo-locked loops or fake time stretching are exposed.

`sequencing.js` owns straight/swing step geometry, chain lookup, track routing,
mute/solo semantics and the one-shot scheduling contract for live/pads/offline.
Swing delays the second sixteenth in each pair by 0–50% of one sixteenth; quarter
beats remain unchanged. Quantize applies to pads while the transport is running;
otherwise pads play immediately. Pads audition and do not record into patterns.
Late JS wake-ups skip stale hits rather than burst them. Pattern/timing edits
cancel future queued voices and reschedule from the current audio-clock beat;
mix-only changes automate gain/pan without resetting the musical clock.

Eight tracks have gain, stereo pan, mute and solo. Mute takes priority over solo;
while any solo is enabled all non-solo tracks are silent. The original accepted
output boost/knee/0.9 ceiling is shared through the same stage factory and keeps
the existing 0–0.75 master contract. Voice attack/release and control microfades
avoid hard discontinuities; one-shot retriggers choke the preceding same-track
voice using the common envelope. The source samples are modestly leveled, not
pre-clipped to a limiter. Listening quality remains a separate owner gate.

## Studio projects and history

The common `perkusi-project` serializer/parser/store dispatches Studio schema2
without altering Beatbox schema1 or the explicit historical schema0→1 migration.
Studio validates eight fixed track identities, a known kit/version, BPM60–180,
4/4, swing0–0.5, quantize boolean, mix bounds, 1–16 named patterns, 16 finite
velocity steps per track, an existing active pattern, and a 1–8-bar chain with no
orphan reference. Extra URL/code/audio fields are rejected. Shared import limit
remains64KiB. Unknown future versions and incompatible modes are explicit errors.

Studio uses the common bounded `ProjectStore` with its own index/draft keys:
`perkusi.projects.studio.v2`, `perkusi.draft.studio.v2`. This prevents Studio reads
or deletes from overwriting V1.1's existing `perkusi.projects.v1` and
`perkusi.draft.v1`. Both families retain the same portable format and shared
strict storage-ID validation. Cross-mode conversion remains S9; attempting to
import a Beatbox file into Studio directs the user to Playground and retains the
original. A corrupted draft is not overwritten automatically. Save remains
optional; denied/invalid/full browser storage does not prevent project download
or native audio.

Sixty validated complete project snapshots bound undo/redo memory. Step edits,
create/duplicate/rename/delete patterns, chain and mix changes participate;
deleting a pattern removes its chain references and undo restores both. A new
edit after undo clears redo. Import/load establishes a new history base; refresh
recovers a paused draft. Text fields retain native Ctrl/Cmd+Z, so global history
shortcuts do not interfere with typing.

## Deterministic arrangement export

One pass of the chain is rendered as stereo48kHz PCM16 with exact rounded frame
length `chain bars × 4 × 60/BPM × 48000`; maximum8bars/32seconds at60BPM.
No hidden silence/tail bars are appended. The final4ms fades at the arrangement
end. Live chain playback uses the same one-shot/mixer/master/output contract.
An export is a frozen snapshot of mix/kit/patterns/swing at Make WAV; pad auditions
and subsequent UI changes are not recorded. The ready filename identifies that
snapshot and remains usable after edits or locale changes.

Budget counts retained live decoded banks, all eight offline decoded samples,
stereo PCM, WAV bytes and small overhead against32MiB. Eight bars at60BPM fit;
invalid/oversized retained memory rejects before context allocation. The shared
encoder retains its finite/0.950001 safety and final quantized-nonzero guard.
Its original mono4/8bar Beatbox contract stays intact. Native decode/render cannot
be force-aborted portably; cancelled/disposed exports retain single-job ownership
until native work settles, then discard output and release buffers/graphs. No late
File is delivered. Download/Share use the existing `FileDelivery` and URL cleanup.

## UX, loading and provenance

Studio is an incrementally activated static ID/EN route with metadata/canonical/
hreflang; homepage advertises its working local candidate while other future
tools stay upcoming. Only Studio dynamically loads its controller/kit URL catalog;
WAV fetch/decode waits for a user gesture or explicit export. No app owner hook is
present in production builds. Controls are disabled until initialization finishes.
Grid touch targets are44px, with explicit horizontal scrolling on narrow screens,
roving arrow-key navigation and semantic pressed state. Every track is reachable
without dragging. The desktop recommendation is dismissible; no UA lock exists.
Reduced motion is respected. Locale changes update labels and preserve owners.

Ruang (warm/modal percussion) and Arus (electronic excitation percussion) comprise
sixteen original seeded one-shots, totaling617,024 source WAV bytes. The standard-
library recipe, full SHA256 manifest and CC0 license are under `internal/studio-kits`
and `scripts/make-studio-kits.py`. Commercial and raw redistribution permissions
are explicit; no external sample/API/DSP/tool/voice clone is involved. The public
license ships as `/STUDIO-KITS-LICENSE.txt`. Generated files/waveform evidence do
not constitute an audition or certification of musical taste.

## Async ownership and keyboard focus

An outstanding native project-file read locks composition mutations and ignores
a conflicting second import until the first owner settles. Audio transport
controls remain available. Settlement restores the previous disabled states and
history bounds; malformed files leave the active composition intact. Disposal
prevents late reads or native renders from publishing state or delivering a file.

Render cancellation/completion restores the initiating control only while focus
remains on the job's hidden cancel button or the document body. This explicitly
handles Firefox retaining focus on a now-hidden control. A meaningful focus or
pointer move to Help or another control vetoes restoration. Native Enter/Tab,
repeated cancellation, both languages, import races and no-focus-steal cases are
verified in Chrome, Edge and Firefox. Pad-feedback timers are disposed with the
owner. A persisted pageshow reloads the disposed document from its paused draft.

## S8 swung-step timing repair

The monotonic `stepBeat` geometry is also inverted for the next eligible step and
the most recent playhead step. Resume and quantized pads therefore retain the
still-future odd step between its straight and delayed boundaries. Pads use the
native5ms scheduling lead; the sequencer skips steps expired at its2ms lead and
records a gap instead of bursting stale callbacks. Audio scheduling remains
independent of animation frames; headers and cells read the same engine snapshot
playhead, with the existing UI paint cadence.

A ready pad on an already-running context schedules in the gesture without an
unnecessary native resume or cache-load promise. Suspended/new contexts still
resume synchronously from the gesture and await native decode when required.
This avoids consuming a short eligible step window during a no-op resume.

The engine retains a monotonic consumed-step cursor across pause, suspension and
live musical edits. Already-passed hits are not replayed if a swing edit moves
their nominal boundary into the future. Stop/import use `engine.rewind()` to reset
both the transport phase and this cursor without resetting the selected kit or
mix. Fresh playback admits step0 at its50ms start lead. Exact boundary/lead math,
before/after odd-hit resume, bar/pattern wrap, late callbacks and tempo/swing
extrema are covered by dedicated tests alongside native and V1.1 regression.

The common parser/serializer now requires numeric `[4,4]` rather than coercing
strings or nested values. Playable Studio ID/EN titles and OG metadata describe
the working rhythm tool and export; canonical/hreflang remain unchanged.
