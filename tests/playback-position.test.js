import test from "node:test";
import assert from "node:assert/strict";
import {
  musicalPosition,
  scorePosition,
} from "../src/audio/playback-position.js";
import { eventFrame, PPQ } from "../src/project/instrument-project.js";

test("display steps meet the exact audio event boundaries at both native rates and fractional tempos", () => {
  for (const rate of [44100, 48000])
    for (const bpm of [60, 96, 173, 180]) {
      const framesPerTick = (60 * rate) / (bpm * PPQ);
      for (let step = 0; step < 16 * 8; step++) {
        const frame = eventFrame((step * PPQ) / 4, bpm, rate),
          at = musicalPosition(frame, framesPerTick);
        assert.equal(at.bar, Math.floor(step / 16));
        assert.equal(at.step, step % 16);
        if (step) {
          const before = musicalPosition(frame - 1, framesPerTick);
          assert.equal(before.bar * 16 + before.step, step - 1);
        }
      }
    }
});

test("fixed repeat periods wrap presentation without musical drift, while once tails never fake another cycle", () => {
  for (const rate of [44100, 48000])
    for (const bpm of [96, 173]) {
      const framesPerTick = (60 * rate) / (bpm * PPQ),
        body = eventFrame(8 * PPQ, bpm, rate),
        hit = eventFrame((19 * PPQ) / 4, bpm, rate);
      for (const cycle of [0, 1, 220]) {
        const p = scorePosition(cycle * body + hit, framesPerTick, body, true);
        assert.equal(p.state, "playing");
        assert.equal(p.bar, 1);
        assert.equal(p.step, 3);
      }
      const tail = scorePosition(body + 3000, framesPerTick, body, false);
      assert.equal(tail.state, "tail");
      assert.equal(tail.step, null);
      assert.equal(tail.phase, 1);
      assert.equal(scorePosition(body, framesPerTick, body, true).step, 0);
    }
});
