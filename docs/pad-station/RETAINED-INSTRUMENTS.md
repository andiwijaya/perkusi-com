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
| Demung         | LIVE - 5897419c | Twelve retained strikes; large-bank extra-cache replacement preserves core21 and32MiB.                  |
| Saron barung   | LIVE - 83bd28a4                               | Source tails up to 17.3 s; no arbitrary blanket 2 s crop.                                               |
| Peking         | LIVE - 84f81c1d                               | Source tails 2.8–14.5 s; tail/onset review required.                                                    |
| Slenthem | Local qualification PASS; publication pending | Selected Pelog2/3/4/5/7 and Slendro1/2/6; four originals held, not a complete bank. |
| Bonang barung  | LIVE - cb6cb772                               | Eight curated strikes; four source-quality holds, not a complete12-note bank.                           |
| Bonang panerus | LIVE - d1805943                               | Long tails; note/laras and retrigger policy required.                                                   |
| Kempul | LIVE - 65708351; bounded review accepted | Eleven strikes; original observer event remains UNKNOWN. |
| Gong ageng | LIVE - 76ef7790 | One full original strike; same-pitch damping; bounded lifecycle qualification with historical unknowns retained. |
| Suling | DEFERRED - demo only | Six retained source/diagnostic media; not a qualified isolated-note bank. Preserve CC BY-SA4 provenance. |
| Vocal loops | Assessed; optional audition deferred | Existing twelve5s/two-bar96BPM phrases remain in Beatbox/Studio. No new loop transport. |

Architecture: standalone runtime registries and sampler adapters are imported only
by `src/pads/main.js`. Normal Studio catalogs, mappings, schema, calibration and
transport stay intact. The first long-bank increment added explicit opt-in
SampleBank duration/cache APIs; two-second defaults, encoded/cache ceilings and
native ownership remain. Later catalogs reuse that code.
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

Published cb6cb7723aceca510426a871307931f4fccf030f; Cloudflare deployment
b240d7c9-8549-45dc-b337-6f9aaea04b02 succeeded. All 243 identity records /
18 routes completed: initial 169, resumed 20, isolated exact 8 MB probe, then
53 serial reads. Two old source-archive reads timed out; successful records
remain frozen and no root cause or single uninterrupted pass is claimed.
Four production profiles with all eight notes, controls, burst/Stop, Studio
21 pads / 21 decodes without Bonang requests, three WAV kit oracles and
Beatbox repeat/reset passed. Receipt:
qa-artifacts/pad-bonang-barung-2026-10-23/publication/RECEIPT.json, SHA256
54ba6d3ef2ccdb050b77f2d09ad59a953379727ada91cd341ca252168f7ffa85.
Physical listening/phone/Safari, long sessions and historical timing,
Stop observer and loading observations remain unqualified, not declared fixed.

## Capacity wording and incremental identity evidence

For banks configured with releaseBudget 4, the enforced bounds are at most
four not-yet-releasing voices and eight total owned voices including fades.
There is no separate hard count of four releasing nodes: rapid same-note
retriggering can leave fewer sounding voices and more short fades within
the same total of eight. Earlier 4+4 shorthand describes capacity, not
independently enforced counts. This is a source-semantics clarification,
not an engine change. Kethuk/Kempyang retain their four-total policy.

After the Bonang barung release, unchanged source archives need not be
re-downloaded every increment. Prior successful SHA256 evidence may carry
forward only for identical candidate bytes/hash and the same deployed URL,
with current HTTP HEAD presence/type/length checked. New/changed archives
and all other content retain current GET/body checks. Reports separate
carried archive checks from current full-body hashes; they do not claim
all current bodies were downloaded when evidence was reused.

## Demung qualification - 2026-10-23

Twelve retained source-labelled strikes: seven Pelog, five Slendro, with no
historical quality flags. Actual FLAC hashes and CC BY 3.0 / source/package
provenance checked. All stereo pairs differ; retain full 5.887-12.243 s
recordings and source timing, no mono/crop/denoise/retune. Source forms,
creator credits, uniform source-gain/resampling and runtime modifications
remain available under CC BY 3.0 / Artistic 2.0 notices. Cultural/tuning
and human-listening acceptance remain unverified.

