import {
  fakeWorkletParams,
  withUnitNativeClock,
} from "./helpers/worklet-frame-clock.js";
import test from "node:test";
import assert from "node:assert/strict";
import { FiniteRecordingProducer } from "../src/loop-station/finite-reader-core.js";
import {
  prepareFiniteReaders,
  finiteReaderOutcome,
} from "../src/loop-station/finite-reader.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { AudioDocument } from "../src/loop-station/audio-document.js";
import { prepareLoopPlan } from "../src/loop-station/plan.js";
import { emptyLoopProject } from "../src/loop-station/model.js";
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import { LoopStationSession } from "../src/loop-station/session.js";
import { WorkspaceAudioOwner } from "../src/loop-station/workspace-owner.js";
import { Transport } from "../src/audio/transport.js";
import { digest } from "../src/loop-station/recording-data.js";
import { PPQ } from "../src/project/instrument-project.js";

const identity = (extra = {}) => ({
  contextId: "context",
  planId: "plan",
  readerId: "reader",
  epoch: "epoch",
  sourceHash: "a".repeat(64),
  rate: 48000,
  channels: 2,
  periodFrames: 128,
  startFrame: 101,
  endFrame: 1101,
  fromFrame: 240037,
  scoreStartFrame: 0,
  phaseFrame: 37,
  ...extra,
});
const payload = (extra = {}) => ({
  identity: identity(extra),
  sourceHash: "a".repeat(64),
  buffers: [
    Float32Array.from({ length: 128 }, (_, n) => Math.fround((n - 64) / 512)),
    Float32Array.from({ length: 128 }, (_, n) => Math.fround((64 - n) / 1024)),
  ],
});
const output = (n) => [new Float32Array(n), new Float32Array(n)];

test("versioned finite alignment binds signed advance and full-period circular reads to exact receipt identity", () => {
  for (const advance of [-37, 37]) {
    const p = payload({
        alignmentVersion: 1,
        advanceFrames: advance,
        phaseFrame: (37 + advance + 128) % 128,
      }),
      r = new FiniteRecordingProducer(p);
    for (let frame = 0; !r.result; frame += 128) {
      const out = output(128);
      r.process(frame, out);
      for (let n = 0; n < 128; n++)
        for (let c = 0; c < 2; c++) {
          const index = (((37 + advance + frame + n - 101) % 128) + 128) % 128;
          assert.equal(
            out[c][n],
            frame + n >= 101 && frame + n < 1101 ? p.buffers[c][index] : 0,
          );
        }
    }
    assert.equal(r.result.coveredFrames, 1000);
    assert.throws(
      () =>
        new FiniteRecordingProducer({
          ...p,
          identity: { ...p.identity, phaseFrame: 37 },
        }),
    );
  }
  for (const extra of [
    { alignmentVersion: 2, advanceFrames: 1 },
    { alignmentVersion: 1, advanceFrames: 128 },
    { alignmentVersion: 1, advanceFrames: 1.5 },
    { advanceFrames: 1 },
  ])
    assert.throws(() => new FiniteRecordingProducer(payload(extra)));
});

test("actual producer writes every distinct channel/frame across variable blocks and non-round seek before coverage", () => {
  const p = payload(),
    r = new FiniteRecordingProducer(p);
  let frame = 0,
    index = 0,
    written = 0;
  while (!r.result) {
    const n = [64, 128, 192, 7, 256][index++ % 5],
      out = output(n);
    r.process(frame, out);
    for (let j = 0; j < n; j++)
      for (let c = 0; c < 2; c++) {
        const expected =
          frame + j >= 101 && frame + j < 1101
            ? p.buffers[c][(37 + frame + j - 101) % 128]
            : 0;
        assert.equal(out[c][j], expected);
        if (c === 0 && frame + j >= 101 && frame + j < 1101) written++;
      }
    frame += n;
  }
  assert.equal(r.result.reason, "complete");
  assert.equal(r.result.coveredFrames, written);
  assert.equal(r.result.channelWrites, 2000);
  assert.throws(() => {
    r.coveredFrames = 999999;
  }, TypeError);
  assert.throws(() => {
    r.result = { reason: "complete" };
  }, TypeError);
  assert.equal(r.close().coveredFrames, 1000);
});
for (const loss of [1, 64, 128, 129])
  test(`actual writer cancel loses ${loss} frames including nonzero tail and cannot complete`, () => {
    const r = new FiniteRecordingProducer(payload());
    r.cancel({ identity: r.identity, atFrame: 1101 - loss });
    for (let frame = 0; !r.result; frame += 128) r.process(frame, output(128));
    assert.equal(r.result.reason, "canceled");
    assert.equal(r.result.coveredFrames, 1000 - loss);
    assert.equal(r.result.cancelRequestedFrame, 1101 - loss);
    assert.equal(r.result.cancelObservedNextFrame, 0);
    assert.equal(r.result.cancelFadeFrames, 0);
  });
