# Local V5 EQ / final mix candidate

F08 and F11 candidate only. Independent review and full V5 acceptance remain open.

Track EQ is optional version1 `{bypass,lowDb,midDb,highDb}`, each gain[-6,+6]dB.
The native stereo graph uses first-order positive-pole low-pass crossovers at
200Hz and3000Hz, mixed as H*dry+(M-H)*LP3000+(L-M)*LP200. This is a broad tone
control, not three independent brick-wall bands. Missing/bypass/flat uses the
existing direct graph. The conservative amplitude bound is
`abs(H)+abs(M-H)+abs(L-M)`. Admission accounts for the bound, existing stereo-pan
bound, all layers, voices and safe master level. Recording PCM remains immutable.

The optional master limiter uses a65537point memoryless WaveShaper, oversampling
none: identity through abs(x)=0.8, then sign(x)*(0.8+0.15*(1-exp(-(abs(x)-0.8)/0.15))).
It has no lookahead and grants no headroom credit. No auto-normalization or silent
clamping occurs. Both pre/post limiter output must be finite and at most0.95.
EQ and limiter parameters are serialized in `.perkusi` and durable project state.
FX changes stop/reset playback and require disposition of pending take work.
Gain/pan/mute/solo retain the existing live automation path.

Live session and final export share the graph builder and native voice recipe.
Final rendering snapshots the current project (including adopted recordings,
overdub layers and official instrument/legacy clips), not past automation history
or unadopted recorder takes. Choose4/8bars. Recording cycles cannot be silently
truncated; unsupported geometry refuses explicitly. Natural event release follows
the body, plus100ms for any active EQ. FX latency is0frames. Maximum render40s,
2048scheduled events,4096cycles/clip and existing16concurrent-voice/shared64MiB
limits remain. Some legal large projects can exceed the export memory budget.

Export owns separate offline prepare/render contexts and caches. The four-channel
internal render meters pre/post limiter stereo independently; the exported RIFF
contains only post-limiter Float32 stereo, a fact frame count and UTF-8 INFO/ICMT
metadata with project, timing/tail, levels and source/recording credits. The render
uses2048frame suspension checkpoints for bounded scheduling/cancellation. Cancel
stops only its owned voices, drains the native context, then releases graph, cache,
source pins, ticket and buffers. Ready WAV bytes stay charged until closed or
replaced. Web Share unavailable/failure falls back to downloading the same WAV;
native share cancellation retains the result. No external upload API is used.

AA1 native testing exposed progress callback reentry before pending ownership.
AA2 publishes the render token before starting via a microtask and checks abort
immediately after the initial callback. A regression covers synchronous reentry
and immediate cancel without native allocation. AA1 evidence remains separate.
AA3 fixes a native IIR tail cutoff at quantum-aligned source ends: one active
zero-valued ConstantSource connects to EQ inputs, preserving their state through
the declared release. It is infrastructure, charged8192bytes, not a musical voice
or audible oscillator. It stops/disconnects with the shared graph. Short native
diagnoses retained in AA artifacts reproduce both cutoff and anchor correction.

Browser/offline checks and mathematical PCM comparison do not constitute listening
or physical-device validation. Live finite Preview/WAV PCM equality must be
independently measured; sharing code alone does not close that gate. See the AA
artifact report for exact candidate identities, measured cases and unresolved gates.