Fixed gain x3.109713 raises strongest K400 -26.913 to -17.058, matching
the measured nylon energy reference; individual peak is 0.6392. This
is an energy result, not a perceived-equality claim. Explicit 15 s profile,
existing eight-total / four-not-yet-releasing voice policy and 12 ms fades.
Encoded 4 MiB, retained 32 MiB and native queue/lease guards are unchanged.

Demung needs 26,559,000 decoded bytes for Pelog, so old extra caches
cannot all remain. The only new control behavior is selector-local:
Stop first, clear all additional-bank caches when entering either Demung
choice, retain core banks, then admit fresh gestures. Other extras reload
on demand; UI discloses this in ID/EN. Invalid/same selections remain
inert. No Studio source/schema/gain/count changes or new engine.

612 unit cases, lint and official build 560a27e7-5cdc-4839-9747-c23b5cb3e6da
passed. Four responsive ID/EN CSP profiles cover all 12 mappings, longest
natural tail, touch/keyboard guards and layout; mobile pixels inspected.
Actual source-instrumented selector gate: core 4,293,128 bytes retained;
Pelog peak 30,852,128, Slendro 20,038,384. Stop precedes old-voice/cache
replacement; all extra caches clear, core stays warm. Same selection
does not clear/redecode. Leaving returns to core; Kethuk reloads exactly
one requested note. An old Bonang native decode remains leased through
exclusive clear; a new Demung gesture succeeds while it is still pending.
Only real settlement drops that lease, with zero stale source admission.
Disposal leaves zero cache/voices and closed context.

Five lifecycle gates: 20 Stop/restarts and 31.04 s repeat create/end 162
sources; two decoded notes / 9,043,024 bytes stable. Twenty seven-note
bursts attempt 140, admit 83, never exceed eight native sources, and end
with zero after Stop/no phantom work. Controls, errors/retry, route/back,
locale and old selector gates pass. Seven Station / ten Studio-Beatbox
checks and three independent WAV kit comparisons (<=1 LSB) pass. All
106 prior audio files and 62 Studio binary assets remain exact; active
audio/Studio/Beatbox/project source blobs are unchanged. Generated bundle
aliases are not normalized as semantic proof; source, graph and actual
browser/PCM gates are separate evidence.

Core matched runs: 255 created/ended, 4,293,128 decoded bytes, zero
voice/intervals; heap 3,883,424 before / 3,893,620 after is GC-sensitive.
Combined 31.03 s workload: 622 created/ended, 28 decodes / 30,852,128 bytes
stable, zero voice/intervals and context closed after disposal. Owned-browser
private committed sums: 293,720,064 baseline core, 296,349,696 candidate
core, 343,556,096 combined, 342,880,256 disposed. These are coarse all-owned
process observations, not isolated audio CPU, resident PCM or immediate
OS reclamation. Controlled-GC blocks restore listener/node counts 51/1019
each time (33 listeners disposed); heap 2.862-3.609 MB is not claimed flat
or leak-free.

32 full-tail default/max-master renders at 44.1/48 kHz use one scale and
the actual default kit at a time; native controls separately check zero/mute.
Peak about 0.881606 through the unchanged limiter. At 48 kHz / maximum
master, all-pad knee occupancy ~0.717% Pelog / 0.581% Slendro; double
stress ~2.034% / 1.376%. Conservative stress exceeds steady polyphony,
and quiet tails affect the ratio. Existing compression remains explicit.

Evidence: qa-artifacts/pad-demung-2026-10-23. Publication pending.
Physical phone/listening/Safari, higher device rates, long sessions and
historical timing/Stop/loading observations remain unqualified.

## Demung publication closure

