import { fakeWorkletParams } from "./helpers/worklet-frame-clock.js";
import test from "node:test";
import assert from "node:assert/strict";
import { RootCaptureCoordinator } from "../src/loop-station/capture-coordinator.js";
import { CaptureSession } from "../src/loop-station/capture-session.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { TakePool } from "../src/loop-station/take-pool.js";
import { Transport } from "../src/audio/transport.js";
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const tick = () => new Promise((r) => setImmediate(r));
class Node extends EventTarget {
  constructor(context) {
    super();
    this.context = context;
    this.parameters = fakeWorkletParams();
    this.connections = new Set();
    this.gain = { value: 1 };
    this.sent = [];
    this.port = {
      postMessage: (m) => this.sent.push(m),
      close: () => {
        this.portClosed = true;
      },
    };
  }
  connect(node) {
    this.connections.add(node);
    return node;
  }
  disconnect(node) {
    if (this.failDisconnect) throw Error("disconnect failure");
    if (node) this.connections.delete(node);
    else this.connections.clear();
  }
  send(m) {
    this.port.onmessage?.({ data: m });
  }
}
class Context extends EventTarget {
  state = "running";
  sampleRate = 48000;
  currentTime = 0;
  constructor() {
    super();
    this.gains = [];
    this.audioWorklet = {
      addModule: async () => {
        if (this.moduleGate) await this.moduleGate.promise;
      },
    };
  }
  createGain() {
    const n = new Node(this);
    this.gains.push(n);
    return n;
  }
  createBuffer(channels, frames, rate) {
    const a = Array.from({ length: channels }, () => new Float32Array(frames));
    return {
      sampleRate: rate,
      getChannelData: (c) => a[c],
      copyToChannel: (v, c) => a[c].set(v),
    };
  }
}
function fixture({ replay = true } = {}) {
  const f = {
    context: new Context(),
    nodes: [],
    sourceCalls: 0,
    sourceReleases: 0,
    brokenRelease: false,
  };
  f.memory = new AudioMemory();
  f.foreign = f.memory.reserve(1234, "foreign-ordinary-track");
  f.pool = new TakePool(f.memory);
  f.transport = new Transport({ bpm: 11520000 / 66590 });
  f.master = f.context.createGain();
  f.foreignNode = new Node(f.context);
  f.foreignNode.connect(f.master);
  f.input = new Node(f.context);
  f.project = {
    format: "perkusi-project",
    schemaVersion: 5,
    mode: "loop-station",
    title: "QA owner",
    timing: { bpm: 173, meter: [4, 4] },
    master: { volume: 1 },
    origins: [],
    assetRefs: [],
    tracks: [],
  };
  f.root = {
    engine: {
      context: f.context,
      master: f.master,
      output: f.master,
      transport: f.transport,
    },
    transport: f.transport,
    memory: f.memory,
    pool: f.pool,
    output: f.master,
    project: f.project,
    headroom: () => ({ peak: 0.01, voices: 1 }),
  };
  f.source = {
    kind: "qualified-finite-synthetic",
    context: f.context,
    memory: f.memory,
    sampleRate: 48000,
    framesPerBar: 66590,
    preGain: true,
    referenceSHA256: "a".repeat(64),
    generation: 0,
    estimatedBytes: 2048,
    voices: 1,
    peak: 0.1,
    isCurrent: () => true,
    async prepare() {
      f.sourceCalls++;
      const lease = f.memory.reserve(2048, "synthetic-source-pin");
      if (f.sourceGate) await f.sourceGate.promise;
      return {
        input: f.input,
        memory: f.memory,
        generation: 0,
        startFrame: 0,
        endFrame: 786432,
        release() {
          if (f.brokenRelease && f.context.state !== "closed")
            throw Error("source release unconfirmed");
          lease.release();
          f.sourceReleases++;
        },
      };
    },
  };
  f.owner = new RootCaptureCoordinator({
    enabled: true,
    replay,
    root: f.root,
    moduleURL: "https://qa.test/capture.js",
    openSession: (o) =>
      CaptureSession.open({
        ...o,
        nodeFactory: (c, options) => {
          const n = new Node(c);
          n.options = options;
          f.nodes.push(n);
          f.onNode?.(n);
          return n;
        },
      }),
  });
  f.transport.start(1);
  f.arm = () =>
    f.owner.arm("selected", { source: f.source, gain: 0.5, bars: 1 });
  f.closeNode = (n, reason = "userStop", frames = 0) => {
    const p = n.options.processorOptions;
    n.send({
      type: "complete",
      ...p,
      capacity: p.endFrame - p.startFrame,
      frames,
      reason,
      blockSizes: [128],
    });
    n.send({ type: "closed" });
  };
  return f;
}

