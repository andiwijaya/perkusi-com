import test from "node:test";
import assert from "node:assert/strict";
import { repeatPeakBound } from "../src/audio/repeat-headroom.js";
import { repeatAdmission } from "../src/project/gamelan-repeat.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { panMatrix } from "../src/audio/frame-dsp.js";

function source(rate, channels, frames, sample) {
  const data = Array.from({ length: channels }, (_, c) =>
    Float32Array.from({ length: frames }, (_, i) => sample(i, c)),
  );
  let peak = 0;
  for (const a of data) for (const x of a) peak = Math.max(peak, Math.abs(x));
  return {
    key: "a",
    bank: { setId: "test" },
    lease: {
      metrics: { peak },
      buffer: {
        sampleRate: rate,
        length: frames,
        numberOfChannels: channels,
        getChannelData: (c) => data[c],
      },
    },
  };
}

test("PCM periodic certificate bounds every stereo output frame over many non-aligned cycles, pan and explicit damp", () => {
  for (const rate of [44100, 48000])
    for (const pan of [-1, 0, 0.37, 1]) {
      const item = source(
          rate,
          2,
          Math.round(rate * 0.43),
          (i, c) =>
            Math.sin(i * (c ? 0.61 : 0.43)) *
            0.7 *
            Math.exp(-i / (rate * 0.013)),
        ),
        period = Math.round(rate * 0.21) + 17;
      const voices = [
          {
            key: "a",
            startFrame: 193,
            endFrame: 193 + item.lease.buffer.length,
            naturalEndFrame: 193 + item.lease.buffer.length,
            dampFrame: null,
            velocity: 0.6,
            mix: { volume: 0.8, pan },
          },
          {
            key: "a",
            startFrame: 773,
            endFrame: 773 + Math.round(rate * 0.02),
            naturalEndFrame: 773 + item.lease.buffer.length,
            dampFrame: 773,
            velocity: 0.3,
            mix: { volume: 0.7, pan },
          },
        ],
        plan = { rate, periodFrames: period, voices },
        memory = new AudioMemory(),
        before = item.lease.buffer.getChannelData(0).slice(),
        r = repeatAdmission(
          plan,
          new Map([["a", { peak: item.lease.metrics.peak }]]),
          0.65,
          { items: [item], memory },
        );
      let actual = 0;
      const m = pan === 0 ? [1, 0, 0, 1] : panMatrix(pan, false),
        pcm = [
          item.lease.buffer.getChannelData(0),
          item.lease.buffer.getChannelData(1),
        ];
      for (let frame = 0; frame < 18 * period; frame++) {
        let left = 0,
          right = 0;
        for (const v of voices)
          for (let cycle = 0; cycle < 18; cycle++) {
            const start = v.startFrame + cycle * period,
              index = frame - start;
            if (index < 0 || frame >= v.endFrame + cycle * period) continue;
            const damp =
                v.dampFrame === null
                  ? 1
                  : Math.max(
                      0,
                      1 -
                        (frame - v.dampFrame - cycle * period) /
                          Math.round(0.02 * rate),
                    ),
              g = v.velocity * 0.25 * v.mix.volume * 0.65 * damp;
            left += (pcm[0][index] * m[0] + pcm[1][index] * m[1]) * g;
            right += (pcm[0][index] * m[2] + pcm[1][index] * m[3]) * g;
          }
        actual = Math.max(actual, Math.abs(left), Math.abs(right));
      }
      assert(actual > 0);
      assert(actual <= r.maxPeak, `${rate}/${pan}: ${actual} <= ${r.maxPeak}`);
      assert(r.maxOwned <= 16);
      assert.equal(memory.snapshot().bytes, 0);
      assert.deepEqual(item.lease.buffer.getChannelData(0), before);
    }
});

test("periodic certificate rejects genuine sustained clipping and releases scratch on PCM errors or memory refusal", () => {
  const item = source(48000, 1, 48000, () => 0.9),
    v = {
      key: "a",
      startFrame: 0,
      endFrame: 48000,
      dampFrame: null,
      velocity: 1,
      mix: { volume: 1, pan: 0 },
    },
    plan = { rate: 48000, periodFrames: 9600, voices: [v] },
    metrics = new Map([["a", { peak: item.lease.metrics.peak }]]),
    memory = new AudioMemory();
  assert.throws(
    () => repeatAdmission(plan, metrics, 1, { items: [item], memory }),
    { code: "voiceHeadroom" },
  );
  assert.equal(memory.snapshot().bytes, 0);
  const bad = { ...item, lease: { ...item.lease, metrics: { peak: 0.1 } } };
  assert.throws(() => repeatPeakBound(plan, [bad], 1, memory), {
    code: "cachedAssetInvalid",
  });
  assert.equal(memory.snapshot().bytes, 0);
  let reads = 0;
  const constrained = new AudioMemory({ maxBytes: 4096 }),
    guard = {
      ...item,
      lease: {
        ...item.lease,
        buffer: {
          ...item.lease.buffer,
          getChannelData() {
            reads++;
            throw Error("must not read");
          },
        },
      },
    };
  const foreign = constrained.reserve(4000, "foreign owner");
  assert.throws(() => repeatPeakBound(plan, [guard], 1, constrained), {
    code: "combinedMemoryLimit",
  });
  assert.equal(reads, 0);
  assert.equal(constrained.snapshot().bytes, 4000);
  foreign.release();
});
