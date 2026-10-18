import test from "node:test";
import assert from "node:assert/strict";
import { CaptureSession } from "../src/loop-station/capture-session.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { TakePool } from "../src/loop-station/take-pool.js";
import { Transport } from "../src/audio/transport.js";
import { LoopClock } from "../src/loop-station/loop-clock.js";

test("unsafeReplay full-window receipt keeps every original overrange sample, refuses normal history, and holds worker until closed", async () => {
  const context = Object.assign(new EventTarget(), {
      sampleRate: 48000,
      currentTime: 0,
      state: "running",
      audioWorklet: { addModule: async () => {} },
    }),
    memory = new AudioMemory(),
    pool = new TakePool(memory),
    transport = new Transport(),
    clock = new LoopClock(context, transport),
    plan = { sampleRate: 48000, startFrame: 1000, endFrame: 1128 };
  let node;
  const session = await CaptureSession.open({
    clock,
    memory,
    pool,
    destination: { context },
    moduleURL: "/qa/capture.js",
    plan,
    channels: 1,
    replayPeakLimit: 0.5,
    nodeFactory: (_c, options) => {
      assert.equal(options.processorOptions.replayPeakLimit, 0.5);
      node = Object.assign(new EventTarget(), {
        context,
        port: { postMessage() {}, close() {} },
        connect() {},
        disconnect() {},
      });
      return node;
    },
  });
  node.port.onmessage({
    data: {
      type: "pcm",
      sequence: 0,
      offset: 0,
      frames: 128,
      buffers: [new Float32Array(128).fill(1.25).buffer],
    },
  });
  node.port.onmessage({
    data: {
      type: "complete",
      ...plan,
      channels: 1,
      frames: 128,
      capacity: 128,
      reason: "unsafeReplay",
      peak: 1.25,
      blockSizes: [128],
    },
  });
  const take = await session.ready;
  assert.equal(take.frames, 128);
  assert.equal(take.partial, true);
  assert.equal(take.reason, "unsafeReplay");
  const original = pool.copyPCM(take.id);
  assert.equal(
    new Float32Array(original.buffer).every((n) => n === 1.25),
    true,
  );
  original.release();
  assert.equal(session.state, "partial");
  const held = memory.snapshot().bytes;
  node.port.onmessage({ data: { type: "closed" } });
  await session.closed;
  assert(memory.snapshot().bytes < held);
  pool.release(take.id);
  assert.equal(memory.snapshot().bytes, 0);
});
