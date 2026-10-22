import test from "node:test";
import assert from "node:assert/strict";
import {
  BEATBOX_BOOST,
  BEATBOX_CEILING,
  beatboxOutputSample,
  createBeatboxOutputStage,
} from "../src/beatbox/output-stage.js";
import { prepareBumiBuffer } from "../src/beatbox/bumi-presence.js";

test("Beatbox mastering preserves silence and low-level balance; every finite overload is bounded", () => {
  assert.equal(BEATBOX_BOOST, 3);
  assert.equal(beatboxOutputSample(0), 0);
  let last = 0;
  for (let i = 0; i <= 20000; i++) {
    const input = i / 10000;
    const output = beatboxOutputSample(input);
    assert.ok(output >= last && output <= BEATBOX_CEILING);
    assert.equal(beatboxOutputSample(-input), -output);
    if (input <= 0.7) assert.equal(output, input);
    last = output;
  }
  assert.equal(beatboxOutputSample(Number.MAX_VALUE), BEATBOX_CEILING);
});

test("Beatbox limiter knee is continuous with unit slope; saturation joins with zero slope", () => {
  const delta = 1e-6;
  const slope = (x) =>
    (beatboxOutputSample(x + delta) - beatboxOutputSample(x - delta)) /
    (2 * delta);
  assert.ok(Math.abs(slope(0.7) - 1) < 0.001);
  assert.ok(Math.abs(slope(1)) < 0.002);
  assert.ok(Math.abs(beatboxOutputSample(0.7 + delta) - 0.7) <= delta);
});

test("Bumi presence raises the 320 Hz oral band while keeping sub-bass and treble nearly unchanged", () => {
  const rate = 48000;
  for (const [frequency, minimum, maximum] of [
    [60, 0, 0.4],
    [320, 5.95, 6.05],
    [3000, 0, 0.3],
  ]) {
    const x = Float32Array.from(
      { length: rate },
      (_, i) => 0.1 * Math.sin((2 * Math.PI * frequency * i) / rate),
    );
    const source = x.slice();
    const buffer = {
      sampleRate: rate,
      numberOfChannels: 1,
      getChannelData: () => x,
    };
    assert.equal(prepareBumiBuffer(buffer, { id: "kick" }), buffer);
    const energy = (data) =>
      data.slice(rate / 2).reduce((sum, v) => sum + v * v, 0);
    const gainDb = 10 * Math.log10(energy(x) / energy(source));
    assert.ok(
      gainDb >= minimum && gainDb <= maximum,
      `${frequency}: ${gainDb}`,
    );
    assert.equal(x.length, source.length);
  }
});

test("Bumi preparation leaves every other character's PCM untouched", () => {
  for (const id of ["snare", "hat", "vocal-bass", "hum", "percussion-fx"]) {
    const x = Float32Array.of(0, 0.1, -0.2, 0.3, 0);
    const original = x.slice();
    const buffer = {
      sampleRate: 32000,
      numberOfChannels: 1,
      getChannelData: () => x,
    };
    assert.equal(prepareBumiBuffer(buffer, { id }), buffer);
    assert.deepEqual(x, original);
  }
});

test("active Beatbox stage retains the complete Float32 mastering curve and disposes both nodes", () => {
  let shaper,
    disconnected = 0;
  const ctx = {
    createGain: () => ({
      gain: {},
      connect() {},
      disconnect() {
        disconnected++;
      },
    }),
    createWaveShaper: () =>
      (shaper = {
        connect() {},
        disconnect() {
          disconnected++;
        },
      }),
  };
  const stage = createBeatboxOutputStage(ctx, { connect() {} });
  for (let i = 0; i < 65537; i++)
    assert.equal(
      shaper.curve[i],
      Math.fround(beatboxOutputSample((i / 65536) * 2 - 1)),
    );
  assert.equal(shaper.oversample, "none");
  stage.dispose();
  assert.equal(disconnected, 2);
});
