# Pad Station retained-media rollout

Baseline: `7e81f369162a2110875ca4d272e1b78192bd0051`.

Scope: standalone only, one instrument qualified and published before the next.
Rhythm Studio stays at 21 pads and its present groups, mappings, schema and gains.
No retired V5/V6 runtime, mic, loop transport, new downloads or tuning claims.

| Increment      | Status                                        | Media / gate                                                                                            |
| -------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Kethuk         | LIVE — 8c301596                               | Two retained strikes: Pelog 6 and Slendro 2; full 1.425/1.935 s tails fit existing short-shot contract. |
| Kempyang       | LIVE — 26333a5f                               | Two retained strikes; next only after Kethuk production gate.                                           |
| Kenong         | LIVE — ef37d9c9                               | 11 retained strikes; organize by recorded laras, no invented notes.                                     |
| Demung         | Pending                                       | Source tails 5.9–12.2 s; measure sustain and budgets before admission.                                  |
| Saron barung   | LIVE - 83bd28a4                               | Source tails up to 17.3 s; no arbitrary blanket 2 s crop.                                               |
| Peking         | LIVE - 84f81c1d                               | Source tails 2.8–14.5 s; tail/onset review required.                                                    |
| Slenthem       | Pending                                       | Source tails up to 45 s; bounded sustain contract required.                                             |
| Bonang barung  | Local qualification PASS; publication pending | Eight curated strikes; four source-quality holds, not a complete12-note bank.                           |
| Bonang panerus | LIVE - d1805943                               | Long tails; note/laras and retrigger policy required.                                                   |
| Kempul         | Pending                                       | Long resonance; voice/tail review required.                                                             |
| Gong ageng     | Pending                                       | 20 s retained source; do not repeat former overlap behavior.                                            |
| Suling         | Assess after curated strikes                  | Retained demo is not a curated tuned note bank. No fake bank.                                           |
| Vocal loops    | Assess last                                   | Audition only if sensible without adding a transport.                                                   |

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

## Kenong production closure

Commit ef37d9c9e5ee0cc238ac3ef9703d28e00c1b372c; Pages
c937226d-fded-4757-a76a-f34380ab3f6a, success. All 159 bodies and 18 routes
verified. All eleven mappings / four profiles, prior banks, controls, bounded
release bursts, three independent WAV kits and Beatbox repeat passed. The earlier
Stop observer assertion remains UNKNOWN and is preserved, not described as fixed.
Receipt: qa-artifacts/pad-kenong-2026-10-23/publication/RECEIPT.json.

## Bonang panerus — curated full-tail increment

Ten source strikes: Pelog 2, 3, 4, 5, 6, 7; Slendro 2, 3, 5, 6. Two original
strikes are HELD: fs-261708 (BONANG_BPPL1.wav) and fs-261942 (BONANG_BPSL1.wav).
Their original integer recordings reach full scale; audible distortion is not
established. They need listening/curation before inclusion. Delivery attenuation
is not a repair of source clipping. All twelve originals and existing optimized
files remain untouched in their retained locations. This is not a complete
12-note bank and the UI explicitly identifies missing degree 1.

Full stereo FLAC tails 3.534–7.909 s are preserved. Left/right channels differ
throughout this group, so exact channel deduplication was rejected. No mono
conversion, denoise, arbitrary two-second crop or retune. Onset threshold is
0–11 frames among accepted files; DC near -0.000012; quiet final 50 ms; no
full-scale delivery frames. Existing uniform source gain 0.8 / 48 kHz delivery
and CC BY 3.0 / Artistic 2.0 provenance remain explicit. Source ZIP and original
Freesound work links are present in credits. Correlation ambiguity advisories
are not treated as evidence to time-shift a recorded strike.

Fixed runtime gain ×1.196790 raises strongest accepted K400 -22.689 to -21.129,
peak 0.5431 to 0.6500. The nylon energy reference remains about 4.07 dB higher;
transient headroom and within-bank dynamics take priority over forcing equal
energy readings. Human-perceived balance is unverified. Four sounding voices
and up to four 12 ms release tails remain bounded; overloaded bursts are refused,
never queued. Isolated strikes retain full tails; replacement intentionally damps.

Shared SampleBank adds an explicit constructor duration profile and inactive-cache
method. Existing callers still enforce two-second one-shots, same schema,
encoded 4 MiB limit, peak checks, native queue leases and 32 MiB retained-cache
limit. Only the two standalone Bonang banks pass an eight-second profile. Studio
catalogs, group count, project schema, current gains and mappings are unchanged.
Leaving a long bank stops/disconnects its owned voices, evicts that bank cache
and keeps its queue accounting visible. Native decode promises retain leases
until actual settlement; cache eviction does not claim native cancellation or
instant total-process memory release. Short-bank switching still reuses cache.

