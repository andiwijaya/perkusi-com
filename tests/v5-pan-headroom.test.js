import test from "node:test";
import assert from "node:assert/strict";
import { panPeakFactor } from "../src/loop-station/pan-headroom.js";

// Independent mathematical signal model used only to challenge conservative
// admission. Native graph checks are separate evidence; this is not native DSP.
function panner(input, pan) {
  if (input.length === 1) {
    const angle = ((pan + 1) * Math.PI) / 4;
    return [input[0] * Math.cos(angle), input[0] * Math.sin(angle)];
  }
  const angle = ((pan <= 0 ? pan + 1 : pan) * Math.PI) / 2;
  const [l, r] = input;
  return pan <= 0
    ? [l + r * Math.cos(angle), r * Math.sin(angle)]
    : [l * Math.cos(angle), r + l * Math.sin(angle)];
}
function graph(input, voicePan, trackPan) {
  let signal = voicePan === 0 ? input : panner(input, voicePan);
  if (signal.length === 1) signal = [signal[0], signal[0]];
  return panner(signal, trackPan);
}
const pans = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
for (const [name, input] of [
  ["mono", [0.5]],
  ["correlated stereo", [0.5, 0.5]],
  ["asymmetric stereo", [0.5, 0.125]],
  ["negative correlation", [0.5, -0.5]],
  ["right only", [0, -0.5]],
]) {
  test(`${name}: both full sides, center and intermediate per-voice/track pan combinations remain bounded`, () => {
    const peak = Math.max(...input.map(Math.abs));
    for (const voicePan of pans)
      for (const trackPan of pans) {
        const bound =
          peak *
          panPeakFactor(input.length, voicePan) *
          panPeakFactor(2, trackPan);
        assert.ok(
          graph(input, voicePan, trackPan).every((v) => Math.abs(v) <= bound),
          `${voicePan}/${trackPan}`,
        );
      }
  });
}
test("mixed mono/stereo sources sum absolute channel bounds without negative-correlation credit", () => {
  const sources = [[0.25], [0.125, -0.25], [-0.25, -0.125]];
  for (const trackPan of pans)
    for (const voicePan of pans) {
      const actual = [0, 0];
      let bound = 0;
      for (const input of sources) {
        graph(input, voicePan, trackPan).forEach((v, c) => (actual[c] += v));
        bound +=
          Math.max(...input.map(Math.abs)) *
          panPeakFactor(input.length, voicePan) *
          panPeakFactor(2, trackPan);
      }
      assert.ok(actual.every((v) => Math.abs(v) <= bound));
    }
  assert.equal(panPeakFactor(2, 1) * 0.5, 1);
});
test("actual mono versus explicit stereo layouts differ while center and .95 exact limit remain stable", () => {
  assert.equal(panPeakFactor(1, 1), 1);
  assert.equal(panPeakFactor(2, 1), 2);
  assert.equal(panPeakFactor(2, -1), 2);
  assert.equal(panPeakFactor(2, 0), 1);
  assert.equal(panPeakFactor(2, -0), 1);
  assert.equal(0.475 * panPeakFactor(2, 1), 0.95);
});
test("unsupported channel layouts or nonfinite/out-of-range pan refuse rather than guessing/downmixing", () => {
  for (const channels of [0, 3, 6, undefined, NaN, Infinity, "1"])
    assert.throws(() => panPeakFactor(channels, 0), {
      code: "invalidLoopPlan",
    });
  for (const pan of [undefined, NaN, Infinity, -Infinity, 1.01, -1.01, "0"])
    assert.throws(() => panPeakFactor(2, pan), { code: "invalidLoopPlan" });
});
