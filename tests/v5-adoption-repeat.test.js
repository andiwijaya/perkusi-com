import test from "node:test";
import assert from "node:assert/strict";
import { CaptureSession } from "../src/loop-station/capture-session.js";
import { LoopClock } from "../src/loop-station/loop-clock.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { TakePool } from "../src/loop-station/take-pool.js";
import { Transport } from "../src/audio/transport.js";

// Actual processor/controller and transferred queues, not a mock that closes
// the worker on behalf of a failing controller. No browser/microphone/native IO.
let Processor;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.port = { onmessage: null, postMessage() {} };
  }
};
globalThis.sampleRate = 48000;
globalThis.registerProcessor = (name, constructor) => {
  Processor = constructor;
};
await import("../src/loop-station/capture-worklet.js");

class Context extends EventTarget {
  state = "running";
  sampleRate = 48000;
  currentTime = 0;
  audioWorklet = { addModule: async () => {} };
}

function fixture(shared = {}) {
  const context = shared.context ?? new Context(),
    memory = shared.memory ?? new AudioMemory(),
    pool = shared.pool ?? new TakePool(memory),
    transport = new Transport();
  transport.start(0);
  const toMain = [],
    toWorker = [],
    sent = [];
  let processor, node;
  class Node extends EventTarget {
    constructor(c, options) {
      super();
      this.context = c;
      this.connected = false;
      this.port = {
        onmessage: null,
        postMessage(m) {
          sent.push(m);
          toWorker.push(structuredClone(m));
        },
        close() {
          this.closed = true;
        },
      };
      processor = new Processor(options);
      processor.port.postMessage = (m, transfer = []) =>
        toMain.push(structuredClone(m, { transfer }));
    }
    connect() {
      this.connected = true;
    }
    disconnect() {
      this.connected = false;
    }
  }
  const drain = () => {
    let n = 0;
    while (toMain.length || toWorker.length) {
      assert.ok(++n < 1000, "bounded protocol must settle");
      while (toMain.length) node.port.onmessage({ data: toMain.shift() });
      while (toWorker.length)
        processor.port.onmessage({ data: toWorker.shift() });
    }
  };
  const options = {
    clock: new LoopClock(context, transport),
    memory,
    pool,
    destination: { context },
    moduleURL: "https://local.test/compiled-capture.js",
    channels: 1,
    plan: {
      sampleRate: 48000,
      startFrame: shared.startFrame ?? 64,
      endFrame: (shared.startFrame ?? 64) + 128,
    },
    nodeFactory: (c, o) => (node = new Node(c, o)),
  };
  return {
    context,
    memory,
    pool,
    options,
    drain,
    toMain,
    toWorker,
    sent,
    get node() {
      return node;
    },
    get processor() {
      return processor;
    },
    block(frame, value) {
      globalThis.currentFrame = frame;
      const out = [[new Float32Array(64)]];
      processor.process([[new Float32Array(64).fill(value)]], out);
      return out[0][0];
    },
  };
}

test("normal-complete adoption failure disconnects/requests stop automatically and retains worker lease until closed ack", async () => {
  const f = fixture(),
    foreign = f.memory.reserve(2048, "foreign-owner");
  const r = f.pool.reserve({ capacity: 128, channels: 1, sampleRate: 48000 });
  const old = f.pool.adopt(
    r,
    { ...r, startFrame: 0, frames: 128, reason: "complete" },
    [new Float32Array(128).fill(0.5).buffer],
  );
  f.pool.adopt = () => {
    throw Error("injected adoption failure");
  };
  const session = await CaptureSession.open(f.options);
  for (const frame of [0, 64, 128]) {
    f.block(frame, 0.125);
    f.drain();
  }
  assert.equal(await session.ready, null);
  assert.equal(session.outcome.reason, "takeAdoptionFailed");
  assert.equal(session.outcome.captureReason, "complete");
  assert.equal(
    f.node.connected,
    false,
    "error must immediately disconnect this session output",
  );
  assert.equal(
    f.sent.filter((m) => m.type === "stop").length,
    1,
    "error must stop its repeating worker without caller cleanup",
  );
  // Repeat the case while withholding worker and main acknowledgments below.
  await session.closed;
  assert.equal(f.processor.closed, true);
  assert.ok(f.block(192, 0).every((v) => v === 0));
  assert.equal(f.pool.describe(old.id).peak, 0.5);
  assert.equal(f.memory.snapshot().bytes, old.bytes + 2048);
  f.pool.release(old.id);
  assert.equal(f.memory.snapshot().bytes, 2048);
  foreign.release();
  assert.equal(f.memory.snapshot().bytes, 0);
});

