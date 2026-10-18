import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { migrateLegacyMetadata } from "../src/project/canonical-metadata.js";
import {
  createCanonicalBundle,
  exportCanonicalPackage,
  importCanonicalPackage,
} from "../src/project/canonical-package.js";
import { createCanonicalEditor } from "../src/studio/canonical-editor.js";
import { compileCanonicalTimeline } from "../src/project/canonical-timeline.js";
import { combineCanonicalMaterial } from "../src/project/canonical-hub.js";
import { PPQ } from "../src/project/instrument-project.js";
import {
  startSongChain,
  cloneSongPattern,
  newSongPattern,
  selectSongPattern,
  setSongLength,
  setSongPlacement,
  deleteSongPattern,
  appendSongPattern,
  editSongChain,
  newRhythmPattern,
  deleteRhythmPattern,
  moveSongPattern,
  moveRhythmPattern,
} from "../src/project/canonical-authoring.js";
import {
  canonicalFixtureRegistry as registry,
  fixturePCM,
} from "./helpers/canonical-fixtures.js";
const code = (c) => (e) => e.code === c;
async function fixture(name = "schema4-multibar") {
  const memory = new AudioMemory(),
    raw = new Uint8Array(
      await readFile(
        new URL(
          "./fixtures/v5-canonical/" + name + ".perkusi.json",
          import.meta.url,
        ),
      ),
    ),
    m = await migrateLegacyMetadata(raw, { registry }),
    entries = new Map();
  if (m.project.assets.length) {
    const pcm = fixturePCM();
    m.project.assets.forEach((a, i) =>
      entries.set(a.id, {
        blob: new Blob([pcm[i].buffer]),
        provenance: "Synthetic QA RAM-only exact raw fixture",
      }),
    );
  }
  const bundle = await createCanonicalBundle(m.project, {
      registry,
      memory,
      entries,
      originals: m.originals,
    }),
    editor = await createCanonicalEditor(bundle, { registry, memory });
  const close = async () => {
    await editor.dispose();
    bundle.dispose();
    assert.equal(memory.snapshot().bytes, 0);
  };
  return { memory, raw, bundle, editor, close };
}
const active = (p) => p.sections.find((s) => s.id === p.activeSection);
const native = (p, s = active(p)) =>
  p.sourceDefs.find(
    (d) =>
      d.id ===
      s.placements.find((a) => a.sourceRef.kind === "working").sourceRef.id,
  );
const rhythm = (p, s = active(p)) => {
  const d = native(p, s);
  return d.kind === "composition"
    ? d
    : p.sourceDefs.find((c) => c.id === d.programme.accompanimentRef);
};

test("song clone owns native/accompaniment/beat controls; A/B/A timeline, Undo/Redo and portable roundtrip preserve A and originals", async () => {
  const f = await fixture(),
    e = f.editor;
  try {
    await e.edit((p) => startSongChain(p));
    const first = e.snapshot().project,
      a = structuredClone(active(first)),
      originalNative = structuredClone(native(first)),
      originalRhythm = structuredClone(rhythm(first));
    await e.edit((p) => cloneSongPattern(p, "B"));
    const b = active(e.snapshot().project),
      d = native(e.snapshot().project),
      g = rhythm(e.snapshot().project);
    assert.notEqual(d.id, originalNative.id);
    assert.notEqual(g.id, originalRhythm.id);
    assert.equal(g.parentId, d.id);
    assert.equal(d.programme.accompanimentRef, g.id);
    await e.editNative(d.id, d.programme.events[0].id, { velocity: 0.21 });
    await e.setBeatbox(g.id, "hum", "volume", 0.31);
    await e.edit((p) =>
      setSongPlacement(
        p,
        b.placements[0].id,
        "phasePolicy",
        "restart-on-entry",
      ),
    );
    await e.edit((p) => setSongLength(p, b.lengthTicks * 2));
    await e.edit((p) => setSongPlacement(p, b.placements[0].id, "loop", true));
    await e.edit(appendSongPattern);
    await e.edit((p) => selectSongPattern(p, a.id));
    await e.edit(appendSongPattern);
    const result = e.snapshot().project;
    assert.equal(
      result.sourceDefs.find((row) => row.id === d.id).programme.events[0]
        .velocity,
      0.21,
    );
    const editedRhythm = result.sourceDefs.find(
      (row) => row.id === g.id,
    ).programme;
    assert.equal(
      editedRhythm.patterns
        .find((row) => row.id === editedRhythm.activePattern)
        .beatbox.find((row) => row.role === "hum").volume,
      0.31,
    );
    assert.equal(
      result.sections.find((row) => row.id === b.id).placements[0].loop,
      true,
    );
    assert.deepEqual(
      result.sections.find((s) => s.id === a.id),
      a,
    );
    assert.deepEqual(
      result.sourceDefs.find((d) => d.id === originalNative.id),
      originalNative,
    );
    assert.deepEqual(
      result.sourceDefs.find((d) => d.id === originalRhythm.id),
      originalRhythm,
    );
    const plan = await compileCanonicalTimeline(result, {
      registry,
      memory: f.memory,
      rate: 48000,
    });
    try {
      assert.deepEqual(
        plan.occurrences.map((o) => o.sectionId),
        [a.id, b.id, a.id],
      );
      assert.deepEqual(
        plan.occurrences.map((o) => o.startTick),
        [0, a.lengthTicks, a.lengthTicks + b.lengthTicks * 2],
      );
      assert.equal(
        plan.placements.filter((a) => a.sourceRef.id === d.id).length,
        2,
      );
    } finally {
      plan.dispose();
    }
    await e.undo();
    assert.equal(e.snapshot().project.chain.length, 2);
    await e.redo();
    assert.deepEqual(e.snapshot().project, result);
    const out = await exportCanonicalPackage(e.snapshot().bundle, {
        memory: f.memory,
      }),
      copy = await importCanonicalPackage(out.blob, {
        registry,
        memory: f.memory,
      });
    try {
      assert.deepEqual(copy.project, result);
      const origin = copy.project.origins.find((o) => o.kind === "file");
      assert.deepEqual(
        new Uint8Array(await copy.originals.get(origin.sha256).arrayBuffer()),
        f.raw,
      );
    } finally {
      copy.dispose();
      out.release();
    }
  } finally {
    await f.close();
  }
});

