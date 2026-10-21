import test from "node:test";
import assert from "node:assert/strict";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { createFreshCanonicalProject } from "../src/studio/canonical-fresh-project.js";
import {
  createCanonicalGamelanMaterial,
  createCanonicalRackMaterial,
} from "../src/studio/canonical-source-material.js";
import { recordSource } from "../src/loop-station/record-sources.js";
import { createCanonicalDemo } from "../src/studio/canonical-demos.js";
import { createStarter, starterContent } from "../src/loop-station/starters.js";
import { combineCanonicalMaterial } from "../src/project/canonical-hub.js";
import {
  deriveCanonicalBundle,
  exportCanonicalPackage,
} from "../src/project/canonical-package.js";
import { createCanonicalEditor } from "../src/studio/canonical-editor.js";
import { createCanonicalWorkflow } from "../src/studio/canonical-workflow.js";
import { physicalFocus } from "../src/gamelan/instrument-focus.js";
import { canonicalRegisteredAssets } from "../src/audio/canonical-registered-assets.js";
const registry = canonicalRegisteredAssets(48000, (d) => "/" + d.path).registry;

test("prepared rack authors every registered drum, bass and guitar recording without changing identities, mix or clocks", async () => {
  const memory = new AudioMemory(),
    base = await createFreshCanonicalProject({ registry, memory });
  try {
    for (const instrument of [
      "drum-ruang",
      "drum-arus",
      "electric-bass",
      "classical-guitar",
    ]) {
      const s = recordSource(instrument);
      for (const sampleId of s.sampleIds) {
        const material = await createCanonicalRackMaterial({
          project: base.project,
          registry,
          memory,
          instrument,
          sampleId,
        });
        try {
          const source = material.project.sourceDefs.find(
            (d) => d.kind === "instrument-events",
          );
          assert.deepEqual(source.programme.events, [
            {
              id: "first-strike",
              tick: 0,
              action: "strike",
              velocity: 0.65,
              bankId: s.bankId,
              sampleId,
            },
          ]);
          assert.equal(material.project.master.volume, 0.65);
          assert.deepEqual(
            material.project.timing.clock,
            base.project.timing.clock,
          );
          for (const o of material.project.origins.filter(
            (o) => o.kind === "file",
          ))
            assert(material.originals.get(o.sha256).size > 0);
        } finally {
          material.dispose();
        }
      }
      await assert.rejects(
        createCanonicalRackMaterial({
          project: base.project,
          registry,
          memory,
          instrument,
          sampleId: "untrusted",
        }),
        (e) => e.code === "unknownInstrumentSample",
      );
    }
  } finally {
    base.dispose();
  }
  assert.equal(memory.snapshot().bytes, 0);
});

test("three existing Loop starters retain their native scores and original archival bytes in canonical demo entry", async () => {
  const memory = new AudioMemory();
  for (const recipe of starterContent) {
    const original = createStarter(recipe.id, registry),
      bundle = await createCanonicalDemo("starter:" + recipe.id, {
        registry,
        memory,
        locale: "en",
      });
    try {
      assert.equal(bundle.project.title, recipe.name.en);
      assert.equal(bundle.project.timing.bpm, recipe.bpm);
      const placed = new Set(
          bundle.project.sections.flatMap((s) =>
            s.placements.map((a) => a.sourceRef.id),
          ),
        ),
        actual = bundle.project.sourceDefs.filter(
          (d) => d.kind === "instrument-events" && placed.has(d.id),
        );
      assert.equal(actual.length, recipe.lanes.length);
      assert.equal(bundle.project.master.volume, original.master.volume);
      assert.equal(bundle.project.transport.kind, "chain");
      assert.equal(bundle.project.tracks.length, recipe.lanes.length);
      assert.deepEqual(
        actual.map((s) => s.programme.events),
        original.sources.map((s) => JSON.parse(s.text).events),
      );
      const archived = await Promise.all(
        bundle.project.origins
          .filter((o) => o.kind === "file")
          .map(async (o) =>
            JSON.parse(await bundle.originals.get(o.sha256).text()),
          ),
      );
      assert(
        archived.some(
          (p) =>
            JSON.stringify(p) ===
            JSON.stringify({ ...original, title: recipe.name.en }),
        ),
      );
    } finally {
      bundle.dispose();
    }
    assert.equal(memory.snapshot().bytes, 0);
  }
});