Live commit: 5897419c3eed061b86d40ed8633b085bf5e35b92. Cloudflare Pages:
1b3eb870-5bfe-4cb8-ae98-2afc0df87aa7. Four production profiles, all twelve
strikes, controls, compiled-cache held-native/fresh-intent gate, Studio 21 pads /
21 decodes / no new assets, three kit WAV oracles <= 1 LSB, and Beatbox repeat/reset
passed. All 267 artifact identities and 18 routes were checked. Fifty-nine
unchanged ZIPs carry exact previous GET hashes plus current HEAD status, MIME and
length; other content uses current GET. The serial attempt reached its 300-second
QA cap after 225 records, then 21 more passed before a NOTICE timeout. One isolated
234 ms transfer proves exact newline-only text; twenty remaining reads completed
the gate. Negative records remain; no network root-cause fix is claimed.
Receipt: qa-artifacts/pad-demung-2026-10-23/publication/RECEIPT.json.

## Kempul qualification - 2026-10-23

Six Pelog strikes (1, 2, 3, 5, 6, 7) and five Slendro strikes (1, 2, 3, 5, 6)
retain their source labels, full stereo image and 6.158-17.682 second tails.
Original FLACs/source ZIPs, CC BY 3.0 recordings, Artistic 2.0 package notices,
creator/source links and modifications remain available. No crop, denoise,
mono fold, retune or destructive original edit was justified. No full-scale
frames were found; mean DC is about -0.000012 and late 50 ms RMS is recorded
per channel rather than labelled calibrated noise/SNR.

Measured uniform runtime gain x1.235062 raises strongest short-hit K400 energy
from -20.446 to -18.613 and individual output peak from 0.5263 to approximately
0.6500. It remains 1.55 dB below the nylon energy reference to preserve transient
headroom. This is not perceived-loudness equality. Within-bank dynamics remain.
The existing envelope, maximum four not-yet-releasing voices and eight total
owned voices, short same-pitch fades and overload refusal remain unchanged.

The existing exclusive additional-cache policy is reused. Core plus all Pelog
retained decoded PCM is 33,166,088 bytes at 48 kHz (388,344 bytes below the unchanged
32 MiB ceiling); Slendro plus core is 23,360,976 bytes. These figures exclude
native in-flight decode/active voice buffers, browser heap and process memory.
Other additional banks reload on demand. Source-instrumented and final compiled
gates prove core retention, clearing before admission, same-selection no-op,
fresh intent while an old native promise remains held, no stale voice, and real
native ownership until settlement. No memory ceiling was increased.

613 unit tests, focused tests, lint and official build
74a7d266-a398-4468-8120-b299f13fc936 passed. The first sandbox unit attempt had
loopback/temp EACCES/EPERM errors; it is preserved separately. The complete suite
passed with the access required by its existing tests, without product changes.
An executor interruption occurred after build initiation; durable build, graph,
audio and headroom results were recovered and not rerun. All four CSP desktop /
mobile viewport ID/EN profiles passed all eleven mappings, touch/keyboard/input
guards, natural longest-tail retirement and cache reloads. The candidate mobile
screenshot was inspected. Five cancellation/retry/native gates, burst/Stop,
selector, seven Station and ten Studio/Beatbox regressions passed. Three independent
kit WAV comparisons are <= 1 LSB. All 118 old audio files and 62 Studio binaries
remain exact; normalized active audio/Studio/Beatbox/project source blobs are
unchanged. Compiled alias differences are recorded, not normalized into a claim
of semantic equivalence.

The two-note 31.08 second native repeat has stable 13,320,944 decoded bytes and
162 created/ended sources. Matched core workloads each have 255 created/ended,
4,293,128 retained decoded bytes and zero voice/intervals after Stop. Core final
JS heap is 3,895,016 before / 4,041,752 after; owned-browser private committed sums
are 294,453,248 / 292,777,984. These are one-pair, GC-sensitive, coarse observations,
not an improvement claim or isolated audio-thread measurement. The combined
30.99 second workload has 621 created/ended, 27 decodes / 33,166,088 bytes stable,
zero voice/intervals and a closed context after disposal. Private committed sums
are 342,466,560 combined / 341,630,976 disposed; immediate OS reclamation is not
promised. Separate controlled-GC blocks restore 51 listeners and 1,102 DOM nodes,
with 33 listeners disposed. Heap is not claimed flat or leak-free.

