import test from "node:test";
import assert from "node:assert/strict";
import { ProjectStore } from "../src/project/store.js";
import { CompositionStore } from "../src/project/composition-store.js";
import { newComposition } from "../src/project/composition-model.js";
import { newStudioProject } from "../src/project/studio-model.js";
import { originalRegistry } from "../src/project/original-registry.js";
import { compositionRegistry } from "../src/project/studio-registry.js";

function setup(tool) {
  const values = new Map(),
    storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, raw) => values.set(key, raw),
      removeItem: (key) => values.delete(key),
    };
  const b = {
    format: "perkusi-project",
    schemaVersion: 1,
    mode: "beatbox",
    title: "Beatbox original",
    pack: { id: originalRegistry.packId, version: originalRegistry.version },
    timing: { bpm: 96, meter: [4, 4] },
    master: { volume: 0.37 },
    export: { bars: 4 },
    tracks: originalRegistry.roleOrder.map((role, i) => ({
      role,
      enabled: i % 2 === 0,
      variant: (i % 2) + 1,
    })),
  };
  storage.setItem(
    "perkusi.projects.v1",
    JSON.stringify({ version: 1, items: [{ id: "bb", project: b }] }),
  );
  storage.setItem(
    "perkusi.projects.studio.v2",
    JSON.stringify({
      version: 1,
      items: [{ id: "old", project: newStudioProject("Older Studio") }],
    }),
  );
  const store =
    tool === "studio"
      ? new CompositionStore(compositionRegistry, () => storage)
      : new ProjectStore(originalRegistry, () => storage);
  const project = tool === "studio" ? newComposition("Chosen — $&") : b;
  const items = [
      { id: "target", project },
      {
        id: "other",
        project: { ...structuredClone(project), title: "Other save" },
      },
    ],
    key = store.keys.projects;
  storage.setItem(key, JSON.stringify({ version: 1, items }));
  for (const name of [
    "perkusi.draft.v1",
    "perkusi.draft.studio.v3",
    "perkusi.draft.studio.v2",
    "perkusi.mode-transfer.v3",
    "unrelated.preference",
  ])
    storage.setItem(name, `keep original bytes: ${name}`);
  return { values, storage, store, key, items };
}
for (const tool of ["beatbox", "studio"]) {
  test(`${tool}: resolving the confirmed save returns its full project without changing drafts or saves`, () => {
    const s = setup(tool),
      chosen = s.store.load("target"),
      before = new Map(s.values);
    assert.deepEqual(s.store.load("target", chosen), chosen);
    assert.deepEqual(s.values, before);
  });
  test(`${tool}: a save changed after confirmation is rejected without applying or writing data`, () => {
    const s = setup(tool),
      chosen = s.store.load("target"),
      latest = structuredClone(s.items);
    latest[0].project.master.volume = 0.19;
    s.storage.setItem(s.key, JSON.stringify({ version: 1, items: latest }));
    const before = new Map(s.values);
    assert.throws(() => s.store.load("target", chosen), {
      code: "projectChanged",
    });
    assert.deepEqual(s.values, before);
  });
  test(`${tool}: a save removed by another tab is rejected with all remaining data intact`, () => {
    const s = setup(tool),
      chosen = s.store.load("target");
    s.storage.setItem(
      s.key,
      JSON.stringify({ version: 1, items: s.items.slice(1) }),
    );
    const before = new Map(s.values);
    assert.throws(() => s.store.load("target", chosen), {
      code: "projectChanged",
    });
    assert.deepEqual(s.values, before);
  });
  test(`${tool}: unrelated additions and edits do not prevent loading the confirmed unchanged save`, () => {
    const s = setup(tool),
      chosen = s.store.load("target"),
      latest = structuredClone(s.items);
    latest[1].project.master.volume = 0.18;
    latest.push({
      id: "added",
      project: { ...structuredClone(chosen), title: "Added elsewhere" },
    });
    s.storage.setItem(s.key, JSON.stringify({ version: 1, items: latest }));
    const before = new Map(s.values);
    assert.deepEqual(s.store.load("target", chosen), chosen);
    assert.deepEqual(s.values, before);
  });
  test(`${tool}: a denied storage read never changes active drafts or saved projects`, () => {
    const s = setup(tool),
      chosen = s.store.load("target"),
      before = new Map(s.values);
    s.store.storage = () => ({
      ...s.storage,
      getItem() {
        throw new Error("Read denied");
      },
    });
    assert.throws(() => s.store.load("target", chosen), {
      code: "storageUnavailable",
    });
    assert.deepEqual(s.values, before);
  });
  test(`${tool}: equivalent reordered object fields still match the confirmed saved project`, () => {
    const s = setup(tool),
      chosen = s.store.load("target"),
      latest = structuredClone(s.items);
    latest[0].project = Object.fromEntries(
      Object.entries(latest[0].project).reverse(),
    );
    s.storage.setItem(s.key, JSON.stringify({ version: 1, items: latest }));
    const before = new Map(s.values);
    assert.deepEqual(s.store.load("target", chosen), chosen);
    assert.deepEqual(s.values, before);
  });
}
for (const id of ["legacy0-old", "legacy1-bb"])
  test(`Studio can load the confirmed ${id} as a migrated copy without rewriting the original`, () => {
    const s = setup("studio"),
      chosen = s.store.load(id),
      before = new Map(s.values);
    assert.equal(chosen.schemaVersion, 3);
    assert.deepEqual(s.store.load(id, chosen), chosen);
    assert.deepEqual(s.values, before);
  });
