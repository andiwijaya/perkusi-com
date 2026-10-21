import { fakeWorkletParams } from "./helpers/worklet-frame-clock.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  waveformSlice,
  mergeWaveform,
  waveformPath,
  WAVEFORM_BINS,
} from "../src/loop-station/waveform.js";
import {
  TrackWaveforms,
  waveformSourceKey,
} from "../src/loop-station/track-waveforms.js";
import { AudioDocument } from "../src/loop-station/audio-document.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { TakePool } from "../src/loop-station/take-pool.js";
import { CaptureSession } from "../src/loop-station/capture-session.js";
import { LoopClock } from "../src/loop-station/loop-clock.js";
import { Transport } from "../src/audio/transport.js";

const hash = (b) => createHash("sha256").update(b).digest("hex");
const planes = (n) => [
  Float32Array.from({ length: n }, (_, i) => (i % 31 === 0 ? 0.75 : -0.125)),
  Float32Array.from({ length: n }, (_, i) => (i % 47 === 0 ? -1.25 : 0.0625)),
];

test("128-bin stereo envelope matches independent bin windows and irregular incremental receipt partitions", () => {
  const data = planes(1001),
    original = data.map((p) => hash(Buffer.from(p.buffer)));
  let view = null,
    start = 0;
  for (const end of [3, 17, 256, 513, 997, 1001]) {
    view = mergeWaveform(
      view,
      waveformSlice({
        capacity: 1001,
        frames: end,
        channels: 2,
        fromFrame: start,
        sample: (c, f) => data[c][f],
      }),
    );
    start = end;
  }
  for (let b = 0; b < WAVEFORM_BINS; b++) {
    const first = Math.ceil((b * 1001) / WAVEFORM_BINS),
      last = Math.ceil(((b + 1) * 1001) / WAVEFORM_BINS),
      values = data.flatMap((p) => [...p.slice(first, last)]);
    assert.equal(view.min[b], Math.min(...values));
    assert.equal(view.max[b], Math.max(...values));
    assert.equal(view.seen[b], 1);
  }
  assert.equal(view.peak, 1.25);
  assert.deepEqual(
    data.map((p) => hash(Buffer.from(p.buffer))),
    original,
  );
  const path = waveformPath(view);
  assert.equal((path.match(/M/g) ?? []).length, 128);
  assert.doesNotMatch(path, /NaN|Infinity/);
  assert.equal(view.peak, 1.25, "drawing bounds cannot clamp raw extrema");
});

test("partial empty bins are unreceived rather than invented silence; bad ranges/nonfinite PCM refuse", () => {
  const w = waveformSlice({
    capacity: 1024,
    frames: 17,
    channels: 1,
    sample: () => 0.25,
  });
  assert.equal([...w.seen].filter(Boolean).length, 3);
  assert.equal(w.seen[3], 0);
  assert.equal(w.frames, 17);
  for (const args of [
    { capacity: 0, frames: 0 },
    { capacity: 10, frames: 11 },
    { capacity: 10, frames: 5, fromFrame: 6 },
    { capacity: Number.MAX_SAFE_INTEGER, frames: 0 },
    { capacity: 10, frames: 1, sample: () => NaN },
  ])
    assert.throws(
      () => waveformSlice({ channels: 1, sample: () => 0, ...args }),
      { code: "invalidWaveform" },
    );
  assert.throws(
    () =>
      mergeWaveform(
        w,
        waveformSlice({
          capacity: 1024,
          frames: 20,
          fromFrame: 18,
          channels: 1,
          sample: () => 0,
        }),
      ),
    { code: "invalidWaveform" },
  );
});

test("immutable take waveform cannot mutate originals and retains the intended partial window", () => {
  const memory = new AudioMemory(),
    pool = new TakePool(memory),
    reservation = pool.reserve({
      capacity: 1024,
      channels: 2,
      sampleRate: 48000,
    }),
    input = planes(1024);
  const expected = input.map((p) => [...p.slice(0, 17)]);
  const take = pool.adopt(
    reservation,
    { ...reservation, startFrame: 0, frames: 17, reason: "suspended" },
    input.map((p) => p.buffer),
  );
  const bytes = memory.snapshot().bytes,
    wave = pool.waveform(take.id);
  assert.equal(wave.frames, 17);
  assert.equal(wave.capacity, 1024);
  wave.min.fill(-100);
  wave.max.fill(100);
  const copy = pool.copyPCM(take.id),
    raw = new Float32Array(copy.buffer);
  for (let c = 0; c < 2; c++)
    assert.deepEqual([...raw.slice(c * 17, (c + 1) * 17)], expected[c]);
  copy.release();
  assert.equal(memory.snapshot().bytes, bytes);
  pool.release(take.id);
  assert.equal(memory.snapshot().bytes, 0);
});

