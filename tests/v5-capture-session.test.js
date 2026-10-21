import { fakeWorkletParams } from "./helpers/worklet-frame-clock.js";
import test from "node:test";
import assert from "node:assert/strict";
import { CaptureSession } from "../src/loop-station/capture-session.js";
import { LoopClock } from "../src/loop-station/loop-clock.js";
import { TakePool } from "../src/loop-station/take-pool.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { Transport } from "../src/audio/transport.js";

class Context extends EventTarget {
  state = "running";
  sampleRate = 48000;
  currentTime = 0;
  audioWorklet = { addModule: async () => {} };
}
class Node extends EventTarget {
  constructor(context) {
    super();
    this.context = context;
    this.parameters = fakeWorkletParams();
    this.port = {
      sent: [],
      postMessage(m) {
        this.sent.push(m);
      },
      close() {
        this.closed = true;
      },
    };
  }
  connect() {}
  disconnect() {
    this.disconnected = true;
  }
  send(m) {
    this.port.onmessage({ data: m });
  }
}
function fixture() {
  const context = new Context(),
    memory = new AudioMemory(),
    pool = new TakePool(memory),
    transport = new Transport();
  transport.start(0);
  const node = new Node(context),
    plan = { startFrame: 1000, endFrame: 1256, sampleRate: 48000 };
  const options = {
    clock: new LoopClock(context, transport),
    memory,
    pool,
    destination: { context },
    moduleURL: "https://local.test/capture.js",
    plan,
    nodeFactory: () => node,
  };
  return { context, memory, pool, node, plan, options };
}
const chunk = () => ({
  type: "pcm",
  sequence: 0,
  offset: 0,
  frames: 128,
  buffers: [new Float32Array(128).fill(0.25).buffer],
});

for (const boundary of ["worker-close", "context-close", "stop-first"])
  test(`192k finite capture host fault preserves PCM and ownership until ${boundary}`, async (t) => {
    let callback;
    t.mock.method(globalThis, "setInterval", (fn) => {
      callback = fn;
      return { unref() {} };
    });
    t.mock.method(globalThis, "clearInterval", () => {});
    const f = fixture();
    f.context.sampleRate = 192000;
    Object.assign(f.plan, { sampleRate: 192000, endFrame: 1000 + 192000 * 32 });
    f.options.replay = false;
    const s = await CaptureSession.open(f.options);
    t.after(async () => {
      f.context.state = "closed";
      f.context.dispatchEvent(new Event("statechange"));
      await s.closed;
      if (s.take) f.pool.release(s.take.id);
      assert.equal(f.memory.snapshot().bytes, 0);
    });
    assert.equal(typeof callback, "function");
    f.node.send(chunk());
    let fault,
      closed = false;
    s.playbackFault.then((v) => (fault = v));
    s.closed.then(() => (closed = true));
    if (boundary === "stop-first") s.stop();
    const held = f.memory.snapshot().bytes;
    assert(held < 67108864);
    f.node.parameters.get("framePhase").linearRampToValueAtTime = () => {
      throw Error("QAHostFiniteCaptureClockFailure");
    };
    f.context.currentTime = (1.1 * 1048576) / 192000;
    callback();
    await new Promise(setImmediate);
    assert.equal(
      fault?.code,
      boundary === "stop-first" ? undefined : "captureClockFailure",
    );
    assert.equal(f.memory.snapshot().bytes, held);
    assert.equal(closed, false);
    if (boundary === "context-close") {
      f.context.state = "closed";
      f.context.dispatchEvent(new Event("statechange"));
    } else {
      f.node.send({
        type: "pcm",
        sequence: 1,
        offset: 128,
        frames: 64,
        buffers: [new Float32Array(64).fill(0.5).buffer],
      });
      f.node.send({
        type: "complete",
        ...f.plan,
        capacity: 192000 * 32,
        channels: 1,
        frames: 192,
        reason: boundary === "stop-first" ? "userStop" : "inputLost",
        blockSizes: [128],
      });
      await s.ready;
      assert.equal(closed, false);
      f.node.send({ type: "closed" });
    }
    const take = await s.ready;
    await s.closed;
    assert.equal(take.frames, boundary === "context-close" ? 128 : 192);
    assert.equal(take.partial, true);
    const copy = f.pool.copyPCM(take.id);
    try {
      const pcm = new Float32Array(copy.buffer);
      assert(pcm.subarray(0, 128).every((v) => v === 0.25));
      assert(pcm.subarray(128).every((v) => v === 0.5));
    } finally {
      copy.release();
    }
    callback();
    assert.equal(s.take, take);
  });

