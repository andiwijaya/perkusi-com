# Five-bank audition gain checkpoint

Local correction only. Native browser/E2E, final production build, listening and
publication are pending. Baseline: `87380ceee9fb34680ff6cdf820a66d0144ffa419`.

| Standalone bank | Previous runtime level | Candidate level | Change |
| --- | ---: | ---: | ---: |
| Kempul Pelog | 1.2350620578119 | 1.554851009722198 | +2 dB |
| Kempul Slendro | 1.2350620578119 | 2.4642727806 | +6 dB |
| Gong ageng | 2.831643815413104 | 3.564828356373349 | +2 dB |
| Slenthem Pelog (5) | 2.1928469760513 | 3.0974786832849355 | +3 dB |
| Slenthem Slendro (3) | 2.1928469760513 | 3.4754282444526443 | +4 dB |

The previous shared Kempul/Slenthem levels are replaced by explicit per-laras
exports and standalone registry wiring. Gain remains uniform within each bank;
sample URLs, hashes, frames, trims, stereo, pitch and tails are unchanged. There
is no EQ, asset rewrite, new instrument, global/master increase, voice/timing or
limiter change. Rhythm Studio stays at 21 pads with its existing mappings,
calibration and project schema; it does not import these additional banks.

The 48 kHz float32 model follows the existing envelope/gain/output tables and
K-weighted 400 ms measurement. Existing PCM24 WAV hashes and FLAC STREAMINFO MD5
match the fixed retained source files. Gong model K400 differs from the prior
native measurement by approximately 0.000000006 dB. This supports the isolated
model path, not native decoding, scheduling or the complete mixed browser path.

Median K400 before/after: Kempul Pelog -21.96/-19.96, Kempul Slendro -24.59/-18.59,
Slenthem Pelog -20.68/-17.68, Slenthem Slendro -22.06/-18.06 dB. Nylon reference
median is about -18.05 dB. These are diagnostic hit-energy values, not a promise
of equal perceived loudness. Natural note differences within each bank remain.

Gong already has full-band K400 near -17.06 dB; the candidate becomes -15.06 dB.
A diagnostic 150 Hz high-pass loses about 13.4 dB. This is a low-frequency-content
observation, not a measured phone response. The modest +2 dB cannot restore bass
that a speaker cannot reproduce; larger blind boosts could overpower full-range
speakers. Human/physical-device assessment remains necessary.

Local gates: baseline 615 tests, candidate 620 tests, focused sampler 27 tests,
and lint passed. Five new tests cover correct bank binding, actual sampler bus
gain, bounded repeats and Stop/dispose using fake audio nodes. The offline model
checks 40 isolated and 60 before/after mix/repeat/mute cases. No isolated target
hit reaches the shaper input-domain clamp at master 0.75. Extreme mixes still
compress: model maximum output 0.881606, worst first-400-ms input-domain saturation
8.05% before / 9.32% after. This tradeoff must be reviewed in native QA; a bounded
PCM output is not proof of unchanged mixed timbre or no internal limiting.

No supported IAB/browser control is exposed to this executor in either the direct
tool definitions or nested bindings/catalog. No browser, native window, server,
Properti.cc repository/tab/port or process inventory was accessed. A supported
task-isolated browser verification handoff is required; no shell-browser fallback.

Evidence and detailed browser handoff:
`qa-artifacts/pad-low-bank-balance-2026-10-24/`. No bulky duplicate build or PCM
output was created. This local checkpoint does not authorize push/deploy.
