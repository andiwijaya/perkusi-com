import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AudioMemory } from "../src/audio/audio-memory.js";
import {
  canonicalFixtureRegistry as registry,
  fixturePCM,
} from "./helpers/canonical-fixtures.js";
import { migrateLegacyMetadata } from "../src/project/canonical-metadata.js";
import {
  createCanonicalBundle,
  exportCanonicalPackage,
  importCanonicalPackage,
} from "../src/project/canonical-package.js";
import { combineCanonicalMaterial } from "../src/project/canonical-hub.js";
import { createCanonicalRecordingHandles } from "../src/audio/canonical-recordings.js";
import { createCanonicalEditor } from "../src/studio/canonical-editor.js";
import { createCanonicalWorkflow } from "../src/studio/canonical-workflow.js";
import { PPQ } from "../src/project/instrument-project.js";
async function fixture(name, memory, { bypass = false, backup = null } = {}) {
  const raw = new Uint8Array(
      await readFile(
        new URL(
          "./fixtures/v5-canonical/" + name + ".perkusi.json",
          import.meta.url,
        ),
      ),
    ),
    m = await migrateLegacyMetadata(raw, { registry }),
    p = structuredClone(m.project),
    entries = new Map();
  if (bypass) p.master.limiter.bypass = true;
  for (const [a, i] of p.assets.map((a, i) => [a, i]))
    entries.set(a.id, {
      blob: new Blob([fixturePCM()[i].buffer]),
      provenance: "QA memory-only fixture " + i,
    });
  return createCanonicalBundle(p, {
    registry,
    memory,
    originals: m.originals,
    entries,
    backup,
  });
}
test("three-tool material copy preserves native off-grid events, independent pattern sources, exact originals and recorded layers", async () => {
  const memory = new AudioMemory(),
    native = await fixture("schema4-multibar", memory),
    beat = await fixture("schema0-beatbox", memory),
    loop = await fixture("schema5-eq-overdub-alignment", memory, {
      bypass: true,
    }),
    a = await combineCanonicalMaterial(native, beat, { registry, memory }),
    b = await combineCanonicalMaterial(a, loop, { registry, memory });
  assert.equal(b.project.mixPolicy, "unified-outer-v1");
  assert.equal(b.project.master.volume, 1);
  assert.equal(b.project.assets.length, 2);
  assert.equal(b.project.tracks.length, 4);
  assert.deepEqual(b.project.sourceDefs[0], a.project.sourceDefs[0]);
  assert.deepEqual(
    native.project.sourceDefs[0].programme.events,
    b.project.sourceDefs[0].programme.events,
  );
  for (const src of [native, beat, loop])
    for (const o of src.project.origins.filter((o) => o.kind === "file"))
      assert.deepEqual(
        await b.originals.get(o.sha256).arrayBuffer(),
        await src.originals.get(o.sha256).arrayBuffer(),
      );
  for (const asset of b.project.assets) {
    assert.equal(
      b.entries.get(asset.id).provenance.startsWith("QA memory-only"),
      true,
    );
    assert.equal(
      asset.sha256,
      loop.project.assets.find((x) => x.sha256 === asset.sha256).sha256,
    );
  }
  const editor = await createCanonicalEditor(b, { registry, memory }),
    d = b.project.sourceDefs.find(
      (d) => d.kind === "composition" && d.parentId === null,
    ),
    old = b.project.sections[0].placements.find(
      (p) => p.sourceRef.id === d.id,
    ).lengthTicks;
  await editor.setChain(d.id, [...d.programme.chain, ...d.programme.chain]);
  assert.equal(
    editor
      .snapshot()
      .project.sections[0].placements.find((p) => p.sourceRef.id === d.id)
      .lengthTicks,
    old * 2,
  );
  await editor.undo();
  assert.deepEqual(editor.snapshot().project, b.project);
  await editor.dispose();
  for (const x of [native, beat, loop, a, b]) x.dispose();
  assert.equal(memory.snapshot().bytes, 0);
});
test("hub refuses tempo, nonlinear source limiter and exhausted tracks atomically; input leases remain valid", async () => {
  const memory = new AudioMemory(),
    a = await fixture("schema0-beatbox", memory),
    b = await fixture("schema5-eq-overdub-alignment", memory),
    before = memory.snapshot().bytes;
  await assert.rejects(
    combineCanonicalMaterial(a, b, { registry, memory }),
    (e) => e.code === "hubLimiterUnsupported",
  );
  assert.equal(memory.snapshot().bytes, before);
  const editor = await createCanonicalEditor(a, { registry, memory });
  await editor.edit((p) => {
    p.timing.bpm = 100;
    for (const d of p.sourceDefs)
      if (d.kind === "composition") {
        d.programme.timing.bpm = 100;
        for (const pattern of d.programme.patterns)
          for (const control of pattern.beatbox) control.enabled = false;
      }
  });
  await assert.rejects(
    combineCanonicalMaterial(a, editor.snapshot().bundle, { registry, memory }),
    (e) => e.code === "hubTempoConflict",
  );
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    combineCanonicalMaterial(a, a, { registry, memory, signal: ac.signal }),
    (e) => e.code === "cancelled",
  );
  let copy = a;
  const owned = [];
  for (let i = 0; i < 7; i++) {
    copy = await combineCanonicalMaterial(copy, a, { registry, memory });
    owned.push(copy);
  }
  await assert.rejects(
    combineCanonicalMaterial(copy, a, { registry, memory }),
    (e) => e.code === "hubTrackLimit",
  );
  for (const x of owned) x.dispose();
  await editor.dispose();
  a.dispose();
  b.dispose();
  assert.equal(memory.snapshot().bytes, 0);
});
test("version 2 package roundtrip retains exact working input archive and detects archive corruption", async () => {
  const memory = new AudioMemory(),
    a = await fixture("schema0-beatbox", memory),
    out = await exportCanonicalPackage(a, { memory }),
    input = await importCanonicalPackage(out.blob, { registry, memory }),
    merged = await combineCanonicalMaterial(a, input, { registry, memory });
  assert.equal(merged.backupRefs.length, 1);
  assert.deepEqual(
    await merged.backups.get(input.backupHash).blob.arrayBuffer(),
    await out.blob.arrayBuffer(),
  );
  const packed = await exportCanonicalPackage(merged, { memory }),
    copy = await importCanonicalPackage(packed.blob, { registry, memory });
  assert.deepEqual(copy.project, merged.project);
  assert.deepEqual(copy.backupRefs, merged.backupRefs);
  const bad = new Uint8Array(await packed.blob.arrayBuffer());
  bad[bad.length - 1] ^= 1;
  await assert.rejects(
    importCanonicalPackage(new Blob([bad]), { registry, memory }),
    (e) => e.code === "canonicalBackupHash",
  );
  for (const x of [a, input, merged, copy]) x.dispose();
  out.release();
  packed.release();
  assert.equal(memory.snapshot().bytes, 0);
});
test("recording handles retain raw signed PCM and credits without asserting commercial rights; outstanding loans block terminal release", async () => {
  const memory = new AudioMemory(),
    b = await fixture("schema5-eq-overdub-alignment", memory),
    handle = createCanonicalRecordingHandles(b, { memory }),
    asset = b.project.assets[0];
  b.dispose();
  const context = {
      sampleRate: 48000,
      createBuffer(channels, frames, sampleRate) {
        const data = Array.from(
          { length: channels },
          () => new Float32Array(frames),
        );
        return {
          numberOfChannels: channels,
          length: frames,
          sampleRate,
          getChannelData: (i) => data[i],
        };
      },
    },
    loan = await handle.recordings[0].acquire({ context });
  assert.equal(handle.recordings[0].rights.commercialUse, null);
  assert.equal(handle.recordings[0].rights.rawRedistribution, null);
  assert.equal(loan.sourceHash, asset.sha256);
  assert.equal(Object.is(loan.buffer.getChannelData(0)[0], -0), true);
  assert.equal(loan.buffer.getChannelData(1)[0], fixturePCM()[0][1]);
  await assert.rejects(
    handle.dispose(),
    (e) => e.code === "canonicalRecordingStillOwned",
  );
  assert.ok(memory.snapshot().bytes > 0);
  loan.release();
  assert.throws(
    () => loan.buffer,
    (e) => e.code === "canonicalLoanReleased",
  );
  await handle.dispose();
  assert.equal(memory.snapshot().bytes, 0);
});
test("recording acquisition at wrong rate or synchronous cancellation releases only its own work", async () => {
  const memory = new AudioMemory(),
    b = await fixture("schema5-eq-overdub-alignment", memory),
    h = createCanonicalRecordingHandles(b, { memory }),
    before = memory.snapshot().bytes;
  assert.throws(
    () => h.recordings[0].acquire({ context: { sampleRate: 44100 } }),
    (e) => e.code === "takeRateMismatch",
  );
  const task = h.recordings[0].acquire({ context: { sampleRate: 48000 } }),
    close = h.dispose();
  await assert.rejects(task, (e) => e.code === "cancelled");
  await close;
  assert.equal(memory.snapshot().bytes, before);
  b.dispose();
  assert.equal(memory.snapshot().bytes, 0);
});
test("explicit native duration authoring and add-file workflow produce undoable working material without changing source file", async () => {
  const memory = new AudioMemory(),
    a = await fixture("schema4-independent-clocks", memory),
    editor = await createCanonicalEditor(a, { registry, memory }),
    id = a.project.sourceDefs.find((d) => d.kind === "instrument-events").id,
    events = a.project.sourceDefs[0].programme.events;
  await editor.setNativeLength(id, 16 * PPQ);
  assert.deepEqual(
    editor.snapshot().project.sourceDefs.find((d) => d.id === id).programme
      .events,
    events,
  );
  assert.equal(editor.snapshot().project.transport.nativeLengthTicks, 16 * PPQ);
  const workflow = createCanonicalWorkflow({
      editor,
      registry,
      memory,
      storage: { close() {} },
    }),
    raw = await readFile(
      new URL(
        "./fixtures/v5-canonical/schema0-beatbox.perkusi.json",
        import.meta.url,
      ),
    );
  await workflow.importFile(new Blob([raw]), { mode: "add" });
  assert.equal(editor.snapshot().project.tracks.length, 2);
  await editor.undo();
  assert.equal(editor.snapshot().project.tracks.length, 1);
  await workflow.dispose();
  await editor.dispose();
  a.dispose();
  assert.equal(memory.snapshot().bytes, 0);
});
