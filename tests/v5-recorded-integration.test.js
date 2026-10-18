import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { Transport } from "../src/audio/transport.js";
import { emptyLoopProject } from "../src/loop-station/model.js";
import { overdubBase, adoptOverdub } from "../src/loop-station/overdub.js";
import {
  adoptRecording,
  digest,
  checkAbort,
} from "../src/loop-station/recording-data.js";
import { prepareLoopPlan, loopAdmission } from "../src/loop-station/plan.js";
import {
  finalMixProgram,
  portableRecordingAdmission,
} from "../src/loop-station/final-program.js";
import {
  FinalMixExporter,
  preflightMixFX,
} from "../src/loop-station/final-export.js";
import { WorkspaceAudioOwner } from "../src/loop-station/workspace-owner.js";
import { LoopStationSession } from "../src/loop-station/session.js";
import { BYPASS_LIMITER } from "../src/loop-station/fx-model.js";
import { PPQ } from "../src/project/instrument-project.js";
import { fail } from "../src/project/instrument-contract.js";
import { alignRecordedClip } from "../src/loop-station/phase-alignment.js";
import { validateLoopProject } from "../src/loop-station/project.js";
import { LoopHistory } from "../src/loop-station/model.js";
import {
  exportAudioBundle,
  importAudioBundle,
} from "../src/loop-station/audio-bundle.js";

test("phase policy is explicit, bounded, hash-bound, per-layer, reversible and portable with identical raw originals", async () => {
  const f = fixture(),
    p = f.adopted.project,
    t = p.tracks.at(-1),
    c = t.clips[1],
    before = JSON.stringify(p);
  const history = new LoopHistory(p, f.registry);
  history.commit((p) => alignRecordedClip(p, t.id, c.id, 137));
  assert.equal(
    history.project.tracks.at(-1).clips[0].phaseAlignment,
    undefined,
  );
  const selected = history.project.tracks.at(-1).clips[1];
  assert.equal(selected.offsetFrames, 0);
  assert.equal(selected.phaseAlignment.advanceFrames, 137);
  history.undo();
  assert.equal(JSON.stringify(history.project), before);
  history.redo();
  const bundle = await exportAudioBundle(history.project, f.entries, {
    registry: f.registry,
    memory: f.memory,
  });
  const other = await importAudioBundle(bundle.blob, {
    registry: f.registry,
    memory: f.memory,
  });
  assert.deepEqual(other.project, history.project);
  for (const ref of p.assetRefs)
    assert.equal(
      hash(await other.entries.get(ref.id).blob.arrayBuffer()),
      ref.sha256,
    );
  other.release();
  bundle.release();
  for (const change of [
    (x) => (x.version = 2),
    (x) => (x.mode = "trim"),
    (x) => (x.advanceFrames = 12001),
    (x) => (x.advanceFrames = 0.5),
    (x) => (x.sourceSHA256 = "b".repeat(64)),
    (x) => (x.hidden = 1),
  ]) {
    const bad = structuredClone(history.project);
    change(bad.tracks.at(-1).clips[1].phaseAlignment);
    assert.throws(() => validateLoopProject(bad, f.registry), {
      code: "invalidPhaseAlignment",
    });
  }
  for (const change of [
    (x) => (x.loop = false),
    (x) => (x.offsetFrames = 1),
    (x) => x.lengthTicks--,
  ]) {
    const bad = structuredClone(history.project);
    change(bad.tracks.at(-1).clips[1]);
    assert.throws(() => validateLoopProject(bad, f.registry), {
      code: "invalidPhaseAlignment",
    });
  }
  const reset = alignRecordedClip(history.project, t.id, c.id, 0);
  assert.equal(JSON.stringify(reset), before);
  assert.equal(JSON.stringify(p), before);
  assertClean(f);
});