608 unit cases, lint and official build passed, including explicit default-
profile rejection, long geometry bounds, encoded/cache caps, native lease and
late-admission tests. Four CSP profiles cover all ten mappings, full natural
tails, native touch/keyboard, same-bank warmth and intentional reload on long-bank
switch. Cold Stop/deferred-resume/retry, 162-source repeat and twenty six-note
burst gates passed. Native ownership view measured: core 4,293,128 bytes; all
short banks warm 10,746,352; with Bonang Pelog 25,526,016; switching away returns
exactly to the short baseline. A held decode remains counted until settlement,
with zero stale voice and a fresh gesture accepted.

All 64 previously published audio files and 62 Studio binary assets are exact.
The shared JS bank implementation changed only through the explicit opt-in
profile/cache additions; textual JS identity is not claimed. Studio retains
21 pads and passes ten browser regressions, including unchanged score/model,
quantize, repeat, save/export and Beatbox. Three independent kit WAV oracles
remain within 1 LSB. The first selector-runner failure was a nonexistent dist-r2
folder, preserved as SELECTOR-FIRST.json; correcting that QA path required no
product/build change. An initial unit expectation also undercounted retained
budget verification; CONTRACT-FIRST.log is preserved.

Matched core workload: 30 s each, 4,293,128 decoded bytes, 255 created / ended,
zero active sources or intervals. Additional combined Bonang + drum/Bilah/
kendhang/bass/guitar jam: 31 s, 621 created / ended total, 27 decodes and
19,072,792 decoded bytes stable during that workload. Separate cache ownership
view covers the hotter all-short-bank case above. Native contexts close on
navigation/disposal; mute/master survive switching and locale changes preserve
bank choice/cache. Four viewport screenshots were inspected/checked, not a
physical-phone qualification.

Browser process observations are separate from JS heap and cache: candidate
core private committed sum 293,732,352 bytes; after the higher-rate combined
workload 317,173,760. Summed working sets include shared pages and all owned
browser processes. These are coarse process observations, not isolated audio-
thread CPU, resident PCM, a precise overhead percentage or a leak-free guarantee.
Normal benchmarks did not force GC. A separate retention diagnostic returned
listeners/nodes to the same 51 / 642 baseline after each of two burst blocks;
its controlled GC is not a performance improvement claim. Closed-context and
zero-voice/lease checks are reported separately from allocator reclamation.

64 full-tail summed renders cover both scales, 44.1 / 48 kHz and default/max/
half/zero master. Observed maximum output about 0.881606 uses the inherited
limiter; all-pad default active-frame knee occupancy about 0.57% Pelog / 0.82%
Slendro, double-hit stress about 1.23% / 1.78%. Long quiet tails change this
ratio's denominator. Extreme mixes still compress; no new limiter or blanket
attenuation was introduced. Physical listening, phone/Safari, higher device
sample rates, long sessions and the older timing / Stop observations remain
outside these bounded claims. Evidence: qa-artifacts/pad-bonang-panerus-2026-10-23.
Published as d1805943e0ec52a23af5988c228f8b5bdd52ab41; Cloudflare deployment 1ed7472f-2344-4d35-98d4-9e154f1a5d9e succeeded. All179 strict body checks /18 routes passed, as did controls, Studio21, burst, WAV and Beatbox production checks. First all-note production run passed3profiles, then ENmobile loading remained pending20s. One isolated ENmobile diagnostic passed all10 notes at0.536-1.551s; first failure is retained, cause unknown, not declared fixed. Address-specific connection failures and HTTP adapter diagnostics are retained separately. Final body comparison used original fetch, scoped selection of an actual DNS answer and fresh connections; no system DNS, CSP or content-comparison relaxation. Receipt: qa-artifacts/pad-bonang-panerus-2026-10-23/publication/RECEIPT.json.

## Peking qualification - 2026-10-23

Twelve source-labelled strikes: seven Pelog, five Slendro. Original titles
SARON_SPPL1-7 / SARON_SPSL1,2,3,5,6 remain unchanged. Registry, credits and
work-261824 source ZIP establish this retained mapping; the archive contains
SARON/SPPL1.wav with original SHA256
be619d27d7854db850cd6530103488842802159e50431a8d728c5d72dcadfaaf.
The first new test omitted an import and assumed invented PEKING_* names.
Failures are retained. A single approval-review retry accepted the corrected
assertion after source inspection; attribution and media were not renamed.

