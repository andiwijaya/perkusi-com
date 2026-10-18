import test from "node:test";
import assert from "node:assert/strict";
import {
  renderPortableMix,
  portableMixBytes,
} from "../src/loop-station/portable-mix.js";
const buffer = (C, F, R, values = []) => {
  const data = Array.from({ length: C }, (_, c) =>
    Float32Array.from({ length: F }, (_, f) => values[c]?.[f] ?? 0),
  );
  return {
    numberOfChannels: C,
    length: F,
    sampleRate: R,
    getChannelData: (c) => data[c],
  };
};
const context = { createBuffer: (C, F, R) => buffer(C, F, R) };
const project = () => ({
  master: { volume: 0.5 },
  tracks: [{ id: "t1", gain: 0.5, pan: 0, mute: false, solo: false }],
});
const spec = (b, start) => ({
  buffer: b,
  startFrame: start,
  endFrame: start + b.length,
  dampFrame: null,
  velocity: 1,
  scale: 4,
  pan: 0,
});
test("portable path renders many non-overlapping future events with bounded active voices and exact immutable stereo input", async () => {
  const p = project(),
    b = buffer(2, 2, 48000, [
      [0.25, -0.125],
      [-0.5, 0.375],
    ]),
    original = [...b.getChannelData(0)],
    events = Array.from({ length: 64 }, (_, i) => ({
      trackId: "t1",
      spec: spec(b, 4 * i),
    })),
    program = { rate: 48000, frames: 256, events };
  const result = await renderPortableMix(context, p, program, {
    yieldTask: async () => {},
  });
  for (let f = 0; f < 256; f++)
    for (let c = 0; c < 2; c++) {
      const expected = f % 4 < 2 ? b.getChannelData(c)[f % 4] * 0.25 : 0;
      assert.equal(result.getChannelData(c)[f], expected);
      assert.equal(result.getChannelData(c + 2)[f], expected);
    }
  assert.deepEqual([...b.getChannelData(0)], original);
  assert.equal(portableMixBytes(p, program), 4096 + 8192 + 16);
});
test("portable path respects mono center duplication and a separate track solo/mute snapshot", async () => {
  const p = project();
  p.tracks.push({ id: "t2", gain: 1, pan: 0, mute: false, solo: true });
  const b = buffer(1, 2, 44100, [[0.25, 0.5]]),
    events = [
      { trackId: "t1", spec: spec(b, 0) },
      { trackId: "t2", spec: spec(b, 0) },
    ];
  const result = await renderPortableMix(
    context,
    p,
    { rate: 44100, frames: 2, events },
    { yieldTask: async () => {} },
  );
  assert.deepEqual([...result.getChannelData(0)], [0.125, 0.25]);
  assert.deepEqual([...result.getChannelData(1)], [0.125, 0.25]);
});
test("portable cancellation is observed at bounded chunk yield without changing sources", async () => {
  const abort = new AbortController(),
    p = project(),
    b = buffer(2, 5000, 48000),
    before = b.getChannelData(0).slice();
  let yields = 0;
  await assert.rejects(
    renderPortableMix(
      context,
      p,
      {
        rate: 48000,
        frames: 5000,
        events: [{ trackId: "t1", spec: spec(b, 0) }],
      },
      {
        signal: abort.signal,
        yieldTask: async () => {
          yields++;
          abort.abort();
        },
      },
    ),
    /cancelled/,
  );
  assert.equal(yields, 1);
  assert.deepEqual(b.getChannelData(0), before);
});
test("portable path refuses actual simultaneous voice excess and unsafe output rather than stealing or clamping", async () => {
  const p = project(),
    b = buffer(2, 1, 48000, [[1], [1]]);
  await assert.rejects(
    renderPortableMix(
      context,
      p,
      {
        rate: 48000,
        frames: 1,
        events: Array.from({ length: 17 }, () => ({
          trackId: "t1",
          spec: spec(b, 0),
        })),
      },
      { yieldTask: async () => {} },
    ),
    /voiceLimit/,
  );
  p.master.volume = 1;
  p.tracks[0].gain = 1;
  await assert.rejects(
    renderPortableMix(
      context,
      p,
      { rate: 48000, frames: 1, events: [{ trackId: "t1", spec: spec(b, 0) }] },
      { yieldTask: async () => {} },
    ),
    /unsafeOutput/,
  );
});