Thirty-two default/max-master full-tail renders at 44.1/48 kHz use the actual
default kit and one selected scale at a time. Maximum output peak is about
0.881606 through the inherited limiter. At 48 kHz/max master, all-pad knee
occupancy is approximately 0.374% Pelog / 0.536% Slendro; double stress is
0.852% / 1.056%. Stress exceeds the live steady polyphony and quiet tails affect
the fraction. Existing compression is explicit; the limiter was not changed.

Evidence: qa-artifacts/pad-kempul-2026-10-23. Local qualification complete;
publication pending. Physical phone/listening/Safari, higher device rates and
long sessions remain unqualified. Historical timing, Kenong Stop observer and
production loading/network observations are retained without a fix claim.

## Kempul bounded review closure

Receipt: qa-artifacts/pad-kempul-2026-10-23/publication/RECEIPT.json. Independent reviewer task 01a169a1-6827-742b-b005-5b6e8d9a0028 and parent accepted bounded lifecycle qualification. Original production callback-counter FAIL and UNKNOWN cause remain. Corrected trace has 20 bursts / 120 gestures, maximum 4 non-releasing and 8 callback-pending sources, 82 zero-fade/stop endpoints, and zero after Stop. Release overlap can reach 8 render-active sources: never a strict four-audible-voice claim. Dedicated burst trace is desktop Pelog at 48 kHz; reviewer synthetic offline PCM is two localhost cases, not all devices or physical listening. No engine change, rebuild or redeploy was made for this qualification.

## Gong ageng implementation in progress

One retained source, fs-261893 / GONG_GAf.wav, not a tuned degree bank. Full stereo 20.049 s source and original/license packets retained. Uniform runtime gain x2.831644 follows measured short-hit energy. Same-pitch retrigger uses the existing fade policy; one non-releasing strike is expected after retrigger, with bounded release overlap up to eight. Full natural tail remains; Stop controls all local pads. Existing 32 MiB retained-PCM and 4 MiB encoded-file limits stay unchanged. No Studio catalog or engine change. Gates pending.

## Gong ageng qualification - 2026-10-24 WIB

One source-labelled strike, fs-261893 / GONG_GAf.wav. Full 20.048708 second stereo
recording, originals, source forms and CC BY 3.0 / Artistic 2.0 notices remain.
No destructive crop, mono fold, denoise or retune was justified. Mean DC is about
-0.000012; no full-scale frames were found. Tail RMS and onset are recorded as
technical observations, not calibrated noise or physical-listening acceptance.
Uniform runtime gain x2.831644 raises strongest K400 from -26.099 to -17.058 and
output peak from 0.10966 to 0.31052. Relative within-recording dynamics remain.

Existing same-pitch fading keeps one non-releasing strike; release overlap can
reach eight rendering sources. Retrigger fades and replaces the prior strike,
not an absolute one-audible-voice guarantee. No automatic blanket sustain cut or
new engine policy was added. The UI states the long natural tail and Stop action;
the one pad spans the available grid width. ID/EN mobile and desktop screenshots
were inspected through the candidate's CSP-compatible external CSS.

614 unit cases, lint, focused tests and official build
350c641c-661c-4aaa-b30e-025d0a65ee74 passed. All four compiled ID/EN desktop/mobile
profiles pass mapping, native multitouch/keyboard, master/mute, cache/no-op/reload,
natural retirement, project-storage protection and navigation/disposal. Five
native cancellation/resume/retry gates pass. A 31.01 second same-pitch repeat has
one decode / 7,698,704 bytes stable and 101 created/ended sources. The 240-gesture
burst admits 141, checks 140 native zero-fade/stop endpoints, stays within eight
callback-pending sources, and settles to one non-releasing pitch. New tracing
handles later stop requests rather than blindly taking a minimum deadline;
the accepted workload has no later fade rescheduling. This is scheduling/API
evidence, not independent per-source native PCM or physical hearing.

Core plus short banks plus Gong retains 18,445,056 decoded PCM bytes. Leaving Gong
unloads its cache, preserves short banks and core, and a later exclusive large
bank still clears additional caches. Core plus Gong alone is 11,991,832 bytes.
Held native decode ownership survives selection away; a fresh gesture works,
and stale completion does not create sound. Retained entries are zero on disposal;
this does not prove total native-buffer or process-memory reclamation.