for (const mode of [
  "partial-drain",
  "complete-drain",
  "complete-replay",
  "context-close",
  "stop-first",
])
  test(`replay host clock failure preserves ${mode} data and ordered worker ownership`, async (t) => {
    let callback;
    t.mock.method(globalThis, "setInterval", (fn) => {
      callback = fn;
      return { unref() {} };
    });
    t.mock.method(globalThis, "clearInterval", () => {});
    const f = fixture(),
      s = await CaptureSession.open(f.options);
    t.after(async () => {
      f.context.state = "closed";
      f.context.dispatchEvent(new Event("statechange"));
      await s.closed;
      if (s.take) f.pool.release(s.take.id);
      assert.equal(f.memory.snapshot().bytes, 0);
    });
    f.node.send(chunk());
    const complete = (frames, reason) =>
      f.node.send({
        type: "complete",
        ...f.plan,
        capacity: 256,
        channels: 1,
        frames,
        reason,
        blockSizes: [128],
      });
    const late = (frames) =>
      f.node.send({
        type: "pcm",
        sequence: 1,
        offset: 128,
        frames,
        buffers: [new Float32Array(frames).fill(0.5).buffer],
      });
    if (mode === "complete-replay") {
      late(128);
      complete(256, "complete");
      await s.ready;
    }
    if (mode === "stop-first") s.stop();
    let ready = false,
      fault;
    s.ready.then(() => (ready = true));
    s.playbackFault.then((v) => (fault = v));
    f.node.parameters.get("framePhase").linearRampToValueAtTime = () => {
      throw Error("QAHostReplayClockFailure");
    };
    const held = f.memory.snapshot().bytes;
    f.context.currentTime = (1.1 * 1048576) / 48000;
    callback();
    await new Promise(setImmediate);
    if (mode === "stop-first") {
      assert.equal(fault, undefined);
      complete(128, "userStop");
    } else {
      assert.equal(fault?.code, "replayClockFailure");
      assert.equal(fault.reason, "QAHostReplayClockFailure");
      assert.equal(f.memory.snapshot().bytes, held);
      assert.equal(f.node.port.closed, undefined);
      if (mode !== "complete-replay") assert.equal(ready, false);
      if (mode === "partial-drain") {
        late(64);
        complete(192, "inputLost");
      }
      if (mode === "complete-drain") {
        late(128);
        complete(256, "complete");
      }
      if (mode === "context-close") {
        f.context.state = "closed";
        f.context.dispatchEvent(new Event("statechange"));
      }
    }
    const take = await s.ready;
    assert(take);
    assert.equal(
      take.frames,
      mode.startsWith("complete") ? 256 : mode === "partial-drain" ? 192 : 128,
    );
    assert.equal(take.partial, !mode.startsWith("complete"));
    const copy = f.pool.copyPCM(take.id);
    try {
      const values = new Float32Array(copy.buffer);
      assert(values.subarray(0, 128).every((v) => v === 0.25));
      assert(values.subarray(128).every((v) => v === 0.5));
    } finally {
      copy.release();
    }
    if (mode !== "context-close") {
      assert.equal(f.node.port.closed, undefined);
      f.node.send({ type: "closed" });
    }
    await s.closed;
    assert.equal(f.node.port.closed, true);
    callback();
    assert.equal(take.frames, s.take.frames);
  });