test("layered recording pattern clone remaps its pair and bus, shares exact PCM, and deletion leaves A intact", async () => {
  const f = await fixture("schema5-eq-overdub-alignment"),
    e = f.editor;
  try {
    await e.edit((p) => {
      const used = new Set(active(p).placements.map((a) => a.trackId));
      p.tracks = p.tracks.filter((t) => used.has(t.id));
      p.compatibility.idMap = p.compatibility.idMap.filter(
        (r) => r.kind !== "track" || used.has(r.newId),
      );
      p.compatibility.fieldPresence = p.compatibility.fieldPresence.filter(
        (r) =>
          !r.startsWith("t/") || [...used].some((id) => r.startsWith(id + "/")),
      );
      startSongChain(p, 4);
    });
    const before = e.snapshot().project,
      a = structuredClone(active(before)),
      originalBuses = structuredClone(before.tracks),
      assets = structuredClone(before.assets);
    await e.edit((p) => cloneSongPattern(p, "Layer B"));
    const p = e.snapshot().project,
      b = active(p),
      layer = p.tracks.find(
        (t) => t.layering && !originalBuses.some((x) => x.id === t.id),
      );
    assert.ok(layer);
    assert(b.placements.some((a) => a.id === layer.layering.basePlacementId));
    assert(
      b.placements.some((a) => a.id === layer.layering.overdubPlacementId),
    );
    assert.deepEqual(p.assets, assets);
    for (const asset of assets)
      assert.equal(
        e.snapshot().bundle.entries.get(asset.id).blob,
        f.bundle.entries.get(asset.id).blob,
      );
    const beforeRefusal = e.snapshot();
    await assert.rejects(
      e.edit((p) =>
        setSongPlacement(p, layer.layering.basePlacementId, "loop", false),
      ),
      code("alignedLoopRequired"),
    );
    assert.equal(e.snapshot().project, beforeRefusal.project);
    await e.edit(deleteSongPattern);
    assert.deepEqual(active(e.snapshot().project), a);
    assert.deepEqual(e.snapshot().project.tracks, originalBuses);
    assert.deepEqual(e.snapshot().project.assets, assets);
  } finally {
    await f.close();
  }
});

test("song chain reorder/remove/repeats edit occurrences only and reject ninth occurrence atomically", async () => {
  const f = await fixture("schema3-fifteen-lanes"),
    e = f.editor;
  try {
    await e.edit((p) => startSongChain(p));
    await e.edit((p) => cloneSongPattern(p, "B"));
    await e.edit(appendSongPattern);
    const sections = structuredClone(e.snapshot().project.sections),
      defs = structuredClone(e.snapshot().project.sourceDefs);
    await e.edit((p) => editSongChain(p, 1, "move", -1));
    assert.equal(
      e.snapshot().project.chain[0].sectionId,
      e.snapshot().project.activeSection,
    );
    await e.edit((p) => editSongChain(p, 0, "repeats", 7));
    const before = e.snapshot();
    await assert.rejects(e.edit(appendSongPattern), code("chainLimit"));
    assert.equal(e.snapshot().project, before.project);
    assert.equal(e.snapshot().revision, before.revision);
    await e.edit((p) => editSongChain(p, 0, "remove"));
    assert.deepEqual(e.snapshot().project.sections, sections);
    assert.deepEqual(e.snapshot().project.sourceDefs, defs);
  } finally {
    await f.close();
  }
});