The first master-zero measurement failed because it sampled a trailing FFT window
before the existing 5 ms exponential master target had settled. The diagnostic
records an early peak about 0.0000269 followed by zero. Its restore step then
stopped on malformed QA range text .65; the remaining restore/active-zero checks
passed with 0.65. Both failed records remain. The final silence threshold stays
1e-6; its measurement begins after 20 existing time constants, a full FFT window
and 10 ms margin in audio-clock time. No master or engine gain code changed.

The first Studio warm-up Stop observation failed with a running AudioContext whose
clock remained zero at the 180 ms read. The original record remains unclassified;
no historical or driver-clock fix is claimed. One cold cancellation trace each
on unchanged published Kempul and Gong artifacts showed native stop/disconnect,
eventual advancing clocks and zero output through one second. Warm-up now waits
for a positive rendering clock before the unchanged 180 ms steady-state Stop
assertion. Nine Studio cases passed before a QA logger used lang outside its
scope. That failure is retained; only the tenth case ran after the logger scope
was corrected. The combined ten-case result is an explicit 9+1 cohort, not one
uninterrupted full-run. Seven Station cases and three independent kit WAV oracles
passed. All 129 prior audio files and 62 Studio binary assets remain exact; active
audio/Studio/project/Beatbox source blobs remain unchanged. Generated aliases are
not treated as semantic equivalence by normalization.

Matched core workloads each create/retire 255 sources with 4,293,128 decoded bytes
and zero voice/intervals after Stop. Final JS heaps are 4,042,684 / 4,045,692 bytes;
private committed browser sums are 291,196,928 / 296,652,800 bytes. These are one-pair
coarse/GC-sensitive observations, not an overhead improvement claim. The combined
31.09 second workload creates/retires 616 sources, holds 22 decodes / 11,991,832 bytes
stable, and closes its context with zero voice/intervals. Private committed sums
are 303,964,160 combined / 303,374,336 disposed; immediate OS reclamation is not
promised. Separate controlled-GC blocks restore 51 listeners and 1,083 DOM nodes,
with 33 listeners disposed; heap is not claimed flat or leak-free.

Sixteen full-tail default/max-master renders at 44.1/48 kHz use the actual default
kit and single Gong. Maximum output peak is about 0.881606 through the unchanged
limiter. At 48 kHz / maximum master, all-pad knee occupancy is approximately
0.319%; double stress is 0.967%. Quiet tails and conservative simultaneous hits
affect those fractions. Compression and burst refusal remain explicit tradeoffs.

Evidence: qa-artifacts/pad-gong-ageng-2026-10-24. LIVE commit76ef7790f61dab038aa64343bcb6cdc7ce081f22, Pages c00b495c-9201-46c3-baaa-97a3b8db5e7a. Production4profiles/lifecycle/burst,Studio21,WAV3kits,BeatboxPASS;291artifactpaths/18routes.82unchanged archives carry prior exact proof/currentHEAD;others currentGET. Receipt publication/RECEIPT.json. Physical
hearing/phones/Safari, higher sample rates, total native memory and long sessions
remain unqualified. No Rhythm Studio instrument, pad count or schema was added.


## Slenthem curated increment (qualification pending)

Eight selected retained registry Slenthem recordings: Pelog2/3/4/5/7 and Slendro1/2/6. Original GENDER_GS filenames and CC BY3/Artistic source-form/credit notices preserved; classification is not independent cultural verification. Full stereo6.839–22.149s; no forced tail cut or original edit. Uniform runtime gain x2.1928469760513. Four sources excluded: P1/S3/S5 exceed encoded4MiB and30s contracts; P6 has a tail-review advisory and including all Pelog exceeds the unchanged32MiB retained cache budget. Advisory does not establish distortion. Core+curated Pelog30,404,208B / Slendro24,109,040B at48k; these are not total native/process memory. Existing exclusive cache and4non-releasing/8total release-overlap policies reused. Studio remains21pads. Local gates pending.