for (const [rate, bars, advance] of [
  [48000, 4, 137],
  [44100, 8, -221],
])
  test(`phase ${rate}/${bars}bar complete-period portable WAV matches independent read-position oracle without raw rotation`, async () => {
    const f = fixture(rate),
      p = f.adopted.project,
      t = p.tracks.at(-1),
      c = t.clips[1],
      candidate = alignRecordedClip(p, t.id, c.id, advance),
      originals = new Map(
        [...f.buffers].map(([id, b]) => [id, hash(f.bytesOf(b))]),
      );
    const result = await f.exporter.render(candidate, { bars });
    try {
      const data = new DataView(await result.blob.arrayBuffer());
      assert.equal(data.getUint32(46, true), bars * f.P);
      for (let n = 0; n < bars * f.P; n++)
        for (let ch = 0; ch < 2; ch++) {
          let sum = 0;
          for (const track of candidate.tracks) {
            let input = 0;
            for (const clip of track.clips) {
              const b = f.buffers.get(clip.sourceId);
              let index = n % f.P;
              if (clip.id === c.id) {
                index += advance;
                if (index < 0) index += f.P;
                if (index >= f.P) index -= f.P;
              }
              input = F(
                input + b.data[Math.min(ch, b.numberOfChannels - 1)][index],
              );
            }
            sum = F(sum + F(input * F(track.gain)));
          }
          assert.equal(
            data.getFloat32(58 + 8 * n + 4 * ch, true),
            F(sum * F(candidate.master.volume)),
          );
        }
      assert.equal(
        result.meta.project.tracks.at(-1).clips[1].phaseAlignment.advanceFrames,
        advance,
      );
      for (const [id, b] of f.buffers)
        assert.equal(hash(f.bytesOf(b)), originals.get(id));
    } finally {
      result.release();
    }
    assertClean(f);
  });

// Real production entry points/ledger/renderer/encoder; all contexts and nodes
// below are RAM models. No AudioContext, native decode, audio file or browser.
const F = Math.fround,
  hash = (b) => createHash("sha256").update(new Uint8Array(b)).digest("hex"),
  code = (c) => (e) => e.code === c,
  param = () => ({
    value: 1,
    setValueAtTime(v) {
      this.value = v;
    },
    linearRampToValueAtTime(v) {
      this.value = v;
    },
    cancelScheduledValues() {},
  });