for (const zero of ["all-zero", "trailing-zero"])
  test(`zero policy requires actual writes even for ${zero} source`, () => {
    const p = payload();
    for (const a of p.buffers) a.fill(0, zero === "all-zero" ? 0 : 64);
    const complete = new FiniteRecordingProducer(p),
      lost = new FiniteRecordingProducer(p);
    lost.cancel({ identity: lost.identity, atFrame: 1100 });
    for (let f = 0; !complete.result || !lost.result; f += 128) {
      if (!complete.result) complete.process(f, output(128));
      if (!lost.result) lost.process(f, output(128));
    }
    assert.equal(complete.result.reason, "complete");
    assert.equal(lost.result.reason, "canceled");
    assert.equal(lost.result.coveredFrames, 999);
  });
for (const [name, frames] of [
  ["repeat", [0, 0]],
  ["gap", [0, 256]],
])
  test(`original ${name} frame labels latch failure`, () => {
    const r = new FiniteRecordingProducer(payload());
    for (const f of frames) r.process(f, output(128));
    assert.equal(r.result.reason, "frameDiscontinuity");
    r.process(128, output(128));
    assert.notEqual(r.result.reason, "complete");
  });
test("missing output channel/PCM, unsafe frames, wrong source/epoch and late start cannot acquire coverage", () => {
  assert.throws(
    () =>
      new FiniteRecordingProducer({ ...payload(), sourceHash: "b".repeat(64) }),
  );
  const invalid = payload();
  invalid.buffers[1][127] = NaN;
  assert.throws(() => new FiniteRecordingProducer(invalid));
  for (const [frame, out] of [
    [NaN, output(128)],
    [0, [new Float32Array(128)]],
    [256, output(128)],
  ]) {
    const r = new FiniteRecordingProducer(payload());
    r.process(frame, out);
    assert.notEqual(r.result.reason, "complete");
  }
  const r = new FiniteRecordingProducer(payload());
  r.cancel({ identity: { ...r.identity, epoch: "wrong" }, atFrame: 1000 });
  assert.equal(r.result.reason, "invalidCancel");
});

