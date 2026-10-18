# Continuous legacy regions

Local AD slice after accepted AC4. Continuous regions are not repetitions of
the finite legacy WAV. Finite legacy playback retains its accepted fade and DSP.

Continuous preparation keeps a first-cycle terminal buffer and bounded steady
phase terminal buffers. At each normal boundary, the existing transport schedules
the exact period prefix and stops that source at the boundary without an added
fade. The next state's prefix includes preceding-role tails and the next strike's
four-ms choke. Bilah choke is shared across pitches. The legacy master and curve
are applied once to the combined signal. There is no score-end master fade.

For finite Preview/export only the final cycle consumes its complete terminal
buffer: no phantom next-cycle strike/choke. All final shot releases are included;
prepared continuous clips append their explicit four-ms stop after the body.
The existing track EQ tail follows the latest natural source end. Track gain,
pan, mute/solo, EQ and master still use the shared mix graph/portable equations.

The original five-second prepared loops keep absolute phase across region cycles,
attack once at initial start, and are never generically stretched or repitched.
They remain explicitly original vocal/percussion sources, not new acoustic bass,
guitar or suling instruments. Source text, manifests/hashes and credits remain
the source of identity and rights. No new sounds are introduced by this adapter.

This bounded representation admits only complete score regions with exactly
integer frame periods matching their original composition tempo at44100/48000.
For prepared loops at most four steady phase states are admitted. Unsupported
fractional/frame-policy combinations reject explicitly with original projects
retained; no rounding a different musical period to force admission. Larger tempo,
bar, rate, clip and physical-device coverage remains a separate qualification.

All states/source copies are admitted before fetch/native allocation in the same
64MiB pool. First/steady terminal buffers retain native/view allowances until
plan release, which follows actual onended/close. Internal source overlap refuses
above16; prepared bus scheduling uses the existing conservative sixteen-owned-
voice/0.95 headroom sweep, including terminal length. Cancellation retains work
through decode/render/native-close settlement. No URL is created by preparation.

Ordinary stop/pause/track stop uses the existing explicit20ms fade and onended
ownership, not the terminal export buffer. Resume reconstructs the chosen cycle's
state at the exact existing project offset; it does not create a second transport.
Restarting a track rejoins its score phase, including that phase's represented
incoming resonance. Normal boundaries use an exact stop with no fade; this is
valid only because adjacent state prefixes reproduce continuous chronology.

The AD evidence checks all first/steady/terminal samples against a separately
written full-stream reference using actual retained decoder PCM. Original assets
that require native rate conversion remain browser-specific inputs; this slice
does not claim cross-browser resampler equivalence. Headless muted rendering is
not physical listening or cultural validation. Chrome strict timestamp failures
from AC remain FAIL/UNVERIFIED and separate from any passing adapter PCM result.
