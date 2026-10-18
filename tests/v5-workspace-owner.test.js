import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceAudioOwner } from "../src/loop-station/workspace-owner.js";
import { LoopStationSession } from "../src/loop-station/session.js";
import { CaptureSession } from "../src/loop-station/capture-session.js";
import { MasterClock } from "../src/loop-station/master-clock.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { Transport } from "../src/audio/transport.js";
import { validateLoopProject } from "../src/loop-station/project.js";
import { PPQ } from "../src/project/instrument-project.js";
const gate = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const tick = () => new Promise((r) => setImmediate(r));
const param = () => ({
  value: 0,
  calls: [],
  setValueAtTime(v, t) {
    this.value = v;
    this.calls.push(["set", v, t]);
  },
  linearRampToValueAtTime(v, t) {
    this.value = v;
    this.calls.push(["ramp", v, t]);
  },
  cancelScheduledValues(t) {
    this.calls.push(["cancel", t]);
  },
});

test("stopped warm plan does not reserve future playback voices during export; ending rows still own slots", async () => {
  const f = await fixture({ voices: 9, peak: 0.01 });
  try {
    const plan = f.session.plan;
    assert.equal(f.owner.bounds().maxOwned, 9);
    assert.throws(() => f.owner.reserveRender(plan), { code: "voiceLimit" });
    f.context.holdEnded = true;
    f.session.stop();
    assert.equal(f.session.rows.size, 9);
    assert.throws(() => f.owner.reserveRender(plan), { code: "voiceLimit" });
    // A stop request alone is not a release receipt. Count remaining owners,
    // including future-scheduled nodes, until their real ended callbacks run.
    for (const s of f.context.sources.slice(0, 2)) s.onended();
    assert.equal(f.session.rows.size, 7);
    const overlapping = f.owner.reserveRender(plan);
    assert.equal(f.owner.renders.size, 1);
    overlapping.release();
    for (const s of f.context.sources) s.onended?.();
    await f.session.waitVoices();
    for (const owners of [f.owner.claims, f.owner.playbacks, f.owner.renders]) {
      const claim = { voices: 8 };
      owners.add(claim);
      assert.throws(() => f.owner.reserveRender(plan), { code: "voiceLimit" });
      owners.delete(claim);
    }
    f.owner.producers.set("track-2", { voices: 8 });
    assert.throws(() => f.owner.reserveRender(plan), { code: "voiceLimit" });
    f.owner.producers.delete("track-2");
    for (let cycle = 0; cycle < 3; cycle++) {
      const ticket = f.owner.reserveRender(plan);
      assert.throws(() => f.owner.reserveRender(plan), { code: "voiceLimit" });
      assert.throws(() => f.session.play(), { code: "voiceLimit" });
      ticket.release();
      ticket.release();
      f.context.holdEnded = false;
      f.session.play();
      if (cycle % 2) f.session.pause();
      else f.session.stop();
      await tick();
      await f.session.waitVoices();
      assert.equal(f.owner.renders.size, 0);
      assert.equal(f.session.rows.size, 0);
    }
  } finally {
    await f.cleanup();
  }
});