let Processor;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.port = {
      messages: [],
      postMessage(d) {
        this.messages.push(structuredClone(d));
      },
    };
  }
};
globalThis.sampleRate = 48000;
globalThis.registerProcessor = (name, C) => {
  assert.ok(
    ["perkusi-finite-reader-v5", "perkusi-finite-tail-v5"].includes(name),
  );
  if (name === "perkusi-finite-reader-v5") Processor = withUnitNativeClock(C);
};
await import("../src/loop-station/finite-reader-worklet.js");
const param = () => ({
  value: 1,
  setValueAtTime(v) {
    this.value = v;
  },
  linearRampToValueAtTime(v) {
    this.value = v;
  },
  cancelScheduledValues() {},
});
class Node {
  constructor(context) {
    this.context = context;
    this.parameters = fakeWorkletParams();
    this.gain = param();
    this.pan = param();
  }
  connect() {}
  disconnect() {}
}
class Context extends EventTarget {
  sampleRate = 48000;
  currentTime = 0;
  state = "running";
  nodes = [];
  audioWorklet = { addModule: async () => {} };
  createGain() {
    return new Node(this);
  }
  createStereoPanner() {
    return new Node(this);
  }
  createBuffer(channels, frames, rate) {
    const a = Array.from({ length: channels }, () => new Float32Array(frames));
    return {
      length: frames,
      sampleRate: rate,
      numberOfChannels: channels,
      duration: frames / rate,
      getChannelData: (c) => a[c],
    };
  }
  confirmClosed() {
    this.state = "closed";
    this.dispatchEvent(new Event("statechange"));
  }
  async close() {
    if (this.rejectClose) throw Error("QA deliberately rejected native close");
    this.confirmClosed();
  }
  factory = (c, options) => {
    if (this.failConstructor) throw Error("QA constructor failure");
    const processor = new Processor({
      processorOptions: structuredClone(options.processorOptions),
    });
    const n = new Node(c);
    Object.assign(n, {
      options,
      processor,
      active: true,
      port: {
        onmessage: null,
        postMessage: (d) =>
          processor.port.onmessage({ data: structuredClone(d) }),
        close() {
          this.closed = true;
        },
      },
      handlers: new Map(),
      addEventListener(type, fn) {
        this.handlers.set(type, fn);
      },
      send(d, trusted = true) {
        this.port.onmessage?.({ data: structuredClone(d), isTrusted: trusted });
      },
      deliver() {
        for (const d of processor.port.messages.splice(0)) this.send(d);
      },
      render(frame, size) {
        globalThis.currentFrame = frame;
        const out = output(size);
        this.active = processor.process([], [out]);
        return out;
      },
    });
    this.nodes.push(n);
    return n;
  };
}
async function fixture(t) {
  const context = new Context(),
    memory = new AudioMemory(),
    registry = new InstrumentRegistry(),
    p = structuredClone(emptyLoopProject(registry)),
    P = 120000;
  p.clock = { kind: "fixed-bar", sampleRate: 48000, framesPerBar: P };
  p.master.volume = 0.5;
  const data = new ArrayBuffer(P * 8),
    view = new DataView(data);
  for (let c = 0; c < 2; c++)
    for (let n = 0; n < P; n++)
      view.setFloat32(
        (c * P + n) * 4,
        Math.fround(((n % 29) - 14) / (1000 + c * 1000)),
        true,
      );
  p.assetRefs.push({
    id: "recording-1",
    kind: "recording",
    sha256: await digest(data),
    bytes: data.byteLength,
    frames: P,
    channels: 2,
    sampleRate: 48000,
    encoding: "float32le",
    recordedBpm: 96,
  });
  p.tracks[0].kind = "recording";
  p.tracks[0].gain = 0.0625;
  p.tracks[0].clips = [
    {
      id: "clip-1",
      sourceId: "recording-1",
      startTick: 0,
      lengthTicks: 4 * PPQ,
      offsetFrames: 0,
      loop: true,
    },
  ];
  const doc = new AudioDocument({
    registry,
    memory,
    backend: {
      entry: async () => ({
        blob: new Blob([data]),
        provenance: "Unit model only",
      }),
    },
  });
  const plan = await prepareLoopPlan(p, {
    registry,
    rate: 48000,
    memory,
    recordedLoops: true,
    resolveRecording: (ref) => doc.resolve(ref, context),
  });
  const prepared = await prepareFiniteReaders(
    plan,
    context,
    memory,
    "https://qa.test/finite.js",
    context.factory,
  );
  const f = {
    context,
    memory,
    registry,
    p,
    doc,
    plan,
    prepared,
    clip: plan.tracks[0].clips[0],
    starts: [],
  };
  t.after(() => {
    context.confirmClosed();
    for (const e of f.starts) e.abortUnstarted();
    prepared.release();
    plan.release();
    assert.equal(memory.snapshot().bytes, 0);
  });
  f.start = () => {
    const epoch = prepared.begin(),
      geometry = {
        ...f.clip.voices[0],
        startFrame: 0,
        endFrame: 480000,
        dampFrame: null,
        loopFrames: P,
        stopFrame: 480000,
      };
    f.starts.push(epoch);
    f.faults = [];
    f.releases = 0;
    f.voice = epoch.start(
      f.clip,
      geometry,
      0.1,
      0,
      context.createGain(),
      () => f.releases++,
      (e) => f.faults.push(e.code),
    );
    return context.nodes.at(-1);
  };
  return f;
}
function renderAll(n) {
  for (let frame = 0; n.active; frame += 128) n.render(frame, 128);
}

