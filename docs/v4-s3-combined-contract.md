# Local combined Studio candidate

This bounded slice follows the accepted 227-source stage/Studio event slice (ZIP SHA256 `61984d11edc58f2d66fe32ade3ffbb940e4fccdd9aff89e911bd0b09b3d3dd18`). It remains local-only and pending independent review. No microphone, deployment, Actions, account, settings or security changes.

## Data and editing

Schema4 retains its editable schema3 `composition`, original legacy text, immutable bank/version references and explicit PPQ960000 events. Older schema4 files remain the same shape. Known optional fields are strict `instrumentMix` rows (bankId/instrumentId/volume/pan/mute/solo) and boolean `tuningConsent`. Unknown fields, duplicate groups, unknown bank/instrument and invalid numbers reject atomically. No recording or score is flattened into a WAV in the saved project.

Studio edits eight 16-step lanes, kit, active pattern, clone, chain up to eight bars, tempo/swing/master, track mixer, six original loop roles/variants, five Bilah pitches/velocities, existing event positions/velocities, and instrument group mixer. One complete project history retains both families with the existing 16-snapshot / 2MiB metadata ceiling. Invalid edits/admission refuse before replacing source or undo state. Demo load is one undoable project replacement. File import replaces history deliberately, as before.

Legacy solos use the existing legacy family mixer; recorded instrument solos use their own family. Group mix affects project playback/render, not physical free-play pads. Event mute preserves source events and removes only their audible planned voices/tails. Legacy melodic Bilah or D-minor hum/vocal-bass plus audible tuned events requires an explicit persisted Studio choice, or muting one family. This acknowledges different tunings; it never repitches either source.

## Shared clock, PCM and ownership

The existing Studio exporter has an optional Float32 return path; its default V1–V3 encoder remains 48kHz. All original sequencing, swing, choke, loop phase, Bumi processing, track/clip/Bilah pan, master, static +3/knee mastering and exact final4ms fade remain in the existing pipeline. The combined path renders a temporary Float32 legacy bus at the native 44.1/48kHz profile, without PCM16 quantization. The bus is playback preparation, never a replacement score.

Legacy preparation admits every selected bank, encoded stream/joined/decoder copy allowances, native output/context/graph and job-local curve before starting. It uses the same global maximum4 actual native decodes as the CDM cache. Cancellation awaits actual decodes/render before shrinking/releasing admission. Completed preparation retains only the Float32 bus plus source allowance. The job-local curve is verified against the preserved legacy Float32 curve.

Live playback starts the legacy source and event sources on the existing AudioEngine context/Transport, at one sample-rounded origin. The legacy bus already includes master/mastering and therefore connects directly to the destination. Recorded sources pass through group gain/pan and the engine master, without legacy mastering or repitch. Conservative legacy-peak + recorded-voice headroom and maximum16 simultaneous recorded voices refuse unsafe live plans. Actual onended owns live bus/pins/nodes; Pause and close do not free them prematurely. Final close awaits the pending playback preparation as well as export. Re-enabling the same physical focus preserves the paused cursor; explicit focus/project edits reset it.

Jeda/Lanjut re-prepares the same score, resumes its legacy source at the cursor and starts still-sounding recorded sources at full-buffer offsets with the remaining explicit damp envelope. Transport position matches the cursor. Putar dari awal starts at zero. The position is session-local, not a hidden project edit. End-of-play waits for the declared arrangement and full audible tails.

Final WAV adds the original Float32 legacy bus to chunked recorded-source renders, with one final stereo PCM16 encoding. Owned WAV/Blob/URL lifecycle is unchanged. Legacy preparation retains the prior32-second/32MiB export limit. Combined WAV retains the90-second full-tail limit and shared64MiB admitted buffer/declared-allowance pool. Refusal preserves source; Pause/release/export can free live focus reservations. This is not a browser/OS RSS guarantee or a128-bar renderer.

## Four candidate demos and open gates

Two distinct four-bar arrangements per recorded Pelog/Slendro use the existing accepted sample mapping, plus shared Gong and Tak/Thung. Saron, bonang, demung, kethuk and kendhang have distinct functions and deliberate explicit damp events; the final gong keeps its full tail. No legacy pitched source appears in a demo. Explanations and all controls are ID-default plus EN. They are original modern candidate arrangements, not expert-curated or culturally authenticated gending. Culture, expert curation, listening, seven sample quality flags and individual commercial/raw-release rights remain UNVERIFIED/open. Real hardware/Safari and production navigation/delivery/SEO/analytics remain untested in this slice.
