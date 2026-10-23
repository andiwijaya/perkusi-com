# Pad Station retained-media rollout

Baseline: `7e81f369162a2110875ca4d272e1b78192bd0051`.

Scope: standalone only, one instrument qualified and published before the next.
Rhythm Studio stays at 21 pads and its present groups, mappings, schema and gains.
No retired V5/V6 runtime, mic, loop transport, new downloads or tuning claims.

| Increment      | Status                                             | Media / gate                                                                                            |
| -------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Kethuk         | LIVE — 8c301596 | Two retained strikes: Pelog 6 and Slendro 2; full 1.425/1.935 s tails fit existing short-shot contract. |
| Kempyang       | Pending                                            | Two retained strikes; next only after Kethuk production gate.                                           |
| Kenong         | Pending                                            | 11 retained strikes; organize by recorded laras, no invented notes.                                     |
| Demung         | Pending                                            | Source tails 5.9–12.2 s; measure sustain and budgets before admission.                                  |
| Saron barung   | Pending                                            | Source tails up to 17.3 s; no arbitrary blanket 2 s crop.                                               |
| Peking         | Pending                                            | Source tails 2.8–14.5 s; tail/onset review required.                                                    |
| Slenthem       | Pending                                            | Source tails up to 45 s; bounded sustain contract required.                                             |
| Bonang barung  | Pending                                            | Long tails; note/laras and retrigger policy required.                                                   |
| Bonang panerus | Pending                                            | Long tails; note/laras and retrigger policy required.                                                   |
| Kempul         | Pending                                            | Long resonance; voice/tail review required.                                                             |
| Gong ageng     | Pending                                            | 20 s retained source; do not repeat former overlap behavior.                                            |
| Suling         | Assess after curated strikes                       | Retained demo is not a curated tuned note bank. No fake bank.                                           |
| Vocal loops    | Assess last                                        | Audition only if sensible without adding a transport.                                                   |

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
