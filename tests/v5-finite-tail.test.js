import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { FiniteGraphOutput } from "../src/loop-station/finite-tail-core.js";
import {
  startFiniteTail,
  finiteMixSignature,
} from "../src/loop-station/finite-tail.js";
import { LoopStationSession } from "../src/loop-station/session.js";
import { WorkspaceAudioOwner } from "../src/loop-station/workspace-owner.js";
import { Transport } from "../src/audio/transport.js";
const id = () => ({
  contextId: "context",
  planId: "plan",
  epoch: "epoch",
  graphId: "graph",
  rate: 48000,
  startFrame: 101,
  bodyEndFrame: 1101,
  endFrame: 5901,
  mixSignature: "immutable-model-mix",
});
const stereo = (n, value = 0.25) => [
  new Float32Array(n).fill(value),
  new Float32Array(n).fill(-value),
];
test("final writer owns every actual body/tail output write including zero material across variable blocks", () => {
  for (const value of [0, 0.25]) {
    const p = id(),
      w = new FiniteGraphOutput(p);
    let f = 0,
      k = 0;
    while (!w.result) {
      const n = [64, 128, 192, 7, 256][k++ % 5],
        input = stereo(n, value),
        out = stereo(n, 9);
      w.process(f, input, out);
      for (let c = 0; c < 2; c++)
        for (let j = 0; j < n; j++)
          assert.equal(
            out[c][j],
            f + j >= p.startFrame && f + j < p.endFrame ? input[c][j] : 0,
          );
      f += n;
    }
    assert.equal(w.result.reason, "complete");
    assert.equal(w.result.bodyOutputFrames, 1000);
    assert.equal(w.result.tailOutputFrames, 4800);
    assert.equal(w.result.channelWrites, 11600);
    assert.equal(w.result.lastWriteFrameExclusive, 5901);
    w.close();
    assert.throws(() => w.process(f, stereo(128), stereo(128)));
  }
});
for (const failure of ["missing", "nonfinite", "repeat", "gap", "late"])
  test(`${failure} actual graph progression cannot certify a tail`, () => {
    const w = new FiniteGraphOutput(id());
    let f = 0,
      input = stereo(128);
    if (failure === "late") f = 256;
    w.process(f, input, stereo(128));
    if (failure === "missing") input = [];
    if (failure === "nonfinite") input[1][100] = NaN;
    if (failure !== "late")
      w.process(
        failure === "repeat" ? 0 : failure === "gap" ? 256 : 128,
        input,
        stereo(128),
      );
    assert.notEqual(w.result?.reason, "complete");
    assert.ok(w.result);
  });
for (const mode of ["drain", "fade"])
  test(`controlled ${mode} has a declared actual endpoint and never complete coverage`, () => {
    const p = id(),
      w = new FiniteGraphOutput(p);
    for (let f = 0; f < 1280; f += 128) w.process(f, stereo(128), stereo(128));
    w.cancel({
      identity: p,
      mode,
      atFrame: 1300,
      fadeFrames: mode === "fade" ? 960 : 0,
    });
    for (let f = 1280; !w.result; f += 128) {
      const out = stereo(128);
      w.process(f, stereo(128), out);
      for (let j = 0; j < 128; j++) {
        const frame = f + j,
          end = mode === "fade" ? 2260 : 1300,
          level =
            frame < 1300
              ? 1
              : mode === "fade"
                ? Math.max(0, 1 - (frame - 1300) / 960)
                : 0;
        assert.equal(out[0][j], frame < end ? Math.fround(0.25 * level) : 0);
      }
    }
    assert.equal(w.result.reason, "canceled");
    assert.equal(w.result.control.endFrame, mode === "fade" ? 2260 : 1300);
    assert.equal(w.result.control.observedNextFrame, 1280);
  });

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
let Reader, Tail;
globalThis.sampleRate = 48000;
globalThis.registerProcessor = (name, C) => {
  if (name === "perkusi-finite-reader-v5") Reader = C;
  else if (name === "perkusi-finite-tail-v5") Tail = C;
  else assert.fail(name);
};
await import("../src/loop-station/finite-reader-worklet.js");
// Reuse the same explicitly modeled context/recording fixture as the reader
// protocol tests. This does not model native IIR DSP or constitute audio proof.
const fixtureText = await readFile(
    new URL("./v5-finite-reader.test.js", import.meta.url),
    "utf8",
  ),
  helperText = fixtureText.slice(
    fixtureText.indexOf("const param = () =>"),
    fixtureText.indexOf("async function fixture(t)"),
  );
