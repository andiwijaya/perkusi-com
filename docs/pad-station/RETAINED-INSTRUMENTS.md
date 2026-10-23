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
| Saron barung   | Pending                                       | Source tails up to 17.3 s; no arbitrary blanket 2 s crop.                                               |
| Peking         | Local qualification PASS; publication pending | Source tails 2.8–14.5 s; tail/onset review required.                                                    |
| Slenthem       | Pending                                       | Source tails up to 45 s; bounded sustain contract required.                                             |
| Bonang barung  | Pending                                       | Long tails; note/laras and retrigger policy required.                                                   |
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

Twelve retained source-labelled strikes: seven Pelog, five Slendro. Original titles are SARON_SPPL1-7 / SARON_SPSL1,2,3,5,6; these are Peking in the retained registry and credits, distinct from Saron barung SARON_SB*. Source ZIP work261824 contains SARON/SPPL1.wav, original SHA256 be619d27d7854db850cd6530103488842802159e50431a8d728c5d72dcadfaaf. An initial presentation test incorrectly assumed PEKING_* names. Its missing import and naming assumption were corrected, with failed evidence retained. Automatic review initially held the title assertion correction; a single retry was accepted after registry/credits/source archive inspection. No originals or attribution titles were renamed.

All12 delivered stereo channels differ. Keep the lossless48k FLAC, original stereo timing and full2.849-14.471s available tails. No new crop/denoise/retune or original edits. Onsets0-34frames at minus60 threshold, DC near -0.000012; zero full-scale delivery frames. Historical correlation ambiguity remains an advisory, not justification for shifting channels. No historical quality flags on these12 sources. This is technical curation, not expert cultural/tuning or listening acceptance.

Fixed gain x2.07366298136 raises strongest K400 -24.700 to -18.366 and peak0.31345 to0.6500, retaining within-bank dynamics. It remains about1.31dB below the nylon energy reference to preserve transient headroom. CC BY3.0 recording credits, source forms, changes and Artistic2.0 package notices are available from the page. Full sustain uses an explicit15s standalone profile with four sounding plus four smooth release voices, maximum8; excess bursts are refused, not queued. Duration defaults, encoded4MiB and retained32MiB guards remain unchanged. Leaving the bank evicts its cache while retaining real native decode leases until settlement.

609 unit tests, lint, official build bf0484b5-655a-4eb8-b6d2-9894a545b850 passed. Four ID/EN desktop/mobile CSP profiles cover all12 mappings, native multitouch, keyboard/input guards, same-bank warmth, deliberate long-bank reload and natural retirement of the14.47s strike. Candidate mobile screenshot was inspected. Five native lifecycle gates,20 Stop/restarts and31.7s repeat admit162 sources, all ended; two decoded notes7,867,952bytes stable. Twenty seven-note bursts:140 gestures,83 admitted, maximum8 native voices,0afterStop and no phantom starts. Cold Stop, deferred resume, failure/retry, navigation/locale and mute/master gates passed.

Source-instrumented native cache: core4,293,128bytes; all short banks+core10,746,352; Peking Pelog peak26,489,128; Slendro peak19,356,776. Leaving the long bank returns exactly to the short baseline. A held native decode stays accounted until settlement;0latevoices and fresh intent works. Disposed cache0,voice0,closed context. These numbers describe retained buffers, not all native/process memory.

All74 previous audio files and62 Studio binary assets remain exact. Active src/audio,src/studio,src/beatbox,src/project Git-normalized blobs are unchanged. Compiled Studio import/export aliases and traversal ordering differ; no alpha-normalization or blanket compiled-JS equivalence claim. Initial strict-JS and ordered-set checker failures remain in evidence. Exact path/bytes/hash binary sets, unchanged source inputs, absence of Peking in the Studio static audio closure and actual Studio/WAV gates establish the stated invariant. Studio remains21 pads and current schema/mappings/gains.

Seven prior Station gates, ten Studio/Beatbox regressions and three independent kit WAV comparisons (maximum1LSB) passed. Improvised pads do not modify saved projects or enter WAV exports. Matched30s core runs:255created/ended,4,293,128decoded bytes before and after,0voice/intervals. Normal JS heap at core final-stop3,825,500before vs3,834,924after; GC-sensitive snapshots, not total memory. Additional31s Peking/core workload:622created/ended,28decodes,20,035,904decoded bytes stable,0active/intervals,contextclosedafterdispose.

Coarse owned-browser private committed sums:293,806,080baseline core vs300,978,176candidate core;324,796,416after the higher-rate combined workload,323,899,392after disposal. Summed working sets include shared-page duplication and all owned processes. No precise overhead percentage, isolated audio-thread CPU or immediate OS reclamation claim. Separate controlled-GC diagnostic returns listener/node counts51/749 after each of two burst blocks (33listeners afterdispose); heap2.810-to3.561MB can include bounded metadata/JIT/probe records, not declared flat or leak-free.

64 full-tail headroom renders at44.1/48k with default/max/half/zero master remain finite, maximum output about0.881606 through the inherited limiter. At48k/default, all-pad knee occupancy ~0.318%Pelog /0.863%Slendro; double-hit1.0stress ~0.682%/1.720%. Maxmaster double stress ~0.900%/2.290%. These are conservative signal stress mixes beyond normal steady polyphony, and quiet tails affect the active-frame denominator. No new limiter or blanket attenuation.

Evidence: qa-artifacts/pad-peking-2026-10-23. Physical listening/phone/Safari, long sessions and historical timing / Stop observer / Bonang20s production loading observations remain unqualified. No claim that reruns fixed those events. Publication pending separate exactSHA and production gates.