test("live CaptureSession exposes only acknowledged PCM, then the identical retained partial after worker close", async () => {
  const context = Object.assign(new EventTarget(), {
      state: "running",
      sampleRate: 48000,
      currentTime: 0,
      audioWorklet: { addModule: async () => {} },
    }),
    transport = new Transport();
  transport.start(0);
  const memory = new AudioMemory(),
    pool = new TakePool(memory),
    node = Object.assign(new EventTarget(), {
      parameters: fakeWorkletParams(),
      context,
      connect() {},
      disconnect() {},
      port: { postMessage() {}, close() {} },
    }),
    plan = { startFrame: 1000, endFrame: 1256, sampleRate: 48000 };
  const session = await CaptureSession.open({
    clock: new LoopClock(context, transport),
    memory,
    pool,
    destination: { context },
    moduleURL: "/capture",
    plan,
    nodeFactory: () => node,
  });
  assert.equal(session.waveform().frames, 0);
  node.port.onmessage({
    data: {
      type: "pcm",
      sequence: 0,
      offset: 0,
      frames: 128,
      buffers: [new Float32Array(128).fill(0.25).buffer],
    },
  });
  const live = session.waveform();
  assert.equal(live.frames, 128);
  assert.equal(live.peak, 0.25);
  node.port.onmessage({
    data: {
      type: "complete",
      ...plan,
      capacity: 256,
      frames: 128,
      channels: 1,
      reason: "suspended",
      blockSizes: [128],
    },
  });
  const take = await session.ready;
  node.port.onmessage({ data: { type: "closed" } });
  await session.closed;
  assert.deepEqual(session.waveform(), live);
  pool.release(take.id);
  assert.equal(memory.snapshot().bytes, 0);
});

test("stored waveforms validate full raw hash/finite data without AudioContext and refund read budgets on errors", async () => {
  const memory = new AudioMemory(),
    raw = new Float32Array([0.25, -0.5, 0.75, -1.25]),
    blob = new Blob([raw]),
    ref = {
      kind: "recording",
      encoding: "float32le",
      channels: 1,
      frames: 4,
      bytes: 16,
      sha256: hash(Buffer.from(raw.buffer)),
    },
    doc = new AudioDocument({
      memory,
      backend: {
        entry: async () => ({
          blob,
          provenance: "Original simulated QA input",
        }),
      },
    });
  const wave = await doc.waveform(ref);
  assert.equal(wave.peak, 1.25);
  assert.equal(wave.frames, 4);
  assert.equal(memory.snapshot().bytes, 0);
  await assert.rejects(doc.waveform({ ...ref, sha256: "0".repeat(64) }), {
    code: "recordingHashMismatch",
  });
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(doc.waveform(ref, { signal: abort.signal }));
  assert.equal(memory.snapshot().bytes, 0);
  assert.deepEqual([...raw], [0.25, -0.5, 0.75, -1.25]);
});

test("waveform metadata is charged while visible, stale live sources release, and disposal refunds every reader/view", async () => {
  const memory = new AudioMemory(),
    manager = new TrackWaveforms({ memory, documentStore: {} }),
    identity = {},
    read = () =>
      waveformSlice({
        capacity: 100,
        frames: 10,
        channels: 1,
        sample: () => 0.1,
      });
  manager.updateLive("track", identity, 10, read);
  assert.equal(memory.snapshot().bytes, 16384);
  manager.updateLive("track", null);
  assert.equal(memory.snapshot().bytes, 0);
  manager.updateLive("track", identity, 10, read);
  await manager.dispose();
  assert.equal(memory.snapshot().bytes, 0);
  manager.updateLive("track", identity, 10, read);
  assert.equal(memory.snapshot().bytes, 0);
});

test("identical bytes with a different valid recording layout cannot reuse a stale waveform or its view lease", async () => {
  const memory = new AudioMemory(),
    manager = new TrackWaveforms({ memory, documentStore: {} }),
    stereo = {
      sha256: "a".repeat(64),
      sampleRate: 48000,
      channels: 2,
      frames: 64000,
      encoding: "float32le",
    },
    mono = { ...stereo, channels: 1, frames: 128000 },
    lease = memory.reserve(16384, "old-layout");
  assert.notEqual(waveformSourceKey(stereo), waveformSourceKey(mono));
  manager.cache.set(waveformSourceKey(stereo), {
    abort: new AbortController(),
    lease,
    wave: {},
  });
  manager.begin({ assetRefs: [mono] });
  assert.equal(manager.cache.size, 0);
  assert.equal(memory.snapshot().bytes, 0);
  await manager.dispose();
});
