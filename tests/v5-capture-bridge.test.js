import { fakeWorkletParams } from "./helpers/worklet-frame-clock.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import { LoopStationSession } from "../src/loop-station/session.js";
import { WorkspaceAudioOwner } from "../src/loop-station/workspace-owner.js";
import { CaptureSession } from "../src/loop-station/capture-session.js";
import { AudioEngine } from "../src/audio/engine.js";
import { createPackFromCatalog } from "../src/audio/pack-catalog.js";
import { originalRegistry } from "../src/project/original-registry.js";
import { adoptRecording } from "../src/loop-station/recording-data.js";
import { SessionTakes } from "../src/loop-station/session-takes.js";

// Reuse declarations only, without running another file's tests. These node,
// PCM and filter fixtures are explicitly modeled, not native audio evidence.
const url = new URL("./v5-finite-tail.test.js", import.meta.url),
  text = await readFile(url, "utf8"),
  declarations =
    text
      .slice(0, text.indexOf("const id ="))
      .replaceAll('"../src/', '"' + new URL("../src/", import.meta.url).href)
      .replaceAll(
        '"./helpers/',
        '"' + new URL("./helpers/", import.meta.url).href,
      ) +
    text
      .slice(
        text.indexOf("globalThis.AudioWorkletProcessor ="),
        text.indexOf("function tailFactory("),
      )
      .replace(
        'import("../src/loop-station/finite-reader-worklet.js")',
        "import(" +
          JSON.stringify(
            new URL(
              "../src/loop-station/finite-reader-worklet.js",
              import.meta.url,
            ).href,
          ) +
          ")",
      )
      .replaceAll("import.meta.url", JSON.stringify(url.href)) +
    text.slice(
      text.indexOf("function tailFactory("),
      text.indexOf("function renderTail("),
    );
