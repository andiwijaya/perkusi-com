# S3 stage, physical focus and instrument-event Studio extension

This local candidate extends the accepted repair2 capsule. It does not publish a
V4 route or replace the ordinary schema3 Studio. Run the existing local candidate
server and open `/internal/instrument-focus/`. The new Studio pane lives in
`src/studio/instrument-panel.js`, reuses the existing Studio ProjectHistory, and
uses the same InstrumentSession, AudioEngine/context, master, Transport and
offline renderer as focus. No second live clock/engine is created for navigation.

## Physical corpus and lazy playback

Twelve real recorded names are exposed: Demung, Saron barung, Peking, Slenthem,
Bonang barung/panerus, Kenong, Kempul, Kethuk, Kempyang, Gong ageng and Kendhang
Ciblon. Pelog and Slendro choose their separate recorded banks. Shared physical
gong and Tak/Thung recordings retain the same immutable IDs in either selection.
No transposition, tuning frequency, missing degree or placeholder is invented.
Kenong/Kempul Pelog have no degree4 sample; their six pads keep that gap visible.
Mapping and geometry come from the accepted registry/provenance, not inferred
from generic scale indices.

Stage focus selection creates no context or audio request on a cold page.
Stage Strike starts the shared context synchronously in its trusted gesture, then
loads only the selected complete focus (plus an explicitly chosen small ensemble)
before playing a recorded note. Other instruments remain selectable after failure.
Focus readiness remains atomic; switching stops old voices and awaits onended
before releasing their pins. Shared ensemble entries are deduplicated. All
complete selections fit the existing64MiB cold admission calculation; pressure
from retained outputs/foreign work can still refuse visibly. No eager479MB load.

Gong/Kempul and short stroke controls play one-shot natural tails on ordinary key
release; explicit Damp All/Pause requests the accepted20ms fade. Melodic pads keep
explicit held/release articulation. These are disclosed interface controls, not
an expert-verified statement of traditional playing technique. The source buffers
are never shortened or retuned.

The original code-native SVG silhouettes show hanging gongs, drum, gong-chimes
and metallophone families. They were authored for this task by Perkusi/Codex, with
no external image copied; source hashes identify the art. They are descriptive
illustrations, not evidence of cultural authenticity. Existing font provenance
and source asset attribution remain unchanged.

## Lossless Studio event bridge

Entering Studio explicitly pauses live free-play and waits for owned voices.
Active recording, arming, load/replay/export and terminal disposal refuse the
transition. The canonical schema4 project, exact legacy origin text, composition,
bank versions and all strike/damp IDs/ticks/velocities remain intact. The event
editor shows physical bank/note identity, position in beats and strike strength;
an applied edit changes one event explicitly, with damp events separately visible.
No implicit quantize, schema3 flattening, pitch conversion or audio bake occurs.

Validated Studio ProjectHistory is reused with16 steps and an additional2MiB
serialized metadata-history ceiling. A trial edit/undo/redo is validated and
admitted before synchronous session commit; failure leaves both project and
history unchanged. Only64 event rows are rendered per page. Registry/source
objects and audio buffers are not duplicated into undo. Mode changes preserve
the project and context identity; export's explicit pause/release can close that
context, after which a deliberate gesture creates a new shared context normally.

Focus, Studio replay and Studio WAV/JSON controls use the accepted resource and
OwnedOutput lifetime. JSON import roundtrips the whole schema4 project. Existing
schema0–3 behavior is retained: empty projects migrate into event mode; active
legacy layers remain explicitly unsupported in this candidate, with the current
take retained and regular Studio available for their original schema3 projects.
Combining active legacy pattern/clip layers with instrument events is a later
bounded feature, not silently rendered or discarded here.

## Review and open gates

This slice covers stage-to-focus,12-name physical mapping, captured musical
events to an editable Studio event pane, return, JSON and WAV. It does not complete
the full Studio arrangement/mixer bridge, expert musical demos per laras,
128-bar renderer, real devices/Safari, production navigation/SEO/analytics or
release. Culture/tuning/technique, human listening, seven source quality flags
and individual commercial/raw-redistribution release-rights validation remain
open. The corpus is a coherent recorded candidate, not a claim of authenticated
complete Central Javanese gamelan. No mic, headers/settings, Git publication or
Actions change. Freeze and independently review before another feature slice.
