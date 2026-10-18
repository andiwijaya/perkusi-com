import { LoopClock } from "./loop-clock.js";
import { MasterClock } from "./master-clock.js";
import { validateLoopProject } from "./project.js";
import { PPQ } from "../project/instrument-project.js";
import { integer, finite, fail } from "../project/instrument-contract.js";

// Call before starting/arming. This returns a new validated manifest; it does not
// change a running transport, imported origins, recorded samples or caller data.
export function freezeCaptureProject(value, registry, rate) {
  const p = validateLoopProject(value, registry);
  if (p.clock?.kind !== "fixed-bar" && p.assetRefs.length)
    fail("loopPeriodMismatch");
  const clock = new MasterClock(p, rate);
  const next = validateLoopProject(
    { ...p, clock: clock.freezeBar() },
    registry,
  );
  const frozen = new MasterClock(next, rate);
  for (const t of next.tracks)
    for (const c of t.clips) {
      const a = next.assetRefs.find((a) => a.id === c.sourceId);
      if (!a) continue;
      if (a.sampleRate !== rate) fail("takeRateMismatch");
      if (
        c.loop &&
        (c.offsetFrames !== 0 ||
          a.frames !==
            frozen.frame(c.startTick + c.lengthTicks) -
              frozen.frame(c.startTick))
      )
        fail("loopPeriodMismatch");
    }
  return next;
}

// CaptureSession accepts the existing LoopClock interface. This adapter maps it
// onto the schema5 frozen bar grid used by LoopStationSession, never another
// tempo or a per-take independently rounded duration.
export class MasterCaptureClock extends LoopClock {
  constructor(context, transport, project, registry) {
    super(context, transport);
    this.project = validateLoopProject(project, registry);
    this.master = new MasterClock(this.project, context.sampleRate);
    if (this.master.policy.kind !== "fixed-bar") fail("captureClockNotFrozen");
    // Check any existing active recording without converting or repairing it.
    freezeCaptureProject(this.project, registry, context.sampleRate);
  }
  epoch() {
    const t = this.transport,
      rate = this.context.sampleRate;
    if (!t.running || this.context.state !== "running" || t.beatsPerBar !== 4)
      fail("invalidLoopPlan");
    if (Math.abs(t.beatSeconds - 60 / this.master.effectiveBpm) > 1e-10)
      fail("loopTempoLocked");
    const origin = t.origin * rate;
    if (
      !Number.isFinite(origin) ||
      !Number.isSafeInteger(Math.round(origin)) ||
      Math.abs(origin - Math.round(origin)) > 1e-5
    )
      fail("captureEpochMismatch");
    return Math.round(origin);
  }
  frameAtBeat(beat) {
    if (!finite(beat, 0, Number.MAX_SAFE_INTEGER / PPQ))
      fail("invalidLoopClock");
    const frame = this.epoch() + this.master.frame(beat * PPQ);
    if (!integer(frame, 0, Number.MAX_SAFE_INTEGER)) fail("invalidLoopClock");
    return frame;
  }
  plan({ bars = 1, countInBars = 1, leadSeconds = 0.1, alignBars = 1 } = {}) {
    if (
      ![1, 2, 4, 8].includes(bars) ||
      ![1, 2, 4, 8].includes(alignBars) ||
      !integer(countInBars, 0, 2) ||
      !finite(leadSeconds, 0.02, 2)
    )
      fail("invalidLoopPlan");
    const originFrame = this.epoch(),
      rate = this.context.sampleRate;
    const earliest = Math.ceil((this.context.currentTime + leadSeconds) * rate);
    const quantum = this.master.policy.framesPerBar;
    const countBar = Math.max(
      0,
      Math.floor((earliest - originFrame) / quantum) + 1,
    );
    const startBar =
      Math.ceil((countBar + countInBars) / alignBars) * alignBars;
    const startFrame = originFrame + startBar * quantum;
    const endFrame = startFrame + bars * quantum;
    if (
      !integer(
        startFrame,
        Math.ceil(this.context.currentTime * rate) + 1,
        Number.MAX_SAFE_INTEGER,
      ) ||
      !integer(endFrame, startFrame + 1, startFrame + rate * 32)
    )
      fail("loopWindowLimit");
    return Object.freeze({
      sampleRate: rate,
      countInFrame: originFrame + (startBar - countInBars) * quantum,
      startFrame,
      endFrame,
      startBeat: startBar * 4,
      endBeat: (startBar + bars) * 4,
      bars,
      bpm: this.project.timing.bpm,
      effectiveBpm: this.master.effectiveBpm,
      framesPerBar: quantum,
      transportOriginFrame: originFrame,
    });
  }
}