test("registered Gamelan creation retains default mix, original identities and source files through undoable addition", async () => {
  const memory = new AudioMemory(),
    foreign = memory.reserve(313, "foreign"),
    base = await createFreshCanonicalProject({ registry, memory }),
    before = JSON.stringify(base.project),
    material = await createCanonicalGamelanMaterial({
      project: base.project,
      registry,
      memory,
    }),
    note = physicalFocus(registry, "saron-barung", "pelog")[0],
    native = material.project.sourceDefs.find(
      (d) => d.kind === "instrument-events",
    ),
    editor = await createCanonicalEditor(base, { registry, memory }),
    combined = await combineCanonicalMaterial(base, material, {
      registry,
      memory,
    });
  try {
    assert.equal(native.programme.events.length, 1);
    assert.deepEqual(native.programme.events[0], {
      id: "first-strike",
      tick: 0,
      action: "strike",
      velocity: 0.65,
      bankId: note.bank.id,
      sampleId: note.descriptor.id,
    });
    assert.equal(material.project.master.volume, 0.65);
    assert.equal(material.project.timing.bpm, base.project.timing.bpm);
    assert.equal(material.project.assets.length, 0);
    await editor.replace(combined);
    for (const b of [base, material])
      for (const { sha256: hash } of b.project.origins.filter(
        (o) => o.kind === "file",
      )) {
        const blob = b.originals.get(hash);
        assert.deepEqual(
          await editor.snapshot().bundle.originals.get(hash).arrayBuffer(),
          await blob.arrayBuffer(),
        );
      }
    assert.equal(JSON.stringify(base.project), before);
    await editor.undo();
    assert.deepEqual(editor.snapshot().project, base.project);
  } finally {
    await editor.dispose();
    combined.dispose();
    material.dispose();
    base.dispose();
  }
  assert.equal(memory.snapshot().bytes, 313);
  foreign.release();
});

async function clocks() {
  const memory = new AudioMemory(),
    base = await createFreshCanonicalProject({ registry, memory }),
    p = structuredClone(base.project);
  p.timing.bpm = 110;
  for (const d of p.sourceDefs)
    if (d.kind === "composition") d.programme.timing.bpm = 110;
  const musical = await deriveCanonicalBundle(p, base, { registry });
  p.timing.clock = {
    kind: "fixed-bar",
    sampleRate: 48000,
    framesPerBar: Math.round((240 * 48000) / 110),
  };
  const fixed = await deriveCanonicalBundle(p, base, { registry });
  return {
    memory,
    base,
    musical,
    fixed,
    dispose() {
      base.dispose();
      musical.dispose();
      fixed.dispose();
      assert.equal(memory.snapshot().bytes, 0);
    },
  };
}

test("rounded 110 BPM fixed clocks can combine only when their actual frame clocks already agree", async () => {
  const f = await clocks();
  let joined, different;
  try {
    joined = await combineCanonicalMaterial(f.fixed, f.fixed, {
      registry,
      memory: f.memory,
    });
    assert.deepEqual(joined.project.timing.clock, f.fixed.project.timing.clock);
    await assert.rejects(
      combineCanonicalMaterial(f.musical, f.fixed, {
        registry,
        memory: f.memory,
      }),
      (e) => e.code === "hubClockConflict",
    );
    const p = structuredClone(f.fixed.project);
    p.timing.clock = {
      kind: "fixed-bar",
      sampleRate: 44100,
      framesPerBar: Math.round((240 * 44100) / 110),
    };
    different = await deriveCanonicalBundle(p, f.fixed, { registry });
    await assert.rejects(
      combineCanonicalMaterial(f.fixed, different, {
        registry,
        memory: f.memory,
      }),
      (e) => e.code === "hubClockConflict",
    );
  } finally {
    joined?.dispose();
    different?.dispose();
    f.dispose();
  }
});

test("explicit capture-clock adoption changes only the undoable working grid; ordinary add keeps its clock refusal", async () => {
  const f = await clocks(),
    editor = await createCanonicalEditor(f.musical, {
      registry,
      memory: f.memory,
    }),
    workflow = createCanonicalWorkflow({
      editor,
      registry,
      memory: f.memory,
      storage: { close() {} },
    }),
    packed = await exportCanonicalPackage(f.fixed, { memory: f.memory }),
    before = editor.snapshot().project;
  try {
    await assert.rejects(
      workflow.importFile(packed.blob, { mode: "add" }),
      (e) => e.code === "hubClockConflict",
    );
    assert.deepEqual(editor.snapshot().project, before);
    await workflow.importFile(packed.blob, {
      mode: "add",
      freezeRecordingClock: true,
    });
    assert.deepEqual(
      editor.snapshot().project.timing.clock,
      f.fixed.project.timing.clock,
    );
    assert.equal(editor.snapshot().project.timing.bpm, 110);
    for (const { sha256: hash } of f.musical.project.origins.filter(
      (o) => o.kind === "file",
    ))
      assert.deepEqual(
        await editor.snapshot().bundle.originals.get(hash).arrayBuffer(),
        await f.musical.originals.get(hash).arrayBuffer(),
      );
    await editor.undo();
    assert.deepEqual(editor.snapshot().project, before);
    assert.throws(
      () =>
        workflow.importFile(packed.blob, {
          mode: "replace",
          freezeRecordingClock: true,
        }),
      (e) => e.code === "invalidImportMode",
    );
  } finally {
    packed.release();
    await workflow.dispose();
    await editor.dispose();
    f.dispose();
  }
});
