import test from "node:test";
import assert from "node:assert/strict";
import catalog from "../internal/instrument-focus/registry-48000.json" with { type: "json" };
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import { instrumentDemo } from "../src/gamelan/instrument-demos.js";
import {
  InstrumentProjectStore,
  INSTRUMENT_STORE_KEY,
  INSTRUMENT_STORE_BYTES,
} from "../src/project/instrument-store.js";

const fixture = () => {
  const registry = new InstrumentRegistry(catalog.banks),
    data = new Map([["perkusi.projects.v1", "opaque untouched original"]]);
  let deny = false,
    quota = false,
    sequence = 0;
  const storage = {
    getItem: (k) => {
      if (deny) throw Error("denied");
      return data.get(k) ?? null;
    },
    setItem: (k, v) => {
      if (deny) throw Error("denied");
      if (quota)
        throw Object.assign(Error("full"), { name: "QuotaExceededError" });
      data.set(k, v);
    },
  };
  return {
    registry,
    data,
    storage,
    store: new InstrumentProjectStore(registry, {
      storage: () => storage,
      makeId: () => "saved-" + ++sequence,
    }),
    denied: (value) => {
      deny = value;
    },
    quota: (value) => {
      quota = value;
    },
  };
};
test("V4 browser saved projects/draft reconstruct complete combined data without audio or legacy store mutation", () => {
  const f = fixture(),
    p = structuredClone(instrumentDemo("pelog-space", f.registry));
  p.composition.patterns[0].notes[0] = { pitch: "f4", velocity: 0.75 };
  p.tuningConsent = true;
  p.instrumentMix = [
    {
      bankId: "cdm-pelog",
      instrumentId: "saron-barung",
      volume: 0.731,
      pan: -0.123,
      mute: false,
      solo: true,
    },
  ];
  const id = f.store.save(p),
    reopened = new InstrumentProjectStore(f.registry, {
      storage: () => f.storage,
    });
  assert.deepEqual(reopened.load(id), p);
  assert.deepEqual(reopened.readDraft(), p);
  const other = instrumentDemo("slendro-response", f.registry);
  reopened.saveDraft(other);
  assert.deepEqual(reopened.readDraft(), other);
  assert.deepEqual(reopened.load(id), p);
  reopened.remove(id);
  assert.equal(reopened.list().length, 0);
  assert.deepEqual(reopened.readDraft(), other);
  assert.equal(f.data.get("perkusi.projects.v1"), "opaque untouched original");
});
test("V4 denied/quota/corrupt/malicious writes never claim success or reset stored drafts/projects", () => {
  const f = fixture(),
    p = instrumentDemo("pelog-space", f.registry),
    id = f.store.save(p),
    raw = f.data.get(INSTRUMENT_STORE_KEY);
  f.quota(true);
  assert.throws(
    () => f.store.saveDraft(instrumentDemo("slendro-space", f.registry)),
    (e) => e.code === "storageFull",
  );
  assert.equal(f.data.get(INSTRUMENT_STORE_KEY), raw);
  f.quota(false);
  f.denied(true);
  assert.throws(
    () => f.store.save(p),
    (e) => e.code === "storageUnavailable",
  );
  f.denied(false);
  assert.deepEqual(f.store.load(id), p);
  for (const bad of [
    "",
    "{",
    JSON.stringify({ version: 5, draft: null, items: [] }),
    "x".repeat(INSTRUMENT_STORE_BYTES + 1),
    JSON.stringify({
      version: 4,
      draft: p,
      items: [
        { id: "x", project: p },
        { id: "x", project: p },
      ],
    }),
    JSON.stringify({ version: 4, draft: { ...p, unknown: true }, items: [] }),
  ]) {
    f.data.set(INSTRUMENT_STORE_KEY, bad);
    assert.throws(
      () => f.store.readDraft(),
      (e) => e.code === "storageCorrupt",
    );
    assert.throws(
      () => f.store.saveDraft(p),
      (e) => e.code === "storageCorrupt",
    );
    assert.equal(f.data.get(INSTRUMENT_STORE_KEY), bad);
  }
});
test("V4 metadata limits/refused IDs preserve accepted records and current source", () => {
  const f = fixture(),
    p = instrumentDemo("pelog-space", f.registry);
  for (let i = 0; i < 30; i++) f.store.save(p);
  const before = f.data.get(INSTRUMENT_STORE_KEY);
  assert.throws(
    () => f.store.save(p),
    (e) => e.code === "storageFull",
  );
  assert.equal(f.data.get(INSTRUMENT_STORE_KEY), before);
  assert.throws(
    () => f.store.remove("missing"),
    (e) => e.code === "missingProject",
  );
  assert.equal(f.data.get(INSTRUMENT_STORE_KEY), before);
  const invalid = structuredClone(p);
  invalid.events[0].sampleId = "missing";
  assert.throws(() => f.store.saveDraft(invalid));
  assert.equal(f.data.get(INSTRUMENT_STORE_KEY), before);
});
test("V4 multiple individually valid large projects remain readable within the envelope byte cap", () => {
  const f = fixture(),
    p = structuredClone(instrumentDemo("pelog-space", f.registry));
  const seed = p.events.find((e) => e.action === "strike");
  p.events = Array.from({ length: 4096 }, (_, i) => ({
    ...seed,
    id: "large-" + i,
    tick: i + 1,
  }));
  const a = f.store.save(p),
    b = f.store.save(p);
  assert.equal(f.store.list().length, 2);
  assert.deepEqual(f.store.load(a), f.store.load(b));
  assert.equal(f.store.readDraft().events.length, 4096);
});