globalThis.__tailReaderModel = Reader;
const { Context } = await import(
  "data:text/javascript;base64," +
    Buffer.from(
      "const output=n=>[new Float32Array(n),new Float32Array(n)];const Processor=globalThis.__tailReaderModel;" +
        helperText +
        "export {Context};",
    ).toString("base64")
);
globalThis.__tailContextModel = Context;
const fixtureImports = fixtureText
  .slice(0, fixtureText.indexOf("const identity ="))
  .replaceAll('"../src/', '"' + new URL("../src/", import.meta.url).href)
  .replaceAll('"node:test"', '"node:test"');
const fixtureCode = fixtureText.slice(
  fixtureText.indexOf("async function fixture(t)"),
  fixtureText.indexOf("function renderAll(n)"),
);
// Evaluate only the reusable fixture declarations; no imported test cases run.
const fixture = (
  await import(
    "data:text/javascript;base64," +
      Buffer.from(
        fixtureImports +
          "const Context=globalThis.__tailContextModel;" +
          fixtureCode +
          "export {fixture};",
      ).toString("base64")
  )
).fixture;

function tailFactory(c, options) {
  if (c.failTailConstructor) throw Error("model tail constructor failure");
  const processor = new Tail({
      processorOptions: structuredClone(options.processorOptions),
    }),
    n = c.createGain();
  Object.assign(n, {
    processor,
    options,
    active: true,
    handlers: new Map(),
    port: {
      onmessage: null,
      postMessage: (d) =>
        processor.port.onmessage({ data: structuredClone(d) }),
      close() {
        this.closed = true;
      },
    },
    addEventListener(type, fn) {
      this.handlers.set(type, fn);
    },
    send(data, isTrusted = true) {
      this.port.onmessage?.({ data: structuredClone(data), isTrusted });
    },
    deliver() {
      for (const d of processor.port.messages.splice(0)) this.send(d);
    },
    render(frame, input = stereo(128)) {
      globalThis.currentFrame = frame;
      const out = stereo(input[0]?.length ?? 128, 0);
      this.active = processor.process([input], [out]);
      return out;
    },
  });
  (c.tailNodes ??= []).push(n);
  return n;
}
function renderTail(n) {
  for (let f = 0; n.active; f += 128) n.render(f);
}
for (const mode of [
  "healthy",
  "body-only",
  "closed-first",
  "wrong-identity",
  "untrusted",
  "bad-tail-count",
])
  test(`tail port ${mode} requires actual ordered output and closed facts`, () => {
    const c = new Context(),
      input = c.createGain(),
      output = c.createGain();
    let releases = 0,
      faults = 0;
    const v = startFiniteTail({
        context: c,
        identity: id(),
        input,
        output,
        nodeFactory: tailFactory,
        onRelease: () => releases++,
        onFault: () => faults++,
      }),
      n = c.tailNodes[0];
    renderTail(n);
    const [ready, body, closed] = n.processor.port.messages.splice(0);
    n.send(ready);
    if (mode === "closed-first") n.send(closed);
    else if (mode === "wrong-identity")
      n.send({ ...body, identity: { ...body.identity, epoch: "other" } });
    else if (mode === "untrusted") n.send(body, false);
    else if (mode === "bad-tail-count")
      n.send({ ...body, body: { ...body.body, tailOutputFrames: 4799 } });
    else n.send(body);
    assert.equal(releases, mode === "closed-first" ? 1 : 0);
    if (mode !== "closed-first") assert.notEqual(v.snapshot().kind, "verified");
    if (mode === "body-only") {
      v.markControlled();
      c.confirmClosed();
      v.confirmClose();
      assert.equal(v.snapshot().kind, "controlled");
    } else {
      n.send(closed);
      assert.equal(
        v.snapshot().kind,
        mode === "healthy" ? "verified" : "unverified",
      );
    }
    assert.equal(releases, 1);
    assert.equal(faults, mode === "healthy" || mode === "body-only" ? 0 : 1);
  });