All 12 stereo pairs differ. Full 2.849-14.471 s FLAC tails/timing are retained,
with no destructive optimization. Onsets 0-34 frames at the -60 dB threshold,
DC near -0.000012, zero full-scale delivery frames and no historical quality
flags. Correlation ambiguity remains an advisory, not permission to shift audio.
Fixed gain x2.073663 raises strongest K400 -24.700 to -18.366 and peak 0.31345
to 0.6500, about 1.31 dB below the nylon energy reference. Natural note dynamics
remain; perceived equality is unverified. Source ZIPs, CC BY 3.0 attribution and
modification notices / Artistic 2.0 notices are accessible from the page.

Explicit 15 s standalone profile, four sounding plus four smooth releases
(maximum eight), excess gestures refused. Defaults and 4 MiB encoded / 32 MiB
retained-cache guards are unchanged. Local gates: 609 tests, lint, official build
bf0484b5-655a-4eb8-b6d2-9894a545b850; four responsive CSP all-note profiles,
longest-strike natural retirement, cold Stop/resume/retry, navigation and controls.
31.7 s repeat + 20 Stop/restarts: 162 sources created/ended, two decodes /
7,867,952 bytes stable. Twenty seven-note bursts: 140 gestures, 83 admitted,
maximum eight native voices, zero after Stop. Hot all-short + core + Pelog
cache 26,489,128 bytes; Slendro 19,356,776. Leaving the bank returns to
10,746,352 bytes; pending native leases settle honestly with no late admission.

All 74 previous audio files and 62 Studio binary assets are exact. Active
audio/Studio/Beatbox/project source blobs are unchanged. Compiled aliases and
traversal order differ; no alpha-normalization or blanket JS-equivalence claim.
Initial graph-checker failures remain recorded; exact binary sets, source pins,
no new Studio media requests and actual browser/PCM gates are separate evidence.
Seven Station and ten Studio/Beatbox gates plus three WAV kit oracles (<=1 LSB)
passed. Core matched runs: 255 created/ended, 4,293,128 decoded bytes, zero
voice/intervals. Core heap snapshots 3,825,500 before / 3,834,924 after are
GC-sensitive. Combined 31 s jam: 622 created/ended, 28 decodes / 20,035,904 bytes
stable; context closes at disposal. Owned-process private committed sums were
293,806,080 baseline core / 300,978,176 candidate core / 324,796,416 combined,
323,899,392 after disposal. These are coarse, not isolated audio-thread CPU,
resident PCM or an immediate reclamation guarantee. Separate controlled-GC
checks return listeners/nodes to 51/749 after each burst block; heap grows with
bounded metadata/JIT/probes and is not claimed flat or leak-free.

64 full-tail summed renders at 44.1/48 kHz and default/max/half/zero master
remain finite, peak about 0.881606 through the inherited limiter. Default
all-pad knee occupancy ~0.318% Pelog / 0.863% Slendro; double stress
~0.682% / 1.720%. Maximum-master double stress ~0.900% / 2.290%. These
conservative signal mixes exceed steady admitted polyphony; quiet tails affect
the denominator. No new limiter or blanket attenuation.

Published 84f81c1df1f6a083d41d94e792c624b2f24b4731; Cloudflare deployment
4bec81f7-8e45-4a1f-82bf-271a5f55ff31 succeeded. All 203 strict bodies /
18 routes, four production profiles with all 12 notes, controls, bursts,
Studio 21 pads / 21 decodes without Peking requests, three WAV kit oracles and
Beatbox repeat/reset passed. Receipt:
qa-artifacts/pad-peking-2026-10-23/publication/RECEIPT.json, SHA256
b979e1f56c3afa61a4453689c87e9259bfbed2970cd6be30caac47cf81f51e9e.
Physical listening/phone/Safari, long sessions and higher device sample rates
remain unqualified. Historical timing / Stop observer / Bonang loading events
are not declared fixed.

## Saron barung qualification - 2026-10-23

Twelve source-labelled strikes: seven Pelog, five Slendro, original SARON_SB*
titles and work/source ZIPs retained. All actual FLAC hashes match the registry,
with CC BY 3.0 recording attribution, source/modification notices and Artistic
2.0 package notices. No historical quality flags; culture/tuning/listening
acceptance is not implied. All stereo pairs differ, so retain full lossless
48 kHz delivery and available 3.768-17.260 s tails. No mono conversion, crop,
denoise or retuning. The earlier verbal minimum estimate was corrected by
the full measured range. DC near -0.000012, onsets 0-24 frames at -60 dB,
zero full-scale delivery frames.