const { fixture, tailFactory } = await import(
  "data:text/javascript;base64," +
    Buffer.from(
      declarations +
        "\nconst stereo=(n,v=.25)=>[new Float32Array(n).fill(v),new Float32Array(n).fill(-v)];export{fixture,tailFactory};",
    ).toString("base64")
);
const tick = () => new Promise((r) => setImmediate(r));
async function bridge(t) {
  const f = await fixture(t),
    c = f.context,
    bytes = new Uint8Array([1, 2, 3, 4]),
    hash = createHash("sha256").update(bytes).digest("hex");
  t.mock.method(globalThis, "fetch", async () => new Response(bytes));
  const createBuffer = c.createBuffer.bind(c);
  c.createBuffer = (...args) => {
    const b = createBuffer(...args);
    b.copyToChannel = (v, channel) => b.getChannelData(channel).set(v);
    return b;
  };
  c.decodeAudioData = async () => {
    const b = c.createBuffer(2, 4096, 48000);
    b.getChannelData(0).fill(0.02);
    b.getChannelData(1).fill(-0.01);
    return b;
  };
  const gain = c.createGain.bind(c);
  c.createGain = () => {
    const n = gain();
    n.connections = new Set();
    n.connect = (to) => {
      n.connections.add(to);
      return to;
    };
    n.disconnect = (to) => {
      if (n.failDisconnect) throw Error("model disconnect failed");
      if (to) n.connections.delete(to);
      else n.connections.clear();
    };
    return n;
  };
  const source = () =>
    Object.assign(c.createGain(), {
      offset: { value: 0 },
      playbackRate: { value: 1 },
      start() {},
      stop() {
        queueMicrotask(() => this.onended?.());
      },
    });
  c.createConstantSource = source;
  c.createBufferSource = source;
  c.createIIRFilter = () => c.createGain();
  const registry = new InstrumentRegistry([
    {
      id: "bridge",
      version: "1",
      kind: "instrument-bank",
      setId: "qa",
      tradition: "qa",
      laras: "slendro",
      samples: ["a", "b"].map((id) => ({
        id,
        instrumentId: "saron-barung",
        pitchId: id,
        articulation: "strike",
        assetPath: "/sounds/qa/" + id + ".wav",
        sha256: hash,
        sourceWorkId: "qa",
        licenseId: "qa",
        encodedBytes: 4,
        sampleRate: 48000,
        channels: 2,
        frames: 4096,
        gainTrim: 1,
        voicePolicy: "polyphonic",
      })),
    },
  ]);
  const project = structuredClone(f.p);
  project.tracks[0].eq = {
    version: 1,
    bypass: false,
    lowDb: 1,
    midDb: -1,
    highDb: 0,
  };
  project.tracks[1].kind = "recording";
  project.tracks[1].gain = 0.0625;
  project.tracks[1].clips = [{ ...project.tracks[0].clips[0], id: "clip-2" }];
  const engine = new AudioEngine(createPackFromCatalog(originalRegistry), {
    contextFactory: () => c,
  });
  engine.volume = 1;
  engine.ensureContext();
  const master = engine.master,
    transport = engine.transport,
    owner = new WorkspaceAudioOwner({
      memory: f.memory,
      getProject: () => project,
    });
  const session = new LoopStationSession({
    context: c,
    memory: f.memory,
    registry,
    output: master,
    transport,
    ownsTransport: true,
    admission: owner,
    finiteReaderModuleURL: "https://qa.test/finite.js",
    finiteReaderNodeFactory: c.factory,
    finiteTailNodeFactory: tailFactory,
    resolveRecording: (ref, o) => f.doc.resolve(ref, c, o),
  });
  owner.attach(engine, session);
  await session.load(project);
  const captures = [];
  await owner.prepareInstrument("track-8", {
    moduleURL: "https://qa.test/capture.js",
    openSession: (o) =>
      CaptureSession.open({
        ...o,
        nodeFactory: (ctx, options) => {
          const n = ctx.createGain();
          Object.assign(n, {
            parameters: fakeWorkletParams(),
            options,
            handlers: new Map(),
            port: { postMessage() {}, close() {} },
            addEventListener(type, fn) {
              this.handlers.set(type, fn);
            },
            send(data) {
              this.port.onmessage?.({ data });
            },
          });
          captures.push(n);
          return n;
        },
      }),
  });
  const input = await owner.assignInstrument("track-8", {
    bankId: "bridge",
    bankVersion: "1",
    sampleIds: ["a", "b"],
  });
  async function play() {
    await owner.run("play", () => session.play({ bars: 4 }));
  }
  function pcm(count, reason) {
    const n = captures.at(-1),
      p = n.options.processorOptions;
    let offset = 0,
      sequence = 0;
    while (offset < count) {
      const frames = Math.min(4096, count - offset);
      n.send({
        type: "pcm",
        sequence: sequence++,
        offset,
        frames,
        buffers: [
          new Float32Array(frames).fill(0.02).buffer,
          new Float32Array(frames).fill(-0.01).buffer,
        ],
      });
      offset += frames;
    }
    if (reason)
      n.send({
        type: "complete",
        ...p,
        capacity: p.endFrame - p.startFrame,
        frames: count,
        reason,
        blockSizes: [128],
      });
  }
  async function arm() {
    c.currentTime = 7;
    const h = owner.armInstrument({ source: input, bars: 2, countInBars: 0 });
    await h.prepared;
    return h;
  }
  async function close() {
    c.confirmClosed();
    for (const record of owner.capture.records)
      if (record.sourceLease) record.sourceLease.input.failDisconnect = false;
    await tick();
    await owner.retryCleanupAfterContextClose();
    for (const take of owner.capture.snapshot().retained)
      owner.releaseTake(take.id);
    await owner.dispose();
    await session.dispose();
    await engine.dispose();
  }
  return {
    ...f,
    c,
    registry,
    project,
    owner,
    session,
    transport,
    input,
    captures,
    play,
    arm,
    pcm,
    close,
  };
}

test("bridge preserves prepared readers, isolates terminal graph, and keeps monitor/clock beyond composite EOF", async (t) => {
  const f = await bridge(t);
  try {
    const root = f.session.graphBundle,
      monitor = f.owner.producers.get("track-8").gain;
    assert.equal(f.session.snapshot().finitePreparation.state, "prepared");
    await f.play();
    const h = await f.arm(),
      r = f.c.nodes.slice(-2),
      g = f.c.tailNodes.at(-1),
      S = r[0].options.processorOptions.identity.startFrame;
    assert.equal(f.session.snapshot().finiteCaptureBridge, true);
    assert.equal(f.session.graphBundle, root);
    assert.notEqual(f.session.finiteGraphBundle, root);
    assert(monitor.connections.has(root.graphs.get("track-8").gain));
    for (let frame = 0; r.some((n) => n.active) || g.active; frame += 128) {
      for (const n of r) if (n.active) n.render(frame, 128);
      if (g.active) g.render(frame);
    }
    for (const n of r) n.deliver();
    const [ready, body, closed] = g.processor.port.messages.splice(0);
    g.send(ready);
    g.send(body);
    assert.equal(f.session.snapshot().finiteCompletion.state, "pending");
    g.send(closed);
    assert.equal(f.session.snapshot().finiteCompletion.state, "verified");
    assert.equal(f.transport.running, true);
    assert.equal(f.session.status, "playing");
    assert.equal(h.state, "armed");
    assert.equal(f.owner.claims.size, 1);
    assert.equal(h.plan.startFrame, S + 360000);
    assert.equal(h.plan.endFrame, S + 600000);
    assert(monitor.connections.has(root.graphs.get("track-8").gain));
    assert(root.final.connections.has(f.session.output));
    f.pcm(240000, "complete");
    const take = await h.ready;
    assert.equal(take.partial, false);
    const stopped = h.stop();
    f.captures.at(-1).send({ type: "closed" });
    await stopped;
    assert.equal(f.owner.claims.size, 0);
    assert.equal(f.owner.capture.snapshot().retained.length, 1);
    await assert.rejects(f.owner.replaceable(), {
      code: "captureTakeNeedsReview",
    });
  } finally {
    await f.close();
  }
});

