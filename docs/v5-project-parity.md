# Full-project final mix qualification

AC local candidate, after bounded AB acceptance. Full V5/release remains HOLD;
this contract is not evidence of physical listening, mic, OS Share or release.

Mixed-project qualification uses native44100/48000 delivery profiles and preserves
recorded PCM identity/rate, V4 embedded source text, track/master gain, two stages
of stereo pan, mute/solo, supported EQ/limiter, and natural official-event releases
beyond the requested4/8bar body. The final EQ tail follows the last natural event,
not merely the body end. Existing finite legacy scores retain their old finite
fade/mastering; continuous legacy Repeat is still a separate adapter task.

Native qualification found canonical legacy preparation left its one-frame decoder
OfflineAudioContext suspended after releasing preparation accounting. prepareLegacyBus
now finishes that silent one-frame destination before shrinking to the borrowed
PCM-only lease. Error/cancellation also waits for that owned context to finish.
This changes lifecycle, not the prepared PCM or legacy DSP. No musical voice runs
through that one-frame decoder destination. Late native decode/close work keeps its
admission until actual completion; cancellation cannot publish a bus early.

Firefox155 does not expose OfflineAudioContext.suspend. When checkpoint methods
are absent, final export now evaluates the prepared voice program in2048frame
portable chunks into a native AudioBuffer, with explicit Float32 mix order,
source/track stereo pan, native-style damping, stable EQ state and the same limiter
curve. It never preallocates an unbounded future native voice graph. Active voices
retain the16voice admission cap; source-view/state bytes share the ledger and stay
held until plan/cache cleanup. The one-frame buffer-factory context finishes before
encoding. Metadata identifies native-checkpoints vs portable-frames-v1. There is
no independent musical clock, time-stretch, sample shift or normalization. This
new fallback requires full-project all-frame and live parity evidence; isolated
accepted native graph tests alone do not qualify it.

Final export represents a validated immutable current-project snapshot. Queued
mix edits block UI export until they settle. Subsequent edits to a caller's input
must not alter an already-started job. A finite Preview restarts the snapshot;
prior unsaved automation history and unadopted takes are not silently exported.

Full-project tests retain all raw source/delivery hashes and credits, WAV metadata,
declared origin, observed PCM and strict receipts. A mathematical oracle may treat
the accepted finite legacy adapter PCM as an explicitly retained source; that is
not a new proof of its internal mastering. No gain/phase fitting, resampling of
recorded takes, transition exclusion or relaxed2e-6DSP tolerance is permitted to
obtain a pass. Resource/error/cancel paths must preserve originals and remain
bounded by the shared ledger/voice admission. Read the AC review report for exactly
which project/browser/rate/lifecycle cases were executed and remaining limits.
