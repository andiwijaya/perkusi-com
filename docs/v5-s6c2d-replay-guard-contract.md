# S6C2D: fail-closed replay containment, capture HOLD

This isolated low-level change applies to CaptureSession/LoopCaptureProcessor;
it does not connect capture to a route, authorize a microphone or repair the
upstream native clock-label/PCM discrepancy. PcmWindow.consume, master clock,
transport, asset bytes, admission limits, three P2 fixes and skip-link CSS stay
unchanged.

Every process call starts with zero output. The processor snapshots the block
frame and actual size. During capture, the existing contiguous consume guard
retains its existing partial prefix semantics. The call that completes capture
may start replay inside the same block at the original endFrame; an aligned end
starts replay at the next block. No main-thread handoff is introduced. Following
completion, each replay block must have a safe nonnegative integral frame and a
size1..16384, safe progression and frame=previousFrame+previousActualSize.

The first bad replay call leaves its entire output silent and latches closing.
Every subsequent process call remains silent, including a corrected catch-up
stamp. There is no cursor repair, tolerance, re-anchoring, padding, normalization
or resampling. A new, explicitly planned session is the recovery epoch; callers
must stop/cancel on global seek or intentional epoch change. Missing input after
completion is allowed; it cannot retroactively become an inputLost capture.

Exactly one playback-error receipt reports replayFrameDiscontinuity with expected
and observed frame, block size, previous frame and previous actual block size.
Invalid/unsafe observed frame or expected progression is represented by null,
not guessed. Completed window PCM and capture metadata remain complete. Bounded
4096-frame/two-in-flight transfer flushing continues after the fault; normal
complete is sent only after all PCM acknowledgements, then closed. A fault can
precede ready or follow its settlement. Stop is idempotent and cannot revive the
fault through a late started/PCM/complete message.

CaptureSession exposes playbackOutcome (immutable fault or null) and the
playbackFault promise (one fault, or null on a nonfault close). Its existing
outcome and ready represent capture receipt/adoption, separately. A valid
completed take still resolves ready and remains in TakePool on a replay fault;
failed adoption resolves null/error and retains no unowned loop. State is error
while a latched fault drains, then terminal closed; playbackOutcome retains its
fault history after closure. Late receipts cannot create a second take or return
the state to looping. Fault receipt disconnects only this node's output.

Worker budget stays reserved while the closed acknowledgement is pending, even
if output is silent/disconnected. Only close ack, processor termination or
confirmed context closure releases it. Suspend before valid complete receipt
retains only the acknowledged prefix under the existing contract; a later fault
does not promote that prefix. Foreign context/transport/track/lease ownership is
preserved. Detectable missing input, channels/PCM changes and capture frame gaps
remain refused. Unknown content loss with plausible labels cannot be certified
by this guard; the coded QA oracle detects that limitation, not product code.

Acceptance is bounded to replay containment. Native clock reliability, actual
capture success, both-rate1/2/4/8bar geometry, recording UX, joint admission,
overdub/history/portable bytes, real-device/listening/cultural and release gates
remain open. Any persistent-backing experiment is a separate finite QA graph,
not a renderer change or permission to raise64MiB/16voice limits.
