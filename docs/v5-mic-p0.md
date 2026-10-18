# V5 microphone P0 software contract

This slice is local software qualification only. Production microphone=() is
unchanged. No real permission, microphone, device enumeration or listening is
authorized by these tests. Physical calibration and the full V5 gate remain open.

The root owns a single explicit, gesture-created MicInput and its epoch. Preparing
the target does not request input. Enable Mic is a second deliberate activation
after preparation. Stop Mic cancels pending grants immediately; late tracks are
stopped. Active capture closes before owned source/device disposal. Track loss is
terminal for that capture; resuming never automatically requests permission.

A bounded audio-thread meter probes the actual input topology, independent of
negotiated hardware settings. Only one or two actual channels are admitted, at the
existing context rate; native MediaStream conversion is reported. No device IDs
or labels are retained. A topology change terminates a recoverable prefix through
the existing capture worklet rather than repairing/downmixing it. Silence is
valid raw PCM. Muted tracks are visible. Nonfinite input retains only the preceding
validated prefix. All received valid chunks remain subject to existing explicit
disposition and partial recovery rules.

Microphone peaks are unknown, not trusted sample descriptors. Monitoring is OFF
by construction. The reserved replay ceiling is 0.5 raw peak; the audio thread
preserves finite overrange PCM but refuses automatic replay when a full window
exceeds that ceiling. That full window is retained as unsafeReplay, explicitly
requiring recovery/disposition instead of normal adoption. No limiter, trim,
normalization or fabricated silence alters originals. Optional live monitoring
is withheld in this slice pending an audio-thread safety gate and wired-headphone
review; the UI states that limitation rather than providing an unsafe toggle.

Capture uses the shared context, Transport, AudioMemory and immutable TakePool.
The input/meter route reserves 49152 bytes and one live source voice; capture
reserves the existing channel-aware full-window/transfer/replay costs separately.
The root capture ceiling remains 64MiB, 16 voices and 0.95 summed peak.

Source attribution is original local microphone input, no supplied asset license
and no assertion of authorship/third-party rights. Permission status and hardware
sample rate are runtime-only; recordings export context rate, channels, raw hashes
and neutral original-input provenance, never device identifiers.

Latency compensation is unavailable/unverified. Existing clips keep offsetFrames
zero. A future versioned non-destructive phase transform must retain original PCM,
specify capture-window/preroll/postroll/rejoin semantics, expose preview/reset and
prove full-period reader/WAV parity. Neither simulated delay nor baseLatency or
outputLatency is a measured hardware roundtrip or a 25ms qualification.