for (const mode of ["constructor", "processorerror"])
  test(`unknown tail ${mode} does not imply closed or verified`, async () => {
    const c = new Context();
    c.failTailConstructor = mode === "constructor";
    let releases = 0;
    const v = startFiniteTail({
      context: c,
      identity: id(),
      input: c.createGain(),
      output: c.createGain(),
      nodeFactory: tailFactory,
      onRelease: () => releases++,
      onFault: () => {},
    });
    if (mode === "processorerror")
      c.tailNodes[0].handlers.get("processorerror")();
    await Promise.resolve();
    assert.equal(v.snapshot().kind, "unverified");
    assert.equal(releases, 0);
    c.rejectClose = true;
    await assert.rejects(c.close());
    assert.equal(releases, 0);
    c.rejectClose = false;
    await c.close();
    v.confirmClose();
    assert.equal(releases, 1);
  });
async function sessionFixture(t) {
  const f = await fixture(t),
    c = f.context;
  c.createIIRFilter = () => c.createGain();
  c.createConstantSource = () =>
    Object.assign(c.createGain(), {
      offset: { value: 0 },
      start() {},
      stop() {},
    });
  const project = structuredClone(f.p);
  project.tracks[0].eq = {
    version: 1,
    bypass: false,
    lowDb: 1,
    midDb: -1,
    highDb: 0,
  };
  const master = c.createGain(),
    transport = new Transport({ bpm: 96 }),
    owner = new WorkspaceAudioOwner({
      memory: f.memory,
      getProject: () => project,
    });
  const session = new LoopStationSession({
    context: c,
    memory: f.memory,
    registry: f.registry,
    output: master,
    transport,
    ownsTransport: true,
    admission: owner,
    finiteReaderModuleURL: "https://qa.test/finite.js",
    finiteReaderNodeFactory: c.factory,
    finiteTailNodeFactory: tailFactory,
    resolveRecording: (ref, o) => f.doc.resolve(ref, c, o),
  });
  owner.attach(
    {
      context: c,
      memory: f.memory,
      transport,
      master,
      output: master,
      volume: 1,
    },
    session,
  );
  await session.load(project);
  return { ...f, session, owner, project, transport };
}
test("actual session waits beyond source body for every graph-tail write and closed; clock freezes at tail endpoint", async (t) => {
  const f = await sessionFixture(t),
    s = f.session,
    c = f.context;
  try {
    s.play({ bars: 4 });
    const r = c.nodes.at(-1),
      g = c.tailNodes[0],
      S = r.options.processorOptions.identity.startFrame,
      E = S + 480000,
      T = E + 4800;
    assert.equal(
      g.options.processorOptions.identity.mixSignature,
      finiteMixSignature(f.project),
    );
    const held = f.memory.snapshot().bytes;
    let frame = 0;
    for (; frame < E + 128; frame += 128) {
      if (r.active) r.render(frame, 128);
      if (g.active) g.render(frame);
    }
    r.deliver();
    assert.equal(s.rows.size, 0);
    assert.equal(s.status, "playing");
    assert.equal(s.hasFiniteWitnessReaders(), true);
    assert.equal(f.memory.snapshot().bytes, held);
    assert.throws(() => s.reclaimOptionalFinitePreparation(), {
      code: "recordBusy",
    });
    assert.throws(() => f.owner.armInput({}), { code: "recordBusy" });
    assert.throws(() => s.prepareMixProgram(), { code: "recordBusy" });
    for (; g.active; frame += 128) g.render(frame);
    const [ready, body, closed] = g.processor.port.messages.splice(0);
    g.send(ready);
    g.send(body);
    assert.equal(body.body.tailOutputFrames, 4800);
    assert.equal(s.status, "playing");
    assert.equal(f.memory.snapshot().bytes, held);
    c.currentTime = 999;
    g.send(closed);
    assert.equal(s.status, "stopped");
    assert.equal(s.error, null);
    assert.equal(s.snapshot().finiteCompletion.state, "verified");
    assert.equal(f.transport.running, false);
    assert.equal(f.transport.beatsAt(1000), (T - S) / 30000);
    assert.ok(f.memory.snapshot().bytes < held);
    // A later ordinary request must rebuild away from the closed terminal gate.
    c.createBufferSource = () => {
      const n = c.createGain();
      n.playbackRate = { value: 1 };
      n.start = () => {};
      n.stop = () => queueMicrotask(() => n.onended?.());
      return n;
    };
    s.play();
    assert.equal(s.status, "playing");
    assert.equal(s.snapshot().finiteCompletion, null);
    s.stop();
    await s.waitVoices();
  } finally {
    c.confirmClosed();
    await s.dispose();
  }
});
test("explicit Stop/reset keeps pending EQ graph ownership until source and tail close and never revives", async (t) => {
  const f = await sessionFixture(t),
    s = f.session,
    c = f.context;
  try {
    s.play({ bars: 4 });
    const r = c.nodes.at(-1),
      g = c.tailNodes[0],
      held = f.memory.snapshot().bytes;
    s.stop();
    assert.equal(s.status, "stopped");
    assert.equal(s.offset, 0);
    assert.equal(f.transport.beatsAt(999), 0);
    assert.equal(s.snapshot().finiteCompletion.state, "controlled");
    assert.equal(f.memory.snapshot().bytes, held);
    assert.throws(() => s.play(), { code: "recordBusy" });
    let frame = 0;
    for (; r.active; frame += 128) {
      r.render(frame, 128);
      g.render(frame);
    }
    r.deliver();
    assert.equal(s.status, "stopped");
    assert.equal(s.tailPending(), true);
    // Continue from the actual last rendered graph block; the modeled source
    // canceled before onset and its receipt schedules a bounded EQ drain.
    for (; g.active; frame += 128) g.render(frame);
    g.deliver();
    assert.equal(s.tailPending(), false);
    assert.equal(s.status, "stopped");
    assert.equal(s.offset, 0);
    assert.equal(s.snapshot().finiteCompletion.state, "controlled");
    assert.equal(s.snapshot().finiteCompletion.graph.kind, "controlled");
  } finally {
    c.confirmClosed();
    await s.dispose();
  }
});