## Slenthem final local qualification — 2026-10-24 WIB

615 unit cases, lint, one official build9be1d10c-01c2-4d28-8259-1d4086917850, four production-CSP ID/EN desktop/mobile viewport profiles, all8 mapping/full-frame checks, native multitouch/keyboard, natural22.149s tail, master/mute/locale/navigation, cold-load Stop/fresh retry, deferred resume R1, source and compiled cache ownership, burst endpoint contract, retained Studio/Beatbox and independent3-kit WAV regression passed. Both desktop/mobile candidate screenshots inspected. No physical listening/phone/Safari claim.

Uniform runtime calibration x2.1928469760513 moves maximum400ms K-weighted hit energy from -23.878416 to -17.058249; maximum solo default-output peak 0.392793. This is not perceptual equal-loudness or whole-song LUFS. Existing lossless48k stereo optimized FLAC, full frames/tails, raw/source archives, names and licenses are preserved, without arbitrary crop, mono, denoise, retune or destructive edits. Timing correlation advisories remain metadata, not proof of sample alignment.

Core+curated Pelog30,404,208 bytes / Slendro24,109,040 bytes at native48k. Exact source-cache and compiled admission/old-native-lease tests passed under unchanged32MiB retention limit. Maximum4 non-releasing and8 total/render-active sources including release overlap; no strict four-audible-voice claim. Source ownership is not total browser-native memory.

Matched measurements and combined repeat observations (one pair, not a statistical guarantee):

```json
[
  {
    "kind": "before",
    "samples": [
      {
        "phase": "final-stop",
        "starts": 255,
        "ended": 255,
        "active": 0,
        "decodeCount": 21,
        "decodedBytes": 4293128,
        "intervals": 0,
        "metrics": {
          "JSEventListeners": 65,
          "Nodes": 1185,
          "ScriptDuration": 0.247123,
          "TaskDuration": 0.789777,
          "JSHeapUsedSize": 4040328
        },
        "privateCommittedSum": 294395904,
        "workingSetSum": 557711360,
        "processCPUSum": 7.775048999999999
      },
      {
        "phase": "disposed",
        "starts": 255,
        "ended": 255,
        "active": 0,
        "decodeCount": 21,
        "decodedBytes": 4293128,
        "intervals": 0,
        "metrics": {
          "JSEventListeners": 66,
          "Nodes": 1185,
          "ScriptDuration": 0.250403,
          "TaskDuration": 0.805867,
          "JSHeapUsedSize": 3916104
        },
        "privateCommittedSum": 293441536,
        "workingSetSum": 557510656,
        "processCPUSum": 7.813486
      }
    ]
  },
  {
    "kind": "after",
    "samples": [
      {
        "phase": "final-stop",
        "starts": 255,
        "ended": 255,
        "active": 0,
        "decodeCount": 21,
        "decodedBytes": 4293128,
        "intervals": 0,
        "metrics": {
          "JSEventListeners": 603,
          "Nodes": 1766,
          "ScriptDuration": 0.190948,
          "TaskDuration": 0.78969,
          "JSHeapUsedSize": 5098528
        },
        "privateCommittedSum": 304541696,
        "workingSetSum": 566333440,
        "processCPUSum": 8.020658999999998
      },
      {
        "phase": "long-final-stop",
        "starts": 620,
        "ended": 620,
        "active": 0,
        "decodeCount": 26,
        "decodedBytes": 30404208,
        "intervals": 0,
        "metrics": {
          "JSEventListeners": 233,
          "Nodes": 1382,
          "ScriptDuration": 0.49138,
          "TaskDuration": 1.978424,
          "JSHeapUsedSize": 3737220
        },
        "privateCommittedSum": 338976768,
        "workingSetSum": 605491200,
        "processCPUSum": 17.797048
      },
      {
        "phase": "disposed",
        "starts": 620,
        "ended": 620,
        "active": 0,
        "decodeCount": 26,
        "decodedBytes": 30404208,
        "intervals": 0,
        "metrics": {
          "JSEventListeners": 234,
          "Nodes": 1382,
          "ScriptDuration": 0.494388,
          "TaskDuration": 1.990791,
          "JSHeapUsedSize": 3576432
        },
        "privateCommittedSum": 337891328,
        "workingSetSum": 604917760,
        "processCPUSum": 17.896881
      }
    ]
  }
]
```

