// Retained shared/data assertions extracted before failed-feature retirement.
import test from "node:test";
import assert from "node:assert/strict";
import { gamelanPlaybackScale } from "../src/audio/gamelan-level.js";

const cdm = { setId: "cdm-porto-recorded-candidate" };

test("only quieter trusted CdM notes receive bounded fixed playback gain; silence and other sources do not", () => {
  for (const peak of [0, 0.01, 0.16, 0.2, 0.4, 0.8, 0.95, 1, 1.5]) {
    const scale = gamelanPlaybackScale(cdm, peak);
    assert(scale >= 1 && scale <= 4);
    assert(peak * scale <= Math.max(peak, 0.8) + 1e-12);
    assert.equal(
      gamelanPlaybackScale({ setId: "original-local-input" }, peak),
      1,
    );
    assert.equal(
      gamelanPlaybackScale({ setId: "studio-original-synthesis" }, peak),
      1,
    );
    assert.equal(
      gamelanPlaybackScale({ setId: "freepats-recorded-plucked" }, peak),
      1,
    );
  }
  assert.equal(gamelanPlaybackScale(cdm, 0.16), 4);
  assert.equal(gamelanPlaybackScale(cdm, 0.4), 2);
  assert.equal(gamelanPlaybackScale(cdm, 0.95), 1);
  for (const x of [NaN, Infinity, -1])
    assert.equal(gamelanPlaybackScale(cdm, x), 1);
});