test("graph closed before held source receipts cannot certify success or reclaim the epoch", async (t) => {
  const f = await sessionFixture(t),
    s = f.session,
    c = f.context;
  try {
    s.play({ bars: 4 });
    const r = c.nodes.at(-1),
      g = c.tailNodes[0],
      held = f.memory.snapshot().bytes;
    renderTail(g);
    g.deliver();
    assert.equal(s.snapshot().finiteCompletion.graph.kind, "verified");
    assert.equal(s.status, "playing");
    assert.equal(s.snapshot().finiteCompletion.state, "pending");
    assert.equal(f.memory.snapshot().bytes, held);
    assert.equal(s.hasFiniteWitnessReaders(), true);
    for (let frame = 0; r.active; frame += 128) r.render(frame, 128);
    c.currentTime = 999;
    r.deliver();
    assert.equal(s.status, "stopped");
    assert.equal(s.error, null);
    assert.equal(s.snapshot().finiteCompletion.state, "verified");
    assert.ok(f.memory.snapshot().bytes < held);
  } finally {
    c.confirmClosed();
    await s.dispose();
  }
});

test("actual source proof plus graph-input fault remains non-successful until confirmed cleanup", async (t) => {
  const f = await sessionFixture(t),
    s = f.session,
    c = f.context;
  try {
    s.play({ bars: 4 });
    const r = c.nodes.at(-1),
      g = c.tailNodes[0];
    for (let frame = 0; r.active; frame += 128) r.render(frame, 128);
    r.deliver();
    assert.equal(s.status, "playing");
    for (let frame = 0; g.active; frame += 128) g.render(frame, []);
    g.deliver();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(s.status, "error");
    assert.equal(s.error, "recordingLoopCompletionUnverified");
    assert.notEqual(s.snapshot().finiteCompletion.state, "verified");
  } finally {
    c.confirmClosed();
    await s.dispose();
  }
});