class BufferModel {
  constructor(c, n, r) {
    this.length = n;
    this.numberOfChannels = c;
    this.sampleRate = r;
    this.duration = n / r;
    this.data = Array.from({ length: c }, () => new Float32Array(n));
  }
  getChannelData(c) {
    return this.data[c];
  }
}
class NodeModel {
  constructor(context) {
    this.context = context;
    this.gain = param();
    this.pan = param();
    this.playbackRate = param();
    this.nativeEnd = Infinity;
  }
  connect() {}
  disconnect() {}
  start(when, offset = 0) {
    this.when = when;
    this.offset = offset;
    if (!this.loop) this.nativeEnd = when + this.buffer.duration - offset;
  }
  stop(time) {
    this.nativeEnd = Math.min(this.nativeEnd, time);
  }
  end() {
    if (!this.ended) {
      this.ended = true;
      this.onended?.();
    }
  }
}
class ContextModel extends EventTarget {
  constructor(c = 2, n = 1, r = 48000) {
    super();
    this.channels = c;
    this.frames = n;
    this.sampleRate = r;
    this.state = "running";
    this.currentTime = 0;
    this.sources = [];
  }
  createGain() {
    return new NodeModel(this);
  }
  createStereoPanner() {
    return new NodeModel(this);
  }
  createWaveShaper() {
    return new NodeModel(this);
  }
  createBufferSource() {
    const n = new NodeModel(this);
    this.sources.push(n);
    return n;
  }
  createBuffer(c, n, r) {
    return new BufferModel(c, n, r);
  }
  decodeAudioData() {
    throw Error("No decoder in recording-only model");
  }
  suspend() {
    throw Error(
      "Native checkpoint backend must not run for qualified recording-only export",
    );
  }
  resume() {
    throw Error("Unexpected native resume");
  }
  async startRendering() {
    this.state = "closed";
    return this.createBuffer(this.channels, 1, this.sampleRate);
  }
  advance(t) {
    this.currentTime = t;
    for (const n of this.sources) if (n.nativeEnd <= t) n.end();
  }
}
function fixture(rate = 48000) {
  const registry = new InstrumentRegistry(),
    memory = new AudioMemory(),
    project = structuredClone(emptyLoopProject(registry)),
    P = (rate * 4) / 3,
    buffers = new Map(),
    entries = new Map(),
    contexts = [];
  project.timing.bpm = 180;
  project.clock = { kind: "fixed-bar", sampleRate: rate, framesPerBar: P };
  project.master.volume = 0.5;
  const makeBuffer = (i, c) => {
    const b = new BufferModel(c, P, rate);
    for (let ch = 0; ch < c; ch++)
      for (let n = 0; n < P; n++)
        b.data[ch][n] = F(
          (((n % (251 - 2 * i - ch)) - 110) * (i + 1)) / (262144 * (ch + 1)),
        );
    return b;
  };
  const bytesOf = (b) => {
    const a = new Float32Array(b.length * b.numberOfChannels);
    for (let c = 0; c < b.numberOfChannels; c++) a.set(b.data[c], c * b.length);
    return a.buffer;
  };
  for (let i = 0; i < 8; i++) {
    const id = "recording-" + (i + 1),
      b = makeBuffer(i, i % 2 ? 1 : 2),
      bytes = bytesOf(b);
    buffers.set(id, b);
    entries.set(id, {
      blob: new Blob([bytes]),
      provenance: "UNIT-FIXTURE original " + id,
    });
    project.assetRefs.push({
      id,
      kind: "recording",
      sha256: hash(bytes),
      bytes: bytes.byteLength,
      frames: P,
      channels: b.numberOfChannels,
      sampleRate: rate,
      encoding: "float32le",
      recordedBpm: 180,
    });
    Object.assign(project.tracks[i], {
      kind: "recording",
      gain: 0.05 + (i % 3) * 0.025,
      clips: [
        {
          id: "clip-" + (i + 1),
          sourceId: id,
          startTick: 0,
          lengthTicks: 4 * PPQ,
          offsetFrames: 0,
          loop: true,
        },
      ],
    });
  }
  const target = "track-8",
    base = overdubBase(project, target),
    b = makeBuffer(8, base.channels),
    newBytes = bytesOf(b),
    take = {
      id: "take-model",
      partial: false,
      frames: P,
      channels: base.channels,
      sampleRate: rate,
      validBytes: newBytes.byteLength,
    },
    adopted = adoptOverdub(
      project,
      registry,
      target,
      take,
      hash(newBytes),
      base,
    );
  buffers.set(adopted.ref.id, b);
  entries.set(adopted.ref.id, {
    blob: new Blob([newBytes]),
    provenance: "UNIT-FIXTURE retained overdub credit",
  });
  let acquired = 0,
    released = 0;
  const resolve = async (ref, context, options = {}) => {
    checkAbort(options.signal);
    if (options.entry)
      assert.equal(hash(await options.entry.blob.arrayBuffer()), ref.sha256);
    const lease = memory.reserve(
      ref.bytes * 2 + 8192,
      "model-recording-native-and-view",
    );
    acquired++;
    const buffer = buffers.get(ref.id);
    let peak = 0;
    for (const a of buffer.data)
      for (const v of a) peak = Math.max(peak, Math.abs(v));
    return {
      buffer,
      sha256: ref.sha256,
      peak,
      release() {
        released++;
        lease.release();
      },
    };
  };
  const documentStore = {
      resolve,
      backend: { entry: async (ref) => entries.get(ref.id) },
    },
    owner = new WorkspaceAudioOwner({
      memory,
      getProject: () => adopted.project,
    }),
    contextFactory = (c, n, r) => {
      const context = new ContextModel(c, n, r);
      contexts.push(context);
      return context;
    },
    exporter = new FinalMixExporter({
      registry,
      memory,
      owner,
      documentStore,
      contextFactory,
    });
  return {
    registry,
    memory,
    project,
    P,
    buffers,
    entries,
    target,
    base,
    newBytes,
    take,
    adopted,
    resolve,
    documentStore,
    owner,
    contexts,
    contextFactory,
    exporter,
    bytesOf,
    counts: () => ({ acquired, released }),
  };
}
async function prepared(f, p = f.adopted.project) {
  return prepareLoopPlan(p, {
    registry: f.registry,
    rate: p.clock.sampleRate,
    memory: f.memory,
    recordedLoops: true,
    resolveRecording: (r, o) => f.resolve(r, null, o),
  });
}
function attach(f) {
  const context = new ContextModel(2, 1, f.project.clock.sampleRate),
    transport = new Transport({ bpm: 180 }),
    master = context.createGain(),
    session = new LoopStationSession({
      context,
      transport,
      memory: f.memory,
      registry: f.registry,
      output: master,
      ownsTransport: true,
      resolveRecording: (r, o) => f.resolve(r, context, o),
      admission: f.owner,
      wallNow: () => context.currentTime * 1000,
    });
  f.owner.attach(
    { context, transport, memory: f.memory, master, output: master, volume: 1 },
    session,
  );
  return { context, session };
}
const assertClean = (f) => {
  assert.equal(f.memory.snapshot().bytes, 0);
  assert.equal(f.counts().acquired, f.counts().released);
};