test("portable nonflat EQ plus active limiter matches an independent closed-form pulse and keeps its complete tail at both native rates", async () => {
  for (const rate of [44100, 48000]) {
    const p = project();
    p.master = {
      volume: 1,
      limiter: { version: 1, bypass: false, kind: "soft-knee-v1" },
    };
    p.tracks[0].gain = 1;
    p.tracks[0].eq = {
      version: 1,
      bypass: false,
      lowDb: 6,
      midDb: 6,
      highDb: 5,
    };
    const b = buffer(2, 2048, rate, [
        Array(2048).fill(0.45),
        Array(2048).fill(-0.42),
      ]),
      frames = 2048 + Math.ceil(rate * 0.1),
      out = await renderPortableMix(
        context,
        p,
        { rate, frames, events: [{ trackId: "t1", spec: spec(b, 0) }] },
        { yieldTask: async () => {} },
      ),
      pole = Math.exp((-2 * Math.PI * 3000) / rate),
      high = Math.fround(10 ** (5 / 20)),
      upper = Math.fround(10 ** (6 / 20) - 10 ** (5 / 20));
    let knee = 0,
      prePeak = 0,
      postPeak = 0,
      tail = 0,
      error = 0;
    for (let c = 0; c < 2; c++)
      for (let f = 0; f < frames; f++) {
        const amplitude = Math.fround(c === 0 ? 0.45 : -0.42),
          x = f < 2048 ? amplitude : 0,
          lp =
            f < 2048
              ? amplitude * (1 - pole ** (f + 1))
              : amplitude * (1 - pole ** 2048) * pole ** (f - 2048 + 1),
          pre = Math.fround(
            Math.fround(x * high) + Math.fround(Math.fround(lp) * upper),
          ),
          expected =
            Math.abs(pre) <= 0.8
              ? pre
              : Math.sign(pre) *
                (0.8 + 0.15 * (1 - Math.exp(-(Math.abs(pre) - 0.8) / 0.15)));
        error = Math.max(
          error,
          Math.abs(out.getChannelData(c + 2)[f] - pre),
          Math.abs(out.getChannelData(c)[f] - expected),
        );
        prePeak = Math.max(prePeak, Math.abs(pre));
        postPeak = Math.max(postPeak, Math.abs(out.getChannelData(c)[f]));
        if (Math.abs(pre) > 0.8) knee++;
        if (f >= 2048 && f < 2176)
          tail = Math.max(tail, Math.abs(out.getChannelData(c)[f]));
      }
    assert.ok(error <= 2e-6);
    assert.ok(knee > 4000);
    assert.ok(prePeak < 0.95 && postPeak < prePeak);
    assert.ok(tail > 0.06);
    assert.ok(
      out
        .getChannelData(0)
        .slice(-128)
        .every((v) => Math.abs(v) < 1e-6),
    );
  }
});

test("streaming analysis matches every full-render sample with 2048-frame retained output and aborts at the chunk boundary", async () => {
  const p = project(),
    b = buffer(2, 5003, 48000, [
      Array.from({ length: 5003 }, (_, i) => 0.1 * Math.sin(i / 71)),
      Array.from({ length: 5003 }, (_, i) => 0.07 * Math.cos(i / 63)),
    ]);
  const program = {
    rate: 48000,
    frames: 6007,
    events: [{ trackId: "t1", spec: spec(b, 317) }],
  };
  const full = await renderPortableMix(context, p, program, {
      yieldTask: async () => {},
    }),
    collected = Array.from({ length: 4 }, () => []);
  const streamed = await renderPortableMix(context, p, program, {
    analysisOnly: true,
    onChunk: (cs) => cs.forEach((c, i) => collected[i].push(...c)),
    yieldTask: async () => {},
  });
  assert.equal(streamed.length, 2048);
  for (let c = 0; c < 4; c++)
    assert.deepEqual(Float32Array.from(collected[c]), full.getChannelData(c));
  const abort = new AbortController();
  let chunks = 0;
  await assert.rejects(
    renderPortableMix(context, p, program, {
      signal: abort.signal,
      analysisOnly: true,
      onChunk: () => {
        chunks++;
        abort.abort();
      },
      yieldTask: async () => {},
    }),
    (e) => e.code === "cancelled",
  );
  assert.equal(chunks, 1);
});
