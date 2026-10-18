import test from "node:test";
import assert from "node:assert/strict";
import { Transport } from "../src/audio/transport.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { LoopClock } from "../src/loop-station/loop-clock.js";
import { PcmWindow } from "../src/loop-station/pcm-window.js";
import { TakePool, LayerHistory } from "../src/loop-station/take-pool.js";

test("absolute audio-frame bar plans and native fixed-period drift stay below10ms over five minutes", () => {
  for (const sampleRate of [44100, 48000])
    for (const bpm of [60, 73, 96, 127.3, 173, 180]) {
      const context = { sampleRate, state: "running", currentTime: 0.137 };
      const transport = new Transport({ bpm });
      transport.start(context.currentTime);
      const clock = new LoopClock(context, transport);
      for (const bars of [1, 2, 4, 8]) {
        const p = clock.plan({ bars, countInBars: 1 });
        assert.equal(p.startBeat % 4, 0);
        assert.equal(
          p.startFrame,
          Math.round(transport.timeAt(p.startBeat) * sampleRate),
        );
        const period = p.endFrame - p.startFrame;
        const cycles = Math.ceil((300 * sampleRate) / period);
        const actual = p.endFrame + cycles * period;
        const ideal = clock.frameAtBeat(p.endBeat + cycles * bars * 4);
        assert.ok((Math.abs(actual - ideal) / sampleRate) * 1000 < 10);
      }
      transport.pause(context.currentTime);
      assert.throws(() => clock.plan());
    }
});

test("PCM capture cuts exact windows across variable blocks and first repeat needs no main-thread callback", () => {
  const w = new PcmWindow({
    startFrame: 17,
    endFrame: 1007,
    channels: 2,
    sampleRate: 48000,
  });
  const sizes = [64, 192, 1, 256, 128],
    value = (f, c) => Math.fround((((f % 97) - 48) / 32) * (c ? -1 : 1));
  let frame = 0,
    n = 0;
  while (frame < 5000) {
    const size = sizes[n++ % sizes.length],
      input = Array.from({ length: 2 }, (_, c) =>
        Float32Array.from({ length: size }, (_, i) => value(frame + i, c)),
      );
    const out = [new Float32Array(size), new Float32Array(size)];
    w.consume(input, frame, size);
    w.render(out, frame, size);
    for (let i = 0; i < size; i++)
      for (let c = 0; c < 2; c++)
        assert.equal(
          out[c][i],
          frame + i < 1007 ? 0 : value(17 + ((frame + i - 1007) % 990), c),
        );
    frame += size;
  }
  assert.equal(w.reason, "complete");
  assert.equal(w.frames, 990);
  assert.ok(w.peak > 1);
  for (let i = 0; i < 990; i++) assert.equal(w.data[1][i], value(17 + i, 1));
});

test("lost input, discontinuity, changed channels and invalid PCM preserve only valid prefixes", () => {
  for (const scenario of ["missing", "gap", "channels", "nan"]) {
    const w = new PcmWindow({
      startFrame: 100,
      endFrame: 500,
      channels: 1,
      sampleRate: 44100,
    });
    w.consume([], 0, 64);
    assert.equal(w.reason, null);
    w.consume([new Float32Array(128).fill(0.25)], 64, 128);
    assert.equal(w.frames, 92);
    if (scenario === "missing") w.consume([], 192, 128);
    if (scenario === "gap") w.consume([new Float32Array(128)], 193, 128);
    if (scenario === "channels")
      w.consume([new Float32Array(128), new Float32Array(128)], 192, 128);
    if (scenario === "nan") {
      const b = new Float32Array(128);
      b[100] = NaN;
      w.consume([b], 192, 128);
    }
    assert.equal(w.frames, 92);
    assert.notEqual(w.reason, "complete");
    assert.ok([...w.data[0].subarray(0, 92)].every((v) => v === 0.25));
    const output = [new Float32Array(128)];
    w.render(output, 600, 128);
    assert.ok(output[0].every((v) => v === 0));
  }
});

function take(pool, partial = false, capacity = 256) {
  const r = pool.reserve({ capacity, channels: 1, sampleRate: 48000 });
  const b = new Float32Array(capacity).fill(1.25);
  const info = pool.adopt(
    r,
    {
      ...r,
      startFrame: 0,
      frames: partial ? 128 : capacity,
      reason: partial ? "inputLost" : "complete",
    },
    [b.buffer],
  );
  assert.equal(b.byteLength, 0);
  return info;
}
test("private raw take ownership, full capacity accounting and non-destructive overdub undo/redo", () => {
  const memory = new AudioMemory(),
    pool = new TakePool(memory),
    history = new LayerHistory(pool);
  for (let n = 1; n <= 8; n++) history.addTrack("track-" + n);
  assert.throws(() => history.addTrack("track-9"));
  const first = take(pool),
    second = take(pool),
    partial = take(pool, true);
  assert.equal(first.peak, 1.25);
  assert.equal(partial.validBytes, 512);
  assert.equal(partial.bytes, 1024);
  history.commit("track-1", first.id);
  history.commit("track-1", second.id, { overdub: true });
  assert.deepEqual(history.layers("track-1"), [first.id, second.id]);
  assert.throws(() => pool.release(first.id));
  assert.throws(() => history.commit("track-1", partial.id));
  history.undo("track-1");
  assert.deepEqual(history.layers("track-1"), [first.id]);
  assert.throws(() => pool.release(second.id));
  history.redo("track-1");
  assert.deepEqual(history.layers("track-1"), [first.id, second.id]);
  history.close();
  for (const t of [first, second, partial]) pool.release(t.id);
  assert.equal(memory.snapshot().bytes, 0);
});

test("foreign budget pressure refuses admission before data allocation; canceled and invalid receipts release honestly", () => {
  const memory = new AudioMemory({ maxBytes: 4096 }),
    pool = new TakePool(memory);
  const foreign = memory.reserve(3500, "foreign-existing-work");
  assert.throws(() =>
    pool.reserve({ capacity: 256, channels: 1, sampleRate: 48000 }),
  );
  assert.equal(memory.snapshot().bytes, 3500);
  foreign.release();
  const r = pool.reserve({ capacity: 256, channels: 1, sampleRate: 48000 });
  const invalid = new Float32Array(256);
  invalid[0] = Infinity;
  assert.throws(() =>
    pool.adopt(r, { ...r, startFrame: 0, frames: 256, reason: "complete" }, [
      invalid.buffer,
    ]),
  );
  assert.notEqual(invalid.byteLength, 0);
  pool.cancel(r);
  pool.cancel(r);
  assert.equal(memory.snapshot().bytes, 0);
});