test("failed normal-complete keeps worker ownership while stop command/closed acknowledgement are pending", async () => {
  const f = fixture(),
    foreign = f.memory.reserve(2048, "foreign-owner");
  f.pool.adopt = () => {
    throw Error("injected adoption failure");
  };
  const session = await CaptureSession.open(f.options);
  f.block(0, 0.125);
  f.block(64, 0.125);
  f.block(128, 0.125);
  // Deliver started/PCM then ACK; completion is emitted but closed is not.
  while (f.toMain.length) f.node.port.onmessage({ data: f.toMain.shift() });
  while (f.toWorker.length)
    f.processor.port.onmessage({ data: f.toWorker.shift() });
  const completion = f.toMain.findIndex((m) => m.type === "complete");
  assert.ok(completion >= 0);
  f.node.port.onmessage({ data: f.toMain.splice(completion, 1)[0] });
  assert.equal(await session.ready, null);
  assert.equal(f.node.connected, false);
  assert.equal(session.state, "error");
  const bytes = f.memory.snapshot().bytes;
  assert.ok(bytes > 2048, "worker must remain reserved before any stop ack");
  assert.equal(f.processor.closed, false);
  while (f.toWorker.length)
    f.processor.port.onmessage({ data: f.toWorker.shift() });
  assert.equal(f.processor.closed, true);
  assert.equal(
    f.memory.snapshot().bytes,
    bytes,
    "processor confirmation not received yet",
  );
  const ack = f.toMain.findIndex((m) => m.type === "closed");
  assert.ok(ack >= 0);
  f.node.port.onmessage({ data: f.toMain.splice(ack, 1)[0] });
  await session.closed;
  assert.equal(f.memory.snapshot().bytes, 2048);
  foreign.release();
  assert.equal(f.memory.snapshot().bytes, 0);
});

test("adoption failure stops only its worker while a prior loop in the same context/pool remains routed", async () => {
  const previous = fixture();
  const oldSession = await CaptureSession.open(previous.options);
  for (const frame of [0, 64, 128]) {
    previous.block(frame, 0.25);
    previous.drain();
  }
  const oldTake = await oldSession.ready;
  assert.equal(oldTake.reason, "complete");
  const failed = fixture({
    context: previous.context,
    memory: previous.memory,
    pool: previous.pool,
    startFrame: 256,
  });
  failed.pool.adopt = () => {
    throw Error("injected adoption failure");
  };
  const newSession = await CaptureSession.open(failed.options);
  for (const frame of [192, 256, 320]) {
    // Both workers share this context's advancing quanta. Keep rendering the
    // foreign loop rather than silently omitting its process calls until384.
    assert.ok(previous.block(frame, 0).every((v) => v === 0.25));
    previous.drain();
    failed.block(frame, 0.125);
    failed.drain();
  }
  assert.equal(await newSession.ready, null);
  await newSession.closed;
  assert.equal(failed.node.connected, false);
  assert.equal(failed.processor.closed, true);
  assert.equal(previous.node.connected, true);
  assert.equal(previous.processor.closed, false);
  assert.ok(previous.block(384, 0).every((v) => v === 0.25));
  assert.equal(previous.context.state, "running");
  assert.equal(previous.pool.describe(oldTake.id).peak, 0.25);
  const closing = oldSession.stop();
  previous.drain();
  await closing;
  previous.pool.release(oldTake.id);
  assert.equal(previous.memory.snapshot().bytes, 0);
});
