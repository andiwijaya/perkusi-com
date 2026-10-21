import test from "node:test";
import assert from "node:assert/strict";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { TakePool } from "../src/loop-station/take-pool.js";
import { newRecordingProject } from "../src/loop-station/model.js";
import { freezeCaptureProject } from "../src/loop-station/master-capture-clock.js";
import { adoptRecording, digest } from "../src/loop-station/recording-data.js";
import { adoptOverdub, overdubBase } from "../src/loop-station/overdub.js";
import { exportAudioBundle } from "../src/loop-station/audio-bundle.js";
import { importCanonicalFile } from "../src/project/canonical-package.js";
import {
  canonicalCaptureProject,
  replaceCanonicalOverdub,
} from "../src/studio/canonical-capture-material.js";
import {
  createCanonicalRecordingHandles,
  isCanonicalRecordingHandle,
  claimCanonicalRecordingLoan,
} from "../src/audio/canonical-recordings.js";
import { createCanonicalProductionAdapter } from "../src/audio/canonical-production-adapter.js";
import { prepareCanonicalScore } from "../src/audio/canonical-score.js";
import { createCanonicalEditor } from "../src/studio/canonical-editor.js";
import { canonicalFixtureRegistry as registry } from "./helpers/canonical-fixtures.js";
import { qaBuffer } from "./helpers/canonical-score-fixtures.js";
import { canonicalRecordingPhase } from "../src/project/canonical-recording-position.js";
import { deriveCanonicalBundle } from "../src/project/canonical-package.js";
import { measureCanonicalScore } from "../src/audio/canonical-native.js";

test("exclusive recording authority binds actual fresh loan, handle, context and memory exactly once", async () => {
  const f = await fixture(),
    context = { sampleRate: 48000, createBuffer: qaBuffer },
    handles = createCanonicalRecordingHandles(f.base, { memory: f.memory }),
    handle = handles.recordings[0],
    loan = await handle.acquire({ context }),
    second = await handle.acquire({ context });
  try {
    assert.equal(isCanonicalRecordingHandle({ ...handle }, f.memory), false);
    assert.equal(isCanonicalRecordingHandle({}, undefined), false);
    assert.notEqual(loan.buffer, second.buffer);
    assert.notEqual(
      loan.buffer.getChannelData(0),
      second.buffer.getChannelData(0),
    );
    for (const args of [
      [{ ...loan }, handle, context, f.memory],
      [loan, { ...handle }, context, f.memory],
      [loan, handle, { ...context }, f.memory],
      [loan, handle, context, new AudioMemory()],
    ])
      assert.throws(
        () => claimCanonicalRecordingLoan(...args),
        (e) => e.code === "canonicalAssetIdentityMismatch",
      );
    assert.equal(
      claimCanonicalRecordingLoan(loan, handle, context, f.memory),
      handle.asset.sha256,
    );
    assert.throws(
      () => claimCanonicalRecordingLoan(loan, handle, context, f.memory),
      (e) => e.code === "canonicalAssetIdentityMismatch",
    );
    loan.release();
    assert.throws(
      () => claimCanonicalRecordingLoan(loan, handle, context, f.memory),
      (e) => e.code === "canonicalAssetIdentityMismatch",
    );
    assert.deepEqual(second.buffer.getChannelData(0), f.original[0]);
  } finally {
    loan.release();
    second.release();
    await handles.dispose();
    await f.close();
  }
});

test("eight-bar accepted stereo take prepares and meters under64MiB without cloning an exclusively owned recording", async () => {
  const f = await fixture(8),
    pressure = f.memory.reserve(
      17 * 1024 * 1024,
      "QA/other-retained-project-data",
    ),
    before = f.memory.snapshot().bytes,
    nativeBuffers = [],
    context = {
      sampleRate: 48000,
      createBuffer(...args) {
        const b = qaBuffer(...args);
        nativeBuffers.push(b);
        return b;
      },
    },
    handles = createCanonicalRecordingHandles(f.base, { memory: f.memory });
  let adapter, score;
  try {
    adapter = createCanonicalProductionAdapter({
      context,
      memory: f.memory,
      recordings: handles.recordings,
      resolveUrl: (d) => "/" + d.path,
      fetcher: () => {
        throw Error("Recorded data must not fetch shipped assets");
      },
    });
    score = await prepareCanonicalScore(f.base.project, {
      registry: adapter.registry,
      provider: adapter.provider,
      memory: f.memory,
      rate: 48000,
      createBuffer: context.createBuffer,
      command: { kind: "window", bars: 8, cycles: 1 },
    });
    const buffer = score.program.events[0].spec.buffer;
    assert.equal(
      nativeBuffers.filter((b) => b.length === f.take.frames).length,
      1,
    );
    assert.equal(buffer, nativeBuffers[0]);
    for (let c = 0; c < 2; c++)
      assert.deepEqual(
        new Uint8Array(buffer.getChannelData(c).buffer),
        new Uint8Array(f.original[c].buffer),
      );
    const measured = await measureCanonicalScore(score, {
      memory: f.memory,
      context,
    });
    assert.equal(measured.output, null);
    assert(measured.metadata.render.postPeak > 0);
    assert(measured.metadata.render.postPeak <= 0.95);
    assert(f.memory.snapshot().highWaterBytes < 67108864);
    assert.equal(f.pool.snapshot().length, 1);
  } finally {
    score?.dispose();
    await adapter?.dispose();
    await handles.dispose();
    assert.equal(f.memory.snapshot().bytes, before);
    pressure.release();
    await f.close();
  }
});