test("record-only coordination admits a silent capture node without hiding foreign peak or voice limits", async () => {
  const f = fixture({ replay: false });
  f.root.headroom = () => ({ peak: 0.9, voices: 14 });
  f.source.peak = 0.4;
  const h = f.arm();
  await h.prepared;
  assert.equal(f.nodes[0].options.processorOptions.replay, false);
  const stopped = h.stop();
  f.closeNode(f.nodes[0]);
  await stopped;
  await f.owner.dispose();
  assert.equal(f.memory.snapshot().bytes, 1234);
  f.foreign.release();
  for (const unsafe of [
    { peak: 0.96, voices: 1 },
    { peak: 0.1, voices: 16 },
  ]) {
    const g = fixture({ replay: false });
    g.root.headroom = () => unsafe;
    assert.throws(
      () => g.arm(),
      (e) => e.code === "captureHeadroom",
    );
    assert.equal(g.nodes.length, 0);
    await g.owner.dispose();
    assert.equal(g.memory.snapshot().bytes, 1234);
    g.foreign.release();
  }
});
function chunk(node, offset, count, sequence, value = 0.125) {
  node.send({
    type: "pcm",
    sequence,
    offset,
    frames: count,
    buffers: [new Float32Array(count).fill(value).buffer],
  });
}
async function complete(f, h) {
  await h.prepared;
  const n = f.nodes.at(-1),
    L = h.plan.endFrame - h.plan.startFrame;
  for (let at = 0, s = 0; at < L; s++) {
    const count = Math.min(4096, L - at);
    chunk(n, at, count, s);
    at += count;
  }
  const p = n.options.processorOptions;
  n.send({
    type: "complete",
    ...p,
    capacity: L,
    frames: L,
    reason: "complete",
    blockSizes: [128],
  });
  return await h.ready;
}
async function cleanup(f) {
  for (const n of f.nodes) if (!n.portClosed) f.closeNode(n);
  await f.owner.dispose();
  assert.equal(f.context.state, "running");
  assert.equal(f.memory.snapshot().bytes, 1234);
  assert.equal(f.foreignNode.connections.has(f.master), true);
  f.foreign.release();
  assert.equal(f.memory.snapshot().bytes, 0);
}
test("explicit internal opt-in, stopped/fixed clock and caller identity required", async () => {
  const f = fixture();
  assert.throws(
    () => new RootCaptureCoordinator({ root: f.root, moduleURL: "x" }),
    { code: "invalidCaptureOwner" },
  );
  await cleanup(f);
});
test("one returned real plan, pre-gain input and one selected gain route", async () => {
  const f = fixture(),
    before = JSON.stringify(f.project),
    h = f.arm();
  await h.prepared;
  assert.equal(h.plan.startFrame, 48000);
  assert.equal(h.plan.endFrame, 114590);
  assert.equal(h.output.gain.value, 0.5);
  assert.equal(h.output.connections.size, 1);
  assert.ok(h.output.connections.has(f.master));
  assert.ok(f.input.connections.has(h.node));
  assert.equal(JSON.stringify(f.project), before);
  h.stop();
  f.closeNode(f.nodes[0]);
  await h.closed;
  assert.equal(f.sourceReleases, 1);
  await cleanup(f);
});