for (const base of [0, 49 * 1048576, 51 * 1048576])
  test(`legal 32s finite reader at epoch${base} pre-schedules all clock events without a host interval`, async (t) => {
    let intervals = 0;
    t.mock.method(globalThis, "setInterval", () => {
      intervals++;
      return { unref() {} };
    });
    const f = await fixture(t),
      epoch = f.prepared.begin();
    f.starts.push(epoch);
    f.context.currentTime = base / 48000;
    let released = 0;
    const faults = [];
    const v = epoch.start(
      f.clip,
      {
        ...f.clip.voices[0],
        startFrame: 0,
        endFrame: 1536000,
        dampFrame: null,
        loopFrames: 120000,
        stopFrame: 1536000,
      },
      (base + 4800) / 48000,
      0,
      f.context.createGain(),
      () => released++,
      (e) => faults.push(e.code),
    );
    const n = f.context.nodes.at(-1);
    assert.ok(n);
    assert.equal(intervals, 0);
    assert.deepEqual(faults, []);
    const last = n.parameters.get("framePhase").events.at(-1);
    assert.ok(last[2] * 48000 > base + 4800 + 1536000);
    assert.equal(v.snapshot().kind, "pending");
    assert.equal(released, 0);
    f.context.confirmClosed();
    assert.equal(released, 1);
    assert.notEqual(v.snapshot().kind, "verified");
  });

test("three immutable readers after adoption require every closed frontier; a fourth stays outside capability", async (t) => {
  const f = await fixture(t),
    p = structuredClone(f.p),
    c = f.context;
  for (let i = 1; i < 3; i++) {
    p.tracks[i].kind = "recording";
    p.tracks[i].gain = 0.0625;
    p.tracks[i].clips = [{ ...p.tracks[0].clips[0], id: "adopted-" + i }];
  }
  const s = new LoopStationSession({
    context: c,
    memory: f.memory,
    registry: f.registry,
    output: c.createGain(),
    transport: new Transport({ bpm: 96 }),
    ownsTransport: true,
    finiteReaderModuleURL: "https://qa.test/finite.js",
    finiteReaderNodeFactory: c.factory,
    resolveRecording: (ref, o) => f.doc.resolve(ref, c, o),
  });
  try {
    await s.load(p);
    s.play({ bars: 4 });
    assert.equal(s.rows.size, 3);
    const nodes = c.nodes.slice(-3);
    for (const n of nodes) renderAll(n);
    nodes[0].deliver();
    nodes[1].deliver();
    const last = nodes[2].processor.port.messages.splice(0);
    nodes[2].send(last[0]);
    nodes[2].send(last[1]);
    assert.equal(s.status, "playing");
    assert.equal(s.rows.size, 1);
    nodes[2].send(last[2]);
    assert.equal(s.snapshot().finiteCompletion.state, "verified");
    assert.equal(s.status, "stopped");
    const next = structuredClone(p);
    next.tracks[3].kind = "recording";
    next.tracks[3].clips = [{ ...p.tracks[0].clips[0], id: "fourth" }];
    await s.load(next);
    assert.equal(s.snapshot().finitePreparation.state, "unavailable");
  } finally {
    c.confirmClosed();
    await s.dispose();
  }
});
test("body proof does not release ownership; late same-epoch proof plus real worker closed can verify despite coarse main clock", async (t) => {
  const f = await fixture(t),
    n = f.start(),
    held = f.memory.snapshot().bytes;
  renderAll(n);
  f.context.currentTime = 999; // Delivery label is deliberately irrelevant.
  const messages = n.processor.port.messages.splice(0);
  n.send(messages[0]);
  n.send(messages[1]);
  assert.equal(finiteReaderOutcome(f.voice).kind, "pending");
  assert.equal(f.memory.snapshot().bytes, held);
  assert.equal(f.releases, 0);
  n.send(messages[2]);
  assert.equal(finiteReaderOutcome(f.voice).kind, "verified");
  assert.equal(f.releases, 1);
  assert.ok(f.memory.snapshot().bytes < held);
});
for (const mode of [
  "closed-first",
  "missing-proof",
  "forged-untrusted",
  "wrong-epoch",
  "wrong-source",
  "bad-count",
  "duplicate-mutated",
])
  test(`${mode} receipt cannot retroactively verify`, async (t) => {
    const f = await fixture(t),
      n = f.start();
    renderAll(n);
    const [ready, body, closed] = n.processor.port.messages.splice(0);
    n.send(ready);
    if (mode === "closed-first" || mode === "missing-proof") n.send(closed);
    else if (mode === "forged-untrusted") n.send(body, false);
    else if (mode === "wrong-epoch" || mode === "wrong-source")
      n.send({
        ...body,
        identity: {
          ...body.identity,
          [mode === "wrong-epoch" ? "epoch" : "sourceHash"]: "wrong",
        },
      });
    else if (mode === "bad-count")
      n.send({ ...body, body: { ...body.body, channelWrites: 1 } });
    else {
      n.send(body);
      n.send({ ...body, body: { ...body.body, coveredFrames: 1 } });
    }
    n.send(body);
    n.send(closed);
    assert.notEqual(finiteReaderOutcome(f.voice).kind, "verified");
    assert.ok(f.faults.length);
    assert.equal(f.releases, 1);
  });
