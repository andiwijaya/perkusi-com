# F2 delivery-finalization contract and mic P2 repairs

Suspension terminates recording admission, while queued native PCM may still be
delivered. CaptureSession keeps its existing reserved host arrays writable during
that terminal drain. It validates and copies each contiguous sequence/offset/channel
receipt before ACK. No new capture-window allocation, padding, normalization or
mutation of an already published take is needed.

Immutable publication occurs after the validated ordered worker complete receipt,
an actual worker closed receipt, processor termination, protocol refusal, or a
confirmed closed AudioContext. The first suspension reason remains partial even if
the worker had captured a complete-sized window. Resume does not reopen the epoch.
Protocol-invalid and post-publication PCM are not ACKed; a worker that cannot close
remains charged until actual termination/confirmed context closure.
The UI exposes explicit audio recovery for protocolError even while the context
is running. That user action closes the context; a withheld invalid ACK cannot
trap the interface behind an unreachable recovery control. The valid partial
remains exportable after confirmed termination.

Outcome deliveryProof distinguishes worker-complete from a confirmed-context-close
prefix. The latter guarantees the accepted received prefix only: undelivered worker
buffers cannot be recovered after destruction and their length/content is unknown.
WAV backups include explicit valid frames, capacity, start/rate/channels, partial
reason and delivery proof. Normal adoption/history still refuses partial takes.

The exact historical 24,448-frame native input can be replayed through models: old
code retains 20,480 and drops/ACKs the 3,968-frame suffix; new code retains every
received byte without changing the separate old immutable prefix. This does not
rewrite the frozen historical experiment, recreate unreceived audio, qualify a full
bar, or repair the unrelated permanently unretained take.

Mic preparation cancellation now has its own terminal code and is retired after
successful installation. Normal Stop/locale release drains capture and disposes
only its source/device without synthesizing input loss. Real ended/nonfinite/channel
loss continues through the genuine fault boundary; unresolved faults are not cleared
to hide errors.

The silent mic meter aggregates every quantum, including ACK stalls. Each snapshot
contains interval peak and RMS, interval frames/samples/clips, and a cumulative
clipped-sample counter since activation. Interval statistics reset after sending;
newer input accumulates independently while one immutable receipt is outstanding.
The cumulative counter survives UI polling and saturates at MAX_SAFE_INTEGER.
Scalar memory/queue bounds and monitor-off routing remain unchanged.

All qualification in this slice uses models/generated native streams. Real mic,
headers/deploy, physical/listening/calibration, F0 producer fault and F1 complete
master/pilot suspend/resume output remain separate gates.
