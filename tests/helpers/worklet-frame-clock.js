// Explicit unit-only native timeline shim. Not browser/hardware evidence.
import { FRAME_PERIOD } from "../../src/audio/worklet-frame-clock.js";
export function nativeParameters(frame, size) {
  return {
    frameEpoch: Float32Array.from({ length: size }, (_, i) =>
      Math.floor((frame + i) / FRAME_PERIOD),
    ),
    framePhase: Float32Array.from(
      { length: size },
      (_, i) => (frame + i) % FRAME_PERIOD,
    ),
  };
}
export function fakeWorkletParams() {
  return new Map(
    ["frameEpoch", "framePhase"].map((name) => [
      name,
      {
        events: [],
        setValueAtTime(value, time) {
          this.events.push(["set", value, time]);
        },
        linearRampToValueAtTime(value, time) {
          this.events.push(["ramp", value, time]);
        },
      },
    ]),
  );
}

export const withUnitNativeClock = (C) =>
  class extends C {
    process(
      inputs,
      outputs,
      parameters = nativeParameters(
        globalThis.currentFrame,
        outputs[0][0].length,
      ),
    ) {
      return super.process(inputs, outputs, parameters);
    }
  };
