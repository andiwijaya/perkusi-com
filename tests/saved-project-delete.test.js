import test from "node:test";
import assert from "node:assert/strict";
import { ProjectStore } from "../src/project/store.js";
import { CompositionStore } from "../src/project/composition-store.js";
import { newComposition } from "../src/project/composition-model.js";
import { originalRegistry } from "../src/project/original-registry.js";
import { compositionRegistry } from "../src/project/studio-registry.js";

function setup(tool) {
  const values = new Map(),
    storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, raw) => values.set(key, raw),
      removeItem: (key) => values.delete(key),
    };
  const store =
    tool === "studio"
      ? new CompositionStore(compositionRegistry, () => storage)
      : new ProjectStore(originalRegistry, () => storage);
  const base =
    tool === "studio"
      ? newComposition("Same title")
      : {
          format: "perkusi-project",
          schemaVersion: 1,
          mode: "beatbox",
          title: "Same title",
          pack: {
            id: originalRegistry.packId,
            version: originalRegistry.version,
          },
          timing: { bpm: 96, meter: [4, 4] },
          master: { volume: 0.37 },
          export: { bars: 4 },
          tracks: originalRegistry.roleOrder.map((role, i) => ({
            role,
            enabled: i % 2 === 0,
            variant: (i % 2) + 1,
          })),
        };
  const items = ["target", "same-title", "other"].map((id, i) => ({
    id,
    project: { ...structuredClone(base), master: { volume: 0.2 + i * 0.1 } },
  }));
  const key = store.keys.projects;
  storage.setItem(key, JSON.stringify({ version: 1, items }));
  for (const other of [
    "perkusi.draft.v1",
    "perkusi.draft.studio.v3",
    "perkusi.draft.studio.v2",
    "perkusi.mode-transfer.v3",
    "perkusi.projects.studio.v2",
    "unrelated.preference",
  ])
    storage.setItem(other, `preserve exact bytes: ${other}`);
  return { store, storage, values, key, items };
}
function assertOtherBytes(state, before) {
  for (const [key, raw] of before)
    if (key !== state.key) assert.equal(state.storage.getItem(key), raw);
}
for (const tool of ["beatbox", "studio"]) {
  test(`${tool}: deletion removes only the chosen ID and preserves a save with the same title`, () => {
    const state = setup(tool),
      before = new Map(state.values);
    state.store.remove("target", state.items[0].project);
    assert.deepEqual(JSON.parse(state.storage.getItem(state.key)), {
      version: 1,
      items: state.items.slice(1),
    });
    assertOtherBytes(state, before);
  });
  test(`${tool}: deleting the confirmed project preserves newly added and updated siblings`, () => {
    const state = setup(tool),
      latest = structuredClone(state.items),
      before = new Map(state.values);
    latest[1].project.master.volume = 0.17;
    latest.push({
      id: "another-tab-save",
      project: { ...structuredClone(latest[2].project), title: "New save" },
    });
    state.storage.setItem(
      state.key,
      JSON.stringify({ version: 1, items: latest }),
    );
    state.store.remove("target", state.items[0].project);
    assert.deepEqual(
      JSON.parse(state.storage.getItem(state.key)).items,
      latest.slice(1),
    );
    assertOtherBytes(state, before);
  });
  test(`${tool}: a changed selected save is refused without writing any project`, () => {
    const state = setup(tool),
      changed = structuredClone(state.items);
    changed[0].project.master.volume = 0.19;
    state.storage.setItem(
      state.key,
      JSON.stringify({ version: 1, items: changed }),
    );
    const before = new Map(state.values);
    assert.throws(() => state.store.remove("target", state.items[0].project), {
      code: "projectChanged",
    });
    assert.deepEqual(state.values, before);
  });
  test(`${tool}: a selected save deleted by another tab does not rewrite the remaining store`, () => {
    const state = setup(tool);
    state.storage.setItem(
      state.key,
      JSON.stringify({ version: 1, items: state.items.slice(1) }),
    );
    const before = new Map(state.values);
    assert.throws(() => state.store.remove("target", state.items[0].project), {
      code: "projectChanged",
    });
    assert.deepEqual(state.values, before);
  });
  test(`${tool}: rejected storage writes preserve all saved projects and active drafts`, () => {
    const state = setup(tool),
      before = new Map(state.values);
    state.store.storage = () => ({
      ...state.storage,
      setItem() {
        throw new Error("Quota denied");
      },
    });
    assert.throws(() => state.store.remove("target", state.items[0].project), {
      code: "storageUnavailable",
    });
    assert.deepEqual(state.values, before);
  });
  test(`${tool}: equivalent project fields in a different object order remain the confirmed save`, () => {
    const state = setup(tool),
      reordered = structuredClone(state.items);
    reordered[0].project = Object.fromEntries(
      Object.entries(reordered[0].project).reverse(),
    );
    state.storage.setItem(
      state.key,
      JSON.stringify({ version: 1, items: reordered }),
    );
    state.store.remove("target", state.items[0].project);
    assert.deepEqual(
      JSON.parse(state.storage.getItem(state.key)).items,
      reordered.slice(1),
    );
  });
}
test("Studio preserves the protected legacy original when deletion is requested", () => {
  const state = setup("studio"),
    before = new Map(state.values);
  assert.throws(
    () => state.store.remove("legacy0-older", state.items[0].project),
    { code: "legacyOriginal" },
  );
  assert.deepEqual(state.values, before);
});
