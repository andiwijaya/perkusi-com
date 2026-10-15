import test from "node:test";
import assert from "node:assert/strict";
import {
  InstrumentRouteStore,
  INSTRUMENT_ROUTE_KEY,
} from "../src/project/instrument-route-store.js";
import c from "../internal/instrument-focus/registry-48000.json" with { type: "json" };
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import { instrumentDemo } from "../src/gamelan/instrument-demos.js";
import {
  instrumentRouteContext,
  instrumentRouteHref,
} from "../src/gamelan/route-context.js";
import { routeCopy } from "../src/gamelan/route-copy.js";
const fixture = () => {
  const registry = new InstrumentRegistry(c.banks),
    data = new Map([["perkusi.draft.studio.v3", "OPAQUE LEGACY KEEP"]]);
  let error = null,
    drop = false;
  const storage = {
    getItem: (k) => {
      if (error === "read") throw Error();
      return data.get(k) ?? null;
    },
    setItem: (k, v) => {
      if (error) throw Object.assign(Error(), { name: error });
      if (!drop) data.set(k, v);
    },
  };
  return {
    registry,
    data,
    storage,
    store: new InstrumentRouteStore(registry, { storage: () => storage }),
    project: instrumentDemo("pelog-space", registry),
    error: (e) => (error = e),
    drop: (v) => (drop = v),
  };
};
test("Schema4 route draft/handoff/reload retains complete editable data, source backup and legacy isolation", () => {
  const f = fixture();
  assert.equal(f.store.readDraft(), null);
  f.store.saveDraft(f.project);
  f.store.prepare(f.project);
  const edited = structuredClone(f.project);
  edited.composition.title = "UNSAVED EDIT";
  edited.events[0].velocity = 0.2;
  f.store.saveDraft(edited);
  const next = new InstrumentRouteStore(f.registry, {
    storage: () => f.storage,
  });
  assert.deepEqual(next.readDraft(), edited);
  assert.deepEqual(next.original(), f.project);
  next.prepare(edited);
  assert.deepEqual(next.original(), edited);
  assert.equal(f.data.get("perkusi.draft.studio.v3"), "OPAQUE LEGACY KEEP");
});
test("Route quota/denial/drop/corruption/invalid edits refuse without erasing source or unrelated draft", () => {
  const f = fixture();
  f.store.saveDraft(f.project);
  const raw = f.data.get(INSTRUMENT_ROUTE_KEY),
    edited = structuredClone(f.project);
  edited.composition.title = "LATEST";
  for (const failure of ["QuotaExceededError", "SecurityError"]) {
    f.error(failure);
    assert.throws(() => f.store.prepare(edited));
    assert.equal(f.data.get(INSTRUMENT_ROUTE_KEY), raw);
  }
  f.error(null);
  f.drop(true);
  assert.throws(
    () => f.store.prepare(edited),
    (e) => e.code === "storageUnavailable",
  );
  assert.equal(f.data.get(INSTRUMENT_ROUTE_KEY), raw);
  f.drop(false);
  const bad = structuredClone(edited);
  bad.events[0].velocity = 2;
  assert.throws(() => f.store.prepare(bad));
  assert.equal(f.data.get(INSTRUMENT_ROUTE_KEY), raw);
  f.data.set(INSTRUMENT_ROUTE_KEY, "{KEEP CORRUPT}");
  assert.throws(
    () => f.store.readDraft(),
    (e) => e.code === "routeCorrupt",
  );
  assert.throws(() => f.store.prepare(edited));
  assert.equal(f.store.rawBackup(), "{KEEP CORRUPT}");
  assert.equal(f.data.get("perkusi.draft.studio.v3"), "OPAQUE LEGACY KEEP");
});
test("Stale same-tab writers and late closed owners cannot overwrite a newer accepted revision", () => {
  const f = fixture();
  f.store.saveDraft(f.project);
  const a = new InstrumentRouteStore(f.registry, { storage: () => f.storage }),
    b = new InstrumentRouteStore(f.registry, { storage: () => f.storage });
  a.readDraft();
  b.readDraft();
  const edit = structuredClone(f.project);
  edit.composition.title = "NEWER FRAME";
  b.saveDraft(edit);
  const raw = f.data.get(INSTRUMENT_ROUTE_KEY);
  assert.throws(
    () => a.prepare(f.project),
    (e) => e.code === "routeConflict",
  );
  assert.equal(f.data.get(INSTRUMENT_ROUTE_KEY), raw);
  a.close();
  assert.throws(
    () => a.saveDraft(f.project),
    (e) => e.code === "routeClosed",
  );
  assert.deepEqual(b.readDraft(), edit);
});
test("Separate tab storage and mode/localized URL boundaries do not share route projects", () => {
  const a = fixture(),
    b = fixture();
  a.store.prepare(a.project);
  assert.equal(b.store.readDraft(), null);
  b.store.prepare(instrumentDemo("slendro-space", b.registry));
  assert.deepEqual(a.store.readDraft(), a.project);
  for (const locale of ["id", "en"]) {
    assert.ok(
      instrumentRouteHref(true, locale).includes(
        "workspace=gamelan&lang=" + locale,
      ),
    );
    assert.ok(
      instrumentRouteHref(false, locale).includes("/gamelan/?lang=" + locale),
    );
  }
  assert.deepEqual(
    instrumentRouteContext("/studio/", "?workspace=gamelan", "gamelan-preview"),
    { studio: true },
  );
  assert.equal(
    instrumentRouteContext("/studio/", "?workspace=gamelan", "production"),
    null,
  );
  assert.equal(instrumentRouteContext("/studio/", "", "gamelan-preview"), null);
});

