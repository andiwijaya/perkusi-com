# Beatbox local S4 preview

The `/beatbox/` and `/en/beatbox/` routes now play the Original Groove
candidate through the reviewed Web Audio engine. The homepage retains the
accepted foundation until the later V1 gate. This is uncommitted local work;
no production deployment or musicality acceptance is implied.

`npm run build` creates the static preview. `npm run preview` serves it on
loopback. Audio starts only on a user gesture. A character toggles one role;
A/B selects its next-bar pattern. Pause holds phase; Reset clears choices;
Try a groove selects kick, hat and vocal bass. The master range is 0–0.75.
Keyboard buttons support Enter/Space and shortcuts 1–6. Language changes keep
the current context, origin and choices. All user-facing control/error copy
is available in ID and EN. Reduced motion retains static state feedback.

The engine keeps role IDs stable across variant banks, loads chosen buffers
under the existing deadline/ownership guards, and schedules replacement voices
on the same `AudioContext.currentTime` grid. A 4 ms gain overlap replaces an
existing voice; cancellation restores its owned gain envelope. Old voices keep
playing while an alternate loads or fails. Cache limits apply across banks,
and headroom accounts for the highest retained peak per role. Timer/RAF callbacks
do not determine sample timing. Animation uses articulation metadata and the
shared transport; it does not claim exact phoneme lip sync.

The S4 repair makes aggregate admission synchronous with buffer publication
inside every bank. A cancelled variation intent may retain a safe decoded
candidate, but cannot publish an asset that breaks the total PCM or headroom
budget. Cached queue, scheduling and source creation validate that same budget;
retry uses the same publication gate. Rejected candidates leave the current
voice playing and expose the existing bilingual role error/retry UI.

Keyboard focus scroll measures the visible transport rectangle and reserves
space for the target and its outline. It rechecks after native focus/scroll and
panel resize, supporting both Tab and Shift+Tab with the transport accessible.
Only visible keyboard focus triggers correction; pointer clicks are not moved.
A bounded follow-up handles residual compositor scrolling; a new wheel or
pointer gesture stops it so normal manual scrolling remains available.
`node scripts/test-beatbox-repair.mjs` verifies all required layouts through
actual focus geometry, pixels and five interior hit points; it also reproduces
cancelled native loads with bounded test PCM, positive control and native memory
admission. Use a fresh `PERKUSI_REPAIR_QA_DIR` and the browser channel variable.

The original 12 PCM files, recipe, license and candidate flags are unchanged.
Catalog duration and mandatory recipe/master provenance are now validated.
Raw SVG exports hide status marks by presentation attribute so standalone
idle files work without external CSS; companion CSS still reveals loading or
error marks. No CSP change was needed.

## Verification

`npm test` and `npm run lint` cover schema, locale, lifecycle and quantized
variation races. `node scripts/test-beatbox.mjs` runs actual Chromium-family
browser checks against `dist`, including CSP, missing/slow PCM requests,
retry, interruption, A/B choices, graph cleanup, keyboard, normal/reduced
motion, and 22 ID/EN layouts (320–1920 px plus landscape). It records pixels.
Use a fresh `PERKUSI_BEATBOX_QA_DIR`; `PERKUSI_AUDIO_CHANNEL=msedge` selects
Edge. `PERKUSI_BEATBOX_CAPTURE=120` adds a two-minute native graph recording
and a phase detector positive control. Capture uses engine output only.

Foundation, S2 smoke and R1/R2 scripts remain regression checks. Always override
their output/dist environment variables with fresh folders; their defaults
point at historical evidence. Build internal fixtures with
`npx vite build --mode audio-prototype --outDir <fresh-local-directory>`.

Native graph measurements establish engineering behavior only. Listening,
mouth likeness, musical blend, physical headphones/speakers/mobile/Bluetooth,
Safari/iOS/macOS, Firefox, novice usability and production verification remain
UNVERIFIED. Candidate flags must remain false until the actual sound-quality
gate. The S4 report and immutable source checkpoint live in
`qa-artifacts/s4-2026-10-11/`; the subsequent P2 repair and closure evidence
are kept separately in `qa-artifacts/s4-repair-2026-10-11/`.