test("empty song pattern and duration edits preserve other patterns; shortening complete material refuses", async () => {
  const f = await fixture("schema3-fifteen-lanes"),
    e = f.editor;
  try {
    await e.edit((p) => startSongChain(p));
    const first = structuredClone(active(e.snapshot().project));
    await e.edit((p) => newSongPattern(p, "Empty"));
    await e.edit((p) => setSongLength(p, 24 * PPQ));
    assert.equal(active(e.snapshot().project).placements.length, 0);
    assert.deepEqual(e.snapshot().project.sections[0], first);
    await e.edit((p) => selectSongPattern(p, first.id));
    const before = e.snapshot();
    await assert.rejects(
      e.edit((p) => setSongLength(p, 1)),
      code("songWindowTooShort"),
    );
    assert.equal(e.snapshot().project, before.project);
    await e.edit((p) => selectSongPattern(p, p.sections[1].id));
    await e.edit(deleteSongPattern);
    assert.deepEqual(active(e.snapshot().project), first);
  } finally {
    await f.close();
  }
});

test("new rhythm is silent; referenced definition deletion refuses; removal preserves remaining patterns", async () => {
  const f = await fixture("schema3-fifteen-lanes"),
    e = f.editor;
  try {
    const id = rhythm(e.snapshot().project).id,
      original = structuredClone(
        rhythm(e.snapshot().project).programme.patterns,
      );
    await e.edit((p) => newRhythmPattern(p, id, "empty-rhythm", "Empty"));
    let g = rhythm(e.snapshot().project).programme,
      a = g.patterns.at(-1);
    assert(
      Object.values(a.steps)
        .flat()
        .every((x) => x === 0),
    );
    assert(a.notes.every((n) => n === null));
    assert(a.beatbox.every((b) => !b.enabled));
    await e.setChain(id, ["empty-rhythm", original[0].id, "empty-rhythm"]);
    const before = e.snapshot();
    await assert.rejects(
      e.edit((p) => deleteRhythmPattern(p, id)),
      code("patternInChain"),
    );
    assert.equal(e.snapshot().project, before.project);
    await e.setChain(id, [original[0].id]);
    await e.edit((p) => deleteRhythmPattern(p, id));
    g = rhythm(e.snapshot().project).programme;
    assert.deepEqual(g.patterns, original);
    await e.undo();
    assert.equal(
      rhythm(e.snapshot().project).programme.patterns.length,
      original.length + 1,
    );
    await e.redo();
    assert.deepEqual(rhythm(e.snapshot().project).programme.patterns, original);
  } finally {
    await f.close();
  }
});

test("definition ordering preserves every value and both chain orders", async () => {
  const f = await fixture("schema3-fifteen-lanes"),
    e = f.editor;
  try {
    await e.edit((p) => startSongChain(p));
    await e.edit((p) => cloneSongPattern(p, "B"));
    const before = e.snapshot().project,
      defs = structuredClone(before.sourceDefs),
      chain = structuredClone(before.chain),
      sections = structuredClone(before.sections),
      id = rhythm(before).id;
    await e.edit((p) => moveSongPattern(p, -1));
    assert.deepEqual(e.snapshot().project.sections, [sections[1], sections[0]]);
    assert.deepEqual(e.snapshot().project.chain, chain);
    assert.deepEqual(e.snapshot().project.sourceDefs, defs);
    const g = rhythm(e.snapshot().project).programme,
      index = g.patterns.findIndex((a) => a.id === g.activePattern),
      direction = index ? -1 : 1,
      expected = structuredClone(g.patterns);
    [expected[index], expected[index + direction]] = [
      expected[index + direction],
      expected[index],
    ];
    await e.edit((p) => moveRhythmPattern(p, id, direction));
    assert.deepEqual(rhythm(e.snapshot().project).programme.patterns, expected);
    assert.deepEqual(rhythm(e.snapshot().project).programme.chain, g.chain);
  } finally {
    await f.close();
  }
});

