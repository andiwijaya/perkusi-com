# S6C canonical clock, sources and per-track ownership

Decision15October2026, following bounded independent S6B ACCEPT. This is an implementation contract, not fullV5 acceptance. No mic/header/upload/release authorization is inferred.

## Musical behavior and clock

One existing AudioEngine/context/Transport per active workspace; each track owns nodes, never another engine. An event-only project uses `clock:{kind:"musical"}`: frame(tick)=round(tick*60*rate/(BPM*PPQ)). Repeated hits derive from absolute tick positions, so fractional cycle rounding does not accumulate as in the S6B spike. A clip period is its lengthTicks; selecting a grid bar is only an editor view. Event tails cross clip boundaries naturally and explicit same-key damp can cross to the following cycle. No retune, autochoke or tail-end period.

Before the first new audio capture, a stopped musical project switches explicitly to `clock:{kind:"fixed-bar",sampleRate,framesPerBar}` where framesPerBar=round(4*60*rate/BPM). Every subsequent1/2/4/8bar capture window is an integer multiple of that one stored bar period. Event times use the same rational framesPerBar/(4*PPQ) mapping. The very small effective BPM difference is disclosed in technical state; project nominal BPM and original audio stay retained. Recorded tempo/rate is locked. No crop/pad/stretch/pitch-rate change or independent per-take period.

Why not first-take length divided by bars: a legacy two-bar S5 take133179frames at173BPM48k cannot be divided into two equal integer one-bar loops. New captures therefore freeze the bar clock before arming. Existing schema5 metadata is still parsed without requiring new fields. Runtime admission must reject incompatible recorded frame geometry/rate before playback, retain the complete document and offer recovery/backup; the old take is never silently repaired. Legacy S5 synthetic memory-only take metadata does not prove bytes are present. S7 retains the complete original and must supply missing bytes. This does not cut new1/2/4/8bar P0 support; physical capture integration remains a later review slice.

Legacy V1-V4 embedded prepared material stays at its original validated tempo. Code inspection found that the accepted finite legacy bus intentionally fades at the score end. C1 therefore admits the complete old finite bus only for one-shot clips and REFUSES legacy Repeat before loading. It must not copy that end fade into every loop boundary or label a faded export as natural carry. The next adapter must schedule original legacy voices/choke/loop policies across cycles through their continuous legacy mastering stage, or prove an equivalent first/steady-state prepared representation. This is an explicit remaining full-S6 blocker, not a removal of hybrid P0. Gamelan event Repeat preserves its natural tails. Already-mastered finite legacy PCM bypasses additional legacy mastering. Restrict legacy trimmed regions until a lossless adapter exists.

## Sources and schema5 compatibility

Keep schemaVersion5 and strict validation; optional bounded `clock` and `sources` extend the accepted prototype. Old schema5 without these fields retains its exact shape and semantics. `origins` remain immutable exact imported text, at most8; edits update one working `sources` entry linked by originId rather than consuming a fresh origin for every click. Working source text is a complete validated schema4 instrument project, including composition/mix/laras/tuning consent; source text and original JSON remain separate. Existing V1-V4 parsers are unchanged; reverse conversion of a changed multi-track project to a legacy subset is unavailable, never silent.

Both presentations use the same canonical eight-track project/controller. Four mobile tracks are shown per page with access to all eight; desktop shows eight. Local metadata draft/export can be exercised for official assets; recorded bytes/durable storage/portable takes remain S7. Missing take bytes are explicit errors, not empty successful playback.

## Ownership and lifecycle

Root workspace owns AudioEngine/context and global Play/Pause/Stop. Per-track Stop cancels only that track's pending/playing nodes with the existing fade/damp; it never pauses/resets shared Transport or affects a foreign track. Restart aligns to the next shared bar. Global Pause saves absolute score-frame position and reconstructs audible tails on Resume. Sources hold buffer leases until real native ended, or until caller has confirmed context closed. Resource disposal never closes a foreign context. Loading uses generation/AbortController guards: Stop/import/navigation cancels preparation and a late completion cannot revive playback.

Track gain/pan/mute/solo route through owned track nodes to one root master. Re-admit any live gain/solo/unmute change before scheduling automation; rejected edits leave previous project/routing intact. Existing64MiB declared allocation budget,16pending+playing voices and0.95conservative headroom remain. No stealing/cap increase. Admission sums conservative per-clip periodic bounds with rounding margin; over-conservative refusal is reported rather than partial starts. Frame-grid boundaries and source natural lengths are independent.

## Sequential checkpoint and verification

### C1 review repairs

Shared draft writes compare the exact raw document last read/saved by this tab under the same-origin Web Lock for the draft key. A stale tab cannot overwrite the newer stored document through edit, import, undo/redo, corrupt-draft recovery or departure. Its editable/downloadable project stays in memory with an explicit conflict notice. The user can download either version, or explicitly back up this tab and adopt the latest draft. The file/schema stays unchanged. Missing Web Locks disables shared persistence while retaining memory edits/download, rather than guessing at write ownership.

Controller disposal synchronously installs terminal admission and one shared operation before any notification or await. New play/load/mix/rejoin is refused, existing preparations settle and late plans release, and owned buffers remain pinned until ended/context closure. Failed cleanup remains terminal and can retry when the caller confirms context closure. The caller context and unrelated leases are never disposed by this controller.

Track rows use a separate `ls-row-` DOM namespace and a direct row map. Valid project IDs remain unchanged; fixed global controls and role-prefixed per-track controls cannot collide with these rows.

S6C1: canonical schema/clock/working-source model; per-track event playback and finite legacy one-shot coexistence (legacy Repeat HOLD); eight-track local UI and safe draft/history/import/export of official-source metadata. Prove foreign owner Stop safety, pause/resume tail offsets, next-cycle/same-tick damp, ideal musical phase, stale async load, both rates, hostile import, source immutability, eight short tracks, ID/EN mobile/desktop and actual native PCM. Inspect rendered pixels and user flows, not just test totals.

S6C2 remains sample-instrument capture/count-in/overdub/record history, waveform and EQ/moderate limiter integration on this clock. MicP0 requires separately authorized permission/header scope and physical latency/listening evidence; synthetic tests only for now. Licensed guitar/suling and >=3fullV5starter projects remain open, as do S7durability/portable takes/WAV and S8release QA. A new independent gate is required before release. No product feature is declared removed; unresolved items are explicit blockers for fullV5, not placeholders labeled done.
