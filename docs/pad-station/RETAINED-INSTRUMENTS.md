# Pad Station retained-media rollout

Baseline: `7e81f369162a2110875ca4d272e1b78192bd0051`.

Scope: standalone only, one instrument qualified and published before the next.
Rhythm Studio stays at 21 pads and its present groups, mappings, schema and gains.
No retired V5/V6 runtime, mic, loop transport, new downloads or tuning claims.

| Increment      | Status                                         | Media / gate                                                                                            |
| -------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Kethuk         | LIVE — 8c301596                                | Two retained strikes: Pelog 6 and Slendro 2; full 1.425/1.935 s tails fit existing short-shot contract. |
| Kempyang       | LIVE — 26333a5f                                | Two retained strikes; next only after Kethuk production gate.                                           |
| Kenong         | Final local qualification; publication pending | 11 retained strikes; organize by recorded laras, no invented notes.                                     |
| Demung         | Pending                                        | Source tails 5.9–12.2 s; measure sustain and budgets before admission.                                  |
| Saron barung   | Pending                                        | Source tails up to 17.3 s; no arbitrary blanket 2 s crop.                                               |
| Peking         | Pending                                        | Source tails 2.8–14.5 s; tail/onset review required.                                                    |
| Slenthem       | Pending                                        | Source tails up to 45 s; bounded sustain contract required.                                             |
| Bonang barung  | Pending                                        | Long tails; note/laras and retrigger policy required.                                                   |
| Bonang panerus | Pending                                        | Long tails; note/laras and retrigger policy required.                                                   |
| Kempul         | Pending                                        | Long resonance; voice/tail review required.                                                             |
| Gong ageng     | Pending                                        | 20 s retained source; do not repeat former overlap behavior.                                            |
| Suling         | Assess after curated strikes                   | Retained demo is not a curated tuned note bank. No fake bank.                                           |
| Vocal loops    | Assess last                                    | Audition only if sensible without adding a transport.                                                   |

Architecture: standalone registry and sampler adapter are imported only by
`src/pads/main.js`. Shared Studio catalogs/renderers and engine code stay intact.
Use existing SampleBank, voice envelopes, master/output stage and lifecycle.
No new sounds are fetched at startup; selected strikes load on demand. Additional
banks use a compact instrument selector, not a growing all-visible phone grid.

Per increment: verify originals/license/source forms; measure onset/tail/noise/DC,
peak and short-hit energy; preserve originals and record any derivation. Verify
lifecycle/cancellation/input/asset errors, UI ID/EN desktop/mobile, headroom and
cache/voice cleanup. Pin Studio graph/assets/load footprint and WAV/Beatbox
regression. Commit only intended files, push existing main, verify exact live SHA
and Cloudflare success, then advance. No Actions or security settings changes.

Long sources currently exceed the shared short-shot maximum of 2 seconds. Do not
weaken that guard or silently cut them. After the short first increment, define a
standalone-only sustained-sample contract if measurements justify it, retaining
Studio's contract and graph isolation. Cultural tuning/listening remain unverified
unless actual independent evidence is obtained.

## Kethuk qualification — 2026-10-23

Two source-labelled strikes only: fs-261691 Pelog 6 and fs-261685 Slendro 2.
Original FLAC and source ZIPs remain unchanged under internal/gamelan-flac and
internal/gamelan-source-forms. CC BY 3.0 recordings / Artistic 2.0 package notices,
creator credits, original-source links and delivery modifications are accessible
in the standalone page's credits. Recorded laras is not a tuning-compatibility claim.

No destructive optimization was justified: full 1.425/1.935 s stereo tails retained,
no full-scale frames, DC around -0.000012, onset 0–2 frames, quiet tail 50 ms.
Fixed runtime calibration ×2.774117 raises strongest K400 from -30.763 to -21.901
and individual peak 0.2343 to 0.6500. It stays 4.84 dB below the nylon short-hit energy
reference to preserve transient headroom; this is not perceived-loudness equality.
Same-note retrigger has 12 ms release; bank limit 4 voices, global engine limit 64.
Stop cancels logical admission and removes owned voices; native decode leases
remain reserved until real settlement. Two notes can overlap; full sustain is kept.
No new shortcuts; accessible Enter/Space and native multitouch use existing input.

Evidence: qa-artifacts/pad-kethuk-2026-10-23 (excluded from Git publication).
600/600 unit tests, lint, official build 535d50e6-2b99-464d-8fa2-71f775403c16.
Four CSP desktop/mobile ID/EN Pad Station profiles plus cancellation/retry gates;
23 standalone pads,21 core shortcuts. Ten Studio/Beatbox regressions. Studio stays
21 pads / 21 decodes, no Kethuk requests;49 old audio files and62 Studio binary assets
byte-identical. Three independent kit WAV comparisons max 1 LSB. Shared chunk export
aliases changed during bundling; source Studio/audio modules are unchanged, so
bundle textual identity is not falsely claimed. Root document markup grows.

