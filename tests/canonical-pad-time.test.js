import test from "node:test";
import assert from "node:assert/strict";
import { canonicalPadWhenFrame } from "../src/studio/canonical-pad-time.js";
import { MasterClock } from "../src/loop-station/master-clock.js";
import { PPQ } from "../src/project/instrument-project.js";
import { stepBeat } from "../src/audio/sequencing.js";

test("pad grid uses the same swung musical boundaries and a fresh native-clock lead", () => {
  const base = {
    timing: { bpm: 96, clock: { kind: "musical", ppq: PPQ } },
    rate: 48000,
    swing: 0.5,
    originFrame: 48000,
    fromFrame: 0,
  };
  assert.equal(canonicalPadWhenFrame({ ...base, nowFrame: 50000 }), 59250);
  assert.equal(canonicalPadWhenFrame({ ...base, nowFrame: 56000 }), 63000);
  assert.equal(canonicalPadWhenFrame({ ...base, nowFrame: 48000, swing: 0 }), 55500);
  // A late prepare uses the current time, not the gesture's old boundary.
  assert.equal(canonicalPadWhenFrame({ ...base, nowFrame: 63001 }), 74250);
});
test("fixed-bar recordings, nonzero resume and long sessions retain the admitted clock", () => {
  for (const rate of [44100, 48000]) {
    const timing = {
      bpm: 137,
      clock: { kind: "fixed-bar", sampleRate: rate, framesPerBar: Math.round(240 * rate / 137) },
    }, clock = new MasterClock({ timing, clock: timing.clock }, rate);
    const originFrame = rate * 900, fromFrame = rate * 18, nowFrame = originFrame + rate * 9;
    const when = canonicalPadWhenFrame({ timing, rate, swing: 0.23, originFrame, fromFrame, nowFrame });
    assert(when >= nowFrame + Math.ceil(.08 * rate));
    const beat = clock.tick(when - originFrame + fromFrame) / PPQ;
    const step = Math.round(beat * 4);
    assert(Math.abs(when - (originFrame - fromFrame + clock.frame(stepBeat(step, .23) * PPQ))) <= 1);
  }
});
test("invalid grid inputs fail before scheduling a native job", () => {
  assert.throws(() => canonicalPadWhenFrame({ swing: NaN }), e => e.code === "invalidCanonicalPadGrid");
});
