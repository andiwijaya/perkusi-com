import { PPQ } from "../project/instrument-project.js";
import { integer, finite, fail } from "../project/instrument-contract.js";
export class MasterClock {
  constructor(project, rate) {
    if (!integer(rate, 8000, 192000) || !finite(project.timing.bpm, 60, 180))
      fail("invalidLoopClock");
    this.rate = rate;
    this.bpm = project.timing.bpm;
    this.policy = project.clock ?? { kind: "musical" };
    if (!["musical", "fixed-bar"].includes(this.policy.kind))
      fail("invalidLoopClock");
    if (
      this.policy.kind === "fixed-bar" &&
      this.policy.framesPerBar !==
        Math.round((4 * 60 * this.policy.sampleRate) / this.bpm)
    )
      fail("invalidLoopClock");
    if (this.policy.kind === "fixed-bar" && this.policy.sampleRate !== rate)
      fail("takeRateMismatch");
    this.framesPerTick =
      this.policy.kind === "fixed-bar"
        ? this.policy.framesPerBar / (4 * PPQ)
        : (60 * rate) / (this.bpm * PPQ);
  }
  frame(tick) {
    if (!finite(tick, 0, Number.MAX_SAFE_INTEGER)) fail("invalidLoopClock");
    const f = Math.round(tick * this.framesPerTick);
    if (!Number.isSafeInteger(f)) fail("invalidLoopClock");
    return f;
  }
  tick(frame) {
    if (!finite(frame, 0, Number.MAX_SAFE_INTEGER)) fail("invalidLoopClock");
    return frame / this.framesPerTick;
  }
  nextBar(frame) {
    return (Math.floor(this.tick(frame) / (4 * PPQ) + 1e-10) + 1) * 4 * PPQ;
  }
  freezeBar() {
    return Object.freeze({
      kind: "fixed-bar",
      sampleRate: this.rate,
      framesPerBar: Math.round((4 * 60 * this.rate) / this.bpm),
    });
  }
  get effectiveBpm() {
    return (60 * this.rate) / (this.framesPerTick * PPQ);
  }
}