Separate controlled-GC retention diagnostic (not normal-performance forced collection):

```json
[
  {
    "phase": "warm-after-GC",
    "starts": 5,
    "ended": 5,
    "active": 0,
    "metrics": {
      "JSEventListeners": 51,
      "Nodes": 1193,
      "JSHeapUsedSize": 2864712
    }
  },
  {
    "phase": "block-0-before-GC",
    "starts": 86,
    "ended": 86,
    "active": 0,
    "metrics": {
      "JSEventListeners": 213,
      "Nodes": 1314,
      "JSHeapUsedSize": 3650440
    }
  },
  {
    "phase": "block-0-after-GC",
    "starts": 86,
    "ended": 86,
    "active": 0,
    "metrics": {
      "JSEventListeners": 51,
      "Nodes": 1193,
      "JSHeapUsedSize": 3255440
    }
  },
  {
    "phase": "block-1-before-GC",
    "starts": 167,
    "ended": 167,
    "active": 0,
    "metrics": {
      "JSEventListeners": 213,
      "Nodes": 1314,
      "JSHeapUsedSize": 3348716
    }
  },
  {
    "phase": "block-1-after-GC",
    "starts": 167,
    "ended": 167,
    "active": 0,
    "metrics": {
      "JSEventListeners": 51,
      "Nodes": 1193,
      "JSHeapUsedSize": 3599916
    }
  },
  {
    "phase": "disposed-after-GC",
    "starts": 167,
    "ended": 167,
    "active": 0,
    "metrics": {
      "JSEventListeners": 33,
      "Nodes": 1193,
      "JSHeapUsedSize": 3516436
    }
  }
]
```

32 full-tail24s offline renders at44.1/48k cover both scales, default/max master and solo/all/double/ensemble. Maximum peak 0.8816059827804565; maximum inherited-knee occupancy 0.6789% of active frames. Conservative all-hit sums can exceed real polyphony and quiet tails affect fractions. Existing limiter compression/refused excessive bursts remain explicit; no limiter or timing change. All130 prior audio binaries and62 Studio graph binaries exact,80 active source inputs unchanged. Compiled alias differences are not silently normalized into semantic equivalence.

Evidence: qa-artifacts/pad-slenthem-2026-10-24. Publication pending; previous Gong/Kempul/Kenong/Bonang loading/Stop/network/timing observations remain preserved with UNKNOWN causes where unproven. Bounded passes do not fix those historical events. Higher native rates, total audio-thread CPU/native memory and long-session listening unqualified.

## Remaining-media disposition

Suling is deferred, not fabricated into pitch pads: six verified retained media (11,650,035 bytes) include the8.836644s stereo performance and technical excerpts; provisional tonal cores do not establish clean note boundaries. Source/provenance: Muthi’ah Zahra / Pinggala09, WikiWaditra/ISBI Bandung; CC BY-SA4 metadata/legal code preserved in internal/media-library/suling. Physical/cultural/listening qualification absent. No media deleted.

Existing vocal phrases were assessed as phrases rather than new instrumental hits. Twelve retained mono32k PCM16 WAVs (3,840,528 bytes), two variants for each of six roles, are5s/two bars at96BPM. CC0 procedural-mouth-synthesis notice preserved under internal/original-groove/audio and source metadata. Current Beatbox imports them already; historical candidate labels do not mean they are absent from production. Optional extra standalone phrase audition is deferred: adding a synchronized loop transport or microphone is outside this increment.

Program now exposes eleven added instrument families /89 selected source strikes in standalone (after Slenthem publication qualification), plus unchanged21 core pads; additional selector shows only one bank, maximum7 extra buttons, rather than a giant89-button mobile grid. No automatic Rhythm Studio additions. Remaining exclusions: two original-full-scale Bonang panerus, four Bonang barung, four Slenthem sources, Suling uncurated demo, optional vocal audition. Originals, optimized media and licensing remain retained.