test("equal IDs in source and placement namespaces clone independently without corrupting compatibility presence", async () => {
  const f = await fixture(),
    e = f.editor;
  try {
    await e.edit((p) => {
      const a = active(p).placements[0],
        previous = a.id;
      a.id = a.sourceRef.id;
      p.compatibility.idMap
        .filter((r) => r.kind === "placement" && r.newId === previous)
        .forEach((r) => (r.newId = a.id));
      p.compatibility.fieldPresence = p.compatibility.fieldPresence
        .map((v) => (v === previous + "/alignment" ? a.id + "/alignment" : v))
        .sort();
      startSongChain(p);
    });
    const before = e.snapshot().project;
    await e.edit((p) => cloneSongPattern(p, "B"));
    const after = e.snapshot().project;
    assert.notEqual(
      active(after).placements[0].id,
      active(after).placements[0].sourceRef.id,
    );
    assert.equal(native(after).kind, "instrument-events");
    await e.edit(deleteSongPattern);
    assert.deepEqual(e.snapshot().project.sourceDefs, before.sourceDefs);
    assert.deepEqual(active(e.snapshot().project), active(before));
  } finally {
    await f.close();
  }
});

test("exhausted layered buses and short native conversion refuse atomically with foreign allocation untouched", async () => {
  const f = await fixture("schema5-eq-overdub-alignment"),
    e = f.editor,
    foreign = f.memory.reserve(313, "foreign");
  try {
    await e.edit((p) => startSongChain(p, 4));
    const before = e.snapshot(),
      bytes = f.memory.snapshot().bytes;
    await assert.rejects(
      e.edit((p) => cloneSongPattern(p, "Too many buses")),
      code("hubTrackLimit"),
    );
    assert.equal(e.snapshot().project, before.project);
    assert.equal(e.snapshot().revision, before.revision);
    assert.equal(f.memory.snapshot().bytes, bytes);
  } finally {
    foreign.release();
    await f.close();
  }
  const short = await fixture("schema4-independent-clocks");
  try {
    const before = short.editor.snapshot();
    await assert.rejects(
      short.editor.edit((p) => startSongChain(p)),
      code("hubRegionUnsupported"),
    );
    assert.equal(short.editor.snapshot().project, before.project);
  } finally {
    await short.close();
  }
});

test("Add material targets a newly authored active song pattern without mutating A or its source definitions", async () => {
  const f = await fixture("schema3-fifteen-lanes"),
    incoming = await fixture("schema3-fifteen-lanes"),
    e = f.editor;
  let combined;
  try {
    await e.edit((p) => startSongChain(p));
    const before = e.snapshot().project,
      a = structuredClone(active(before)),
      defs = structuredClone(before.sourceDefs);
    await e.edit((p) => newSongPattern(p, "B"));
    combined = await combineCanonicalMaterial(
      e.snapshot().bundle,
      incoming.bundle,
      { registry, memory: f.memory },
    );
    await e.replace(combined);
    const p = e.snapshot().project;
    assert(active(p).placements.length > 0);
    assert.deepEqual(
      p.sections.find((s) => s.id === a.id),
      a,
    );
    // The explicit hub may rebind source masters once; programme/identity stay exact.
    for (const d of defs)
      assert.deepEqual(
        p.sourceDefs.find((row) => row.id === d.id).programme,
        d.programme,
      );
    await e.undo();
    assert.equal(active(e.snapshot().project).placements.length, 0);
    await e.redo();
    assert(active(e.snapshot().project).placements.length > 0);
  } finally {
    combined?.dispose();
    await f.close();
    await incoming.close();
  }
});

test("imported shared working definitions refuse cross-pattern edits until explicitly cloned", async () => {
  const f = await fixture(),
    e = f.editor;
  try {
    await e.edit((p) => {
      startSongChain(p);
      const other = structuredClone(active(p));
      other.id = "external-shared";
      other.name = "Shared";
      other.placements.forEach((a, i) => (a.id = "external-placement-" + i));
      p.sections.push(other);
    });
    const before = e.snapshot(),
      g = rhythm(before.project);
    await assert.rejects(
      e.setBeatbox(g.id, "hum", "volume", 0.31),
      code("sharedPatternSource"),
    );
    assert.equal(e.snapshot().project, before.project);
    assert.equal(e.snapshot().revision, before.revision);
    await e.edit((p) => cloneSongPattern(p, "Independent B"));
    await e.setBeatbox(rhythm(e.snapshot().project).id, "hum", "volume", 0.31);
    assert.deepEqual(
      e.snapshot().project.sourceDefs.find((d) => d.id === g.id),
      g,
    );
  } finally {
    await f.close();
  }
});