Fixed uniform gain x1.550063 raises strongest K400 -23.251 to -19.444 and
peak 0.41934 to 0.6500. The remaining ~2.39 dB energy gap to nylon preserves
transient headroom and within-bank dynamics; perceived balance is unverified.
Explicit standalone 20 s profile, inherited four sounding + four release
voices, maximum eight. No memory-ceiling increase, core mapping/gain/schema
change or Studio integration. Leaving a long bank evicts its cache after Stop.

610 tests, lint and official build a6622893-5b84-48b5-b472-022dab8f4a1d
passed before a short executor disconnect. The attempted native command failed
at process creation; reconnect inspection proved no process, result or owned
listener existed. Only pending gates resumed, not the completed suite/build.
Four desktop/mobile ID/EN CSP profiles cover all 12 mappings, natural retirement
of the 17.26 s strike, keyboard/touch/input guards and cache switching. Candidate
mobile pixels inspected. Five lifecycle gates, 20 Stop/restarts and 31.1 s
repeat: 162 sources created/ended, two decoded notes / 4,223,992 bytes stable.
Twenty seven-note bursts: 140 gestures, 83 admitted, maximum eight voices,
zero after Stop, no phantom starts. Controls, locale and route/back reopening
passed in isolated QA profiles.

Actual core cache 4,293,128 bytes; all short banks + core 10,746,352.
Peking-to-Saron transition evicts the old long bank exactly. Saron hot Pelog
31,173,784 bytes, Slendro 29,598,216, below 32 MiB at 48 kHz. Leaving
returns to the short baseline. Pending native decode stays counted until true
settlement; no late voice, fresh intent works; disposal yields zero retained
cache/voices and closed context. Higher device rates remain unqualified and
can reach guards sooner. These are retained-buffer figures, not total RAM.

All 86 old audio files and 62 Studio binary assets remain exact; active
audio/Studio/Beatbox/project source blobs unchanged. Generated alias differences
are not normalized away as semantic proof. Seven Station, ten Studio/Beatbox
gates and three independent kit WAV oracles (<=1 LSB) passed. Matched core
runs each create/end 255 sources and retain 4,293,128 decoded bytes with zero
voice/intervals. Heap snapshots 5,246,772 before / 3,834,276 after are not an
improvement claim. Combined 31 s workload: 622 created/ended, 28 decodes /
24,720,560 bytes stable; zero active/intervals and closed context after disposal.
Owned-browser private committed sums: 303,734,784 baseline core, 304,578,560
candidate core, 340,828,160 combined, 339,693,568 disposed. Shared working-set
duplication, native allocator retention, GC and instrumentation limit precision.
Separate controlled-GC blocks return listeners/nodes to 51/847 each time
(33 listeners after disposal); no long-term leak-free or audio-thread CPU claim.

32 full-tail headroom renders, one scale at a time, cover default/maximum
master at 44.1/48 kHz; actual controls separately verify mute/master zero.
Peak about 0.881606 through the inherited limiter. At 48 kHz / maximum master,
all-pad knee occupancy ~0.501% Pelog / 0.332% Slendro; double stress
~0.995% / 0.736%. Quiet tails affect this fraction; stress mixes exceed steady
polyphony. Compression is retained, with no new limiter or attenuation.

Published 83bd28a481ccd472a259c3f2a33e01e45c165de1; Cloudflare deployment
d94736a3-3ab9-43e2-972f-00fc4e92a109 succeeded. All 227 strict bodies /
18 routes completed over an initial 79 verified reads and 148 resumed reads.
One 4,250-byte guitar manifest request timed out at 15 s; its isolated diagnostic
returned exact bytes. The original 79 records remain hash-identical. No body
comparison was weakened or network root cause claimed. Four production all-note
profiles, controls, bursts, Studio 21 pads / 21 decodes without Saron requests,
three WAV kit oracles and Beatbox repeat/reset passed. Receipt:
qa-artifacts/pad-saron-barung-2026-10-23/publication/RECEIPT.json, SHA256
dc653eaf17505a7641bf5349c58a83800c94afd9f0cf0f9f05e9eb39bcdc7be7.
Physical phone/listening/Safari, long sessions and historical timing/Stop/loading
observations remain outside the demonstrated gates.

## Bonang barung qualification - 2026-10-23