test("exact duplicate proof is idempotent, old callbacks cannot change a replacement epoch", async (t) => {
  const f = await fixture(t),
    n = f.start();
  renderAll(n);
  const [ready, body, closed] = n.processor.port.messages.splice(0);
  const oldCallback = n.port.onmessage;
  n.send(ready);
  n.send(body);
  n.send(body);
  n.send(closed);
  assert.equal(finiteReaderOutcome(f.voice).kind, "verified");
  const replacement = f.start(),
    before = f.memory.snapshot().bytes;
  oldCallback({ isTrusted: true, data: body });
  assert.equal(f.memory.snapshot().bytes, before);
  assert.equal(finiteReaderOutcome(f.voice).kind, "pending");
  assert.notEqual(
    replacement.options.processorOptions.identity.epoch,
    body.identity.epoch,
  );
});
test("controlled cancel and failed-close retry hold cloned PCM/node ownership until actual closed proof", async (t) => {
  const f = await fixture(t),
    n = f.start(),
    held = f.memory.snapshot().bytes;
  n.deliver();
  f.voice.stop();
  assert.equal(f.memory.snapshot().bytes, held);
  assert.throws(() => f.voice.disconnect(), { code: "loopClosePending" });
  f.context.state = "suspended";
  f.context.rejectClose = true;
  await assert.rejects(f.context.close(), /deliberately rejected/);
  assert.equal(f.context.state, "suspended");
  assert.equal(f.memory.snapshot().bytes, held);
  f.context.rejectClose = false;
  await f.context.close();
  assert.equal(f.releases, 1);
  assert.equal(finiteReaderOutcome(f.voice).kind, "controlled");
  assert.ok(f.memory.snapshot().bytes < held);
});
test("host hash mismatch, clone budget pressure and unqualified JSON flags cannot acquire a reader capability", async (t) => {
  const f = await fixture(t),
    clip = f.clip,
    held = f.memory.snapshot().bytes;
  const fake = {
    ...f.plan,
    tracks: f.plan.tracks.map((x, i) =>
      i ? x : { ...x, clips: [{ ...clip, verified: true }] },
    ),
  };
  assert.equal(
    await prepareFiniteReaders(
      fake,
      f.context,
      f.memory,
      "https://qa.test/finite.js",
      f.context.factory,
    ),
    null,
  );
  const pressure = f.memory.reserve(67108864 - held - 1, "foreign-pressure");
  assert.throws(() => f.prepared.begin(), { code: "combinedMemoryLimit" });
  pressure.release();
  assert.equal(f.context.nodes.length, 0);
  clip.voices[0].buffer.getChannelData(0)[0] = 0.9;
  await assert.rejects(
    prepareFiniteReaders(
      f.plan,
      f.context,
      f.memory,
      "https://qa.test/finite.js",
      f.context.factory,
    ),
    { code: "recordingHashMismatch" },
  );
  assert.equal(f.memory.snapshot().bytes, held);
});
test("actual session grants verified stop only after all producer/closed receipts and blocks capture while active", async (t) => {
  const f = await fixture(t),
    transport = new Transport({ bpm: 96 }),
    master = f.context.createGain(),
    owner = new WorkspaceAudioOwner({
      memory: f.memory,
      getProject: () => f.p,
    });
  const session = new LoopStationSession({
    context: f.context,
    transport,
    memory: f.memory,
    registry: f.registry,
    output: master,
    ownsTransport: true,
    admission: owner,
    resolveRecording: (ref) => f.doc.resolve(ref, f.context),
    finiteReaderModuleURL: "https://qa.test/finite.js",
    finiteReaderNodeFactory: f.context.factory,
  });
  owner.attach(
    {
      context: f.context,
      transport,
      memory: f.memory,
      master,
      output: master,
      volume: 1,
    },
    session,
  );
  await session.load(f.p);
  session.play({ bars: 4 });
  assert.equal(session.hasFiniteWitnessReaders(), true);
  const held = f.memory.snapshot().bytes;
  assert.throws(() => session.reclaimOptionalFinitePreparation(), {
    code: "recordBusy",
  });
  assert.equal(f.memory.snapshot().bytes, held);
  assert.throws(() => owner.armInput({}), { code: "recordBusy" });
  await assert.rejects(owner.assignInstrument("track-8", {}), {
    code: "recordBusy",
  });
  const n = f.context.nodes.at(-1);
  renderAll(n);
  assert.equal(session.status, "playing");
  assert.equal(session.snapshot().finiteCompletion.state, "pending");
  const [ready, body, closed] = n.processor.port.messages.splice(0);
  n.send(ready);
  n.send(body);
  assert.throws(() => session.reclaimOptionalFinitePreparation(), {
    code: "recordBusy",
  });
  assert.equal(f.memory.snapshot().bytes, held);
  n.send(closed);
  assert.equal(session.status, "stopped");
  assert.equal(session.error, null);
  assert.equal(session.snapshot().finiteCompletion.state, "verified");
  assert.equal(transport.running, false);
  assert.equal(transport.beatsAt(10), transport.beatsAt(11));
  session.reclaimOptionalFinitePreparation();
  assert.equal(session.snapshot().finitePreparation.state, "unavailable");
  await session.dispose();
});