test("production adoptTake body admits ninth clip before durable save/history; root refusal, cancellation and storage failure retain originals", async () => {
  const source = await readFile(
      new URL("../src/loop-station/workspace.js", import.meta.url),
      "utf8",
    ),
    start = source.indexOf("  function adoptTake() {"),
    end = source.indexOf("  function importProject(file) {", start),
    body = source.slice(start, end);
  assert(start >= 0 && end > start);
  for (const mode of ["success", "root-refusal", "cancel", "save-failure"]) {
    const f = fixture(),
      { context, session } = attach(f),
      original = JSON.stringify(f.project),
      order = [];
    let saves = 0,
      commits = 0,
      copies = 0,
      admissions = 0;
    if (mode === "root-refusal") f.owner.renders.add({ voices: 8 });
    const abort = new AbortController(),
      recorder = {
        current: { state: "closed", take: f.take },
        assignment: { trackId: f.target },
        overdub: true,
        base: f.base,
        takes: {
          saved: new Map([[f.take.id, {}]]),
          attribution: () => f.entries.get(f.adopted.ref.id).provenance,
        },
      },
      history = {
        project: f.project,
        commit(fn) {
          order.push("commit");
          commits++;
          this.project = fn();
        },
      };
    f.owner.pool.copyPCM = () => {
      const lease = f.memory.reserve(f.take.validBytes, "model-copy");
      copies++;
      return {
        buffer: f.newBytes.slice(0),
        release() {
          copies--;
          lease.release();
        },
      };
    };
    const admit = f.owner.admitOrdinary.bind(f.owner);
    f.owner.admitOrdinary = (p, doc) => {
      order.push("root");
      admissions++;
      const result = admit(p, doc);
      if (mode === "cancel") abort.abort();
      return result;
    };
    const fn = vm.runInNewContext("(" + body + ")", {
      storageReady: true,
      recorder,
      selected: f.target,
      registry: f.registry,
      controller: session,
      memory: f.memory,
      cache: null,
      Blob,
      fail,
      overdubBase,
      adoptOverdub,
      adoptRecording,
      digest,
      checkAbort,
      history,
      audioOwner: f.owner,
      audioOperation: async (kind, op) => {
        assert.equal(kind, "adopt-take");
        assert.equal(session.plan, null);
        return op(abort.signal);
      },
      documentStore: f.documentStore,
      prepareLoopPlan,
      save: async (p, options) => {
        checkAbort(options.signal);
        order.push("save");
        if (mode === "save-failure")
          throw Object.assign(Error("storage"), {
            code: "audioStorageWriteFailed",
          });
        const entry = options.entries.get(f.adopted.ref.id);
        assert.equal(
          entry.provenance,
          f.entries.get(f.adopted.ref.id).provenance,
        );
        assert.equal(
          hash(await entry.blob.arrayBuffer()),
          f.adopted.ref.sha256,
        );
        assert.equal(JSON.stringify(p), JSON.stringify(f.adopted.project));
        saves++;
      },
      adoptedReceipt: false,
      revision: 0,
    });
    if (mode === "success") {
      await fn();
      assert.equal(saves, 1);
      assert.equal(commits, 1);
      assert.deepEqual(order, ["root", "save", "commit"]);
    } else {
      await assert.rejects(
        fn(),
        code(
          {
            "root-refusal": "voiceLimit",
            cancel: "cancelled",
            "save-failure": "audioStorageWriteFailed",
          }[mode],
        ),
      );
      assert.equal(saves, 0);
      assert.equal(commits, 0);
      assert.equal(history.project, f.project);
    }
    assert.equal(admissions, 1);
    assert.equal(copies, 0);
    assert.equal(JSON.stringify(f.project), original);
    assert(recorder.takes.saved.has(f.take.id));
    context.state = "closed";
    await session.dispose();
    assertClean(f);
  }
});