Eight eligible source-labelled strikes: Pelog 1/2/5/6 and Slendro 1/2/3/5.
Four originals remain held: fs-261805 (Pelog3), fs-261803 (Pelog4), fs-261783
(Pelog7), fs-261710 (Slendro6), flagged for full-scale integer samples in the
original source. Audible distortion has not been established; delivery gain
is not a repair. No complete 12-note-bank claim. Held originals, optimized
versions, source archives and license evidence remain protected locally;
they are not imported as playable pads. UI and credits state the omissions.

All actual eligible FLAC hashes match the retained registry. CC BY 3.0
recording attribution, raw source forms, modification notices and Artistic 2.0
package notices are exposed. Full 5.625-10.315 s available stereo tails and
source timing are retained. Channels differ and often have different levels;
no mono fold or per-channel gain alteration. No crop, denoise or retune.
Eligible delivered files have zero full-scale frames, DC near -0.000012,
onsets 0-61 frames at -60 dB and quiet final 50 ms. Source/culture/listening
qualification remains distinct from these technical measurements.

Calibration uses only the eight eligible files, not the four held strikes.
Uniform gain x1.207029 raises strongest K400 -22.153 to -20.519 and peak
0.53851 to 0.6500. The ~3.46 dB energy gap to nylon protects transient
headroom and within-bank dynamics; no perceived-loudness equality claim.
Explicit standalone 15 s profile and existing four sounding + four releases
(maximum eight); no change to encoded 4 MiB / retained 32 MiB guards,
shared engine, Studio catalog, project schema, mappings or current gains.

611 tests, lint and official build 9c4b634b-3a13-4749-8f8f-e84f226836e8 passed.
Four desktop/mobile ID/EN CSP profiles play all eight actual mappings and
verify the longest eligible natural tail, touch/keyboard/typing guards,
same-bank warmth, intentional reload and disposal. Mobile screenshot inspected.
Five native lifecycle gates: 20 Stop/restarts plus 31.69 s repeat admit
162 sources, all ended; two decoded notes / 6,928,216 bytes stay stable.
Twenty twelve-gesture bursts: 240 attempted, 84 admitted, maximum eight
native voices, zero after Stop and no phantom work; overload is refused,
not queued. Cold Stop/resume, failure/retry, controls, locale and route/back
gates passed. No human listening or physical-touch qualification is implied.

Actual hot core cache 4,293,128 bytes; all short + core 10,746,352.
Saron-to-Bonang transition evicts the prior long cache before new admission.
Bonang Pelog peak 24,618,992 bytes, Slendro 23,538,672. Leaving returns
exactly to the short baseline. Pending native leases remain until real
settlement; zero stale voice and fresh intent succeeds. Disposal leaves
zero retained cache/voices and a closed context. Higher device rates may
reach the unchanged cache guard sooner and remain unqualified.

All 98 previously published audio files and 62 Studio binary assets are exact.
Active audio/Studio/Beatbox/project source blobs are unchanged. Generated
alias differences are not alpha-normalized as semantic proof. Seven Station,
ten Studio/Beatbox gates and three independent kit WAV oracles (<=1 LSB) pass.
Core matched runs each create/end 255 sources with 4,293,128 decoded bytes
and zero active/intervals. Heap snapshots 3,742,804 before / 5,275,824 after
are GC-sensitive, not precise overhead. Combined 31.5 s workload: 619
created/ended, 25 decodes / 18,165,768 bytes stable. Owned-browser private
committed sums: 297,902,080 baseline core, 307,507,200 candidate core,
315,445,248 combined, 314,351,616 disposed. These include browser/native
allocator behavior and do not isolate audio-thread CPU or resident PCM.
Separate controlled-GC blocks restore listeners/nodes to 51/894 each time
(33 listeners disposed); heap 2.782-3.571 MB is not claimed flat or leak-free.

32 full-tail renders cover default/maximum master at 44.1/48 kHz, using
one recorded scale and the actual default Pad Station kit per render.
Native controls separately verify mute/master zero; Studio's three kits
are covered by independent WAV regression. Peak about 0.881606 through
the inherited limiter. At 48 kHz / maximum master, all-pad knee occupancy
~0.609% Pelog / 0.595% Slendro; double stress ~1.253% / 1.302%.
Conservative stress exceeds steady admitted polyphony and quiet tails
affect the denominator. Compression remains; no new limiter or attenuation.

Evidence: qa-artifacts/pad-bonang-barung-2026-10-23. Publication pending.
Physical listening/phone/Safari, long sessions and historical timing,
Stop observer and loading observations remain unqualified, not declared fixed.
