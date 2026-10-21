import test from "node:test";
import assert from "node:assert/strict";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { renderPortableMix } from "../src/loop-station/portable-mix.js";
import { createPortableMixState } from "../src/loop-station/portable-mix-state.js";
import { FLAT_EQ, BYPASS_LIMITER } from "../src/loop-station/fx-model.js";
import { qaBuffer } from "./helpers/canonical-score-fixtures.js";
const event = (buffer, trackId, start, end, extra = {}) => ({
  trackId,
  spec: {
    buffer,
    frames: buffer.length,
    startFrame: start,
    naturalEndFrame: end,
    endFrame: end,
    dampFrame: null,
    velocity: 0.65,
    scale: 1,
    pan: 0,
    ...extra,
  },
});
const project = (limit = false) => ({
  master: {
    volume: 0.65,
    limiter: limit
      ? { version: 1, bypass: false, kind: "soft-knee-v1" }
      : BYPASS_LIMITER,
  },
  tracks: [
    {
      id: "a",
      gain: 0.6,
      pan: -0.27,
      mute: false,
      solo: false,
      eq: { version: 1, bypass: false, lowDb: 2, midDb: -3, highDb: 1 },
    },
    { id: "b", gain: 0.7, pan: 0.31, mute: false, solo: false, eq: FLAT_EQ },
  ],
});
for (const rate of [44100, 48000])
  for (const boundedSourceViews of [false, true])
    test(`persistent mix ${rate}, bounded=${boundedSourceViews}: arbitrary partitions equal established finite PCM bit-for-bit`, async () => {
      const mono = qaBuffer(1, 8192, rate),
        stereo = qaBuffer(2, 4096, rate);
      mono
        .getChannelData(0)
        .set(
          Float32Array.from({ length: 8192 }, (_, f) =>
            f === 0 ? -0 : 0.2 * Math.sin(f / 31),
          ),
        );
      for (let c = 0; c < 2; c++)
        stereo
          .getChannelData(c)
          .set(
            Float32Array.from(
              { length: 4096 },
              (_, f) => 0.1 * Math.cos(f / (c ? 23 : 47)),
            ),
          );
      const p = project(),
        program = {
          rate,
          frames: 16001,
          events: [
            event(mono, "a", 0, 9000, {
              loopFrames: 8192,
              phaseOffsetFrames: -137,
              dampFrame: 8500,
              pan: 0.3,
            }),
            event(stereo, "b", 307, 4403, { dampFrame: 3000 }),
            event(stereo, "b", 4048, 8144, { velocity: 0.4, pan: -0.2 }),
          ],
        },
        reference = await renderPortableMix(
          { createBuffer: qaBuffer },
          p,
          program,
          { boundedSourceViews, yieldTask: async () => {} },
        ),
        memory = new AudioMemory(),
        foreign = memory.reserve(313, "foreign"),
        state = createPortableMixState(p, program, {
          memory,
          boundedSourceViews,
        }),
        output = Array.from(
          { length: 4 },
          () => new Float32Array(program.frames),
        ),
        chunks = [1, 127, 128, 2048, 3, 4096, 257];
      let at = 0,
        index = 0;
      while (at < program.frames) {
        const n = Math.min(
            chunks[index++ % chunks.length],
            program.frames - at,
          ),
          channels = Array.from({ length: 4 }, () => new Float32Array(n)),
          receipt = state.renderInto(channels);
        assert.equal(receipt.from, at);
        assert.equal(receipt.frames, n);
        for (let c = 0; c < 4; c++) output[c].set(channels[c], at);
        at = receipt.endFrame;
      }
      for (let c = 0; c < 4; c++)
        assert.deepEqual(output[c], reference.getChannelData(c));
      assert.equal(
        state.renderInto([new Float32Array(128), new Float32Array(128)]).frames,
        0,
      );
      state.dispose();
      state.dispose();
      assert.equal(memory.snapshot().bytes, 313);
      assert.throws(
        () => state.renderInto([new Float32Array(1), new Float32Array(1)]),
        (e) => e.code === "memoryReleased",
      );
      foreign.release();
      assert.equal(memory.snapshot().bytes, 0);
    });
test("persistent shared finite law keeps soft limiter interpolation exact across chunk boundaries", async () => {
  const buffer = qaBuffer(2, 4096, 48000);
  for (let c = 0; c < 2; c++) buffer.getChannelData(c).fill(0.94);
  const p = project(true);
  p.master.volume = 1;
  p.tracks = [{ ...p.tracks[0], gain: 1, pan: 0, eq: FLAT_EQ }];
  const program = {
      rate: 48000,
      frames: 4096,
      events: [event(buffer, "a", 0, 4096, { velocity: 1, scale: 4 })],
    },
    reference = await renderPortableMix(
      { createBuffer: qaBuffer },
      p,
      program,
      { yieldTask: async () => {} },
    ),
    memory = new AudioMemory(),
    state = createPortableMixState(p, program, { memory });
  try {
    for (let at = 0; at < program.frames;) {
      const n = Math.min(127, program.frames - at),
        channels = Array.from({ length: 4 }, () => new Float32Array(n));
      state.renderInto(channels);
      for (let c = 0; c < 4; c++)
        assert.deepEqual(
          channels[c],
          reference.getChannelData(c).subarray(at, at + n),
        );
      at += n;
    }
  } finally {
    state.dispose();
  }
  assert.equal(memory.snapshot().bytes, 0);
});
for (const kind of ["voiceLimit", "unsafeOutput"])
  test(`persistent ${kind} is terminal and retains its own state until explicit close`, () => {
    const buffer = qaBuffer(1, 128, 48000);
    buffer.getChannelData(0).fill(kind === "unsafeOutput" ? 0.99 : 0.01);
    const p = project();
    p.master.volume = 1;
    p.tracks = [{ ...p.tracks[0], gain: 1, pan: 0, eq: FLAT_EQ }];
    const program = {
        rate: 48000,
        frames: 128,
        events: Array.from({ length: kind === "voiceLimit" ? 17 : 1 }, () =>
          event(buffer, "a", 0, 128, { velocity: 1, scale: 4 }),
        ),
      },
      memory = new AudioMemory(),
      foreign = memory.reserve(313, "foreign"),
      state = createPortableMixState(p, program, { memory }),
      held = memory.snapshot().bytes;
    for (let i = 0; i < 2; i++)
      assert.throws(
        () => state.renderInto([new Float32Array(128), new Float32Array(128)]),
        (e) => e.code === kind,
      );
    assert.equal(memory.snapshot().bytes, held);
    assert.equal(state.snapshot().fault, kind);
    state.dispose();
    assert.equal(memory.snapshot().bytes, 313);
    foreign.release();
    assert.equal(memory.snapshot().bytes, 0);
  });
test("an invalid or aliased chunk cannot advance mixer or overwrite shared output samples", () => {
  const memory = new AudioMemory(),
    state = createPortableMixState(
      project(),
      { rate: 48000, frames: 2, events: [] },
      { memory },
    ),
    c = new Float32Array([0.1, 0.2]);
  assert.throws(
    () => state.renderInto([c, c]),
    (e) => e.code === "invalidRenderChunk",
  );
  assert.equal(state.snapshot().frame, 0);
  assert.deepEqual(c, new Float32Array([0.1, 0.2]));
  assert.equal(
    state.renderInto([new Float32Array(1), new Float32Array(1)]).endFrame,
    1,
  );
  state.dispose();
  assert.equal(memory.snapshot().bytes, 0);
});