for (const mode of ["source", "graph", "suspend"])
  test(`bridge ${mode} fault publishes capture cause/ACK first and holds foreign stop until capture close`, async (t) => {
    const f = await bridge(t);
    try {
      await f.play();
      const h = await f.arm();
      f.pcm(512);
      const before = f.memory.snapshot().bytes;
      if (mode === "source") f.c.nodes.at(-1).handlers.get("processorerror")();
      else if (mode === "graph")
        f.c.tailNodes.at(-1).handlers.get("processorerror")();
      else {
        f.c.state = "suspended";
        f.c.dispatchEvent(new Event("statechange"));
      }
      assert.equal(h.state, "closing");
      assert.equal(h.outcome.acknowledgedFrames, 512);
      assert.equal(
        h.outcome.terminalCause.code,
        mode === "suspend"
          ? "contextSuspended"
          : "recordingLoopCompletionUnverified",
      );
      assert.equal(f.transport.running, true);
      assert.equal(f.session.rows.size, 2);
      assert(f.memory.snapshot().bytes >= before);
      assert.equal(f.owner.claims.size, 1);
      {
        const n = f.captures.at(-1),
          p = n.options.processorOptions;
        n.send({
          type: "complete",
          ...p,
          capacity: p.endFrame - p.startFrame,
          frames: 512,
          reason: "userStop",
          blockSizes: [128],
        });
      }
      await h.ready;
      assert.equal(h.take.partial, true);
      f.captures.at(-1).send({ type: "closed" });
      await h.closed;
      await tick();
      assert.equal(f.transport.running, false);
      assert.equal(f.owner.claims.size, 0);
      assert.equal(h.outcome.acknowledgedEndFrame, h.plan.startFrame + 512);
      assert.equal(
        f.owner.capture.snapshot().retainedOutcomes[0].outcome.terminalCause
          .code,
        h.outcome.terminalCause.code,
      );
      assert.equal(f.session.snapshot().finiteCompletion.state, "unverified");
      f.transport.start(f.c.currentTime + 0.1);
      await assert.rejects(f.owner.playSaved(h.take.id, "track-8"), {
        code: "partialTakeNeedsReview",
      });
      const retained = f.owner.pool.snapshot();
      assert.throws(
        () =>
          adoptRecording(
            f.project,
            f.registry,
            "track-8",
            h.take,
            "a".repeat(64),
          ),
        { code: "partialTakeNeedsReview" },
      );
      const takes = new SessionTakes(f.owner);
      t.mock.method(
        takes,
        "attribution",
        () => "Unit model export only; not production provenance",
      );
      assert.throws(() => takes.save(h.take.id, "track-8"), {
        code: "partialTakeNeedsReview",
      });
      const reserve = f.memory.reserve.bind(f.memory),
        mock = t.mock.method(f.memory, "reserve", (bytes, label) => {
          if (label === "take-WAV/export-and-blob")
            throw Object.assign(Error("model export capacity"), {
              code: "combinedMemoryLimit",
            });
          return reserve(bytes, label);
        });
      assert.throws(() => takes.wav(h.take.id), {
        code: "combinedMemoryLimit",
      });
      mock.mock.restore();
      assert.deepEqual(f.owner.pool.snapshot(), retained);
    } finally {
      await f.close();
    }
  });

