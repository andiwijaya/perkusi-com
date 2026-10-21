import { fakeWorkletParams } from "./helpers/worklet-frame-clock.js";
import test from "node:test";
import assert from "node:assert/strict";
import { CaptureSession } from "../src/loop-station/capture-session.js";
import { LoopClock } from "../src/loop-station/loop-clock.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { TakePool } from "../src/loop-station/take-pool.js";
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
async function setup(signal) {
  const context = new Context(),
    memory = new AudioMemory(),
    pool = new TakePool(memory),
    transport = new Transport(),
    node = new Node(context),
    foreign = memory.reserve(1234, "other track");
  transport.start(0);
  const plan = { startFrame: 1000, endFrame: 1256, sampleRate: 48000 };
  const session = await CaptureSession.open({
    clock: new LoopClock(context, transport),
    memory,
    pool,
    destination: { context },
    moduleURL: "https://local.test/guard.js",
    plan,
    signal,
    nodeFactory: () => node,
  });
  return { context, memory, pool, transport, node, foreign, plan, session };
}
const fault = () => ({
  type: "playback-error",
  code: "replayFrameDiscontinuity",
  expectedFrame: 1280,
  observedFrame: 1152,
  blockSize: 128,
  previousFrame: 1152,
  previousBlockSize: 128,
});
const chunk = (n = 0) => ({
  type: "pcm",
  sequence: n,
  offset: n * 128,
  frames: 128,
  buffers: [
    Float32Array.from({ length: 128 }, (_, i) => (n * 128 + i - 100) / 512)
      .buffer,
  ],
});
const complete = (f) => ({
  type: "complete",
  ...f.plan,
  frames: 256,
  capacity: 256,
  channels: 1,
  reason: "complete",
  blockSizes: [128],
});
async function release(f, take) {
  f.node.send({ type: "closed" });
  await f.session.closed;
  assert.equal(f.session.state, "closed");
  assert.equal(f.context.state, "running");
  assert.equal(f.transport.origin, 0);
  assert.equal(f.transport.running, true);
  assert.equal(f.transport.position, 0);
  assert.equal(f.memory.snapshot().bytes, 1234 + (take?.bytes ?? 0));
  if (take) {
    const copy = f.pool.copyToAudioBuffer(take.id, {
      sampleRate: 48000,
      createBuffer: (_, length) => ({
        getChannelData: () => new Float32Array(length),
        copyToChannel(data) {
          this.values = [...data];
        },
      }),
    });
    for (let i = 0; i < 256; i++)
      assert.equal(copy.buffer.values[i], (i - 100) / 512);
    copy.release();
    f.pool.release(take.id);
  }
  f.foreign.release();
  assert.equal(f.memory.snapshot().bytes, 0);
}
for (const phase of [
  "before-chunks",
  "between-chunks",
  "before-complete",
  "after-ready",
]) {
  test(`replay fault ${phase} preserves complete take and cannot revive looping`, async () => {
    const f = await setup(),
      s = f.session;
    let readyCalls = 0;
    s.ready.then(() => readyCalls++);
    if (phase === "before-chunks") f.node.send(fault());
    f.node.send(chunk());
    if (phase === "between-chunks") f.node.send(fault());
    f.node.send(chunk(1));
    if (phase === "before-complete") f.node.send(fault());
    f.node.send(complete(f));
    const take = await s.ready;
    if (phase === "after-ready") {
      assert.equal(s.state, "looping");
      f.node.send(fault());
    }
    assert.equal(s.state, "error");
    assert.equal(take.partial, false);
    assert.equal(s.outcome.reason, "complete");
    assert.equal((await s.playbackFault).code, "replayFrameDiscontinuity");
    assert.equal(s.playbackOutcome, await s.playbackFault);
    assert.ok(Object.isFrozen(s.playbackOutcome));
    assert.equal(f.node.disconnected, true);
    assert.ok(f.memory.snapshot().bytes > 1234 + take.bytes);
    f.node.send({ type: "started", frame: 1000 });
    f.node.send(complete(f));
    f.node.send(fault());
    assert.equal(s.state, "error");
    assert.equal(f.pool.snapshot().length, 1);
    assert.equal(readyCalls, 1);
    await release(f, take);
    f.node.send(complete(f));
    assert.equal(s.state, "closed");
    assert.equal(s.playbackOutcome.code, "replayFrameDiscontinuity");
  });
}

test("late PCM cannot revive a fault state before the completion receipt", async () => {
  const f = await setup();
  f.node.send(fault());
  f.node.send(chunk());
  assert.equal(f.session.state, "error");
  f.node.send(chunk(1));
  assert.equal(f.session.state, "error");
  f.node.send(complete(f));
  await release(f, await f.session.ready);
});

test("stop is synchronous/idempotent, drains complete receipt without revival, and normal close settles no playback fault", async () => {
  const f = await setup(),
    s = f.session;
  f.node.send(chunk());
  const a = s.stop(),
    b = s.stop();
  assert.equal(a, b);
  assert.equal(f.node.port.sent.filter((m) => m.type === "stop").length, 1);
  f.node.send({ type: "started", frame: 1000 });
  f.node.send(chunk(1));
  assert.equal(s.state, "closing");
  f.node.send(complete(f));
  const take = await s.ready;
  assert.equal(s.state, "closing");
  assert.equal(take.partial, false);
  await release(f, take);
  assert.equal(await s.playbackFault, null);
});