test("real producer cancel before EOF differs from unknown proof and preserves the exact missing count", async (t) => {
  const f = await fixture(t),
    n = f.start(),
    id = n.options.processorOptions.identity;
  n.port.postMessage({
    type: "cancel",
    identity: id,
    atFrame: id.endFrame - 64,
    fadeFrames: 0,
  });
  renderAll(n);
  n.deliver();
  const outcome = finiteReaderOutcome(f.voice);
  assert.equal(outcome.kind, "fault");
  assert.equal(outcome.fault, "recordingLoopEnded");
  assert.equal(outcome.body.coveredFrames, id.endFrame - id.startFrame - 64);
  assert.equal(f.releases, 1);
});
for (const mode of ["constructor", "processorerror"])
  test(`${mode} failure cannot release worker allowance without EOF or confirmed closure`, async (t) => {
    const f = await fixture(t);
    f.context.failConstructor = mode === "constructor";
    const n = f.start(),
      held = f.memory.snapshot().bytes;
    if (mode === "processorerror") n.handlers.get("processorerror")();
    await Promise.resolve();
    assert.equal(finiteReaderOutcome(f.voice).kind, "unverified");
    assert.equal(f.releases, 0);
    assert.equal(f.memory.snapshot().bytes, held);
    f.context.confirmClosed();
    assert.equal(f.releases, 1);
    assert.ok(f.memory.snapshot().bytes < held);
  });
