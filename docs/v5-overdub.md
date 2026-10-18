# Y: bounded nondestructive two-layer overdub

X independent acceptance authorizes this local slice, not full V5/publication.
No actual microphone, upload, deployment, header/settings/security or Git write.

Schema5 gains an optional, versioned track capability:
`layering: {version:1, baseClipId, overdubClipId}`. It requires exactly two ordered
recording clips referencing distinct immutable assets, equal frames/rate/channels,
zero offset/start, loop enabled and equal full 1/2/4/8-bar periods on the frozen
clock. Existing one-clip/legacy projects are unchanged; older readers safely
refuse the unknown capability. No native objects are serialized, no flattening,
normalization or modification of base bytes. Clone remaps roles; clear/source
replacement removes roles. Repeat is locked for this bounded two-layer format.

Explicit Prepare overdub accepts one full looping recorded stereo48k base only.
The candidate source remains the accepted two-note Saron. It reads only that
source bus before the track mixer, while ordinary base playback remains audible.
One shared transport schedules the new capture on a **full base-cycle boundary**;
the count-in is one bar immediately before that boundary. The new layer must have
the same exact period; partial data is retained/WAV-able but cannot be committed.
Selected Stop stops base plus capture/replay; root Stop/navigation uses the
existing ownership barriers. There is no feedback from master/base into capture.

Existing admission counts the base ordinary voices plus producer3 and reader1,
their conservative absolute-channel peaks and native/worklet/memory costs. The
16MiB project PCM capacity is checked before preparing a maximum-period overdub.
Before adopting, both immutable audio resources are resolved and the resulting
composite plan is admitted for actual peaks/voices and future graph/memory. No
phase cancellation is used to evade .95 headroom. Failure preserves base and new
session take. The accepted 16-voice/64MiB limits remain; not all maximum-duration
eight-track combinations are claimed.

The base reference/clip stays byte-identical; the new reference/clip and roles are
added only after audio/credits/document commit in the accepted IDB CAS transaction.
The session original retains its pins until explicit discard. Main Undo removes
only the new layer; Redo restores it from immutable stored bytes. Re-record by
Undo plus explicit session disposition and a new overdub creates new immutable
content. Undo stacks themselves are not persisted; complete portable export and
reload preserve the active two-layer project, both PCM payloads and credits.

Validation must include actual source-only capture with base audible, strict
native routed composite phase/gain, exact base/new PCM preservation, two-payload
portable/reload/import, project Undo/Redo, failed quota/cancel/stale-writer safety,
stop/navigation/partial recovery and full cleanup. Record failed attempts; no
listening, hardware or full V5 release claim. FX/final mix, other source families/
mic, device/accessibility/stress/listening/cultural/rights gates remain open.