Matched 30 s core-pad pair: 4,293,128 decoded bytes unchanged,255 created / 255 ended,
0 active after Stop,0 intervals. Kethuk-only 31 s repeat plus 20 Stop/restarts:
2 decodes / 1,290,392 bytes stable,162 created / 162 ended,0 active after Stop, context closed
at disposal. JS heap snapshots are GC-sensitive, not native/total memory. Observer
listener/DOM counts include uncollected ended-source objects, so no total-memory
leak-free or audio-thread CPU guarantee is claimed. No physical listening/device,
Safari or long-session qualification. Historical 5.67 ms timing observation untouched.

32 summed headroom renders cover 44.1/48 kHz,default/max/half/zero master.
All 23 default simultaneous peak 0.881606; about 1.96% active frames exceed inherited
base limiter knee. Double 23 at 50 ms: 4.39% default / 5.60% maximum knee occupancy.
The existing limiter compresses extremes; no new limiter/attenuation was added.
Natural ensemble at default peaks 0.8424, knee 0.017%. These are measured renders,
not a claim every simultaneous mix remains linear or sounds balanced to listeners.

Next: verify exact commit/deployment/production before Kempyang. No other retained
instrument or demo has been integrated by this increment.

## Kethuk production closure

Commit: 8c3015965a52d6e1a20b33f03c853a8122d07792.
Pages deployment: ebbeef0f-4dad-493b-8313-6ccb4d3fc172, success.
All 133 artifact bodies verified; binary bytes exact and text normalization limited
to line endings and explicit manifest references. Four production ID/EN desktop/
mobile viewport profiles passed, plus audio/multitouch/Stop, Studio isolation,
three independent kit WAV oracles and Beatbox repeat/reset. No physical-device or
listening claim. Receipt: qa-artifacts/pad-kethuk-2026-10-23/publication/RECEIPT.json.

## Kempyang increment — local qualification

Retained fs-261984 Pelog 6 and fs-261760 Slendro 1, full stereo durations
0.9943 / 1.0438 s. Source work IDs, hashes, original titles, CC BY 3.0 recordings
and Artistic 2.0 package notices verified. No full-scale frames, DC about
-0.000012; onset 0–2 frames. Full lossless tails retained; no destructive trim,
denoise, retune or original edits. Gain ×5.691921 raises strongest short-hit K400
from -34.728 to -19.623 and peak 0.1142 to 0.6500. It remains 2.56 dB below the
nylon energy reference because transient headroom takes priority over forcing
an equal energy reading. No perceived-loudness guarantee.

The existing additional-instrument selector now switches Kethuk / Kempyang.
It stops prior intents/voices before rendering the new two-button bank. Only
23 pads are visible at once: 21 core plus two selected strikes, 25 available.
No new keyboard shortcut or persistence/schema change. No auto-loaded samples.

600 unit cases, lint and official build passed. Four bilingual CSP viewport
profiles and ten warm bank switches passed; four samples decode only once,
2,073,040 bytes total when both banks are warm. Switch during pending fetch or
resume produced no old voice/request, while the new bank played correctly.
Kempyang alone: 31 s repeat plus 20 Stop/restarts, 782,648 decoded bytes stable,
162 sources started/ended, zero after Stop and closed context at disposal.
Native two-touch, Enter/Space, actual output/mute/master-zero checks passed.
Studio remains 21 pads / 21 decodes with no Kempyang request; 51 previously
published audio files and 62 Studio binaries remain exact. Independent Studio
WAV for three kits stays within 1 LSB. JS heap/listener metrics remain GC-sensitive;
these are bounded automated checks, not total-memory/audio-thread guarantees.
No physical listening, phone, Safari or long-session qualification.

Evidence: qa-artifacts/pad-kempyang-2026-10-23. Publication and final matched
performance / Studio regression closure must be recorded before Kenong.

Matched 30 s core workload against published Kethuk: 4,293,128 decoded bytes and
255 started / 255 ended in both runs; no active voices or intervals after Stop.
Final JS heap snapshots: 3,751,304 / 3,786,980 bytes, with no forced GC; not total
native memory or a statistically precise overhead result. The inherited limiter
still bounds all-23 coincident output at about 0.881606; default active-frame knee
occupancy 2.16%, double-hit stress 4.97%. Zero-master renders are silent at both
sample rates. No new limiter or global attenuation was introduced.