test("nine-clip live FX preflight uses the same root budget, retains credits and cleans success/refusal/cancellation", async () => {
  const source = await readFile(
      new URL("../src/loop-station/workspace.js", import.meta.url),
      "utf8",
    ),
    start = source.indexOf("  const checkFX = (p, options = {}) =>"),
    end = source.indexOf("  const recordPanel =", start),
    body = source.slice(start, end);
  assert(start >= 0 && end > start);
  for (const mode of [
    "cold",
    "attached",
    "ending-owner",
    "root-refusal",
    "bad-owner",
    "cancel",
    "memory",
  ]) {
    const f = fixture(),
      p = structuredClone(f.adopted.project),
      abort = new AbortController();
    p.master.limiter = { ...BYPASS_LIMITER, bypass: false };
    const linked = ["attached", "ending-owner"].includes(mode)
      ? attach(f)
      : null;
    if (mode === "ending-owner") {
      await linked.session.load(f.project);
      linked.session.play();
      linked.session.stop();
      assert.equal(linked.session.rows.size, 8);
    }
    if (mode === "root-refusal") f.owner.renders.add({ voices: 8 });
    if (mode === "bad-owner") f.owner.renders.add({ voices: NaN });
    const pressure =
      mode === "memory"
        ? f.memory.reserve(64 * 1024 * 1024 - 500000, "foreign-pressure")
        : null;
    if (mode === "cancel") abort.abort();
    const checkFX = vm.runInNewContext(
      "(() => {" + body + "; return checkFX; })()",
      {
        preflightMixFX,
        registryForRate: () => f.registry,
        memory: f.memory,
        documentStore: f.documentStore,
        audioOwner: f.owner,
        engine: null,
      },
    );
    const op = checkFX(p, {
      contextFactory: f.contextFactory,
      signal: abort.signal,
    });
    if (["root-refusal", "bad-owner"].includes(mode))
      await assert.rejects(op, code("voiceLimit"));
    else if (mode === "ending-owner") {
      await assert.rejects(op, code("recordBusy"));
      assert.equal(linked.session.rows.size, 8);
    } else if (mode === "cancel") await assert.rejects(op, code("cancelled"));
    else if (mode === "memory") await assert.rejects(op);
    else await op;
    pressure?.release();
    assert(f.contexts.every((c) => c.state === "closed"));
    if (linked) {
      linked.context.state = "closed";
      await linked.session.dispose();
    }
    assert.equal(
      f.entries.get(f.adopted.ref.id).provenance,
      "UNIT-FIXTURE retained overdub credit",
    );
    assertClean(f);
  }
});

test("portable finite admission requires private clip/program identity and exact complete period; native admission remains conservative", async () => {
  const f = fixture(),
    plan = await prepared(f);
  try {
    assert.throws(() => finalMixProgram(plan, 4), code("voiceLimit"));
    const program = finalMixProgram(plan, 4, {
      backend: "portable-recordings",
    });
    assert.equal(program.events.length, 36);
    assert.equal(program.admission.maxOwned, 9);
    assert.equal(
      program.admission.maxPeak,
      loopAdmission(plan, plan.project, { recordedLoops: true }).maxPeak,
    );
    assert.equal(portableRecordingAdmission(plan, program), program.admission);
    assert.throws(
      () => f.owner.reserveRender(plan, { ...program }),
      code("invalidLoopPlan"),
    );
    const project = plan.project;
    plan.project = { ...project };
    assert.throws(
      () => f.owner.reserveRender(plan, program),
      code("invalidLoopPlan"),
    );
    plan.project = project;
    assert.throws(() => {
      program.events[0].spec.endFrame++;
    }, TypeError);
    const clone = {
      ...plan,
      tracks: plan.tracks.map((r) => ({
        ...r,
        clips: r.clips.map((c) => ({ ...c })),
      })),
    };
    assert.throws(
      () => finalMixProgram(clone, 4, { backend: "portable-recordings" }),
      code("invalidLoopPlan"),
    );
    const clip = plan.tracks[0].clips[0];
    clip.offsetFrames = 1;
    assert.throws(
      () => f.owner.reserveRender(plan, program),
      code("loopPeriodMismatch"),
    );
    clip.offsetFrames = 0;
    clip.lengthTicks *= 2;
    assert.throws(
      () => finalMixProgram(plan, 4, { backend: "portable-recordings" }),
      code("loopPeriodMismatch"),
    );
    clip.lengthTicks /= 2;
  } finally {
    plan.release();
  }
  assertClean(f);
});