for (const boundary of ["worker-receipt", "context-close"])
  test(`unpublished clock refusal retains constructed worker until actual ${boundary}`, async () => {
    const f = fixture(),
      foreign = f.memory.reserve(313, "foreign-owner");
    f.node.parameters.clear();
    let settled = false;
    const opening = CaptureSession.open(f.options),
      rejected = assert.rejects(opening, /workletClockStartMissed/);
    opening.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise((r) => setImmediate(r));
    assert.equal(settled, false);
    assert(f.memory.snapshot().bytes > 313);
    assert(f.node.port.sent.some((m) => m.type === "stop"));
    assert.equal(f.node.port.closed, undefined);
    if (boundary === "worker-receipt") {
      f.node.send({
        type: "complete",
        ...f.plan,
        channels: 1,
        capacity: 256,
        frames: 0,
        reason: "userStop",
        blockSizes: [],
      });
      await new Promise((r) => setImmediate(r));
      assert.equal(settled, false);
      assert(f.memory.snapshot().bytes > 313);
      f.node.send({ type: "closed" });
    } else {
      f.context.state = "closed";
      f.context.dispatchEvent(new Event("statechange"));
    }
    await rejected;
    assert.equal(f.node.port.closed, true);
    assert.equal(f.memory.snapshot().bytes, 313);
    foreign.release();
  });
test("first-fault receipt remains distinct from later native closure and preserves the exact partial PCM", async () => {
  const f = fixture(),
    s = await CaptureSession.open(f.options);
  f.node.send(chunk());
  const fault = {
    code: "captureFrameDiscontinuity",
    expectedFrame: 1128,
    observedFrame: 1256,
    previousFrame: 1000,
    previousBlockSize: 128,
    blockSize: 128,
    capturedFrames: 128,
    callbackCount: 3,
    inputChannels: 1,
  };
  f.node.send({
    type: "complete",
    ...f.plan,
    capacity: 256,
    channels: 1,
    frames: 128,
    reason: "frameGap",
    blockSizes: [128],
    captureFault: fault,
  });
  const take = await s.ready;
  assert.equal(take.frames, 128);
  assert.equal(take.partial, true);
  assert.deepEqual(s.outcome.captureFault, {
    ...fault,
    receivedContextFrame: 0,
    receivedContextState: "running",
  });
  f.node.send({
    type: "closed",
    captureFault: { ...fault, observedFrame: 9999 },
  });
  await s.closed;
  assert.equal(s.outcome.captureFault.observedFrame, 1256);
  const copy = f.pool.copyPCM(take.id);
  try {
    assert(new Float32Array(copy.buffer).every((x) => x === 0.25));
  } finally {
    copy.release();
  }
  f.pool.release(take.id);
  assert.equal(f.memory.snapshot().bytes, 0);
});