test("bridge cohort rejects foreign input, changed generation and extra ownership without releasing any foreign lease", async (t) => {
  const f = await bridge(t);
  try {
    await f.play();
    assert.equal(f.owner.canArmFiniteCapture({ ...f.input }), false);
    const foreign = f.memory.reserve(128, "foreign-test-pin");
    f.owner.playbacks.add({
      trackId: "track-7",
      voices: 1,
      prePeak: 0.01,
      futureBytes: 0,
    });
    assert.equal(f.owner.canArmFiniteCapture(f.input), false);
    f.owner.playbacks.clear();
    assert.equal(f.owner.canArmFiniteCapture(f.input), true);
    f.owner.generation++;
    assert.equal(f.owner.canArmFiniteCapture(f.input), false);
    assert(
      f.memory.snapshot().owners.some((x) => x.label === "foreign-test-pin"),
    );
    foreign.release();
  } finally {
    await f.close();
  }
});

test("bridge arm refuses simultaneous memory pressure before claim publication", async (t) => {
  const f = await bridge(t);
  try {
    await f.play();
    f.c.currentTime = 7;
    const b = f.memory.snapshot(),
      pin = f.memory.reserve(b.maxBytes - b.bytes - 1024, "foreign-pressure");
    assert.throws(() => f.owner.armInstrument({ source: f.input, bars: 2 }), {
      code: "combinedMemoryLimit",
    });
    assert.equal(f.owner.claims.size, 0);
    assert.equal(f.owner.capture.records.size, 0);
    assert(
      f.memory.snapshot().owners.some((x) => x.label === "foreign-pressure"),
    );
    pin.release();
  } finally {
    await f.close();
  }
});

test("unconfirmed bridge input disconnect retains claim/route/partial and blocks foreign stop until context close", async (t) => {
  const f = await bridge(t);
  try {
    await f.play();
    const h = await f.arm();
    f.pcm(512);
    const record = [...f.owner.capture.records][0];
    record.sourceLease.input.failDisconnect = true;
    let action = false;
    const stopped = f.owner.run("stop", () => {
      action = true;
      f.session.stop();
    });
    const n = f.captures.at(-1),
      p = n.options.processorOptions;
    n.send({
      type: "complete",
      ...p,
      capacity: p.endFrame - p.startFrame,
      frames: 512,
      reason: "userStop",
      blockSizes: [128],
    });
    await h.ready;
    n.send({ type: "closed" });
    await assert.rejects(h.closed, /model disconnect failed/);
    await assert.rejects(stopped);
    assert.equal(action, false);
    assert.equal(f.owner.claims.size, 1);
    assert.equal(f.owner.capture.snapshot().owners[0].state, "closing-error");
    assert(
      f.memory
        .snapshot()
        .owners.some((x) => x.label === "root-capture-selected-route"),
    );
    assert.throws(() => f.owner.armInstrument({ source: f.input }), {
      code: "recordBusy",
    });
    assert.equal(f.owner.capture.snapshot().retained.length, 1);
  } finally {
    await f.close();
  }
});

test("closed old capture callbacks cannot write or release a new bridge claim", async (t) => {
  const f = await bridge(t);
  try {
    await f.play();
    const first = await f.arm(),
      old = f.captures.at(-1);
    f.pcm(512, "userStop");
    await first.ready;
    const stop = first.stop();
    old.send({ type: "closed" });
    await stop;
    f.owner.releaseTake(first.take.id);
    const second = await f.arm(),
      before = f.memory.snapshot().bytes;
    old.send({
      type: "pcm",
      sequence: 1,
      offset: 512,
      frames: 128,
      buffers: [new Float32Array(128).buffer, new Float32Array(128).buffer],
    });
    old.send({ type: "closed" });
    assert.equal(f.owner.claims.size, 1);
    assert.equal(second.outcome, undefined);
    assert.equal(f.memory.snapshot().bytes, before);
  } finally {
    await f.close();
  }
});

test("foreign root Stop waits for capture acknowledged prefix and close before mutating shared transport", async (t) => {
  const f = await bridge(t);
  try {
    await f.play();
    const h = await f.arm();
    f.pcm(512);
    let action = false;
    const stop = f.owner.run("stop", () => {
      assert.equal(h.outcome.acknowledgedFrames, 512);
      action = true;
      f.session.stop();
    });
    assert.equal(h.outcome.terminalCause.code, "stop");
    assert.equal(action, false);
    assert.equal(f.transport.running, true);
    const n = f.captures.at(-1),
      p = n.options.processorOptions;
    n.send({
      type: "complete",
      ...p,
      capacity: p.endFrame - p.startFrame,
      frames: 512,
      reason: "userStop",
      blockSizes: [128],
    });
    await h.ready;
    assert.equal(action, false);
    n.send({ type: "closed" });
    await stop;
    assert.equal(action, true);
    assert.equal(f.transport.running, false);
    assert.equal(h.take.partial, true);
  } finally {
    await f.close();
  }
});