test("Loop playhead follows the fixed audio clock with pause freeze and a real tail interval", async () => {
  const f = await fixture();
  try {
    const before = JSON.stringify(f.document),
      origin = f.session.transport.origin;
    assert.equal(f.session.playhead().state, "waiting");
    f.context.currentTime = origin + 33295 / 48000;
    assert.equal(f.session.playhead().step, 8);
    assert.equal(f.session.playhead().state, "playing");
    f.context.currentTime = origin + 70000 / 48000;
    assert.equal(f.session.playhead().state, "tail");
    assert.equal(f.session.playhead().step, null);
    assert.equal(f.session.playhead().phase, 1);
    f.session.pause();
    const p = f.session.playhead();
    f.context.currentTime += 1;
    assert.deepEqual(f.session.playhead(), p);
    assert.equal(p.state, "paused");
    f.session.stop();
    assert.equal(f.session.playhead().step, null);
    assert.equal(JSON.stringify(f.document), before);
  } finally {
    await f.cleanup();
  }
});
class Node extends EventTarget {
  constructor(context) {
    super();
    this.context = context;
    this.connections = new Set();
    this.gain = param();
    this.pan = param();
    this.sent = [];
    this.port = {
      postMessage: (m) => this.sent.push(m),
      close: () => {
        this.portClosed = true;
      },
    };
  }
  connect(n) {
    this.connections.add(n);
    return n;
  }
  disconnect(n) {
    if (n) this.connections.delete(n);
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
  sources = [];
  audioWorklet = {
    addModule: async () => {
      if (this.moduleGate) await this.moduleGate.promise;
    },
  };
  createGain() {
    return new Node(this);
  }
  createStereoPanner() {
    return new Node(this);
  }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from(
      { length: channels },
      () => new Float32Array(length),
    );
    return {
      length,
      sampleRate,
      numberOfChannels: channels,
      duration: length / sampleRate,
      getChannelData: (c) => data[c],
      copyToChannel: (a, c) => data[c].set(a),
    };
  }
  createBufferSource() {
    const n = new Node(this);
    n.playbackRate = param();
    n.start = () => {};
    n.stop = () => {
      if (!this.holdEnded) queueMicrotask(() => n.onended?.());
    };
    this.sources.push(n);
    return n;
  }
}
function project({ master = 1, gain = 0.125 } = {}) {
  return validateLoopProject({
    format: "perkusi-project",
    schemaVersion: 5,
    mode: "loop-station",
    title: "Owner test",
    timing: { bpm: 173, meter: [4, 4] },
    master: { volume: master },
    clock: { kind: "fixed-bar", sampleRate: 48000, framesPerBar: 66590 },
    origins: [],
    assetRefs: [
      {
        id: "qa-foreign",
        kind: "recording",
        sha256: "a".repeat(64),
        bytes: 66590 * 4,
        frames: 66590,
        channels: 1,
        sampleRate: 48000,
        encoding: "float32le",
        recordedBpm: 173,
      },
    ],
    tracks: Array.from({ length: 8 }, (_, i) => ({
      id: "track-" + (i + 1),
      kind: i === 0 ? "recording" : "event",
      gain: i === 1 ? 0.75 : gain,
      pan: 0,
      mute: false,
      solo: false,
      clips:
        i === 0
          ? [
              {
                id: "qa-clip",
                sourceId: "qa-foreign",
                startTick: 0,
                lengthTicks: 4 * PPQ,
                offsetFrames: 0,
                loop: false,
              },
            ]
          : [],
    })),
  });
}
async function fixture({
  master = 1,
  voices = 1,
  gain = 0.125,
  peak = 0.25,
  frames = 66590,
  loop = false,
  channels = 1,
} = {}) {
  const f = {
    context: new Context(),
    memory: new AudioMemory(),
    nodes: [],
    sourcePins: 0,
  };
  f.foreign = f.memory.reserve(1234, "foreign-root-owner");
  f.document = project({ master, gain, voices });
  const transport = new Transport({ bpm: 11520000 / 66590 }),
    output = f.context.createGain();
  output.gain.value = 1;
  f.engine = {
    context: f.context,
    transport,
    master: output,
    output,
    volume: 1,
    disposed: false,
  };
  f.owner = new WorkspaceAudioOwner({
    memory: f.memory,
    getProject: () => f.document,
  });
  f.session = new LoopStationSession({
    context: f.context,
    wallNow: () => f.context.wall ?? f.context.currentTime * 1000,
    transport,
    memory: f.memory,
    output,
    ownsTransport: true,
    admission: f.owner,
    prepare: async (p) => {
      if (f.loadGate) await f.loadGate.promise;
      const lease = f.memory.reserve(
        channels * frames * 4,
        "QA/preallocated-foreign-buffer",
      );
      const buffer = f.context.createBuffer(channels, frames, 48000);
      for (let ch = 0; ch < channels; ch++)
        buffer.getChannelData(ch).fill(0.25);
      return {
        project: validateLoopProject(p),
        clock: new MasterClock(p, 48000),
        tracks: p.tracks.map((t, i) => ({
          ...t,
          clips:
            i === 0
              ? [
                  {
                    ...t.clips[0],
                    loop,
                    maxTailFrames: frames,
                    voices: Array.from({ length: voices }, (_, j) => ({
                      key: "qa" + j,
                      buffer,
                      frames,
                      tick: 0,
                      dampTick: null,
                      velocity: 1,
                      scale: 4,
                      pan: 0,
                      peak,
                    })),
                  },
                ]
              : [],
        })),
        trackDocuments: new Map(),
        release: () => lease.release(),
      };
    },
  });
  f.owner.attach(f.engine, f.session);
  await f.session.load(f.document);
  await f.owner.prepareSynthetic("track-2", {
    moduleURL: "https://qa.test/capture.js",
    openSession: (o) =>
      CaptureSession.open({
        ...o,
        nodeFactory: (c, opts) => {
          const n = new Node(c);
          n.options = opts;
          f.nodes.push(n);
          return n;
        },
      }),
  });
  f.session.play();
  f.input = new Node(f.context);
  f.source = {
    kind: "qualified-finite-synthetic",
    context: f.context,
    memory: f.memory,
    sampleRate: 48000,
    framesPerBar: 66590,
    preGain: true,
    referenceSHA256: "b".repeat(64),
    generation: 0,
    estimatedBytes: 0,
    voices: 1,
    peak: 1,
    isCurrent: () => true,
    async prepare() {
      f.sourcePins++;
      if (f.sourceGate) await f.sourceGate.promise;
      return {
        input: f.input,
        memory: f.memory,
        generation: 0,
        startFrame: 0,
        endFrame: 786432,
        release() {
          f.sourcePins--;
        },
      };
    },
  };
  f.arm = () => f.owner.armSynthetic({ source: f.source });
  f.mix = (change) => {
    const p = structuredClone(f.session.project);
    change(p);
    const accepted = f.session.setMix(p);
    f.document = accepted;
    return accepted;
  };
  f.close = (n, reason = "userStop", frames = 0) => {
    const p = n.options.processorOptions;
    n.send({
      type: "complete",
      ...p,
      capacity: p.endFrame - p.startFrame,
      reason,
      frames,
      blockSizes: [128],
    });
    n.send({ type: "closed" });
  };
  f.complete = async (h) => {
    await h.prepared;
    const n = h.node,
      L = h.plan.endFrame - h.plan.startFrame;
    for (let i = 0, seq = 0; i < L; seq++) {
      const frames = Math.min(4096, L - i);
      n.send({
        type: "pcm",
        sequence: seq,
        offset: i,
        frames,
        buffers: [new Float32Array(frames).fill(0.125).buffer],
      });
      i += frames;
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
    return h.ready;
  };
  f.cleanup = async () => {
    const boundary = f.owner.begin("QA-cleanup");
    for (const n of f.nodes) if (!n.portClosed) f.close(n);
    await boundary.closed;
    boundary.finish();
    for (const t of f.owner.capture?.snapshot().retained ?? [])
      f.owner.releaseTake(t.id);
    await f.owner.replaceable();
    f.session.stop();
    f.context.state = "closed";
    for (const s of f.context.sources) s.onended?.();
    await f.session.dispose();
    assert.equal(f.memory.snapshot().bytes, 1234);
    f.foreign.release();
    assert.equal(f.memory.snapshot().bytes, 0);
  };
  return f;
}
test("actual master1 rejects reverse gain saturation; master.5 admits without duplicate gain", async () => {
  for (const master of [1, 0.5]) {
    const f = await fixture();
    try {
      f.engine.volume = master;
      f.engine.master.gain.value = master;
      const h = f.arm();
      await h.prepared;
      const before = JSON.stringify(f.document),
        calls = f.session.graphs.get("track-1").gain.gain.calls.length;
      if (master === 1) {
        assert.throws(() => f.mix((p) => (p.tracks[0].gain = 1)), {
          code: "voiceHeadroom",
        });
        assert.equal(JSON.stringify(f.document), before);
        assert.equal(
          f.session.graphs.get("track-1").gain.gain.calls.length,
          calls,
        );
      } else f.mix((p) => (p.tracks[0].gain = 1));
      assert.equal(h.output.gain.value, 1);
      assert.ok(h.output.connections.has(f.session.graphs.get("track-2").gain));
      assert.equal(f.session.graphs.get("track-2").gain.gain.value, 0.75);
      assert.ok(f.session.master.connections.has(f.engine.master));
    } finally {
      await f.cleanup();
    }
  }
});
test("ordinary mix first then capture refuses before source preparation at master1", async () => {
  const f = await fixture();
  try {
    f.mix((p) => (p.tracks[0].gain = 1));
    assert.throws(() => f.arm(), { code: "voiceHeadroom" });
    assert.equal(f.sourcePins, 0);
    assert.equal(f.owner.claims.size, 0);
  } finally {
    await f.cleanup();
  }
});
test("project master is counted exactly once in both ordinary and selected paths", async () => {
  const f = await fixture({ master: 0.5, gain: 1 });
  try {
    const h = f.arm();
    await h.prepared;
    assert.equal(f.session.master.gain.value, 0.5);
    assert.equal(f.engine.master.gain.value, 1);
    assert.throws(() => f.mix((p) => (p.master.volume = 1)), {
      code: "voiceHeadroom",
    });
    assert.equal(f.document.master.volume, 0.5);
    assert.equal(h.state, "armed");
  } finally {
    await f.cleanup();
  }
});
test("pending source and module awaits already reserve peak/voices; release only after closed ack", async () => {
  for (const phase of ["source", "module"]) {
    const f = await fixture();
    try {
      const g = gate();
      if (phase === "source") f.sourceGate = g;
      else f.context.moduleGate = g;
      const h = f.arm();
      await tick();
      assert.equal(f.owner.claims.size, 1);
      assert.throws(() => f.mix((p) => (p.tracks[0].gain = 1)), {
        code: "voiceHeadroom",
      });
      g.resolve();
      await h.prepared;
      assert.equal([...f.owner.claims][0].futureBytes, 0);
      h.stop();
      await tick();
      assert.equal(f.owner.claims.size, 1);
      assert.equal(f.sourcePins, 1);
      f.close(h.node);
      await h.closed;
      await tick();
      assert.equal(f.owner.claims.size, 0);
      assert.equal(f.sourcePins, 0);
    } finally {
      await f.cleanup();
    }
  }
});
test("pending periodic future voices/tails count even if tracks are muted/stopped", async () => {
  const f = await fixture({ voices: 15, frames: 128, peak: 0, gain: 0 });
  try {
    f.source.voices = 2;
    f.session.stopTrack("track-1");
    assert.throws(() => f.arm(), { code: "voiceLimit" });
    assert.equal(f.sourcePins, 0);
  } finally {
    await f.cleanup();
  }
});
test("periodic long tails include lookahead/grace occupancy rather than instantaneous node count", async () => {
  const f = await fixture({
    voices: 4,
    frames: 150000,
    loop: true,
    peak: 0,
    gain: 0,
  });
  try {
    assert.ok(f.owner.bounds().maxOwned > f.session.rows.size);
    f.source.voices = 2;
    assert.throws(() => f.arm(), { code: "voiceLimit" });
  } finally {
    await f.cleanup();
  }
});
test("solo/unmute/pan and selected gain refusals preserve accepted routing and document", async () => {
  const f = await fixture({ gain: 1 });
  try {
    f.mix((p) => (p.tracks[0].mute = true));
    f.context.currentTime += 0.08;
    const h = f.arm();
    await h.prepared;
    for (const change of [
      (p) => (p.tracks[0].mute = false),
      (p) => (p.tracks[1].gain = 1),
      (p) => (p.tracks[1].pan = 1),
      (p) => {
        p.tracks[0].mute = false;
        p.tracks[0].solo = true;
        p.tracks[1].solo = true;
      },
    ]) {
      const before = JSON.stringify(f.document);
      assert.throws(() => f.mix(change), { code: "voiceHeadroom" });
      assert.equal(JSON.stringify(f.document), before);
    }
  } finally {
    await f.cleanup();
  }
});
test("mix ramp frontier prevents pending capture from using a prematurely lowered gain", async () => {
  const f = await fixture({ gain: 1 });
  try {
    f.mix((p) => (p.tracks[0].gain = 0.125));
    assert.throws(() => f.arm(), { code: "voiceHeadroom" });
    f.context.currentTime += 0.074;
    const h = f.arm();
    await h.prepared;
    assert.equal(h.state, "armed");
  } finally {
    await f.cleanup();
  }
});
test("late memory pressure refuses ordinary changes and capture; foreign reservation remains owned", async () => {
  const f = await fixture();
  let held;
  try {
    f.sourceGate = gate();
    const h = f.arm();
    await tick();
    const original = JSON.stringify(f.document);
    held = f.memory.reserve(
      f.memory.snapshot().maxBytes - f.memory.snapshot().bytes - 10000,
      "foreign-pressure",
    );
    assert.throws(() => f.mix((p) => (p.tracks[0].gain = 0.1)), {
      code: "combinedMemoryLimit",
    });
    assert.equal(JSON.stringify(f.document), original);
    f.sourceGate.resolve();
    await assert.rejects(h.prepared, { code: "combinedMemoryLimit" });
    await h.closed;
    assert.equal(f.owner.claims.size, 0);
    assert.ok(
      f.memory.snapshot().owners.some((x) => x.label === "foreign-pressure"),
    );
  } finally {
    held?.release();
    await f.cleanup();
  }
});
test("rejoin readmits shared pending capture and memory before touching stopped-track cursors", async () => {
  const f = await fixture();
  let held;
  try {
    f.session.stopTrack("track-1");
    await tick();
    const h = f.arm();
    await h.prepared;
    held = f.memory.reserve(
      f.memory.snapshot().maxBytes - f.memory.snapshot().bytes - 1000,
      "foreign-pressure",
    );
    assert.throws(() => f.session.playTrack("track-1"), {
      code: "combinedMemoryLimit",
    });
    assert.ok(f.session.stoppedTracks.has("track-1"));
  } finally {
    held?.release();
    await f.cleanup();
  }
});
for (const kind of ["stop", "pause", "import", "navigation", "dispose"]) {
  for (const phase of ["source", "module", "armed", "recording", "replay"]) {
    test(`dispatcher ${kind} during ${phase} is terminal before action and drains selected worker`, async () => {
      const f = await fixture();
      try {
        if (phase === "source") f.sourceGate = gate();
        if (phase === "module") f.context.moduleGate = gate();
        const h = f.arm();
        await tick();
        if (!["source", "module"].includes(phase)) await h.prepared;
        if (phase === "recording") {
          h.node.send({ type: "started", frame: h.plan.startFrame });
          h.node.send({
            type: "pcm",
            sequence: 0,
            offset: 0,
            frames: 128,
            buffers: [new Float32Array(128).buffer],
          });
        }
        if (phase === "replay") await f.complete(h);
        let ran = false;
        const op = f.owner.run(kind, () => {
          ran = true;
          assert.equal(f.owner.capture.admission, false);
        });
        assert.equal(f.owner.capture.admission, false);
        assert.equal(ran, false);
        assert.equal(f.session.status, "playing");
        assert.ok(f.engine.transport.running);
        f.sourceGate?.resolve();
        f.context.moduleGate?.resolve();
        await tick();
        for (const n of f.nodes)
          if (!n.portClosed)
            f.close(
              n,
              phase === "recording" ? "userStop" : "userStop",
              phase === "recording" ? 128 : 0,
            );
        await op;
        assert.ok(ran);
        await h.closed;
        assert.equal(f.sourcePins, 0);
        assert.equal(f.owner.claims.size, 0);
        assert.equal(f.context.state, "running");
        assert.equal(f.engine.transport.running, true);
      } finally {
        await f.cleanup();
      }
    });
  }
}
test("completed or partial take blocks destructive departure without dropping pins or foreign playback", async () => {
  for (const partial of [false, true]) {
    const f = await fixture();
    try {
      const h = f.arm();
      await h.prepared;
      let take;
      if (partial) {
        h.node.send({
          type: "pcm",
          sequence: 0,
          offset: 0,
          frames: 128,
          buffers: [new Float32Array(128).buffer],
        });
        f.close(h.node, "inputLost", 128);
        take = await h.ready;
        await h.closed;
      } else {
        take = await f.complete(h);
      }
      let ran = false;
      const departure = f.owner.run(
        "navigation",
        () => {
          ran = true;
        },
        { destructive: true },
      );
      if (!partial) {
        f.close(h.node);
        await h.closed;
      }
      await assert.rejects(departure, { code: "captureTakeNeedsReview" });
      assert.equal(ran, false);
      assert.equal(f.context.state, "running");
      assert.equal(f.engine.transport.running, true);
      assert.throws(() => f.owner.pool.release(take.id), { code: "takeHeld" });
      assert.equal(f.owner.pool.describe(take.id).partial, partial);
      f.owner.releaseTake(take.id);
      await f.owner.run(
        "navigation",
        () => {
          ran = true;
        },
        { destructive: true },
      );
      assert.ok(ran);
    } finally {
      await f.cleanup();
    }
  }
});
test("failed save after empty cancellation keeps the route, project and caller audio alive", async () => {
  const f = await fixture();
  try {
    const h = f.arm();
    await h.prepared;
    const op = f.owner.run(
      "navigation",
      () => {
        throw Object.assign(Error(), { code: "draftConflict" });
      },
      { destructive: true },
    );
    f.close(h.node);
    await assert.rejects(op, { code: "draftConflict" });
    assert.equal(f.context.state, "running");
    assert.equal(f.engine.transport.running, true);
    assert.equal(f.session.status, "playing");
  } finally {
    await f.cleanup();
  }
});
test("new explicit arm epoch after confirmed cancellation uses same engine/clock/ledger", async () => {
  const f = await fixture();
  try {
    const a = f.arm();
    await a.prepared;
    const cancelled = f.owner.run("stop", () => {});
    f.close(a.node);
    await cancelled;
    const b = f.arm();
    await b.prepared;
    assert.equal(f.nodes.length, 2);
    assert.equal(f.sourcePins, 1);
    assert.equal(f.owner.capture.context, f.engine.context);
    assert.equal(f.owner.pool.usesMemory(f.memory), true);
  } finally {
    await f.cleanup();
  }
});
test("adoption failure and replay fault preserve independent outcomes and conservative reservation until closed", async () => {
  for (const adoption of [true, false]) {
    const f = await fixture();
    try {
      const h = f.arm();
      await h.prepared;
      const adopt = f.owner.pool.adopt;
      if (adoption)
        f.owner.pool.adopt = () => {
          throw Error("adoption");
        };
      const take = await f.complete(h);
      if (!adoption)
        h.node.send({
          type: "playback-error",
          code: "replayFrameDiscontinuity",
          previousFrame: 0,
          previousBlockSize: 128,
          expectedFrame: 128,
          observedFrame: 0,
          blockSize: 128,
        });
      if (!adoption) await h.playbackFault;
      assert.equal(f.owner.claims.size, 1);
      assert.equal(h.output.connections.size, 0);
      h.node.send({ type: "closed" });
      await h.closed;
      await tick();
      assert.equal(f.owner.claims.size, 0);
      if (adoption) {
        assert.equal(take, null);
        assert.equal(h.outcome.reason, "takeAdoptionFailed");
      } else {
        assert.equal(take.partial, false);
        assert.equal(h.outcome.reason, "complete");
        assert.equal((await h.playbackFault).code, "replayFrameDiscontinuity");
        assert.throws(() => f.owner.pool.release(take.id), {
          code: "takeHeld",
        });
      }
      f.owner.pool.adopt = adopt;
    } finally {
      await f.cleanup();
    }
  }
});

test("dispatcher barrier stays installed during a caller action await even with no active record", async () => {
  const f = await fixture();
  try {
    const action = gate();
    let ran = false;
    const done = f.owner.run("stop", async () => {
      ran = true;
      await action.promise;
    });
    await tick();
    assert.ok(ran);
    assert.equal(f.owner.capture.admission, false);
    assert.equal(f.owner.boundaries.size, 1);
    assert.throws(() => f.arm(), { code: "recordBusy" });
    action.resolve();
    await done;
    assert.equal(f.owner.boundaries.size, 0);
  } finally {
    await f.cleanup();
  }
});

test("exact combined .95 peak,16 voices and64MiB positives still admit without duplicate capture memory", async () => {
  for (const exact of ["peak", "voices", "memory"]) {
    const f = await fixture(
      exact === "peak"
        ? { gain: 1, peak: 0.2 }
        : exact === "voices"
          ? { voices: 15, frames: 128, peak: 0, gain: 0 }
          : {},
    );
    let held;
    try {
      if (exact === "memory") {
        const plan = f.owner.capture.clock.plan({
            bars: 1,
            countInBars: 0,
            leadSeconds: 0.1,
          }),
          future = 8192 + 8 * (plan.endFrame - plan.startFrame) + 40960;
        held = f.memory.reserve(
          f.memory.snapshot().maxBytes - f.memory.snapshot().bytes - future,
          "foreign-exact-budget",
        );
      }
      const h = f.arm();
      await h.prepared;
      if (exact === "memory") assert.equal(f.memory.snapshot().bytes, 67108864);
      if (exact === "voices")
        assert.equal(f.owner.check(f.session.plan, f.document).voices, 16);
      if (exact === "peak")
        assert.equal(f.owner.check(f.session.plan, f.document).peak, 0.95);
    } finally {
      held?.release();
      await f.cleanup();
    }
  }
});
test("owner disposal installs its terminal shared promise before subscriber reentry", async () => {
  const f = await fixture();
  try {
    const h = f.arm();
    await h.prepared;
    let shared;
    const unsubscribe = f.owner.capture.subscribe((s) => {
      if (!s.admission && !shared) shared = f.owner.dispose();
    });
    const a = f.owner.dispose();
    assert.equal(a, shared);
    assert.equal(f.owner.dispose(), a);
    assert.throws(() => f.arm(), { code: "recordBusy" });
    f.close(h.node);
    await a;
    unsubscribe();
    assert.equal(f.context.state, "running");
    assert.equal(f.engine.transport.running, true);
  } finally {
    await f.cleanup();
  }
});
test("unconfirmed cleanup holds peak/voice/route reservations until explicit caller context-close proof", async () => {
  const f = await fixture();
  try {
    const prepare = f.source.prepare;
    f.source.prepare = async () => {
      const lease = await prepare();
      const release = lease.release;
      lease.release = () => {
        if (f.context.state !== "closed")
          throw Error("unconfirmed source cleanup");
        release();
      };
      return lease;
    };
    const h = f.arm();
    await h.prepared;
    h.stop();
    f.close(h.node);
    await assert.rejects(h.closed, /unconfirmed/);
    assert.equal(f.owner.claims.size, 1);
    assert.equal(f.sourcePins, 1);
    assert.ok(
      f.memory
        .snapshot()
        .owners.some((x) => x.label === "root-capture-selected-route"),
    );
    await assert.rejects(f.owner.retryCleanupAfterContextClose(), {
      code: "captureCleanupUnconfirmed",
    });
    f.context.state = "closed";
    await f.owner.retryCleanupAfterContextClose();
    assert.equal(f.owner.claims.size, 0);
    assert.equal(f.sourcePins, 0);
    assert.ok(
      f.memory.snapshot().owners.some((x) => x.label === "foreign-root-owner"),
    );
  } finally {
    await f.cleanup();
  }
});

for (const failure of ["protocol", "processor", "replay-before-ready"]) {
  test(`actual ${failure} failure keeps partial receipt and never revives selected output`, async () => {
    const f = await fixture();
    try {
      const h = f.arm();
      await h.prepared;
      h.node.send({
        type: "pcm",
        sequence: 0,
        offset: 0,
        frames: 128,
        buffers: [new Float32Array(128).buffer],
      });
      if (failure === "protocol")
        h.node.send({
          type: "pcm",
          sequence: 4,
          offset: 128,
          frames: 128,
          buffers: [new Float32Array(128).buffer],
        });
      else if (failure === "processor")
        h.node.dispatchEvent(new Event("processorerror"));
      else {
        h.node.send({
          type: "playback-error",
          code: "replayFrameDiscontinuity",
          previousFrame: 0,
          previousBlockSize: 128,
          expectedFrame: 128,
          observedFrame: 0,
          blockSize: 128,
        });
        await h.playbackFault;
        assert.equal(f.owner.claims.size, 1);
        h.node.send({ type: "closed" });
      }
      const take = await h.ready;
      assert.ok(take.partial);
      assert.equal(take.frames, 128);
      assert.equal(h.output.connections.size, 0);
      if (failure !== "processor") h.node.send({ type: "closed" });
      await h.closed;
      await tick();
      assert.equal(f.owner.claims.size, 0);
      assert.throws(() => f.owner.pool.release(take.id), { code: "takeHeld" });
    } finally {
      await f.cleanup();
    }
  });
}

for (const pan of [-1, -0.5, -0.25, 0.25, 0.5, 1]) {
  test(`mono capture through explicit-stereo track pan${pan} reserves absolute channel sum before prepare`, async () => {
    const f = await fixture();
    try {
      f.mix((p) => {
        p.tracks[1].gain = 1;
        p.tracks[1].pan = pan;
      });
      f.source.peak = 0.5;
      assert.throws(() => f.arm(), { code: "voiceHeadroom" });
      assert.equal(f.sourcePins, 0);
      assert.equal(f.owner.claims.size, 0);
      assert.equal(f.nodes.length, 0);
    } finally {
      await f.cleanup();
    }
  });
  test(`actual pan${pan} edit while capture armed rejects before project/version/automation mutation`, async () => {
    const f = await fixture();
    try {
      f.mix((p) => (p.tracks[1].gain = 1));
      f.context.currentTime += 0.08;
      f.source.peak = 0.5;
      const h = f.arm();
      await h.prepared;
      const text = JSON.stringify(f.document),
        version = f.owner.version,
        param = f.session.graphs.get("track-2").pan.pan,
        calls = param.calls.length;
      assert.throws(() => f.mix((p) => (p.tracks[1].pan = pan)), {
        code: "voiceHeadroom",
      });
      assert.equal(JSON.stringify(f.document), text);
      assert.equal(f.owner.version, version);
      assert.equal(param.calls.length, calls);
      assert.equal(param.value, 0);
      assert.equal(h.state, "armed");
      assert.equal(f.owner.claims.size, 1);
    } finally {
      await f.cleanup();
    }
  });
}
for (const phase of ["source", "module"])
  test(`pan admission stays reserved during ${phase} await and until actual closed`, async () => {
    const f = await fixture();
    try {
      f.mix((p) => (p.tracks[1].gain = 1));
      f.context.currentTime += 0.08;
      f.source.peak = 0.5;
      const g = gate();
      if (phase === "source") f.sourceGate = g;
      else f.context.moduleGate = g;
      const h = f.arm();
      await tick();
      assert.throws(() => f.mix((p) => (p.tracks[1].pan = 1)), {
        code: "voiceHeadroom",
      });
      assert.equal(f.owner.claims.size, 1);
      g.resolve();
      await h.prepared;
      h.stop();
      assert.equal(f.owner.claims.size, 1);
      f.close(h.node);
      await h.closed;
      await tick();
      assert.equal(f.owner.claims.size, 0);
    } finally {
      f.sourceGate?.resolve();
      f.context.moduleGate?.resolve();
      await f.cleanup();
    }
  });
for (const channels of [1, 2])
  for (const pan of [-1, 1])
    test(`ordinary ${channels}channel track pan${pan} uses explicit stereo sum`, async () => {
      const f = await fixture({ gain: 1, peak: 0.5, channels });
      try {
        const text = JSON.stringify(f.document),
          version = f.owner.version,
          calls = f.session.graphs.get("track-1").pan.pan.calls.length;
        assert.throws(() => f.mix((p) => (p.tracks[0].pan = pan)), {
          code: "voiceHeadroom",
        });
        assert.equal(JSON.stringify(f.document), text);
        assert.equal(f.owner.version, version);
        assert.equal(
          f.session.graphs.get("track-1").pan.pan.calls.length,
          calls,
        );
      } finally {
        await f.cleanup();
      }
    });
test("stereo per-voice pan plus opposite full track pan rejects the shared ordinary counterexample", async () => {
  const f = await fixture({ gain: 1, peak: 0.40625, channels: 2 });
  try {
    f.session.plan.tracks[0].clips[0].voices[0].pan = 0.5;
    assert.throws(() => f.mix((p) => (p.tracks[0].pan = -1)), {
      code: "voiceHeadroom",
    });
  } finally {
    await f.cleanup();
  }
});
test("mono per-voice equal-power pan is not incorrectly given a stereo summing multiplier", async () => {
  const f = await fixture({ gain: 1, peak: 0.75, channels: 1 });
  try {
    f.session.plan.tracks[0].clips[0].voices[0].pan = 0.5;
    assert.doesNotThrow(() => f.mix((p) => (p.tracks[0].pan = 0)));
    assert.equal(f.owner.bounds().maxPeak, 0.75);
  } finally {
    await f.cleanup();
  }
});
test("pan/gain/master ramp envelope holds old absolute-channel peak before a new capture arm", async () => {
  const f = await fixture({ gain: 0, peak: 0 });
  try {
    f.mix((p) => {
      p.tracks[1].gain = 0.5;
      p.tracks[1].pan = 1;
    });
    f.context.currentTime += 0.08;
    f.mix((p) => {
      p.tracks[1].gain = 0.25;
      p.tracks[1].pan = 0;
      p.master.volume = 0.5;
    });
    f.source.peak = 1;
    assert.throws(() => f.arm(), { code: "voiceHeadroom" });
    f.context.currentTime += 0.074;
    const h = f.arm();
    await h.prepared;
    assert.equal(h.state, "armed");
  } finally {
    await f.cleanup();
  }
});
test("corrected full-pan exact-limit .95 and safe mixed-source headroom remain admissible", async () => {
  for (const exact of [true, false]) {
    const f = await fixture({ gain: exact ? 0 : 0.125 });
    try {
      f.mix((p) => {
        p.tracks[1].gain = 1;
        p.tracks[1].pan = -1;
      });
      f.context.currentTime += 0.08;
      f.source.peak = exact ? 0.475 : 0.375;
      const h = f.arm();
      await h.prepared;
      assert.equal(
        f.owner.check(f.session.plan, f.document).peak,
        exact ? 0.95 : 0.78125,
      );
      assert.equal(f.session.graphs.get("track-2").pan.pan.value, -1);
      assert.equal(h.output.gain.value, 1);
    } finally {
      await f.cleanup();
    }
  }
});

test("interrupted actual mixer holds audible values, keeps the pending envelope, and refuses atomically", async () => {
  const f = await fixture();
  try {
    f.mix((p) => {
      p.tracks[1].gain = 0.5;
      p.tracks[1].pan = -1;
      p.master.volume = 0.5;
    });
    f.context.currentTime += 0.08;
    f.source.peak = 0.9;
    const h = f.arm();
    await h.prepared;
    f.mix((p) => {
      p.tracks[1].gain = 0.25;
      p.tracks[1].pan = 1;
      p.master.volume = 1;
    });
    f.context.currentTime += 0.005;
    f.mix((p) => {
      p.tracks[1].gain = 0.1;
      p.tracks[1].pan = 0;
      p.master.volume = 0.25;
    });
    const params = [
        f.session.graphs.get("track-2").gain.gain,
        f.session.graphs.get("track-2").pan.pan,
        f.session.master.gain,
      ],
      held = params.map((p) => p.calls.filter((c) => c[0] === "set").at(-1)[1]);
    for (const [i, value] of [0.4375, -0.5, 0.625].entries())
      assert.ok(Math.abs(held[i] - value) < 1e-12);
    assert.equal(f.owner.check(f.session.plan, f.document).peak, 0.93125);
    const before = {
      project: JSON.stringify(f.document),
      version: f.owner.version,
      frontier: f.owner.mixFrontier,
      calls: params.map((p) => JSON.stringify(p.calls)),
    };
    assert.throws(
      () =>
        f.mix((p) => {
          p.tracks[1].gain = 1;
          p.tracks[1].pan = 1;
          p.master.volume = 1;
        }),
      { code: "voiceHeadroom" },
    );
    assert.equal(JSON.stringify(f.document), before.project);
    assert.equal(f.owner.version, before.version);
    assert.equal(f.owner.mixFrontier, before.frontier);
    assert.deepEqual(
      params.map((p) => JSON.stringify(p.calls)),
      before.calls,
    );
    assert.equal(h.state, "armed");
    assert.equal(f.owner.claims.size, 1);
    f.context.currentTime += 0.074;
    assert.equal(
      f.owner.check(f.session.plan, f.document).peak,
      0.9 * (0.1 * 0.25) + 0.25 * 0.125 * 0.25,
    );
  } finally {
    await f.cleanup();
  }
});

test("reverse arm refuses an active old envelope before publishing claim or version", async () => {
  const f = await fixture({ gain: 0, peak: 0 });
  try {
    f.mix((p) => {
      p.tracks[1].gain = 1;
      p.tracks[1].pan = 1;
    });
    f.mix((p) => {
      p.tracks[1].gain = 0.25;
      p.tracks[1].pan = 0;
      p.master.volume = 0.5;
    });
    f.source.peak = 0.5;
    const version = f.owner.version,
      frontier = f.owner.mixFrontier;
    assert.throws(() => f.arm(), { code: "voiceHeadroom" });
    assert.equal(f.owner.version, version);
    assert.equal(f.owner.mixFrontier, frontier);
    assert.equal(f.owner.claims.size, 0);
    assert.equal(f.sourcePins, 0);
    assert.equal(f.nodes.length, 0);
    f.context.currentTime += 0.074;
    const h = f.arm();
    await h.prepared;
    assert.equal(f.owner.claims.size, 1);
  } finally {
    await f.cleanup();
  }
});

test("future program frontier survives its lead, ramp and exact grace before reverse arm", async () => {
  const f = await fixture({ gain: 0, peak: 0 });
  try {
    f.mix((p) => {
      p.tracks[1].gain = 1;
      p.tracks[1].pan = 1;
    });
    f.mix((p) => {
      p.tracks[1].gain = 0.25;
      p.tracks[1].pan = 0;
      p.master.volume = 0.5;
    });
    const program = f.session.scheduledMix;
    assert.equal(f.owner.mixFrontier.program, program);
    assert.equal(f.owner.mixFrontier.until, program.graceFrame / 48000);
    f.source.peak = 0.5;
    for (const time of [0.03, 0.05, 0.071, (program.graceFrame - 1) / 48000]) {
      f.context.currentTime = time;
      assert.throws(() => f.arm(), { code: "voiceHeadroom" });
    }
    f.context.currentTime = program.graceFrame / 48000;
    const h = f.arm();
    await h.prepared;
    assert.equal(f.owner.claims.size, 1);
  } finally {
    await f.cleanup();
  }
});
test("armed late mixer proposal refuses atomically while the capture owner continues", async () => {
  const f = await fixture();
  try {
    const h = f.arm();
    await h.prepared;
    const proposal = f.session.prepareMixProgram(),
      before = {
        project: f.session.project,
        version: f.owner.version,
        frontier: f.owner.mixFrontier,
        program: f.session.scheduledMix,
        calls: JSON.stringify(f.session.master.gain.calls),
      };
    f.context.currentTime = proposal.startFrame / 48000;
    assert.throws(() => f.session.setMix(f.session.project, proposal), {
      code: "mixProgramLate",
    });
    assert.equal(f.session.project, before.project);
    assert.equal(f.owner.version, before.version);
    assert.equal(f.owner.mixFrontier, before.frontier);
    assert.equal(f.session.scheduledMix, before.program);
    assert.equal(JSON.stringify(f.session.master.gain.calls), before.calls);
    assert.equal(h.state, "armed");
    assert.equal(f.owner.claims.size, 1);
  } finally {
    await f.cleanup();
  }
});
test("accepted submission fault holds the transition envelope until actual capture closed and voices ended", async () => {
  const f = await fixture();
  try {
    const h = f.arm();
    await h.prepared;
    f.context.holdEnded = true;
    const native = f.session.master.gain.linearRampToValueAtTime.bind(
      f.session.master.gain,
    );
    f.session.master.gain.linearRampToValueAtTime = (...a) => {
      native(...a);
      f.context.currentTime = 0.051;
    };
    assert.throws(
      () =>
        f.mix((p) => {
          p.tracks[1].gain = 0.5;
        }),
      { code: "mixProgramLate" },
    );
    const frontier = f.owner.mixFrontier;
    assert.equal(frontier.fault, true);
    f.context.currentTime = 1;
    assert.equal(f.owner.mixFrontier, frontier);
    assert.equal(f.owner.claims.size, 1);
    assert.equal(f.engine.transport.running, true);
    f.close(h.node);
    await h.closed;
    await tick();
    assert.equal(f.owner.claims.size, 0);
    assert.equal(f.owner.mixFrontier, frontier);
    for (const n of f.context.sources) n.onended?.();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(f.session.rows.size, 0);
    assert.equal(f.owner.mixFrontier, null);
    assert.equal(f.engine.transport.running, false);
    assert.equal(f.session.status, "error");
  } finally {
    await f.cleanup();
  }
});

for (const delayed of [false, true])
  test(`armed owner and controller refuse immediate proposals before admission${delayed ? " after 100ms" : " at time zero"}`, async () => {
    const f = await fixture();
    try {
      const h = f.arm();
      await h.prepared;
      const proposal = f.session.prepareMixProgram(true),
        candidate = structuredClone(f.session.project);
      candidate.tracks[1].gain = 0.5;
      const params = [...f.session.graphs.values()]
          .flatMap((g) => [g.gain.gain, g.pan.pan])
          .concat(f.session.master.gain),
        before = {
          project: f.session.project,
          document: f.document,
          sequence: f.session.mixSequence,
          program: f.session.scheduledMix,
          version: f.owner.version,
          frontier: f.owner.mixFrontier,
          claims: [...f.owner.claims],
          memory: f.memory.snapshot().bytes,
          calls: params.map((p) => JSON.stringify(p.calls)),
          segments: params.map((p) => f.session.mixAutomation.segments.get(p)),
          pins: f.sourcePins,
        };
      if (delayed) {
        f.context.currentTime = 0.1;
        f.context.wall = 100;
      }
      for (const call of [
        () => f.session.setMix(candidate, proposal),
        () =>
          f.owner.admitOrdinary(f.session.plan, candidate, {
            mix: true,
            program: proposal,
          }),
        () => f.session.applyMix(candidate, false, proposal),
        () => f.session.applyMix(candidate, true, proposal),
      ]) {
        assert.throws(call, { code: "mixProgramLate" });
        assert.equal(f.session.project, before.project);
        assert.equal(f.document, before.document);
        assert.equal(f.session.mixSequence, before.sequence);
        assert.equal(f.session.scheduledMix, before.program);
        assert.equal(f.owner.version, before.version);
        assert.equal(f.owner.mixFrontier, before.frontier);
        assert.deepEqual([...f.owner.claims], before.claims);
        assert.equal(f.memory.snapshot().bytes, before.memory);
        assert.deepEqual(
          params.map((p) => JSON.stringify(p.calls)),
          before.calls,
        );
        params.forEach((p, i) =>
          assert.equal(
            f.session.mixAutomation.segments.get(p),
            before.segments[i],
          ),
        );
        assert.equal(f.session.mixProgramFault, null);
        assert.equal(f.owner.lastFault, undefined);
        assert.equal(f.owner.boundaries.size, 0);
        assert.equal(h.state, "armed");
        assert.equal(f.sourcePins, before.pins);
        assert.equal(f.engine.transport.running, true);
      }
      f.mix((p) => {
        p.tracks[1].gain = 0.5;
      });
      assert.equal(f.owner.mixFrontier.program, f.session.scheduledMix);
      assert.equal(f.session.scheduledMix.instant, false);
      assert.equal(h.state, "armed");
    } finally {
      await f.cleanup();
    }
  });