test("live waveform progress exposes accepted frames before any terminal outcome is published", async () => {
  const f = fixture(),
    h = f.arm();
  await h.prepared;
  const n = f.nodes.at(-1);
  assert.equal(h.outcome, undefined);
  assert.equal(h.acknowledgedFrames, 0);
  chunk(n, 0, 128, 0, 0.125);
  assert.equal(h.outcome, undefined);
  assert.equal(h.acknowledgedFrames, 128);
  assert.equal(h.waveform().frames, 128);
  chunk(n, 128, 256, 1, -0.25);
  assert.equal(h.acknowledgedFrames, 384);
  const wave = h.waveform(128);
  assert.equal(wave.frames, 384);
  assert.equal(wave.fromFrame, 128);
  h.stop();
  f.closeNode(n, 384);
  await h.closed;
  assert.equal(h.take.frames, 384);
  assert.equal(h.acknowledgedFrames, 384);
  f.owner.releaseTake(h.take.id);
  await cleanup(f);
});
for (const kind of ["stop", "seek", "import", "navigation", "dispose"]) {
  test(`root ${kind} installs terminal admission before delayed preparation/action await`, async () => {
    const f = fixture();
    f.sourceGate = deferred();
    const h = f.arm();
    await tick();
    assert.equal(f.sourceCalls, 1);
    let terminal = false;
    const done = f.owner.rootIntent(kind, () => {
      terminal = !f.owner.admission;
      assert.throws(() => f.arm(), { code: "captureOwnerTerminal" });
    });
    assert.ok(terminal);
    assert.equal(f.nodes.length, 0);
    f.sourceGate.resolve();
    await assert.rejects(h.prepared, { code: "captureCancelled" });
    await done;
    assert.equal(f.sourceReleases, 1);
    assert.equal(f.memory.snapshot().bytes, 1234);
    await cleanup(f);
  });
}
test("cancellation in the same stack prevents source admission entirely", async () => {
  const f = fixture(),
    h = f.arm(),
    done = f.owner.rootIntent("stop");
  await assert.rejects(h.prepared, { code: "captureCancelled" });
  await done;
  assert.equal(f.sourceCalls, 0);
  await cleanup(f);
});
test("module completion after cancellation cannot create a worker or route revival", async () => {
  const f = fixture();
  f.context.moduleGate = deferred();
  const h = f.arm();
  await tick();
  assert.equal(f.nodes.length, 0);
  h.stop();
  f.context.moduleGate.resolve();
  await assert.rejects(h.prepared, { code: "captureCancelled" });
  await h.closed;
  assert.equal(f.nodes.length, 0);
  assert.equal(f.memory.snapshot().bytes, 1234);
  await cleanup(f);
});
test("construction racing root navigation drains newly returned session without input connection", async () => {
  const f = fixture();
  f.onNode = () => {
    void f.owner.rootIntent("navigation");
  };
  const h = f.arm();
  await tick();
  assert.equal(f.nodes.length, 1);
  assert.equal(f.input.connections.size, 0);
  assert.equal(f.nodes[0].sent.filter((x) => x.type === "stop").length, 1);
  f.closeNode(f.nodes[0]);
  await assert.rejects(h.prepared, { code: "captureCancelled" });
  await h.closed;
  await cleanup(f);
});
test("local double stop preserves foreign graph/context/transport and holds worker until ack", async () => {
  const f = fixture(),
    h = f.arm();
  await h.prepared;
  const before = f.memory.snapshot().bytes,
    a = h.stop(),
    b = h.stop();
  assert.equal(a, b);
  assert.equal(f.nodes[0].sent.filter((x) => x.type === "stop").length, 1);
  assert.equal(f.memory.snapshot().bytes, before);
  assert.equal(f.transport.running, true);
  assert.equal(f.transport.origin, 1);
  assert.equal(f.foreignNode.connections.has(f.master), true);
  f.closeNode(f.nodes[0]);
  await a;
  assert.equal(f.memory.snapshot().bytes, 1234);
  await cleanup(f);
});
test("late started/PCM/complete after cancel retain original once but never restart looping", async () => {
  const f = fixture(),
    h = f.arm();
  await h.prepared;
  h.stop();
  const take = await complete(f, h);
  assert.ok(take && !take.partial);
  assert.equal(h.state, "closing");
  f.nodes[0].send({ type: "started", frame: h.plan.startFrame });
  assert.equal(h.state, "closing");
  assert.equal(f.pool.snapshot().length, 1);
  assert.throws(() => f.pool.release(take.id), { code: "takeHeld" });
  f.nodes[0].send({ type: "closed" });
  await h.closed;
  f.nodes[0].send({ type: "complete" });
  assert.equal(h.state, "closed");
  assert.equal(f.pool.snapshot().length, 1);
  f.owner.releaseTake(take.id);
  await cleanup(f);
});
test("native receipt inputLost remains partial/memory-only and never auto-enters history", async () => {
  const f = fixture(),
    h = f.arm();
  await h.prepared;
  chunk(f.nodes[0], 0, 128, 0, 0);
  f.closeNode(f.nodes[0], "inputLost", 128);
  const take = await h.ready;
  await h.closed;
  assert.equal(take.partial, true);
  assert.equal(h.outcome.reason, "inputLost");
  assert.equal(take.frames, 128);
  assert.equal(h.persistence, "memory-only");
  assert.equal(f.owner.project.assetRefs.length, 0);
  await cleanup(f);
});
test("first capture fault carries a bounded context/transport/graph timeline without applying its partial take", async () => {
  const f = fixture(),
    h = f.arm();
  await h.prepared;
  for (let n = 0; n < 24; n++)
    f.context.dispatchEvent(new Event("statechange"));
  chunk(f.nodes[0], 0, 128, 0, 0.125);
  const p = f.nodes[0].options.processorOptions,
    fault = {
      code: "captureFrameDiscontinuity",
      expectedFrame: p.startFrame + 128,
      observedFrame: p.startFrame + 256,
      previousFrame: p.startFrame,
      previousBlockSize: 128,
      blockSize: 128,
      capturedFrames: 128,
      callbackCount: 3,
      inputChannels: 1,
    };
  f.nodes[0].send({
    type: "complete",
    ...p,
    capacity: p.endFrame - p.startFrame,
    frames: 128,
    reason: "frameGap",
    blockSizes: [128],
    captureFault: fault,
  });
  f.nodes[0].send({ type: "closed" });
  const take = await h.ready;
  await h.closed;
  assert.equal(take.partial, true);
  assert.equal(take.frames, 128);
  assert.equal(h.outcome.captureFault.expectedFrame, p.startFrame + 128);
  const d = h.outcome.captureDiagnostics;
  assert.equal(d.timeline.length, 16);
  assert(d.droppedTraceEvents > 0);
  assert(
    d.timeline.some(
      (e) =>
        e.event === "input-connected" && e.inputConnected && e.transportRunning,
    ),
  );
  assert.equal(d.generation, 0);
  assert.equal(d.sourceGeneration, 0);
  assert(Object.isFrozen(d.timeline));
  assert.equal(f.owner.project.assetRefs.length, 0);
  const copy = f.pool.copyPCM(take.id);
  try {
    assert(new Float32Array(copy.buffer).every((x) => x === 0.125));
  } finally {
    copy.release();
  }
  await cleanup(f);
});
test("completed original survives replay fault; outcome/fault distinct and late messages terminal", async () => {
  const f = fixture(),
    h = f.arm(),
    take = await complete(f, h);
  f.nodes[0].send({
    type: "playback-error",
    code: "replayFrameDiscontinuity",
    expectedFrame: 114816,
    observedFrame: 114688,
    blockSize: 128,
    previousFrame: 114688,
    previousBlockSize: 128,
  });
  assert.equal((await h.playbackFault).code, "replayFrameDiscontinuity");
  assert.equal(h.outcome.reason, "complete");
  assert.equal(take.partial, false);
  assert.equal(h.output.connections.size, 0);
  f.nodes[0].send({ type: "closed" });
  await h.closed;
  assert.equal(f.pool.describe(take.id).reason, "complete");
  await cleanup(f);
});
test("adoption failure stops output, yields no invented take and retains worker through close", async () => {
  const f = fixture(),
    h = f.arm();
  await h.prepared;
  const adopt = f.pool.adopt;
  f.pool.adopt = () => {
    throw Error("adoption");
  };
  assert.equal(await complete(f, h), null);
  assert.equal(h.outcome.reason, "takeAdoptionFailed");
  assert.ok(f.memory.snapshot().bytes > 1234);
  f.nodes[0].send({ type: "closed" });
  await h.closed;
  f.pool.adopt = adopt;
  assert.equal(f.pool.snapshot().length, 0);
  await cleanup(f);
});
test("same caller context/transport/pool accepts new explicit epoch with original pinned", async () => {
  const f = fixture(),
    first = f.arm(),
    take = await complete(f, first);
  first.stop();
  f.nodes[0].send({ type: "closed" });
  await first.closed;
  await f.owner.rootIntent("stop");
  f.owner.beginEpoch();
  const next = f.arm();
  await next.prepared;
  assert.throws(() => f.pool.release(take.id), { code: "takeHeld" });
  next.stop();
  f.closeNode(f.nodes[1]);
  await next.closed;
  assert.equal(f.pool.describe(take.id).reason, "complete");
  assert.equal(f.context.state, "running");
  await cleanup(f);
});
test("tempo/transport/context/source generation changes during prep refuse without retime", async () => {
  for (const change of [
    (f) => f.transport.pause(0),
    (f) => (f.transport.origin += 1),
    (f) => (f.transport.beatSeconds += 0.001),
    (f) => f.source.generation++,
    (f) => (f.root.engine.disposed = true),
  ]) {
    const f = fixture();
    f.sourceGate = deferred();
    const h = f.arm();
    await tick();
    change(f);
    f.sourceGate.resolve();
    await assert.rejects(h.prepared, { code: "captureCancelled" });
    await h.closed;
    assert.equal(f.nodes.length, 0);
    await cleanup(f);
  }
});
test("changed/imported project is preserved and requires a new owner", async () => {
  const f = fixture();
  await f.owner.rootIntent("import", () => {
    f.root.project = { ...f.project, title: "new caller data" };
  });
  assert.throws(() => f.owner.beginEpoch(), { code: "captureProjectChanged" });
  assert.equal(f.root.project.title, "new caller data");
  await cleanup(f);
});
test("incompatible recorded rate/period is rejected without altering imported data", async () => {
  const f = fixture();
  await f.owner.dispose();
  f.transport.reset();
  const project = {
    ...f.project,
    clock: { kind: "fixed-bar", sampleRate: 44100, framesPerBar: 61179 },
  };
  const text = JSON.stringify(project);
  assert.throws(
    () =>
      new RootCaptureCoordinator({
        root: { ...f.root, project },
        enabled: true,
        moduleURL: "x",
      }),
  );
  assert.equal(JSON.stringify(project), text);
  f.foreign.release();
});
test("memory refusal before prepare/allocation leaves foreign leases untouched", async () => {
  const f = fixture(),
    held = f.memory.reserve(66550000, "foreign-large");
  assert.throws(() => f.arm(), { code: "combinedMemoryLimit" });
  assert.equal(f.sourceCalls, 0);
  assert.equal(f.nodes.length, 0);
  held.release();
  await cleanup(f);
});
test("headroom/voice admission refuses before creating selected route", async () => {
  for (const headroom of [
    { peak: 0.95, voices: 1 },
    { peak: 0, voices: 16 },
  ]) {
    const f = fixture();
    f.root.headroom = () => headroom;
    assert.throws(() => f.arm(), { code: "captureHeadroom" });
    assert.equal(f.sourceCalls, 0);
    await cleanup(f);
  }
});
test("foreign allocation arriving during source prep is not evicted or double charged", async () => {
  const f = fixture();
  f.sourceGate = deferred();
  const h = f.arm();
  await tick();
  const held = f.memory.reserve(66550000, "foreign-late");
  f.sourceGate.resolve();
  await assert.rejects(h.prepared, { code: "combinedMemoryLimit" });
  await h.closed;
  assert.equal(f.memory.snapshot().bytes, 66551234);
  held.release();
  await cleanup(f);
});
for (const kind of ["stop", "seek", "import", "navigation", "dispose"])
  for (const phase of ["armed", "recording", "replay"]) {
    test(`root ${kind} during ${phase} closes only selected owner, late receipts cannot revive`, async () => {
      const f = fixture(),
        h = f.arm();
      await h.prepared;
      if (phase === "recording") {
        f.nodes[0].send({ type: "started", frame: h.plan.startFrame });
        chunk(f.nodes[0], 0, 128, 0);
      }
      if (phase === "replay") await complete(f, h);
      const closed =
        kind === "dispose" ? f.owner.dispose() : f.owner.rootIntent(kind);
      assert.equal(f.owner.admission, false);
      assert.equal(h.output.connections.size, 0);
      f.nodes[0].send({ type: "started", frame: h.plan.startFrame });
      assert.equal(h.state, "closing");
      f.closeNode(f.nodes[0], "userStop", phase === "recording" ? 128 : 0);
      await closed;
      await h.closed;
      assert.equal(h.state, "closed");
      assert.equal(f.foreignNode.connections.has(f.master), true);
      assert.equal(f.transport.running, true);
      await cleanup(f);
    });
  }
