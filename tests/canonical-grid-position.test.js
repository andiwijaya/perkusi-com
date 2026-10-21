import test from "node:test";
import assert from "node:assert/strict";
import { canonicalGridStep } from "../src/audio/canonical-grid-position.js";
import { PPQ } from "../src/project/instrument-project.js";
test("visual grid uses exact rounded swung source boundaries including nonzero placements and fixed-bar clock", () => {
  for (const rate of [44100, 48000])
    for (const bpm of [60, 110, 180])
      for (const fixed of [false, true])
        for (const swing of [0, 0.16, 0.5]) {
          const timing = {
              bpm,
              clock: fixed
                ? {
                    kind: "fixed-bar",
                    sampleRate: rate,
                    framesPerBar: Math.round((240 * rate) / bpm),
                  }
                : { kind: "musical" },
            },
            fpt = fixed
              ? timing.clock.framesPerBar / (4 * PPQ)
              : (60 * rate) / (bpm * PPQ),
            startTick = 3.125 * PPQ,
            bar = 2,
            options = { startTick, bar, timing, rate, swing };
          for (let step = 0; step < 16; step++) {
            const frame = Math.round(
              (startTick +
                bar * 4 * PPQ +
                (step / 4 + (step % 2 ? swing / 4 : 0)) * PPQ) *
                fpt,
            );
            assert.equal(canonicalGridStep(frame, options), step);
            if (step)
              assert.equal(canonicalGridStep(frame - 1, options), step - 1);
          }
          assert.equal(
            canonicalGridStep(
              Math.round((startTick + bar * 4 * PPQ) * fpt) - 1,
              options,
            ),
            null,
          );
          assert.equal(
            canonicalGridStep(
              Math.round((startTick + (bar + 1) * 4 * PPQ) * fpt),
              options,
            ),
            null,
          );
        }
});