## Kempyang production closure

Commit 26333a5fe7ee4fec0c3e2d305aa60028b9acbab9; Pages
493f0aa8-d777-4013-8c42-1078a754fa5b, success. All 137 body identities,
4 ID/EN viewport profiles, selector interruption/cache, actual two-touch/mute,
Studio 21-pad isolation, three independent WAV kits and Beatbox repeat passed.
Receipt: qa-artifacts/pad-kempyang-2026-10-23/publication/RECEIPT.json.

## Kenong qualification and observed limits

Eleven original strikes, not an invented chromatic bank: Pelog degrees 1, 2, 3,
5, 6, 7 and Slendro 1, 2, 3, 5, 6. These are separate selector choices. Full
0.801–1.239 s source tails retained. Source hashes, CC BY 3.0 work/creator links,
Artistic 2.0 notices and all eleven original source ZIPs verified. No full-scale
samples; DC near -0.000012, onset 0–48 frames, quiet final 50 ms. No retuning,
mono conversion, denoise or destructive original rewrite. Fixed gain ×3.404015
raises strongest K400 from -28.508 to -17.868; maximum individual peak 0.191 to
0.650. Reference nylon remains about 0.81 dB higher in this metric. Natural
within-bank differences remain; perceived balance/listening is unverified.

Studio remains 21 pads with no Kenong registry/assets in its static import
closure. All 53 already-published audio files and 62 Studio binaries remain exact.
Standalone shows 27 pads with Pelog or 26 with Slendro, rather than all banks at
once. There are 36 available strikes including core / Kethuk / Kempyang / Kenong.
All eleven Kenong decodes total 4,380,184 bytes; all 15 added strikes plus the
21 core sounds total 10,746,352 bytes when warm, below the unchanged 32 MiB cap.

A deterministic voice-policy counterexample is preserved in rc1/STEAL-REPRO.log:
the original four-total-voice policy disconnected two nonzero voices immediately
when six different notes arrived. Kenong alone opts into four sounding voices
plus at most four 12 ms releases. Final regression preserves the old two-strike
bank defaults. At an artificial overload of 120 gestures in six-note bursts,
82 sources were admitted; excess gestures are refused, never queued. Peak native
ownership was eight, then zero after Stop, with a fresh gesture accepted. This
is bounded polyphony, not a claim every overloaded gesture sounds. Isolated
strikes keep their full tails; polyphonic replacement intentionally damps them.
No physical listening or click-free output guarantee is claimed.

Final logic tests: 601 cases, lint and corrected official build. Four ID/EN
Kenong viewport profiles check all eleven mappings, audible output, touch,
Enter/Space, selector typing guards, warm cache and natural retirement. Native
repeat/cancellation, prior-bank regressions and three independent Studio WAV
oracles pass. Manual summed renders cover 64 combinations at 44.1 / 48 kHz;
all-Pelog / Slendro default knee occupancy is about 2.29% / 2.76%, while extreme
double-hit mixes reach about 4.49% / 5.99%. Peak stays about 0.881606 through the
existing limiter. These conservative scenarios are not a claim all mixes are
linear or perceptually balanced.

One Studio regression observation remains unexplained: during concurrent QA,
a single kick was still counted by the observer 180 ms after Stop. The first
failure is retained at stop-diagnostic/FIRST-FAILURE.json. A predeclared three
cold runs on the published baseline and three on the candidate all showed native
Stop, silence and retirement within the same gate. One final isolated 10-case
Studio regression also passed without changing that 180 ms requirement. No core
code was changed and the original cause remains UNKNOWN; passing runs do not
prove it was a harness fault or a fixed product defect. Keep this observation
separate from the older 5.67 ms timing caveat, which is also untouched.

The final build additionally removes obsolete fixed-21 wording from Pad Station
homepage/metadata only. Audio/control sources are pinned unchanged from the
qualified R2 artifact; final UI/audio checks bind the last artifact. JS heap is
GC-sensitive and not total native/process memory. Physical phone, Safari,
listening and long-session qualification remain unverified. Publication receipt
must be completed before the next instrument.

Final Kenong artifact: official build c630b5b5-c339-4c72-9156-1a7f4add8487.
601 final unit cases and lint passed; final metadata-corrected artifact passed
four all-note Kenong profiles, four prior-bank profiles, three independent WAV
kit comparisons and the bounded voice-burst test. Audio/control source hashes
remain identical to qualified R2. Matched 30 s core workload against Kempyang
has 4,293,128 decoded bytes, 255 created / ended, zero active/intervals in both
runs; final heap snapshots 3,789,696 / 3,786,984 bytes are GC-sensitive, not an
improvement percentage or total-process memory guarantee.
