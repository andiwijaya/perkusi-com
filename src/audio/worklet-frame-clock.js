// Read the native AudioParam timeline, independently of the worklet global
// currentFrame (Chromium can leave that global stale during graph contention).
// Two small, exactly representable coordinates avoid Float32 precision loss
// after a long-lived AudioContext. No callback counter or clock rebasing.
export const FRAME_PERIOD = 1048576;
export const frameClockDescriptors = () => [
  {
    name: "frameEpoch",
    defaultValue: -1,
    minValue: -1,
    maxValue: 16777215,
    automationRate: "a-rate",
  },
  {
    name: "framePhase",
    defaultValue: -1,
    minValue: -1,
    maxValue: FRAME_PERIOD,
    automationRate: "a-rate",
  },
];

export function nativeWorkletFrame(parameters, size) {
  const epoch = parameters?.frameEpoch,
    phase = parameters?.framePhase;
  if (
    !epoch ||
    !phase ||
    !Number.isInteger(size) ||
    size < 1 ||
    size > 16384 ||
    (epoch.length !== 1 && epoch.length !== size) ||
    (phase.length !== 1 && phase.length !== size)
  )
    return NaN;
  if (epoch[0] === -1 && phase[0] === -1) {
    return epoch.every((x) => x === -1) && phase.every((x) => x === -1)
      ? null
      : NaN;
  }
  let first;
  for (let i = 0; i < size; i++) {
    const e = epoch[epoch.length === 1 ? 0 : i],
      p = phase[phase.length === 1 ? 0 : i],
      n = Math.round(p);
    if (
      !Number.isInteger(e) ||
      e < 0 ||
      e > 16777215 ||
      !Number.isFinite(p) ||
      Math.abs(p - n) > 0.125 ||
      n < 0 ||
      n > FRAME_PERIOD
    )
      return NaN;
    // At an exact wrap Chromium can expose the ramp's endpoint for one native
    // sample before the simultaneous set events: (epoch, PERIOD) and
    // (epoch + 1, 0) encode the SAME absolute frame. Keep the endpoint, then
    // still require every native sample and the caller's blocks consecutive.
    // No counter, offset, tolerance expansion, or clock rebasing is involved.
    const frame = e * FRAME_PERIOD + n;
    if (i === 0) first = frame;
    else if (frame !== first + i) return NaN;
  }
  return first;
}

// At most four future cycles (twelve native automation events) are held. For
// an indefinite preview, extend the timeline in advance, never alter past
// events. If the host stalls beyond the horizon, the native timeline freezes
// and the processor's existing continuity guard rejects it. No silent repair.
// Caller reserves4096 bytes in addition to its existing worklet/node allowance
// and retains this owner until actual worker/native closure.
export function installWorkletFrameClock(
  node,
  context,
  startFrame,
  endFrame = null,
  onFault = null,
) {
  const rate = context.sampleRate,
    anchor = Math.floor(startFrame / 128) * 128,
    epoch = node.parameters?.get("frameEpoch"),
    phase = node.parameters?.get("framePhase");
  if (
    !epoch ||
    !phase ||
    !Number.isSafeInteger(startFrame) ||
    startFrame < 0 ||
    !Number.isInteger(rate) ||
    rate < 8000 ||
    rate > 192000 ||
    (endFrame !== null &&
      (!Number.isSafeInteger(endFrame) || endFrame < startFrame)) ||
    (context.currentTime >= anchor / rate &&
      !(anchor === 0 && context.currentTime === 0))
  )
    throw RangeError("workletClockStartMissed");
  let boundary = (Math.floor(anchor / FRAME_PERIOD) + 1) * FRAME_PERIOD,
    disposed = false,
    fault = null,
    extended = false,
    timer;
  epoch.setValueAtTime(Math.floor(anchor / FRAME_PERIOD), anchor / rate);
  phase.setValueAtTime(anchor % FRAME_PERIOD, anchor / rate);
  const extend = () => {
    // Compare in the same seconds representation passed to AudioParam. An
    // inverse multiplication can round an exact deadline below its frame.
    if (extended && context.currentTime >= (boundary - FRAME_PERIOD) / rate)
      throw RangeError("workletClockHorizonMissed");
    const goal = Math.min(
      endFrame === null ? Infinity : endFrame + 16384,
      Math.max(anchor, Math.ceil(context.currentTime * rate)) +
        3 * FRAME_PERIOD,
    );
    while (boundary <= goal + FRAME_PERIOD) {
      if (boundary / FRAME_PERIOD > 16777215)
        throw RangeError("workletClockRange");
      phase.linearRampToValueAtTime(FRAME_PERIOD, boundary / rate);
      phase.setValueAtTime(0, boundary / rate);
      epoch.setValueAtTime(boundary / FRAME_PERIOD, boundary / rate);
      boundary += FRAME_PERIOD;
    }
    extended = true;
  };
  extend();
  if (
    context.currentTime >= anchor / rate &&
    !(anchor === 0 && context.currentTime === 0)
  )
    throw RangeError("workletClockStartMissed");
  if (endFrame === null || boundary <= endFrame + 16384 + FRAME_PERIOD)
    timer = setInterval(
      () => {
        if (disposed || fault || context.state === "closed") return;
        try {
          extend();
          if (endFrame !== null && boundary > endFrame + 16384 + FRAME_PERIOD)
            clearInterval(timer);
        } catch (error) {
          fault = error;
          clearInterval(timer);
          // Notification is not retirement; the caller still owns its node,
          // transferred PCM and clock until actual native/context closure.
          onFault?.(error);
        }
      },
      (FRAME_PERIOD / rate) * 500,
    );
  timer?.unref?.();
  return Object.freeze({
    get fault() {
      return fault;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearInterval(timer);
    },
  });
}
