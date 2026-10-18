import { fail } from "../project/instrument-contract.js";
import { phaseAdvance } from "./phase-alignment.js";

// A prepared-plan capability, never an imported JSON flag. Only the recording
// resolver path registers a complete immutable PCM period after identity checks.
const periods = new WeakMap();
export function qualifyRecordedLoop(clip, ref, clock) {
  if (!clip.loop || ref.kind !== "recording") return;
  const v = clip.voices[0],
    advance = phaseAdvance(clip, ref, clock.policy),
    start = clock.frame(clip.startTick),
    period = clock.frame(clip.startTick + clip.lengthTicks) - start;
  if (
    clock.policy.kind !== "fixed-bar" ||
    clip.voices.length !== 1 ||
    clip.sourceId !== ref.id ||
    clip.offsetFrames !== 0 ||
    period !== ref.frames ||
    period < 128 ||
    v.key !== ref.id ||
    v.tick !== 0 ||
    v.dampTick !== null ||
    v.velocity !== 1 ||
    v.scale !== 4 ||
    v.pan !== 0 ||
    (v.phaseOffsetFrames ?? 0) !== advance ||
    v.loopFrames !== undefined ||
    v.stopFrame !== undefined ||
    v.cycles ||
    v.frames !== period ||
    v.buffer.length !== period ||
    v.buffer.sampleRate !== clock.rate ||
    v.buffer.numberOfChannels !== ref.channels
  )
    fail("loopPeriodMismatch");
  periods.set(
    clip,
    Object.freeze({
      clock,
      voice: v,
      buffer: v.buffer,
      startFrame: start,
      periodFrames: period,
      startTick: clip.startTick,
      lengthTicks: clip.lengthTicks,
      sourceId: clip.sourceId,
      sourceHash: ref.sha256,
      rate: clock.rate,
      channels: ref.channels,
      peak: v.peak,
      phaseOffsetFrames: advance,
      phaseJSON: JSON.stringify(clip.phaseAlignment),
    }),
  );
}
export function recordedLoopGeometry(clip, clock) {
  const g = periods.get(clip);
  if (!g) return null;
  const v = clip.voices[0];
  if (
    g.clock !== clock ||
    g.rate !== clock.rate ||
    !clip.loop ||
    clip.startTick !== g.startTick ||
    clip.lengthTicks !== g.lengthTicks ||
    clip.sourceId !== g.sourceId ||
    clip.offsetFrames !== 0 ||
    clip.voices.length !== 1 ||
    v !== g.voice ||
    v.buffer !== g.buffer ||
    v.frames !== g.periodFrames ||
    v.tick !== 0 ||
    v.dampTick !== null ||
    v.velocity !== 1 ||
    v.scale !== 4 ||
    v.pan !== 0 ||
    v.key !== g.sourceId ||
    v.peak !== g.peak ||
    (v.phaseOffsetFrames ?? 0) !== g.phaseOffsetFrames ||
    JSON.stringify(clip.phaseAlignment) !== g.phaseJSON ||
    v.buffer.length !== g.periodFrames ||
    v.buffer.sampleRate !== g.rate ||
    v.buffer.numberOfChannels !== g.channels ||
    v.loopFrames !== undefined ||
    v.stopFrame !== undefined ||
    v.cycles ||
    clock.frame(clip.startTick) !== g.startFrame ||
    clock.frame(clip.startTick + clip.lengthTicks) - g.startFrame !==
      g.periodFrames
  )
    fail("loopPeriodMismatch");
  return g;
}