test("canonical manual phase is undoable metadata with stale, period and range guards; original stereo survives", async () => {
  const f = await fixture(),
    p = f.base.project,
    a = p.sections
      .find((s) => s.id === p.activeSection)
      .placements.find((a) => a.sourceRef.kind === "asset"),
    r = p.assets.find((r) => r.id === a.sourceRef.id),
    before = structuredClone(p),
    editor = await createCanonicalEditor(f.base, {
      registry,
      memory: f.memory,
    });
  let changed;
  try {
    for (const n of [-12000, -128, 0, 128, 12000]) {
      const next = canonicalRecordingPhase(p, a.id, n, r.sha256);
      assert.deepEqual(p, before);
      assert.deepEqual(next.assets, p.assets);
      assert.deepEqual(next.origins, p.origins);
      const target = next.sections
        .find((s) => s.id === next.activeSection)
        .placements.find((x) => x.id === a.id);
      assert.equal(target.alignment?.advanceFrames ?? 0, n);
      assert.equal(target.lengthTicks, a.lengthTicks);
      assert.equal(target.offsetFrames, a.offsetFrames);
      changed = await deriveCanonicalBundle(next, f.base, { registry });
      assert.deepEqual(
        await changed.entries.get(r.id).blob.arrayBuffer(),
        await f.base.entries.get(r.id).blob.arrayBuffer(),
      );
      await editor.replace(changed);
      changed.dispose();
      changed = null;
      await editor.undo();
      assert.deepEqual(editor.snapshot().project, p);
    }
    assert.throws(
      () => canonicalRecordingPhase(p, a.id, 128, "0".repeat(64)),
      (e) => e.code === "draftConflict",
    );
    for (const n of [12001, -12001, 0.5, NaN])
      assert.throws(
        () => canonicalRecordingPhase(p, a.id, n, r.sha256),
        (e) => e.code === "invalidPhaseAlignment",
      );
    const bad = structuredClone(p);
    bad.sections
      .find((s) => s.id === bad.activeSection)
      .placements.find((x) => x.id === a.id).loop = false;
    assert.throws(
      () => canonicalRecordingPhase(bad, a.id, 128, r.sha256),
      (e) => e.code === "invalidPhaseAlignment",
    );
  } finally {
    changed?.dispose();
    await editor.dispose();
    await f.close();
  }
});