test("Recovered read permission never silently replaces an unseen existing tab project", () => {
  const f = fixture();
  f.store.prepare(f.project);
  const stale = new InstrumentRouteStore(f.registry, {
      storage: () => f.storage,
    }),
    before = f.data.get(INSTRUMENT_ROUTE_KEY);
  f.error("read");
  assert.throws(() => stale.readDraft());
  f.error(null);
  const edited = structuredClone(f.project);
  edited.composition.title = "IN MEMORY ONLY";
  for (let i = 0; i < 3; i++)
    assert.throws(
      () => stale.prepare(edited),
      (e) => e.code === "routeConflict",
    );
  assert.equal(f.data.get(INSTRUMENT_ROUTE_KEY), before);
  assert.deepEqual(stale.readDraft(), f.project);
  stale.prepare(edited);
  assert.deepEqual(stale.readDraft(), edited);
});
test("After-commit exceptions can confirm actual persistence; a concurrent replacement refuses without rollback", () => {
  const f = fixture();
  f.store.prepare(f.project);
  const originalSet = f.storage.setItem;
  f.storage.setItem = (k, v) => {
    originalSet(k, v);
    throw Object.assign(Error(), { name: "QuotaExceededError" });
  };
  const edited = structuredClone(f.project);
  edited.composition.title = "ACTUALLY COMMITTED";
  f.store.prepare(edited);
  assert.deepEqual(f.store.readDraft(), edited);
  f.storage.setItem = (k, v) => {
    const newer = JSON.parse(v);
    newer.revision++;
    newer.project.composition.title = "OTHER OWNER";
    originalSet(k, JSON.stringify(newer));
  };
  assert.throws(
    () => f.store.prepare(f.project),
    (e) => e.code === "routeConflict",
  );
  assert.equal(
    JSON.parse(f.data.get(INSTRUMENT_ROUTE_KEY)).project.composition.title,
    "OTHER OWNER",
  );
});
test("Route copy has complete ID/EN key/error parity", () => {
  assert.deepEqual(
    Object.keys(routeCopy.id).sort(),
    Object.keys(routeCopy.en).sort(),
  );
  assert.deepEqual(
    Object.keys(routeCopy.id.errors).sort(),
    Object.keys(routeCopy.en.errors).sort(),
  );
});
