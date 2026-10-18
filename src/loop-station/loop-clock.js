import { Transport } from "../audio/transport.js";
import { integer, finite, fail } from "../project/instrument-contract.js";

// An adapter to the existing transport/context, never a second musical clock.
export class LoopClock {
  constructor(context, transport) {
    if (
      !integer(context?.sampleRate, 8000, 192000) ||
      !(transport instanceof Transport)
    )
      fail("invalidLoopClock");
    this.context = context;
    this.transport = transport;
  }
  frameAtBeat(beat) {
    if (!finite(beat, 0, Number.MAX_SAFE_INTEGER)) fail("invalidLoopClock");
    const frame = Math.round(
      this.transport.timeAt(beat) * this.context.sampleRate,
    );
    if (!integer(frame, 0, Number.MAX_SAFE_INTEGER)) fail("invalidLoopClock");
    return frame;
  }
  plan({ bars = 1, countInBars = 1, leadSeconds = 0.1 } = {}) {
    if (
      !this.transport.running ||
      this.context.state !== "running" ||
      ![1, 2, 4, 8].includes(bars) ||
      !integer(countInBars, 0, 2) ||
      !finite(leadSeconds, 0.02, 2)
    )
      fail("invalidLoopPlan");
    const beat = this.transport.beatsAt(this.context.currentTime + leadSeconds);
    const countInBeat =
      (Math.floor(beat / this.transport.beatsPerBar + 1e-10) + 1) *
      this.transport.beatsPerBar;
    const startBeat = countInBeat + countInBars * this.transport.beatsPerBar;
    const endBeat = startBeat + bars * this.transport.beatsPerBar;
    const startFrame = this.frameAtBeat(startBeat),
      endFrame = this.frameAtBeat(endBeat);
    if (endFrame - startFrame > this.context.sampleRate * 32)
      fail("loopWindowLimit");
    return Object.freeze({
      sampleRate: this.context.sampleRate,
      countInFrame: this.frameAtBeat(countInBeat),
      startFrame,
      endFrame,
      startBeat,
      endBeat,
      bars,
      bpm: 60 / this.transport.beatSeconds,
    });
  }
}