for (const event of ["suspended", "closed", "processorerror"]) {
  test(`fault racing ${event} retains only acknowledged prefix and holds lease until termination`, async () => {
    const f = await setup();
    f.node.send(fault());
    f.node.send(chunk());
    if (event === "processorerror") f.node.dispatchEvent(new Event(event));
    else {
      f.context.state = event;
      f.context.dispatchEvent(new Event("statechange"));
    }
    if (event === "suspended") {
      assert.equal(f.session.take, undefined);
      assert.ok(f.memory.snapshot().bytes > 1234 + 256 * 4);
      f.context.state = "closed";
      f.context.dispatchEvent(new Event("statechange"));
    }
    const take = await f.session.ready;
    assert.equal(take.frames, 128);
    assert.equal(take.partial, true);
    assert.equal(f.session.playbackOutcome.code, "replayFrameDiscontinuity");
    await f.session.closed;
    assert.equal(f.memory.snapshot().bytes, 1234 + take.bytes);
    f.pool.release(take.id);
    f.foreign.release();
    assert.equal(f.memory.snapshot().bytes, 0);
  });
}

test("fault before complete plus failed adoption cannot expose an unretained loop or free a live worker", async () => {
  const f = await setup();
  f.pool.adopt = () => {
    throw Error("transfer failure");
  };
  f.node.send(fault());
  f.node.send(chunk());
  f.node.send(chunk(1));
  f.node.send(complete(f));
  assert.equal(await f.session.ready, null);
  assert.equal(f.session.outcome.reason, "takeAdoptionFailed");
  assert.equal(f.session.state, "error");
  assert.ok(f.memory.snapshot().bytes > 1234);
  await release(f, null);
});

test("malformed replay fault is refused; invalid observed frame is a valid explicit fault", async () => {
  const f = await setup();
  f.node.send({ ...fault(), previousBlockSize: 0 });
  assert.equal(await f.session.ready, null);
  assert.equal(f.session.outcome.reason, "protocolError");
  await release(f, null);
  const g = await setup();
  g.node.send({ ...fault(), observedFrame: null });
  g.node.send(chunk());
  g.node.send(chunk(1));
  g.node.send(complete(g));
  assert.equal((await g.session.playbackFault).observedFrame, null);
  await release(g, await g.session.ready);
});

test("fresh session is the recovery epoch; terminal owner cannot acquire or revive after close", async () => {
  const f = await setup();
  f.node.send(fault());
  f.node.send(chunk());
  f.node.send(chunk(1));
  f.node.send(complete(f));
  await release(f, await f.session.ready);
  const before = f.memory.snapshot().highWaterBytes;
  f.node.send(chunk());
  f.node.send({ type: "started", frame: 1000 });
  assert.equal(f.session.state, "closed");
  assert.equal(f.memory.snapshot().highWaterBytes, before);
  const g = await setup();
  g.node.send(chunk());
  g.node.send(chunk(1));
  g.node.send(complete(g));
  assert.equal(g.session.state, "looping");
  assert.equal(g.session.playbackOutcome, null);
  await release(g, await g.session.ready);
});

test("abort racing a replay fault cannot revive playback or discard a valid complete receipt", async () => {
  for (const first of ["abort", "fault"]) {
    const abort = new AbortController(),
      f = await setup(abort.signal);
    f.node.send(chunk());
    if (first === "abort") abort.abort();
    f.node.send(fault());
    if (first === "fault") abort.abort();
    f.node.send(chunk(1));
    f.node.send(complete(f));
    const take = await f.session.ready;
    assert.equal(take.partial, false);
    assert.equal(f.session.state, "error");
    assert.equal(f.session.playbackOutcome.code, "replayFrameDiscontinuity");
    await release(f, take);
  }
});

test("same caller context, transport and pool can admit a fresh recovery epoch without changing retained takes", async () => {
  const f = await setup();
  f.node.send(fault());
  f.node.send(chunk());
  f.node.send(chunk(1));
  f.node.send(complete(f));
  const oldTake = await f.session.ready;
  f.node.send({ type: "closed" });
  await f.session.closed;
  assert.equal(f.context.state, "running");
  const node = new Node(f.context),
    plan = { startFrame: 2000, endFrame: 2256, sampleRate: 48000 },
    recovered = await CaptureSession.open({
      clock: new LoopClock(f.context, f.transport),
      memory: f.memory,
      pool: f.pool,
      destination: { context: f.context },
      moduleURL: "https://local.test/guard.js",
      plan,
      nodeFactory: () => node,
    });
  node.send(chunk());
  node.send(chunk(1));
  node.send(complete({ plan }));
  const next = await recovered.ready;
  assert.equal(recovered.state, "looping");
  assert.equal(recovered.playbackOutcome, null);
  assert.equal(f.pool.describe(oldTake.id).reason, "complete");
  assert.equal(f.pool.snapshot().length, 2);
  assert.equal(f.transport.origin, 0);
  assert.equal(f.transport.running, true);
  recovered.stop();
  node.send({ type: "closed" });
  await recovered.closed;
  assert.equal(f.memory.snapshot().bytes, 1234 + oldTake.bytes + next.bytes);
  f.pool.release(oldTake.id);
  f.pool.release(next.id);
  f.foreign.release();
  assert.equal(f.memory.snapshot().bytes, 0);
});