test("missed source preparation deadline refuses rather than selecting another plan", async () => {
  const f = fixture();
  f.sourceGate = deferred();
  const h = f.arm();
  await tick();
  f.context.currentTime = 2;
  f.sourceGate.resolve();
  await assert.rejects(h.prepared, { code: "captureStartMissed" });
  await h.closed;
  assert.equal(f.nodes.length, 0);
  await cleanup(f);
});
test("foreign history pin survives coordinator disposal and retains its original bytes", async () => {
  const f = fixture(),
    h = f.arm(),
    take = await complete(f, h),
    other = { id: "foreign-history" };
  h.stop();
  f.nodes[0].send({ type: "closed" });
  await h.closed;
  f.pool.pin(take.id, other);
  await f.owner.dispose();
  assert.equal(f.pool.describe(take.id).reason, "complete");
  assert.equal(f.pool.snapshot()[0].pins, 1);
  assert.equal(f.memory.snapshot().bytes, 1234 + take.bytes);
  f.pool.unpin(take.id, other);
  f.pool.release(take.id);
  f.foreign.release();
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("mixed-master input and unknown source role refuse without foreign rewiring", async () => {
  const f = fixture();
  f.source.kind = "unknown";
  assert.throws(() => f.arm(), { code: "invalidCaptureSource" });
  f.source.kind = "qualified-finite-synthetic";
  f.input = f.master;
  const h = f.arm();
  await assert.rejects(h.prepared, { code: "invalidCaptureSourceLease" });
  await h.closed;
  await cleanup(f);
});
test("dispose is terminal/shared before observer reentry and never closes caller context", async () => {
  const f = fixture(),
    h = f.arm();
  await h.prepared;
  let reentered;
  f.owner.subscribe((s) => {
    if (s.closing && !reentered) reentered = f.owner.dispose();
  });
  const a = f.owner.dispose();
  assert.equal(reentered, a);
  assert.equal(f.owner.dispose(), a);
  assert.throws(() => f.arm(), { code: "captureOwnerTerminal" });
  f.closeNode(f.nodes[0]);
  await a;
  assert.equal(f.context.state, "running");
  f.foreign.release();
});
test("unconfirmed source cleanup remains terminal and keeps route lease until caller close", async () => {
  const f = fixture(),
    h = f.arm();
  await h.prepared;
  f.brokenRelease = true;
  h.stop();
  f.closeNode(f.nodes[0]);
  await assert.rejects(h.closed, /unconfirmed/);
  assert.equal(h.state, "closing-error");
  assert.ok(
    f.memory
      .snapshot()
      .owners.some((x) => x.label === "root-capture-selected-route"),
  );
  await assert.rejects(f.owner.dispose(), /unconfirmed/);
  f.context.state = "closed";
  f.context.dispatchEvent(new Event("statechange"));
  await f.owner.retryCleanupAfterContextClose();
  assert.equal(f.owner.disposed, true);
  assert.equal(f.memory.snapshot().bytes, 1234);
  f.foreign.release();
});

for (const [name, foreign] of [
  ["peak", { peak: 0.95, voices: 1 }],
  ["voices", { peak: 0, voices: 16 }],
]) {
  test(`late foreign ${name} during module await refuses before input and holds all leases until closed`, async () => {
    const f = fixture();
    f.context.moduleGate = deferred();
    const h = f.arm();
    try {
      await tick();
      assert.equal(f.nodes.length, 0);
      const beforeModule = f.memory.snapshot().bytes;
      const reserved =
        beforeModule + 8 * (h.plan.endFrame - h.plan.startFrame) + 45056;
      assert.ok(beforeModule > 1234 + 2048);
      f.root.headroom = () => foreign;
      f.context.moduleGate.resolve();
      const result = await h.prepared.then(
        () => ({ accepted: true }),
        (error) => ({ error }),
      );
      assert.equal(result.error?.code, "captureHeadroom");
      assert.equal(f.nodes.length, 1);
      const node = f.nodes[0];
      assert.equal(f.input.connections.size, 0);
      assert.equal(h.output.connections.size, 0);
      assert.equal(node.sent.filter((m) => m.type === "stop").length, 1);
      assert.equal(h.state, "closing");
      assert.equal(f.sourceReleases, 0);
      assert.equal(f.memory.snapshot().bytes, reserved);
      let closed = false;
      void h.closed.then(() => {
        closed = true;
      });
      await tick();
      assert.equal(closed, false);
      node.send({ type: "started", frame: h.plan.startFrame });
      assert.equal(h.state, "closing");
      assert.equal(f.input.connections.size, 0);
      assert.equal(h.output.connections.size, 0);
      assert.equal(f.foreignNode.connections.has(f.master), true);
      assert.equal(f.transport.running, true);
      f.closeNode(node);
      await h.closed;
      assert.equal(f.sourceReleases, 1);
      assert.equal(f.memory.snapshot().bytes, 1234);
      assert.equal(f.root.headroom(), foreign);
    } finally {
      f.context.moduleGate.resolve();
      await cleanup(f);
    }
  });
}

test("late headroom admission permits exact limits without reserving session memory twice", async () => {
  const f = fixture();
  f.context.moduleGate = deferred();
  const h = f.arm();
  let held, heldBytes;
  try {
    await tick();
    // CaptureSession reserves its pool/window after addModule finishes.
    heldBytes =
      f.memory.snapshot().maxBytes -
      f.memory.snapshot().bytes -
      (8 * (h.plan.endFrame - h.plan.startFrame) + 45056);
    held = f.memory.reserve(heldBytes, "foreign-fills-remaining-budget");
    f.root.headroom = () => ({ peak: 0.9125, voices: 15 });
    f.context.moduleGate.resolve();
    await h.prepared;
    assert.equal(f.memory.snapshot().bytes, f.memory.snapshot().maxBytes);
    assert.equal(f.input.connections.has(h.node), true);
    h.stop();
    f.closeNode(f.nodes[0]);
    await h.closed;
    assert.equal(f.memory.snapshot().bytes, 1234 + heldBytes);
  } finally {
    f.context.moduleGate.resolve();
    held?.release();
    await cleanup(f);
  }
});

for (const [name, bounds] of [
  ["missing start", { startFrame: undefined }],
  ["NaN start", { startFrame: NaN }],
  ["infinite start", { startFrame: Infinity }],
  ["negative infinite start", { startFrame: -Infinity }],
  ["negative start", { startFrame: -1 }],
  ["fractional start", { startFrame: 0.5 }],
  ["unsafe start", { startFrame: Number.MAX_SAFE_INTEGER + 1 }],
  ["missing end", { endFrame: undefined }],
  ["NaN end", { endFrame: NaN }],
  ["infinite end", { endFrame: Infinity }],
  ["negative infinite end", { endFrame: -Infinity }],
  ["negative end", { endFrame: -1 }],
  ["fractional end", { endFrame: 786432.5 }],
  ["unsafe end", { endFrame: Number.MAX_SAFE_INTEGER + 1 }],
  ["empty interval", { startFrame: 48000, endFrame: 48000 }],
  ["reversed interval", { startFrame: 48000, endFrame: 47999 }],
  ["late start", { startFrame: 48001 }],
  ["honestly short finite end", { endFrame: 114589 }],
]) {
  test(`finite lease rejects ${name} before route/session allocation`, async () => {
    const f = fixture(),
      prepare = f.source.prepare;
    f.source.prepare = async (...args) => ({
      ...(await prepare(...args)),
      ...bounds,
    });
    const h = f.arm();
    try {
      const result = await h.prepared.then(
        () => ({ accepted: true }),
        (error) => ({ error }),
      );
      assert.equal(result.error?.code, "invalidCaptureSourceLease");
      await h.closed;
      assert.equal(f.nodes.length, 0);
      assert.equal(f.context.gains.length, 1);
      assert.equal(f.input.connections.size, 0);
      assert.equal(f.sourceReleases, 1);
      assert.equal(f.memory.snapshot().bytes, 1234);
    } finally {
      await cleanup(f);
    }
  });
}

test("finite lease admits exact nonnegative integral coverage", async () => {
  const f = fixture(),
    prepare = f.source.prepare;
  f.source.prepare = async (...args) => ({
    ...(await prepare(...args)),
    startFrame: 48000,
    endFrame: 114590,
  });
  const h = f.arm();
  try {
    await h.prepared;
    assert.equal(f.input.connections.has(h.node), true);
    h.stop();
    f.closeNode(f.nodes[0]);
    await h.closed;
  } finally {
    await cleanup(f);
  }
});