async function fixture(bars = 1) {
  const memory = new AudioMemory(),
    pool = new TakePool(memory),
    project = structuredClone(newRecordingProject(registry));
  project.timing.bpm = 110;
  const p = freezeCaptureProject(project, registry, 48000),
    n = p.clock.framesPerBar * bars,
    original = Array.from({ length: 2 }, (_, c) =>
      Float32Array.from({ length: n }, (_, f) =>
        f === 0 ? -0 : (c ? Math.cos(f / 37) : Math.sin(f / 23)) * 0.03,
      ),
    );
  const take = pool.adopt(
      pool.reserve({ capacity: n, channels: 2, sampleRate: 48000 }),
      {
        capacity: n,
        channels: 2,
        sampleRate: 48000,
        startFrame: 0,
        frames: n,
        reason: "complete",
      },
      original.map((c) => new Float32Array(c).buffer),
    ),
    copy = pool.copyPCM(take.id),
    hash = await digest(copy.buffer),
    adopted = adoptRecording(p, registry, "track-1", take, hash),
    entries = new Map([
      [
        adopted.ref.id,
        {
          blob: new Blob([copy.buffer]),
          provenance: "Isolated synthetic stereo test; no microphone",
        },
      ],
    ]);
  copy.release();
  const packed = await exportAudioBundle(adopted.project, entries, {
      registry,
      memory,
    }),
    base = await importCanonicalFile(packed.blob, { registry, memory });
  packed.release();
  return {
    memory,
    pool,
    p: adopted.project,
    entries,
    take,
    original,
    base,
    async close() {
      base.dispose();
      pool.release(take.id);
      assert.equal(memory.snapshot().bytes, 0);
    },
  };
}
test("original planar stereo channels and signed zeros survive canonical native decoding and identity verification", async () => {
  const f = await fixture(),
    context = { sampleRate: 48000, createBuffer: qaBuffer },
    handles = createCanonicalRecordingHandles(f.base, { memory: f.memory });
  let adapter, score, loan;
  try {
    loan = await handles.recordings[0].acquire({ context });
    for (let c = 0; c < 2; c++)
      assert.deepEqual(loan.buffer.getChannelData(c), f.original[c]);
    loan.release();
    loan = null;
    adapter = createCanonicalProductionAdapter({
      context,
      memory: f.memory,
      recordings: handles.recordings,
      resolveUrl: (d) => "/" + d.path,
      fetcher: () => {
        throw Error("Recording must not fetch assets");
      },
    });
    score = await prepareCanonicalScore(f.base.project, {
      registry: adapter.registry,
      provider: adapter.provider,
      memory: f.memory,
      rate: 48000,
      createBuffer: qaBuffer,
      command: { kind: "window", bars: 4, cycles: 1 },
    });
    for (let c = 0; c < 2; c++)
      assert.deepEqual(
        score.program.events[0].spec.buffer.getChannelData(c),
        f.original[c],
      );
  } finally {
    loan?.release();
    score?.dispose();
    await adapter?.dispose();
    await handles.dispose();
    await f.close();
  }
});
test("capture projection and overdub replace exactly one full-pool track, preserving old raw bytes, mix, FX, archives and Undo", async () => {
  const f = await fixture(),
    track = f.base.project.tracks.find((t) => t.kind === "recording"),
    projection = canonicalCaptureProject(f.base.project, registry, {
      trackId: track.id,
      rate: 48000,
    });
  let incoming, combined, editor;
  const n = f.take.frames,
    second = f.pool.adopt(
      f.pool.reserve({ capacity: n, channels: 2, sampleRate: 48000 }),
      {
        capacity: n,
        channels: 2,
        sampleRate: 48000,
        startFrame: n,
        frames: n,
        reason: "complete",
      },
      [
        new Float32Array(f.original[1]).buffer,
        new Float32Array(f.original[0]).buffer,
      ],
    ),
    copy = f.pool.copyPCM(second.id);
  let packed;
  try {
    assert.equal(projection.master.volume, f.base.project.master.volume);
    assert.equal(
      projection.assetRefs[0].sha256,
      f.base.project.assets[0].sha256,
    );
    const adopted = adoptOverdub(
      projection,
      registry,
      "track-1",
      second,
      await digest(copy.buffer),
      overdubBase(projection, "track-1"),
    );
    f.entries.set(adopted.ref.id, {
      blob: new Blob([copy.buffer]),
      provenance: "Isolated second layer; unchanged planar PCM",
    });
    packed = await exportAudioBundle(adopted.project, f.entries, {
      registry,
      memory: f.memory,
    });
    incoming = await importCanonicalFile(packed.blob, {
      registry,
      memory: f.memory,
    });
    combined = await replaceCanonicalOverdub(f.base, incoming, track.id, {
      registry,
      memory: f.memory,
    });
    assert.equal(combined.project.tracks.length, 8);
    const replaced = combined.project.tracks.find((t) => t.id === track.id);
    assert(replaced.layering);
    assert.deepEqual(replaced.mix, track.mix);
    assert.deepEqual(replaced.fx, track.fx);
    assert.equal(combined.project.master.volume, f.base.project.master.volume);
    for (const old of f.base.project.assets) {
      const kept = combined.project.assets.find((a) => a.id === old.id);
      assert.deepEqual(kept, old);
      assert.deepEqual(
        await combined.entries.get(old.id).blob.arrayBuffer(),
        await f.base.entries.get(old.id).blob.arrayBuffer(),
      );
    }
    for (const o of f.base.project.origins.filter((o) => o.kind === "file"))
      assert.deepEqual(
        await combined.originals.get(o.sha256).arrayBuffer(),
        await f.base.originals.get(o.sha256).arrayBuffer(),
      );
    editor = await createCanonicalEditor(f.base, {
      registry,
      memory: f.memory,
    });
    await editor.replace(combined);
    await editor.undo();
    assert.deepEqual(editor.snapshot().project, f.base.project);
  } finally {
    copy.release();
    packed?.release();
    await editor?.dispose();
    combined?.dispose();
    incoming?.dispose();
    f.pool.release(second.id);
    await f.close();
  }
});
