import test from "node:test";
import assert from "node:assert/strict";
import catalog from "../internal/instrument-focus/registry-48000.json" with { type: "json" };
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { emptyLoopProject, LoopHistory } from "../src/loop-station/model.js";
import { adoptRecording, digest } from "../src/loop-station/recording-data.js";
import {
  overdubBase,
  adoptOverdub,
  admitOverdubBytes,
} from "../src/loop-station/overdub.js";
import { validateLoopProject } from "../src/loop-station/project.js";
import { prepareLoopPlan } from "../src/loop-station/plan.js";
import {
  exportAudioBundle,
  importAudioBundle,
} from "../src/loop-station/audio-bundle.js";
import { MasterCaptureClock } from "../src/loop-station/master-capture-clock.js";
import { Transport } from "../src/audio/transport.js";
const registry = new InstrumentRegistry(catalog.banks);
async function fixture(level = 0.1) {
  const empty = structuredClone(emptyLoopProject(registry));
  empty.clock = { kind: "fixed-bar", sampleRate: 48000, framesPerBar: 120000 };
  const take = {
      frames: 120000,
      sampleRate: 48000,
      channels: 2,
      validBytes: 960000,
      partial: false,
    },
    basePCM = new Float32Array(240000).fill(level),
    newPCM = new Float32Array(240000).fill(-level),
    baseHash = await digest(basePCM.buffer),
    layerHash = await digest(newPCM.buffer),
    base = adoptRecording(empty, registry, "track-1", take, baseHash).project,
    identity = overdubBase(base, "track-1"),
    candidate = adoptOverdub(
      base,
      registry,
      "track-1",
      take,
      layerHash,
      identity,
    ),
    entries = new Map([
      [
        base.assetRefs[0].id,
        { blob: new Blob([basePCM.buffer]), provenance: "QA source base" },
      ],
      [
        candidate.ref.id,
        { blob: new Blob([newPCM.buffer]), provenance: "QA source layer" },
      ],
    ]);
  return { take, base, candidate, identity, baseHash, layerHash, entries };
}
test("overdub appends a distinct immutable layer, preserves exact base clip/ref and undo removes only the layer", async () => {
  const f = await fixture(),
    original = JSON.stringify(f.base),
    p = f.candidate.project;
  assert.equal(JSON.stringify(f.base), original);
  assert.deepEqual(p.tracks[0].clips[0], f.base.tracks[0].clips[0]);
  assert.deepEqual(p.assetRefs[0], f.base.assetRefs[0]);
  assert.equal(p.assetRefs.length, 2);
  assert.equal(p.tracks[0].clips.length, 2);
  assert.equal(p.tracks[0].layering.baseClipId, p.tracks[0].clips[0].id);
  assert.equal(p.tracks[0].layering.overdubClipId, p.tracks[0].clips[1].id);
  const history = new LoopHistory(f.base, registry);
  history.commit(() => p);
  assert.deepEqual(history.undo(), f.base);
  assert.deepEqual(history.redo(), p);
  assert.throws(() => overdubBase(p, "track-1"), {
    code: "overdubBaseRequired",
  });
  assert.throws(
    () => adoptRecording(f.base, registry, "track-1", f.take, f.layerHash),
    { code: "recorderEmptyTarget" },
  );
});
test("strict layer schema refuses missing/wrong roles, changed period, reversed IDs and extra layer without mutating base", async () => {
  const f = await fixture();
  const changes = [
    (p) => (p.tracks[0].layering.version = 2),
    (p) => (p.tracks[0].layering.baseClipId = p.tracks[0].clips[1].id),
    (p) => (p.tracks[0].clips[1].loop = false),
    (p) => (p.tracks[0].clips[1].startTick = 960000),
    (p) =>
      p.tracks[0].clips.push({ ...p.tracks[0].clips[1], id: "clip-extra" }),
    (p) => (p.tracks[0].layering.unknown = true),
  ];
  for (const change of changes) {
    const p = structuredClone(f.candidate.project);
    change(p);
    assert.throws(() => validateLoopProject(p, registry));
  }
  assert.throws(
    () =>
      adoptOverdub(
        f.base,
        registry,
        "track-1",
        { ...f.take, partial: true },
        f.layerHash,
        f.identity,
      ),
    { code: "partialTakeNeedsReview" },
  );
  assert.throws(
    () =>
      adoptOverdub(
        f.base,
        registry,
        "track-1",
        { ...f.take, frames: 119999 },
        f.layerHash,
        f.identity,
      ),
    { code: "overdubGeometryMismatch" },
  );
  assert.throws(
    () =>
      adoptOverdub(f.base, registry, "track-1", f.take, f.layerHash, {
        ...f.identity,
        sha256: "0".repeat(64),
      }),
    { code: "captureProjectChanged" },
  );
});
test("two-layer complete bundle/reload retains both exact PCM payloads and independent credits", async () => {
  const f = await fixture(),
    memory = new AudioMemory(),
    bundle = await exportAudioBundle(f.candidate.project, f.entries, {
      registry,
      memory,
    });
  const loaded = await importAudioBundle(bundle.blob, { registry, memory });
  assert.deepEqual(loaded.project, f.candidate.project);
  assert.equal(loaded.entries.size, 2);
  assert.equal(
    await digest(
      await loaded.entries.get(f.base.assetRefs[0].id).blob.arrayBuffer(),
    ),
    f.baseHash,
  );
  assert.equal(
    await digest(
      await loaded.entries.get(f.candidate.ref.id).blob.arrayBuffer(),
    ),
    f.layerHash,
  );
  assert.equal(
    loaded.entries.get(f.candidate.ref.id).provenance,
    "QA source layer",
  );
  loaded.release();
  bundle.release();
  assert.equal(memory.snapshot().bytes, 0);
});
test("composite planning sums absolute layer peaks even when opposite phases cancel; unsafe sum refuses and releases both native pins", async () => {
  for (const [level, safe] of [
    [0.1, true],
    [0.6, false],
  ]) {
    const f = await fixture(level);
    let held = 0;
    const resolveRecording = async (ref) => {
      held++;
      return {
        sha256: ref.sha256,
        peak: level,
        buffer: {
          length: ref.frames,
          sampleRate: ref.sampleRate,
          numberOfChannels: ref.channels,
        },
        release: () => held--,
      };
    };
    if (safe) {
      const plan = await prepareLoopPlan(f.candidate.project, {
        registry,
        rate: 48000,
        resolveRecording,
      });
      assert.equal(plan.tracks[0].clips.length, 2);
      assert.equal(held, 2);
      plan.release();
    } else
      await assert.rejects(
        prepareLoopPlan(f.candidate.project, {
          registry,
          rate: 48000,
          resolveRecording,
        }),
        { code: "voiceHeadroom" },
      );
    assert.equal(held, 0);
    assert.equal(f.base.assetRefs.length, 1);
  }
});
test("overdub aligns the first frame to full 1/2/4/8-bar base cycles, not an arbitrary next bar", () => {
  for (const sampleRate of [44100, 48000])
    for (const bpm of [60, 96, 173, 180])
      for (const bars of [1, 2, 4, 8]) {
        const p = structuredClone(emptyLoopProject(registry));
        p.timing.bpm = bpm;
        p.clock = {
          kind: "fixed-bar",
          sampleRate,
          framesPerBar: Math.round((240 * sampleRate) / bpm),
        };
        const transport = new Transport({ bpm });
        transport.start(0);
        const context = {
            sampleRate,
            state: "running",
            currentTime: (p.clock.framesPerBar / sampleRate) * 2.37,
          },
          clock = new MasterCaptureClock(context, transport, p, registry);
        transport.beatSeconds = 60 / clock.master.effectiveBpm;
        const plan = clock.plan({ bars, countInBars: 1, alignBars: bars });
        assert.equal(
          (plan.startFrame - plan.transportOriginFrame) %
            (bars * p.clock.framesPerBar),
          0,
        );
        assert.equal(
          plan.endFrame - plan.startFrame,
          bars * p.clock.framesPerBar,
        );
        assert.equal(plan.startFrame - plan.countInFrame, p.clock.framesPerBar);
        assert.ok(plan.countInFrame > context.currentTime * sampleRate);
      }
});
test("project audio capacity refuses before recording a second maximum-duration layer", () => {
  const p = structuredClone(emptyLoopProject(registry));
  p.timing.bpm = 60;
  p.clock = { kind: "fixed-bar", sampleRate: 48000, framesPerBar: 192000 };
  const take = {
      frames: 1536000,
      sampleRate: 48000,
      channels: 2,
      validBytes: 12288000,
      partial: false,
    },
    base = adoptRecording(p, registry, "track-1", take, "a".repeat(64)).project,
    identity = overdubBase(base, "track-1");
  assert.throws(() => admitOverdubBytes(base, identity), {
    code: "recordingPackageTooLarge",
  });
  assert.equal(base.assetRefs.length, 1);
  assert.equal(base.tracks[0].clips.length, 1);
});