test("partial take and worker/native ownership settle independently and never claim durable save", async () => {
  const f = fixture(),
    s = await CaptureSession.open(f.options);
  f.node.send(chunk());
  f.node.send({
    type: "complete",
    ...f.plan,
    capacity: 256,
    channels: 1,
    frames: 128,
    reason: "userStop",
    blockSizes: [128],
  });
  const take = await s.ready;
  assert.equal(take.frames, 128);
  assert.equal(take.partial, true);
  assert.equal(take.persistence, "memory-only");
  assert.ok(f.memory.snapshot().bytes > take.bytes);
  f.node.send({ type: "closed" });
  await s.closed;
  assert.equal(f.memory.snapshot().bytes, take.bytes);
  f.pool.release(take.id);
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("context suspension preserves acknowledged prefix and pending worker budget until closed/ack", async () => {
  const f = fixture(),
    s = await CaptureSession.open(f.options);
  f.node.send(chunk());
  f.context.state = "suspended";
  f.context.dispatchEvent(new Event("statechange"));
  assert.equal(s.take, undefined);
  assert.equal(s.state, "closing");
  assert.ok(f.memory.snapshot().bytes > 256 * 4);
  assert.equal(f.node.disconnected, true);
  f.context.state = "closed";
  f.context.dispatchEvent(new Event("statechange"));
  const t = await s.ready;
  assert.equal(t.reason, "suspended");
  assert.equal(t.frames, 128);
  assert.equal(s.outcome.workerFlushConfirmed, false);
  assert.equal(s.outcome.deliveryProof, "confirmed-context-close-prefix");
  await s.closed;
  assert.equal(f.memory.snapshot().bytes, t.bytes);
  f.pool.release(t.id);
  assert.equal(f.memory.snapshot().bytes, 0);
});

test("suspend defers immutable publication and accepts the ordered late suffix before confirmed close", async () => {
  const f = fixture(),
    s = await CaptureSession.open(f.options);
  const first = chunk();
  first.frames = 127;
  first.buffers = [new Float32Array(127).fill(0.125).buffer];
  f.node.send(first);
  f.context.state = "suspended";
  f.context.dispatchEvent(new Event("statechange"));
  assert.equal(s.take, undefined);
  f.node.send({
    type: "pcm",
    sequence: 1,
    offset: 127,
    frames: 65,
    buffers: [new Float32Array(65).fill(0.75).buffer],
  });
  assert.equal(s.acknowledgedFrames, 192);
  assert.deepEqual(f.node.port.sent.at(-1), { type: "ack", sequence: 1 });
  f.context.state = "closed";
  f.context.dispatchEvent(new Event("statechange"));
  const take = await s.ready;
  assert.equal(take.frames, 192);
  assert.equal(take.partial, true);
  assert.equal(take.reason, "suspended");
  const copy = f.pool.copyPCM(take.id);
  assert.equal(copy.buffer.byteLength, 192 * 4);
  assert([...new Float32Array(copy.buffer, 0, 127)].every((x) => x === 0.125));
  assert([...new Float32Array(copy.buffer, 127 * 4)].every((x) => x === 0.75));
  copy.release();
  await s.closed;
  f.pool.release(take.id);
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("module-load cancellation, foreign memory owner and constructor failure do not leak or arm", async () => {
  const f = fixture(),
    abort = new AbortController();
  let resolve;
  f.context.audioWorklet.addModule = () =>
    new Promise((r) => {
      resolve = r;
    });
  const pending = CaptureSession.open({ ...f.options, signal: abort.signal });
  abort.abort();
  resolve();
  await assert.rejects(pending, /captureCancelled/);
  assert.equal(f.memory.snapshot().bytes, 0);
  await assert.rejects(
    CaptureSession.open({
      ...f.options,
      pool: new TakePool(new AudioMemory()),
    }),
    /invalidCaptureSession/,
  );
  const g = fixture();
  await assert.rejects(
    CaptureSession.open({
      ...g.options,
      nodeFactory() {
        throw Error("native creation failed");
      },
    }),
  );
  assert.equal(g.memory.snapshot().bytes, 0);
});
test("processor error and invalid completion preserve prior takes, resolve and release only terminated worker", async () => {
  const f = fixture(),
    s = await CaptureSession.open(f.options);
  f.node.send(chunk());
  f.node.dispatchEvent(new Event("processorerror"));
  const t = await s.ready;
  await s.closed;
  assert.equal(t.reason, "processorError");
  assert.equal(f.memory.snapshot().bytes, t.bytes);
  f.pool.release(t.id);
  const g = fixture(),
    other = await CaptureSession.open(g.options);
  g.node.send({ type: "complete", frames: 256 });
  assert.equal(await other.ready, null);
  assert.equal(other.state, "closing");
  g.node.send({ type: "closed" });
  await other.closed;
  assert.equal(g.memory.snapshot().bytes, 0);
});

test("failed take adoption reports error instead of a retained take and leaves an earlier recording intact", async () => {
  const f = fixture();
  const reservation = f.pool.reserve({
    capacity: 256,
    channels: 1,
    sampleRate: 48000,
  });
  const previous = f.pool.adopt(
    reservation,
    { ...reservation, startFrame: 0, frames: 256, reason: "complete" },
    [new Float32Array(256).fill(0.5).buffer],
  );
  f.pool.adopt = () => {
    throw Error("simulated transfer failure");
  };
  const s = await CaptureSession.open(f.options);
  f.node.send(chunk());
  f.node.send({
    type: "complete",
    ...f.plan,
    capacity: 256,
    channels: 1,
    frames: 128,
    reason: "userStop",
    blockSizes: [128],
  });
  assert.equal(await s.ready, null);
  assert.equal(s.state, "error");
  assert.equal(s.outcome.reason, "takeAdoptionFailed");
  assert.equal(f.pool.describe(previous.id).peak, 0.5);
  f.node.send({ type: "closed" });
  await s.closed;
  assert.equal(f.memory.snapshot().bytes, previous.bytes);
  f.pool.release(previous.id);
  assert.equal(f.memory.snapshot().bytes, 0);
});
