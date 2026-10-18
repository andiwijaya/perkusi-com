import test from "node:test";
import assert from "node:assert/strict";
import {
  ProgrammeMeter,
  measureProgramme,
  programmeGain,
  auditionGain,
} from "../src/audio/programme-level.js";
import {
  createProgrammeOutputStage,
  isProgrammeOutputStage,
} from "../src/audio/programme-output.js";
for (const rate of [44100, 48000])
  test(`K-weighting and fixed programme calibration preserve master/mute and chunk identity at${rate}`, () => {
    const x = Float32Array.from(
        { length: rate * 4 },
        (_, i) => 0.1 * Math.sin((2 * Math.PI * 997 * i) / rate),
      ),
      zero = new Float32Array(x.length),
      m = measureProgramme([x, x], rate);
    assert(Math.abs(m.integratedLKFS + 20) < 0.04);
    const chunked = new ProgrammeMeter(rate);
    for (let f = 0; f < x.length; f += 997)
      chunked.push(x.subarray(f, f + 997), x.subarray(f, f + 997));
    assert.deepEqual(chunked.result(), m);
    const gain = programmeGain(m, 0.65),
      half = measureProgramme([x.map((v) => v / 2), x.map((v) => v / 2)], rate);
    assert(
      Math.abs(programmeGain(half, 0.325) - gain) < 1e-9,
      "normalization must not cancel the user's master reduction",
    );
    assert.equal(programmeGain(measureProgramme([zero, zero], rate)), 1);
    assert.equal(programmeGain(m, 0), 1);
    assert(programmeGain({ peak: 0.4, integratedLKFS: -40 }) <= 0.82 / 0.4);
    assert.equal(programmeGain({ peak: 0.0001, integratedLKFS: -80 }), 16);
    const buffer = {
      sampleRate: rate,
      length: x.length,
      numberOfChannels: 1,
      getChannelData: () => x,
    };
    const snapshot = x.slice();
    const a = auditionGain(buffer, 1, 0.65);
    assert(a >= 1 && a <= 8);
    assert.deepEqual(x, snapshot);
  });
test("only branded bounded stage grants the workspace output contract; measured calibration is constant", () => {
  const params = [],
    nodes = [];
  const c = {
    currentTime: 1,
    createGain() {
      const n = {
        gain: {
          value: 1,
          setValueAtTime(v, t) {
            this.value = v;
            params.push([v, t]);
          },
        },
        connect() {},
        disconnect() {},
      };
      nodes.push(n);
      return n;
    },
    createWaveShaper() {
      const n = { connect() {}, disconnect() {} };
      nodes.push(n);
      return n;
    },
  };
  const input = { connect() {} },
    stage = createProgrammeOutputStage(c, input);
  assert(isProgrammeOutputStage(stage));
  assert(!isProgrammeOutputStage({ ...stage }));
  stage.setProgrammeGain(7);
  assert.equal(stage.programmeGain, 7);
  assert.deepEqual(params, [[7, 1]]);
  for (const v of [NaN, 0, 17]) assert.throws(() => stage.setProgrammeGain(v));
  const curve = nodes[1].curve;
  assert(Math.max(...curve) < 0.9);
  assert(curve[32768] === 0);
  assert(Math.abs(curve[32768 + 16384] - 0.5) < 1e-9);
  stage.dispose();
});
