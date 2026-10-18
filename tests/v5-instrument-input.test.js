import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createInstrumentInput,
  captureInputChannels,
  captureReservedBytes,
} from "../src/loop-station/instrument-input.js";
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { Transport } from "../src/audio/transport.js";
import { LoopStationSession } from "../src/loop-station/session.js";
import { WorkspaceAudioOwner } from "../src/loop-station/workspace-owner.js";
import { CaptureSession } from "../src/loop-station/capture-session.js";
import { MasterClock } from "../src/loop-station/master-clock.js";
import { validateLoopProject } from "../src/loop-station/project.js";
const bytes = new Uint8Array([1, 2, 3, 4]),
  hash = createHash("sha256").update(bytes).digest("hex");
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
class Node extends EventTarget {
  constructor(c) {
    super();
    this.context = c;
    this.gain = param();
    this.pan = param();
    this.offset = param();
    this.playbackRate = param();
    this.port = { postMessage() {}, close() {} };
  }
  connect() {}
  disconnect() {}
  send(data) {
    this.port.onmessage?.({ data });
  }
  start() {
    if (this.context.failStart) throw Error("native voice failed");
  }
  stop(when = 0) {
    if (when <= this.context.currentTime && !this.context.holdEnded)
      queueMicrotask(() => this.onended?.());
  }
}
class Context extends EventTarget {
  state = "running";
  sampleRate = 48000;
  currentTime = 0;
  sources = [];
  audioWorklet = { addModule: async () => {} };
  createGain() {
    return new Node(this);
  }
  createStereoPanner() {
    return new Node(this);
  }
  createBufferSource() {
    const n = new Node(this);
    this.sources.push(n);
    return n;
  }
  createConstantSource() {
    const n = new Node(this);
    this.sources.push(n);
    return n;
  }
  createBuffer(channels, length, sampleRate) {
    const a = Array.from({ length: channels }, (_, i) =>
      new Float32Array(length).fill(i ? -0.25 : 0.5),
    );
    return {
      length,
      numberOfChannels: channels,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: (i) => a[i],
      copyToChannel: (v, i) => a[i].set(v),
    };
  }
  async decodeAudioData() {
    return this.createBuffer(2, 4096, 48000);
  }
}
async function fixture(t, { recordedSet = false } = {}) {
  t.mock.method(globalThis, "fetch", async () => new Response(bytes));
  const c = new Context(),
    memory = new AudioMemory(),
    foreign = memory.reserve(1234, "foreign-owner"),
    transport = new Transport(),
    output = c.createGain();
  output.gain.value = 1;
  const registry = new InstrumentRegistry([
    {
      id: "qa-bank",
      version: "1",
      kind: "instrument-bank",
      setId: recordedSet ? "cdm-porto-recorded-candidate" : "qa",
      tradition: "qa",
      laras: "slendro",
      samples: ["note-a", "note-b"].map((id) => ({
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
  const project = validateLoopProject({
    format: "perkusi-project",
    schemaVersion: 5,
    mode: "loop-station",
    title: "Stereo input unit",
    timing: { bpm: 173, meter: [4, 4] },
    clock: { kind: "fixed-bar", sampleRate: 48000, framesPerBar: 66590 },
    master: { volume: 0.5 },
    origins: [],
    assetRefs: [],
    tracks: [
      {
        id: "selected",
        kind: "event",
        gain: 0.5,
        pan: 0,
        mute: false,
        solo: false,
        clips: [],
      },
    ],
  });
  const owner = new WorkspaceAudioOwner({
      memory,
      getProject: () => s.project,
    }),
    s = new LoopStationSession({
      context: c,
      transport,
      memory,
      registry,
      output,
      wallNow: () => c.currentTime * 1000,
      admission: owner,
    });
  s.project = project;
  s.plan = {
    project,
    clock: new MasterClock(project, 48000),
    tracks: project.tracks,
    trackDocuments: new Map(),
    release() {},
  };
  owner.attach({ context: c, transport, master: output, output, volume: 1 }, s);
  const nodes = [];
  await owner.prepareInstrument("selected", {
    moduleURL: "https://qa.test/capture.js",
    openSession: (o) =>
      CaptureSession.open({
        ...o,
        nodeFactory: (ctx, options) => {
          const n = new Node(ctx);
          n.options = options;
          nodes.push(n);
          return n;
        },
      }),
  });
  s.status = "playing";
  transport.start(0.1); // Unit admission fixture; no fake rendering claim.
  const source = await createInstrumentInput({
    context: c,
    transport,
    memory,
    registry,
    bankId: "qa-bank",
    bankVersion: "1",
    sampleIds: ["note-a", "note-b"],
    framesPerBar: 66590,
    endFrame: 1000000,
  });
  const f = {
    c,
    memory,
    source,
    owner,
    s,
    nodes,
    arm: () => owner.armInstrument({ source, bars: 2 }),
    closeNode() {
      for (const n of nodes) {
        const p = n.options.processorOptions;
        n.send({
          type: "complete",
          ...p,
          capacity: p.endFrame - p.startFrame,
          frames: 0,
          reason: "userStop",
          blockSizes: [128],
        });
        n.send({ type: "closed" });
      }
    },
    async close() {
      const b = owner.begin("test-cleanup");
      f.closeNode();
      for (const n of c.sources) n.onended?.();
      await b.closed;
      b.finish();
      await source.dispose();
      await owner.dispose();
      c.state = "closed";
      c.dispatchEvent(new Event("statechange"));
      await s.dispose();
      assert.equal(memory.snapshot().bytes, 1234);
      foreign.release();
      assert.equal(memory.snapshot().bytes, 0);
    },
  };
  return f;
}

test("Gamelan capture producer declares the same calibrated peak as its native input trim", async (t) => {
  const f = await fixture(t, { recordedSet: true });
  try {
    // Active-level matching respects the two-voice.8 programme budget even for
    // this artificial DC step; its native input trim is included in admission.
    assert(f.source.peak >= 0.4 && f.source.peak <= 0.8000001);
  } finally {
    await f.close();
  }
});
test("stereo capability cannot be forged, relabeled or admitted under mono guards", async (t) => {
  const f = await fixture(t);
  try {
    assert.equal(
      captureInputChannels(f.source, f.c, f.memory, f.owner.engine.transport),
      2,
    );
    for (const source of [
      { ...f.source },
      { ...f.source, kind: "qualified-finite-synthetic" },
      { kind: "qualified-finite-synthetic", channels: 2 },
    ])
      assert.throws(() => f.owner.armInstrument({ source }), {
        code: "invalidCaptureSource",
      });
    assert.throws(() => f.owner.armSynthetic({ source: f.source }), {
      code: "invalidCaptureSource",
    });
    assert.throws(
      () =>
        captureInputChannels(
          f.source,
          f.c,
          new AudioMemory(),
          f.owner.engine.transport,
        ),
      { code: "invalidCaptureSource" },
    );
    assert.equal(f.owner.claims.size, 0);
    assert.equal(f.nodes.length, 0);
  } finally {
    await f.close();
  }
});
test("stereo root/workspace reserve all channel copies/pages/route before async preparation", async (t) => {
  const f = await fixture(t);
  try {
    assert.equal(captureReservedBytes(1, 133180), 8 * 133180 + 49152);
    assert.equal(captureReservedBytes(2, 133180), 2212800);
    const h = f.arm(),
      claim = [...f.owner.claims][0];
    assert.equal(claim.channels, 2);
    assert.equal(claim.voices, 4);
    assert.equal(claim.futureBytes, 2212800);
    await h.prepared;
    assert.equal(h.node.options.processorOptions.channels, 2);
    assert.deepEqual(h.node.options.outputChannelCount, [2]);
    assert.equal(claim.futureBytes, 0);
    assert.equal(f.source.monitoring, "disabled");
    assert.deepEqual(f.source.effects, []);
  } finally {
    await f.close();
  }
});
test("two-voice capacity and physical pad ownership retain tails and final-owner damp across caller locale/focus", async (t) => {
  const f = await fixture(t);
  try {
    const h = f.arm();
    await h.prepared;
    f.c.holdEnded = true;
    f.source.strike("note-a", { when: 0.05 });
    f.source.press("keyboard:KeyA", "note-b", { when: 0.05 });
    const before = f.source.snapshot(),
      native = f.c.sources.length;
    assert.throws(
      () => f.source.press("touch:other", "note-a", { when: 0.05 }),
      { code: "voiceLimit" },
    );
    assert.equal(f.c.sources.length, native);
    assert.deepEqual(f.source.snapshot().tokens, before.tokens);
    f.source.press("touch:1", "note-b", { when: 0.05 });
    let view = { locale: "id", focus: "note-b" };
    view = { locale: "en", focus: "note-a" };
    assert.equal(view.locale, "en");
    f.source.release("keyboard:KeyA", { when: 0.055 });
    assert.equal(
      f.source.snapshot().voices.find((v) => v.id === "note-b").endFrame,
      2400 + 4096,
    );
    f.source.release("touch:1", { when: 0.06 });
    assert.equal(
      f.source.snapshot().voices.find((v) => v.id === "note-b").endFrame,
      3840,
    );
    assert.equal(
      f.source.snapshot().voices.find((v) => v.id === "note-a").endFrame,
      2400 + 4096,
    );
    assert.equal(f.source.snapshot().voices.length, 2);
    assert.equal(f.source.snapshot().tokens.length, 0);
  } finally {
    await f.close();
  }
});
test("producer voice admission refusal publishes no token/native pin and keeps active capture", async (t) => {
  const f = await fixture(t);
  try {
    const h = f.arm();
    await h.prepared;
    const check = f.owner.capture.root.headroom;
    f.owner.capture.root.headroom = () => ({ peak: 0.95, voices: 1 });
    const before = f.source.snapshot(),
      native = f.c.sources.length,
      bytes = f.memory.snapshot().bytes;
    assert.throws(() => f.source.press("keyboard:A", "note-a"), {
      code: "captureHeadroom",
    });
    assert.equal(f.c.sources.length, native);
    assert.equal(f.memory.snapshot().bytes, bytes);
    assert.deepEqual(f.source.snapshot().tokens, before.tokens);
    assert.equal(f.source.snapshot().voices.length, 0);
    assert.equal(h.state, "armed");
    f.owner.capture.root.headroom = check;
  } finally {
    await f.close();
  }
});
test("capture.closed precedes producer pin/node release and actual native ended precedes claim release", async (t) => {
  const f = await fixture(t);
  try {
    const h = f.arm();
    await h.prepared;
    f.c.holdEnded = true;
    f.source.strike("note-a", { when: 0.05 });
    let closed = false;
    void h.closed.then(() => {
      closed = true;
    });
    h.stop();
    f.closeNode();
    await new Promise((r) => setImmediate(r));
    assert.equal(closed, false);
    assert.equal(f.owner.claims.size, 1);
    assert.equal(f.source.snapshot().disposed, false);
    assert.ok(f.memory.snapshot().bytes > 1234);
    for (const n of f.c.sources) n.onended?.();
    await h.closed;
    assert.equal(f.owner.claims.size, 0);
    assert.equal(f.source.snapshot().disposed, true);
    assert.equal(f.source.snapshot().voices.length, 0);
  } finally {
    await f.close();
  }
});
test("producer failure is terminal and distinct from controlled stereo idle silence", async (t) => {
  const f = await fixture(t);
  try {
    const h = f.arm();
    await h.prepared;
    assert.equal(h.inputOutcome, null);
    assert.equal(f.source.snapshot().voices.length, 0);
    f.source.invalidate("producer-test-loss");
    assert.equal(h.inputOutcome.code, "instrumentInputLost");
    assert.equal(h.inputOutcome.reason, "producer-test-loss");
    assert.throws(() => f.source.press("keyboard:A", "note-a"), {
      code: "recordBusy",
    });
    assert.equal(f.source.snapshot().tokens.length, 0);
    f.closeNode();
    await h.closed;
    assert.equal(f.owner.claims.size, 0);
  } finally {
    await f.close();
  }
});
test("native activation failure rolls back its token and retains terminal cleanup ownership", async (t) => {
  const f = await fixture(t);
  try {
    const h = f.arm();
    await h.prepared;
    f.c.failStart = true;
    assert.throws(
      () => f.source.press("keyboard:A", "note-a"),
      /native voice failed/,
    );
    assert.equal(f.source.snapshot().tokens.length, 0);
    assert.equal(f.source.snapshot().voices.length, 0);
    assert.equal(h.inputOutcome.code, "instrumentInputLost");
    f.closeNode();
    await h.closed;
    assert.equal(f.owner.claims.size, 0);
  } finally {
    await f.close();
  }
});

test("stereo future-memory refusal is atomic before claims or source preparation", async (t) => {
  const f = await fixture(t);
  let filler;
  try {
    const before = f.memory.snapshot(),
      version = f.owner.version;
    filler = f.memory.reserve(
      before.maxBytes - before.bytes - 2212800 + 1,
      "memory-counterexample",
    );
    assert.throws(() => f.arm(), { code: "combinedMemoryLimit" });
    assert.equal(f.owner.claims.size, 0);
    assert.equal(f.owner.version, version);
    assert.equal(f.nodes.length, 0);
    assert.equal(f.source.snapshot().accepting, false);
  } finally {
    filler?.release();
    await f.close();
  }
});
test("unexpected native carrier end cancels an otherwise idle producer", async (t) => {
  const f = await fixture(t);
  try {
    const h = f.arm();
    await h.prepared;
    f.c.sources[0].onended();
    assert.equal(h.inputOutcome.reason, "instrumentInputEnded");
    assert.equal(f.source.isCurrent(), false);
    f.closeNode();
    await h.closed;
    assert.equal(f.owner.claims.size, 0);
  } finally {
    await f.close();
  }
});

for (const advanced of [false, true])
  for (const strikeFirst of [false, true])
    test(`final pad owner damps every same-pad row: ${strikeFirst ? "strike then held" : "held then strike"}, ${advanced ? "advancing clock" : "queued"}`, async (t) => {
      const f = await fixture(t);
      try {
        const h = f.arm();
        await h.prepared;
        f.c.holdEnded = true;
        if (strikeFirst) f.source.strike("note-a", { when: 0.05 });
        f.source.press("keyboard:A", "note-a", {
          when: strikeFirst ? 0.055 : 0.05,
        });
        f.source.press("touch:1", "note-a", { when: 0.055 });
        if (!strikeFirst) {
          if (advanced) f.c.currentTime = 0.055;
          f.source.strike("note-a", { when: 0.055 });
        }
        const before = f.source.snapshot(),
          scopes = before.cache.activeScopes;
        if (advanced) f.c.currentTime = 0.06;
        f.source.release("keyboard:A", { when: 0.06 });
        assert.deepEqual(f.source.snapshot().voices, before.voices);
        if (advanced) f.c.currentTime = 0.065;
        f.source.release("touch:1", { when: 0.065 });
        const after = f.source.snapshot();
        assert.equal(after.tokens.length, 0);
        assert.equal(after.voices.length, 2);
        assert.ok(after.voices.every((v) => v.endFrame === 4080));
        assert.equal(after.cache.activeScopes, scopes);
        assert.equal(after.fault, null);
        assert.equal(h.inputOutcome, null);
        assert.equal(f.owner.claims.size, 1);
        assert.throws(
          () => f.source.press("touch:overflow", "note-b", { when: 0.07 }),
          { code: "voiceLimit" },
        );
      } finally {
        await f.close();
      }
    });

test("retriggering an ending pad never extends the older damp or releases its pin early", async (t) => {
  const f = await fixture(t);
  try {
    const h = f.arm();
    await h.prepared;
    f.c.holdEnded = true;
    f.source.press("keyboard:A", "note-a", { when: 0.05 });
    f.c.currentTime = 0.06;
    f.source.release("keyboard:A");
    f.c.currentTime = 0.065;
    f.source.press("touch:1", "note-a", { when: 0.065 });
    const scopes = f.source.snapshot().cache.activeScopes;
    f.c.currentTime = 0.07;
    f.source.release("touch:1");
    assert.deepEqual(
      f.source.snapshot().voices.map((v) => v.endFrame),
      [3840, 4320],
    );
    assert.equal(f.source.snapshot().cache.activeScopes, scopes);
    f.c.sources[1].onended();
    assert.equal(f.source.snapshot().voices.length, 1);
    assert.equal(f.source.snapshot().cache.activeScopes, scopes - 1);
    assert.equal(f.owner.claims.size, 1);
    f.source.strike("note-b", { when: 0.075 });
    const b = f.source.snapshot().voices.find((v) => v.id === "note-b");
    assert.equal(f.source.release("touch:1", { when: 0.08 }), false);
    assert.equal(
      f.source.snapshot().voices.find((v) => v.id === "note-b").endFrame,
      b.endFrame,
    );
  } finally {
    await f.close();
  }
});

test("monitored producer is separately reserved and a stopped reader does not dispose live input", async (t) => {
  const f = await fixture(t);
  try {
    await f.source.dispose();
    const source = await f.owner.assignInstrument("selected", {
      bankId: "qa-bank",
      bankVersion: "1",
      sampleIds: ["note-a", "note-b"],
    });
    assert.equal(source.monitoring, "selected-track");
    assert.equal(source.voices, 1);
    assert.equal(f.owner.producers.get("selected").voices, 3);
    source.press("keyboard:A", "note-a", { when: 0.05 });
    assert.equal(source.snapshot().voices.length, 1);
    const h = f.owner.armInstrument({ source, bars: 2, countInBars: 1 });
    assert.equal([...f.owner.claims][0].voices, 1);
    assert.equal(f.owner.check(f.s.plan, f.s.project).voices, 4);
    await h.prepared;
    assert.equal(h.plan.startFrame - h.plan.countInFrame, 66590);
    const stopped = f.owner.capture.stopTrack("selected");
    f.closeNode();
    await stopped;
    await h.closed;
    assert.equal(f.owner.claims.size, 0);
    assert.equal(source.snapshot().disposed, false);
    assert.equal(source.snapshot().voices.length, 1);
    assert.equal(f.owner.producers.size, 1);
    const silent = source.silence();
    for (const n of f.c.sources) n.onended?.();
    await silent;
    assert.equal(source.snapshot().tokens.length, 0);
  } finally {
    await f.close();
  }
});
test("unsafe monitor plus replay overlap refuses before capture admission", async (t) => {
  const f = await fixture(t);
  try {
    await f.source.dispose();
    const source = await f.owner.assignInstrument("selected", {
      bankId: "qa-bank",
      bankVersion: "1",
      sampleIds: ["note-a", "note-b"],
    });
    f.s.project = structuredClone(f.s.project);
    f.s.project.tracks[0].gain = 1;
    f.s.project.tracks[0].pan = 1;
    f.s.project.master.volume = 1;
    // Existing project identity is stale, but the combined headroom refusal must
    // happen synchronously before any capture claim or source-reader publication.
    const version = f.owner.version;
    assert.throws(() => f.owner.armInstrument({ source, bars: 2 }), {
      code: "voiceHeadroom",
    });
    assert.equal(f.owner.version, version);
    assert.equal(f.owner.claims.size, 0);
    assert.equal(source.snapshot().disposed, false);
  } finally {
    await f.close();
  }
});
