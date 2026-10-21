// Shared assertions retained before any failed-feature source/test retirement.
// Exact provenance and original line anchors are in C2 SHARED-EXTRACTIONS.json.
import test from "node:test";
import assert from "node:assert/strict";
import { programmeSample } from "../src/audio/programme-output.js";
import { softLimit } from "../src/loop-station/fx-model.js";

test("existing programme curve bounds the actual SUM instead of summing individually calibrated outputs", () => {
  const a = 0.7598987817764282,
    b = 0.6321051716804504;
  assert(a + b > 0.95);
  assert(Math.abs(programmeSample(a + b)) < 0.9);
  for (const value of [-100, -2, -1, -0.85, 0, 0.85, 1, 2, 100])
    assert(Math.abs(programmeSample(value)) < 0.9);
  assert(
    Math.abs(programmeSample(a) - a) < 1e-7,
    "single-programme linear region is unchanged",
  );
});

test("shared programme protection is linear at nominal peaks, smooth and signed at upper-master peaks", () => {
  for (const v of [0, 0.2, 0.82, -0.82])
    assert.equal(programmeSample(v), Math.fround(v));
  assert(Math.abs(programmeSample((0.82 * 0.75) / 0.65) - 0.89269) < 0.00001);
  let prior = 0;
  for (let i = 0; i <= 2000; i++) {
    const x = i / 1000,
      y = programmeSample(x);
    assert(y >= prior);
    assert(y < 0.9);
    assert(Math.abs(y + programmeSample(-x)) < 1e-7);
    prior = y;
  }
  assert.throws(() => programmeSample(NaN));
});

test("retained soft limiter preserves small values and is monotone, symmetric and bounded", () => {
  assert.equal(softLimit(0.4), 0.4);
  assert.ok(softLimit(0.9) < 0.9);
  assert.ok(softLimit(0.9) > 0.8);
  let prior = -1;
  for (let i = 0; i <= 65536; i++) {
    const x = i / 32768 - 1,
      y = softLimit(x);
    assert.ok(y >= prior && Math.abs(y) <= 0.95);
    assert.equal(y, -softLimit(-x));
    prior = y;
  }
});