test("retired output writer tolerates later active-input calls without writing or emitting another EOF", () => {
  const c = new Context(),
    p = new Tail({ processorOptions: { identity: id() } });
  for (let frame = 0; p.writer; frame += 128) {
    globalThis.currentFrame = frame;
    p.process([stereo(128)], [stereo(128)]);
  }
  const count = p.port.messages.length;
  assert.equal(count, 3);
  for (let i = 0; i < 3; i++) {
    const out = stereo(128, 9);
    assert.equal(p.process([stereo(128)], [out]), false);
    assert.ok(out.every((a) => a.every((v) => v === 0)));
  }
  assert.equal(p.port.messages.length, count);
  c.confirmClosed();
});
test("closed output proof cannot release a failed native input disconnect; confirmed context close can", () => {
  const c = new Context(),
    input = c.createGain(),
    output = c.createGain();
  let calls = 0,
    releases = 0;
  input.disconnect = () => {
    if (++calls > 1) throw Error("modeled disconnect failure");
  };
  const v = startFiniteTail({
      context: c,
      identity: id(),
      input,
      output,
      nodeFactory: tailFactory,
      onRelease: () => releases++,
      onFault: () => {},
    }),
    g = c.tailNodes[0];
  renderTail(g);
  g.deliver();
  assert.equal(v.snapshot().closed, true);
  assert.equal(v.snapshot().released, false);
  assert.equal(releases, 0);
  assert.equal(v.snapshot().kind, "unverified");
  c.confirmClosed();
  v.confirmClose();
  assert.equal(releases, 1);
});
test("explicit Stop during graph tail resets the clock even when source body receipts are held", async (t) => {
  const f = await sessionFixture(t),
    s = f.session,
    c = f.context;
  try {
    s.play({ bars: 4 });
    const r = c.nodes.at(-1),
      g = c.tailNodes[0],
      end = r.options.processorOptions.identity.endFrame;
    let frame = 0;
    for (; frame < end + 256; frame += 128) {
      if (r.active) r.render(frame, 128);
      g.render(frame);
    }
    c.currentTime = frame / 48000;
    s.stop();
    assert.equal(s.offset, 0);
    assert.equal(s.status, "stopped");
    assert.equal(f.transport.beatsAt(999), 0);
    r.deliver();
    for (; g.active; frame += 128) g.render(frame);
    g.deliver();
    const b = s.snapshot().finiteCompletion.graph.body;
    assert.equal(b.reason, "canceled");
    assert.equal(b.control.mode, "fade");
    assert.equal(b.control.fadeFrames, 960);
    assert.equal(s.snapshot().finiteCompletion.state, "controlled");
    assert.equal(s.status, "stopped");
    assert.equal(s.offset, 0);
  } finally {
    c.confirmClosed();
    await s.dispose();
  }
});
