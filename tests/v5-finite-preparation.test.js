import test from "node:test";
import assert from "node:assert/strict";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { AudioDocument } from "../src/loop-station/audio-document.js";
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import { emptyLoopProject } from "../src/loop-station/model.js";
import { LoopStationSession } from "../src/loop-station/session.js";
import { WorkspaceAudioOwner } from "../src/loop-station/workspace-owner.js";
import { Transport } from "../src/audio/transport.js";
import { digest } from "../src/loop-station/recording-data.js";
import { PPQ } from "../src/project/instrument-project.js";
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
class Context extends EventTarget {
  state = "running";
  sampleRate = 48000;
  currentTime = 0;
  nativeSources = [];
  workerConstructions = 0;
  moduleCalls = 0;
  createGain() {
    return {
      context: this,
      gain: param(),
      pan: param(),
      connect() {},
      disconnect() {},
    };
  }
  createStereoPanner() {
    return this.createGain();
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
  createBufferSource() {
    const n = this.createGain();
    n.playbackRate = param();
    n.start = (when, offset) => {
      n.when = when;
      n.offset = offset;
    };
    n.stop = () => queueMicrotask(() => n.onended?.());
    this.nativeSources.push(n);
    return n;
  }
  confirmClosed() {
    this.state = "closed";
    this.dispatchEvent(new Event("statechange"));
  }
  factory = () => {
    this.workerConstructions++;
    throw Error("policy model must refuse before worker construction");
  };
}
async function fixture(t, { module = true, count = 1 } = {}) {
  const context = new Context(),
    memory = new AudioMemory(),
    registry = new InstrumentRegistry(),
    project = structuredClone(emptyLoopProject(registry)),
    P = 120000;
  project.clock = { kind: "fixed-bar", sampleRate: 48000, framesPerBar: P };
  project.master.volume = 0.5;
  project.tracks.forEach((track) => (track.gain = 0.0625));
  const pcm = new Float32Array(2 * P);
  pcm.fill(0.01, 0, P);
  pcm.fill(0.02, P);
  const bytes = pcm.buffer,
    hash = await digest(bytes),
    blob = new Blob([bytes]);
  for (let i = 0; i < count; i++) {
    const id = "recording-" + (i + 1);
    project.assetRefs.push({
      id,
      kind: "recording",
      sha256: hash,
      bytes: bytes.byteLength,
      frames: P,
      channels: 2,
      sampleRate: 48000,
      encoding: "float32le",
      recordedBpm: 96,
    });
    Object.assign(project.tracks[i], {
      kind: "recording",
      clips: [
        {
          id: "clip-" + i,
          sourceId: id,
          startTick: 0,
          lengthTicks: 4 * PPQ,
          offsetFrames: 0,
          loop: true,
        },
      ],
    });
  }
  const doc = new AudioDocument({
      registry,
      memory,
      backend: {
        entry: async () => ({ blob, provenance: "Policy model only" }),
      },
    }),
    transport = new Transport({ bpm: 96 }),
    output = context.createGain(),
    contextLease = memory.reserve(524288, "loop-context-graph-allowance"),
    owner = new WorkspaceAudioOwner({ memory, getProject: () => project });
  const f = {
    context,
    memory,
    registry,
    project,
    owner,
    transport,
    doc,
    hash,
    blob,
    foreign: null,
    corruption: null,
    onModule: null,
    resolved: [],
    resolverHook: null,
  };
  context.audioWorklet = {
    addModule: async () => {
      context.moduleCalls++;
      return f.onModule?.();
    },
  };
  const session = new LoopStationSession({
    context,
    transport,
    memory,
    registry,
    output,
    ownsTransport: true,
    admission: owner,
    finiteReaderModuleURL: module ? "https://qa.test/finite.js" : null,
    finiteReaderNodeFactory: context.factory,
    resolveRecording: async (ref, options) => {
      const result = await doc.resolve(ref, context, options);
      f.resolved.push(result);
      if (f.corruption === "hash") result.buffer.getChannelData(0)[0] = 0.9;
      if (f.corruption === "nan") result.buffer.getChannelData(0)[0] = NaN;
      if (f.corruption === "throw")
        result.buffer.getChannelData = () => {
          throw TypeError("unexpected source getter failure");
        };
      if (f.corruption === "cancelDigest") {
        const get = result.buffer.getChannelData;
        result.buffer.getChannelData = (c) => {
          if (c === 1) queueMicrotask(() => session.loading?.abort());
          return get(c);
        };
      }
      await f.resolverHook?.(result);
      return result;
    },
  });
  f.session = session;
  owner.attach(
    { context, transport, memory, master: output, output, volume: 1 },
    session,
  );
  t.after(async () => {
    context.confirmClosed();
    await owner.dispose();
    await session.dispose();
    f.foreign?.release();
    contextLease.release();
    assert.equal(memory.snapshot().bytes, 0);
    assert.equal(await digest(await blob.arrayBuffer()), hash);
  });
  return f;
}
test("exact reviewer pressure admits identical unbounded workload after reclaiming only optional finite copies", async (t) => {
  const results = [];
  for (const module of [true, false]) {
    const f = await fixture(t, { module });
    await f.session.load(f.project);
    assert.equal(f.memory.snapshot().bytes, module ? 4376576 : 2452480);
    f.foreign = f.memory.reserve(62699520, "other-owner-ledger-pressure");
    const foreignBefore = f.memory
      .snapshot()
      .owners.find((o) => o.label === "other-owner-ledger-pressure");
    f.session.play();
    assert.equal(f.session.status, "playing");
    assert.equal(f.context.nativeSources.length, 1);
    assert.equal(f.context.workerConstructions, 0);
    assert.equal(f.memory.snapshot().bytes, 65229824);
    assert.deepEqual(
      f.memory
        .snapshot()
        .owners.find((o) => o.label === "other-owner-ledger-pressure"),
      foreignBefore,
    );
    assert.equal(
      f.memory
        .snapshot()
        .owners.some(
          (o) => o.label === "finite-reader/prepared-copy-and-digest",
        ),
      false,
    );
    results.push(f.memory.snapshot().bytes);
    f.session.pause();
    await f.session.waitVoices();
    f.context.currentTime = 1;
    f.session.play({ resume: true });
    f.session.stop();
    await f.session.waitVoices();
  }
  assert.equal(results[0], results[1]);
});
for (const [corruption, code] of [
  ["hash", "recordingHashMismatch"],
  ["nan", "invalidRecordingPCM"],
  ["throw", undefined],
  ["cancelDigest", "cancelled"],
])
  test(`integrated ${corruption} preparation failure never publishes or starts the bad native copy`, async (t) => {
    const f = await fixture(t);
    f.corruption = corruption;
    await assert.rejects(
      f.session.load(f.project),
      code ? { code } : TypeError,
    );
    assert.equal(f.session.plan, null);
    assert.equal(f.session.project, null);
    assert.equal(f.session.status, "error");
    assert.equal(f.memory.snapshot().bytes, 524288);
    assert.equal(f.context.nativeSources.length, 0);
    assert.equal(f.context.workerConstructions, 0);
    assert.throws(() => f.session.play(), { code: "instrumentNotReady" });
    if (corruption !== "cancelDigest") {
      f.corruption = null;
      await f.session.load(f.project);
      assert.equal(f.session.error, null);
      assert.notEqual(f.resolved[0].buffer, f.resolved.at(-1).buffer);
      assert.equal(
        f.resolved.at(-1).buffer.getChannelData(0)[0],
        Math.fround(0.01),
      );
    }
  });
test("fatal replacement rolls back to the previous good document and preserves foreign/native original ownership", async (t) => {
  const f = await fixture(t);
  await f.session.load(f.project);
  const plan = f.session.plan,
    project = f.session.project,
    original = f.resolved[0].buffer;
  f.foreign = f.memory.reserve(1234, "foreign-original");
  const lease = f.memory
    .snapshot()
    .owners.find((o) => o.label === "foreign-original");
  f.corruption = "hash";
  await assert.rejects(
    f.session.load({ ...f.project, title: "bad replacement" }),
    { code: "recordingHashMismatch" },
  );
  assert.equal(f.session.plan, plan);
  assert.equal(f.session.project, project);
  assert.equal(original.getChannelData(0)[0], Math.fround(0.01));
  assert.deepEqual(
    f.memory.snapshot().owners.find((o) => o.label === "foreign-original"),
    lease,
  );
  assert.equal(f.context.nativeSources.length, 0);
  f.corruption = null;
  await f.session.load({ ...f.project, title: "verified retry" });
  assert.equal(f.session.project.title, "verified retry");
  assert.equal(f.session.error, null);
});
test("module failure is soft availability, while partial preparation capacity unwinds only optional copies", async (t) => {
  const unavailable = await fixture(t);
  unavailable.onModule = () => {
    throw Error("module unavailable");
  };
  await unavailable.session.load(unavailable.project);
  assert.equal(unavailable.session.error, null);
  assert.equal(
    unavailable.session.finiteReaderUnavailable,
    "finiteReaderUnavailable",
  );
  assert.equal(unavailable.memory.snapshot().bytes, 2452480);
  unavailable.session.play();
  assert.equal(unavailable.context.nativeSources.length, 1);
  const f = await fixture(t, { count: 2 });
  f.onModule = () => {
    const b = f.memory.snapshot();
    f.foreign = f.memory.reserve(
      b.maxBytes - b.bytes - 1924096 - 1024,
      "partial-preparation-pressure",
    );
  };
  await f.session.load(f.project);
  assert.equal(f.session.finiteReaderUnavailable, "combinedMemoryLimit");
  assert.equal(
    f.memory
      .snapshot()
      .owners.some((o) => o.label === "finite-reader/prepared-copy-and-digest"),
    false,
  );
  assert.equal(f.context.workerConstructions, 0);
  assert.ok(
    f.memory
      .snapshot()
      .owners.some((o) => o.label === "partial-preparation-pressure"),
  );
});
test("epoch capacity refusal reclaims inactive optional preparation before native finite fallback admission", async (t) => {
  const f = await fixture(t);
  await f.session.load(f.project);
  const b = f.memory.snapshot();
  f.foreign = f.memory.reserve(b.maxBytes - b.bytes - 100000, "epoch-pressure");
  f.session.play({ bars: 4 });
  assert.equal(f.context.workerConstructions, 0);
  assert.equal(f.context.nativeSources.length, 1);
  assert.equal(f.session.snapshot().finiteCompletion, null);
  assert.equal(
    f.session.snapshot().finitePreparation.reason,
    "combinedMemoryLimit",
  );
  assert.equal(
    f.memory
      .snapshot()
      .owners.some((o) => o.label.startsWith("finite-reader/")),
    false,
  );
});
test("nonselected capture preparation and load replacement reclaim inactive cache without touching originals", async (t) => {
  const f = await fixture(t);
  await f.session.load(f.project);
  await f.owner.prepareInstrument("track-8", {
    moduleURL: "https://qa.test/capture.js",
  });
  assert.equal(
    f.session.snapshot().finitePreparation.reason,
    "capturePreparation",
  );
  assert.equal(
    f.memory
      .snapshot()
      .owners.some((o) => o.label === "finite-reader/prepared-copy-and-digest"),
    false,
  );
  assert.equal(f.resolved[0].buffer.getChannelData(0)[0], Math.fround(0.01));
  await f.owner.replaceable();
  await f.session.load(f.project);
  assert.equal(f.session.snapshot().finitePreparation.state, "prepared");
  await f.session.load({
    ...f.project,
    master: {
      ...f.project.master,
      limiter: { version: 1, bypass: false, kind: "soft-knee-v1" },
    },
    tracks: f.project.tracks.map((tr, i) =>
      i
        ? tr
        : {
            ...tr,
            eq: { version: 1, bypass: false, lowDb: 1, midDb: 0, highDb: 0 },
          },
    ),
  });
  assert.equal(f.session.snapshot().finitePreparation.state, "unavailable");
  assert.equal(
    f.memory
      .snapshot()
      .owners.some((o) => o.label === "finite-reader/prepared-copy-and-digest"),
    false,
  );
});
test("module deadline falls back explicitly without source or foreign lease loss", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = await fixture(t);
  f.onModule = () => new Promise(() => {});
  const load = f.session.load(f.project);
  while (!f.context.moduleCalls) await new Promise((r) => setImmediate(r));
  t.mock.timers.tick(5000);
  await load;
  assert.equal(f.session.status, "stopped");
  assert.equal(f.session.finiteReaderUnavailable, "finiteReaderUnavailable");
  assert.equal(f.memory.snapshot().bytes, 2452480);
  assert.equal(f.context.workerConstructions, 0);
  t.mock.timers.reset();
});

test("stale in-flight replacement cannot publish, reclaim or fault a newer valid document", async (t) => {
  const f = await fixture(t);
  let unblock, entered;
  const started = new Promise((r) => (entered = r));
  const gate = new Promise((r) => (unblock = r));
  let calls = 0;
  f.resolverHook = async () => {
    if (++calls === 1) {
      entered();
      await gate;
    }
  };
  const stale = f.session.load({ ...f.project, title: "old load" });
  const rejected = assert.rejects(stale, { code: "cancelled" });
  await started;
  await f.session.load({ ...f.project, title: "new load" });
  const plan = f.session.plan,
    bytes = f.memory.snapshot().bytes;
  unblock();
  await rejected;
  assert.equal(f.session.plan, plan);
  assert.equal(f.session.project.title, "new load");
  assert.equal(f.session.error, null);
  assert.equal(f.session.snapshot().finitePreparation.state, "prepared");
  assert.equal(f.memory.snapshot().bytes, bytes - 1928192);
  assert.equal(f.context.nativeSources.length, 0);
});