for (const [rate, bars] of [
  [48000, 4],
  [44100, 8],
])
  test(`actual FinalMixExporter ${rate}/${bars}bar RAM WAV equals independent chronological stereo/mono sum at every sample`, async (t) => {
    const f = fixture(rate),
      before = new Map(
        [...f.buffers].map(([id, b]) => [id, hash(f.bytesOf(b))]),
      ),
      result = await f.exporter.render(f.adopted.project, { bars });
    try {
      assert.equal(result.meta.render.path, "portable-recordings-v1");
      assert.equal(result.meta.recordingCredits.length, 9);
      for (const credit of result.meta.recordingCredits)
        assert.equal(credit.text, f.entries.get(credit.id).provenance);
      assert.equal(f.owner.renders.size, 0);
      const data = new DataView(await result.blob.arrayBuffer()),
        frames = bars * f.P;
      assert.equal(data.getUint32(46, true), frames);
      let maxError = 0;
      for (let n = 0; n < frames; n++)
        for (let c = 0; c < 2; c++) {
          let expected = 0;
          for (const track of f.adopted.project.tracks) {
            let input = 0;
            for (const clip of track.clips) {
              const b = f.buffers.get(clip.sourceId);
              input = F(
                input + b.data[Math.min(c, b.numberOfChannels - 1)][n % f.P],
              );
            }
            expected = F(expected + F(input * F(track.gain)));
          }
          expected = F(expected * F(f.adopted.project.master.volume));
          maxError = Math.max(
            maxError,
            Math.abs(data.getFloat32(58 + 8 * n + 4 * c, true) - expected),
          );
        }
      assert.equal(maxError, 0);
      t.diagnostic(
        JSON.stringify({
          rate,
          bars,
          frames,
          clips: 9,
          maxWavError: maxError,
          modelLedgerHighWaterBytes: f.memory.snapshot().highWaterBytes,
          qualification: "RAM model only; no native AudioContext or file",
        }),
      );
      assert(
        f.contexts.every((c) => c.sources.length === 0 && c.state === "closed"),
      );
      for (const [id, b] of f.buffers)
        assert.equal(hash(f.bytesOf(b)), before.get(id));
      assert.equal(f.counts().acquired, f.counts().released);
    } finally {
      result.release();
    }
    assertClean(f);
  });

test("production export cancellation at render/check/encode and memory/owner refusal are atomic with original PCM/credits retained", async () => {
  for (const mode of [
    "rendering",
    "checking",
    "encoding",
    "memory",
    "render-memory",
    "other-render",
    "bad-owner",
    "stopped-live",
  ]) {
    const f = fixture(),
      before = JSON.stringify(f.adopted.project),
      linked = mode === "stopped-live" ? attach(f) : null;
    if (linked) await linked.session.load(f.adopted.project);
    if (mode === "other-render") f.owner.renders.add({ voices: 8 });
    if (mode === "bad-owner") f.owner.renders.add({ voices: NaN });
    const baseline = f.memory.snapshot().bytes,
      pressure = ["memory", "render-memory"].includes(mode)
        ? f.memory.reserve(
            mode === "memory" ? 64 * 1024 * 1024 - 500000 : 48 * 1024 * 1024,
            "foreign-owner",
          )
        : null;
    let reached = false;
    const op = f.exporter.render(f.adopted.project, {
      bars: 4,
      onProgress: (p) => {
        if (p.phase === mode && !reached) {
          reached = true;
          void f.exporter.cancel();
        }
      },
    });
    await assert.rejects(
      op,
      ["other-render", "bad-owner", "stopped-live"].includes(mode)
        ? code("voiceLimit")
        : ["memory", "render-memory"].includes(mode)
          ? () => true
          : code("cancelled"),
    );
    if (["rendering", "checking", "encoding"].includes(mode)) assert(reached);
    pressure?.release();
    if (mode === "render-memory") assert.equal(f.contexts.length, 2);
    await f.exporter.cancel();
    assert.equal(f.exporter.pending, null);
    assert.equal(f.memory.snapshot().bytes, baseline);
    assert.equal(JSON.stringify(f.adopted.project), before);
    assert.equal(f.entries.size, 9);
    if (linked) {
      linked.context.state = "closed";
      await linked.session.dispose();
    }
    assertClean(f);
  }
});

test("nine-clip finite live preview explicitly uses live reader admission and exact terminal Stop while offline default remains18", async () => {
  const f = fixture(),
    { session, context } = attach(f);
  try {
    await session.load(f.adopted.project);
    assert.throws(() => loopAdmission(session.plan), code("voiceLimit"));
    session.play({ bars: 4 });
    assert.equal(session.finite.backend, "live-readers");
    assert.equal(session.finite.admission.maxOwned, 9);
    assert.equal(session.rows.size, 9);
    const end = session.transport.origin + (4 * f.P) / context.sampleRate;
    for (const n of context.sources) assert.equal(n.nativeEnd, end);
    context.advance(end);
    session.pump();
    assert.equal(session.rows.size, 0);
    assert.notEqual(session.error, "recordingLoopEnded");
  } finally {
    clearInterval(session.timer);
    context.state = "closed";
    await session.dispose();
  }
  assertClean(f);
});
