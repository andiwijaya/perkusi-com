import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  newComposition,
  compositionDemo,
  toBeatbox,
  fromBeatbox,
} from "../src/project/composition-model.js";
import { newStudioProject } from "../src/project/studio-model.js";
import {
  parseProject,
  serializeProject,
  MAX_PROJECT_BYTES,
} from "../src/project/schema.js";
import { compositionRegistry } from "../src/project/studio-registry.js";
import { originalRegistry } from "../src/project/original-registry.js";
import { ProjectStore, PROJECTS_KEY } from "../src/project/store.js";
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import {
  PPQ,
  MAX_INSTRUMENT_PROJECT_BYTES,
  parseInstrumentProject,
  validateInstrumentProject,
  migrateToInstrumentProject,
  deriveLegacyProject,
  eventFrame,
  orderedEvents,
} from "../src/project/instrument-project.js";

const hash = (v) => createHash("sha256").update(v).digest("hex");
// Descriptors only; no QA audio or fake instrument is shipped into app registries.
export const syntheticBank = () => ({
  id: "qa-bank",
  version: "1.0.0",
  kind: "instrument-bank",
  setId: "qa-set",
  tradition: "qa-synthetic",
  laras: "none",
  samples: [
    {
      id: "qa-note",
      instrumentId: "qa-instrument",
      pitchId: "qa-pitch",
      articulation: "strike",
      assetPath: "/sounds/qa-only.wav",
      sha256: "a".repeat(64),
      sourceWorkId: "qa-source",
      licenseId: "qa-only",
      encodedBytes: 256,
      sampleRate: 48000,
      channels: 1,
      frames: 48000,
      gainTrim: 0.5,
      voicePolicy: "polyphonic",
    },
  ],
});
const registry = () => new InstrumentRegistry([syntheticBank()]);
const p4 = () => {
  const p = migrateToInstrumentProject(
    JSON.stringify(newComposition()),
    registry(),
  );
  return structuredClone(p);
};
const ev = (id = "event-1", tick = 0, action = "strike") => ({
  id,
  tick,
  action,
  bankId: "qa-bank",
  sampleId: "qa-note",
  velocity: action === "damp" ? 0 : 0.6,
});
const withEvents = () => {
  const p = p4();
  p.banks = [{ id: "qa-bank", version: "1.0.0" }];
  p.events = [ev()];
  return p;
};
const bad = (fn, code) => assert.throws(fn, (e) => e.code === code);
test("S1 canonical fixture is opt-in; old parser and full composition remain isolated", () => {
  const p = withEvents(),
    valid = validateInstrumentProject(p, registry());
  assert.equal(valid.schemaVersion, 4);
  assert.deepEqual(valid.composition, newComposition());
  assert.equal(Object.isFrozen(valid.events[0]), true);
  assert.deepEqual(
    parseInstrumentProject(JSON.stringify(valid), registry()),
    valid,
  );
  bad(
    () => parseProject(JSON.stringify(valid), compositionRegistry),
    "unsupportedVersion",
  );
  assert.equal(
    parseProject(JSON.stringify(valid.composition), compositionRegistry)
      .schemaVersion,
    3,
  );
});
test("S1 schema rejects future/unknown/accessor/prototype/duplicate/unsafe/invalid fields atomically", () => {
  const changes = [
    (p) => (p.schemaVersion = 5),
    (p) => (p.mode = "studio"),
    (p) => (p.extra = true),
    (p) => (p.clock.frame = 1),
    (p) => (p.clock.ppq = 960),
    (p) => (p.clock.lengthTicks = 0),
    (p) => (p.clock.lengthTicks = 491520001),
    (p) => (p.events[0].tick = -0),
    (p) => (p.events[0].tick = -1),
    (p) => (p.events[0].tick = 0.5),
    (p) => (p.events[0].tick = NaN),
    (p) => (p.events[0].tick = p.clock.lengthTicks),
    (p) => (p.events[0].tick = Number.MAX_SAFE_INTEGER + 1),
    (p) => (p.events[0].velocity = Infinity),
    (p) => (p.events[0].velocity = 0),
    (p) => (p.events[0].action = "note-off"),
    (p) => (p.events[0].id = "../x"),
    (p) => (p.events[0].sampleId = "missing"),
    (p) => (p.events[0].bankId = "missing"),
    (p) => (p.banks[0].version = "2"),
    (p) => p.banks.push({ ...p.banks[0] }),
    (p) => p.events.push({ ...p.events[0], tick: 1 }),
    (p) => p.events.push({ ...p.events[0], id: "other" }),
    (p) => (p.origin.schemaVersion = 2),
    (p) => (p.origin.text = "{}"),
    (p) => (p.composition.instrument.id = "gamelan"),
    (p) => (p.events[0].tuningHz = 440),
    (p) => (p.events[0].velocity = -0),
    (p) => Object.setPrototypeOf(p.clock, { evil: 1 }),
    (p) =>
      Object.defineProperty(p.events[0], "id", {
        get() {
          throw Error("getter executed");
        },
        enumerable: true,
      }),
    (p) => (p.events = Array(1)),
    (p) => p.banks.push({ id: "untrusted", version: "1" }),
  ];
  for (const change of changes) {
    const p = withEvents();
    change(p);
    assert.throws(() => validateInstrumentProject(p, registry()));
  }
  let getterCalls = 0;
  const accessor = withEvents();
  Object.defineProperty(accessor.events[0], "id", {
    enumerable: true,
    get() {
      getterCalls++;
      return "event-1";
    },
  });
  assert.throws(() => validateInstrumentProject(accessor, registry()));
  assert.equal(getterCalls, 0);
  const nested = withEvents();
  Object.defineProperty(nested.composition.master, "volume", {
    enumerable: true,
    get() {
      getterCalls++;
      return 0.65;
    },
  });
  assert.throws(() => validateInstrumentProject(nested, registry()));
  assert.equal(getterCalls, 0);
  const p = withEvents(),
    before = hash(JSON.stringify(p));
  p.events[0].tick = p.clock.lengthTicks;
  const invalid = hash(JSON.stringify(p));
  assert.throws(() => validateInstrumentProject(p, registry()));
  assert.equal(hash(JSON.stringify(p)), invalid);
  assert.notEqual(before, invalid);
});
test("S1 event bounds, stable ties and note/damp collision ordering are explicit", () => {
  const p = withEvents();
  p.events = [ev("z", 3), ev("a", 3, "damp"), ev("b", 2)];
  assert.deepEqual(
    orderedEvents(p.events).map((e) => e.id),
    ["b", "a", "z"],
  );
  const v = validateInstrumentProject(p, registry());
  assert.deepEqual(
    v.events.map((e) => e.id),
    ["b", "a", "z"],
  );
  p.events = Array.from({ length: 4096 }, (_, i) => ev("e-" + i, i));
  assert.equal(validateInstrumentProject(p, registry()).events.length, 4096);
  p.events.push(ev("overflow", 4096));
  bad(
    () => validateInstrumentProject(p, registry()),
    "invalidInstrumentProject",
  );
  p.events = [];
  p.banks = Array.from({ length: 9 }, (_, i) => ({
    id: "b-" + i,
    version: "1",
  }));
  assert.throws(() => validateInstrumentProject(p, registry()));
});
test("S1 collision policy keeps different sample identities and same-frame distinct ticks", () => {
  const b = syntheticBank();
  b.samples.push({
    ...b.samples[0],
    id: "qa-note-2",
    articulation: "alternate",
  });
  const r = new InstrumentRegistry([b]),
    p = withEvents();
  p.events = [
    ev("same-frame-later", 1),
    ev("first", 0),
    { ...ev("other-sample", 0), sampleId: "qa-note-2" },
    ev("damp", 0, "damp"),
  ];
  const v = validateInstrumentProject(p, r);
  assert.equal(v.events.length, 4);
  assert.deepEqual(
    v.events.map((e) => e.id),
    ["damp", "first", "other-sample", "same-frame-later"],
  );
  assert.equal(eventFrame(0, 96, 48000), eventFrame(1, 96, 48000));
  const permutation = { ...p, events: [...p.events].reverse() };
  assert.deepEqual(validateInstrumentProject(permutation, r), v);
  p.events.push(ev("ambiguous", 0));
  assert.throws(() => validateInstrumentProject(p, r));
  p.events = p.events.slice(0, 4);
  p.events.push(ev("duplicate-damp", 0, "damp"));
  assert.throws(() => validateInstrumentProject(p, r));
});
test("S1 PPQ preserves integer source-frame positions through nearest ticks and absolute late boundaries", () => {
  for (const rate of [8000, 44100, 48000, 192000])
    for (const bpm of [60, 73, 96, 180]) {
      const maxFrame = Math.floor((491520000 * rate * 60) / (bpm * PPQ));
      for (const frame of [
        0,
        1,
        2,
        127,
        128,
        129,
        255,
        256,
        257,
        maxFrame - 129,
        maxFrame - 1,
      ]) {
        const tick = Math.round((frame * PPQ * bpm) / (rate * 60));
        assert.equal(eventFrame(tick, bpm, rate), frame);
      }
      assert.ok((rate * 60) / (bpm * PPQ) / 2 <= 0.100000001);
      for (const divisor of [2, 3, 4, 5, 8, 16]) assert.equal(PPQ % divisor, 0);
    }
  assert.ok(491520000 * 192000 * 60 < 2 ** 53);
});
test("S1 absolute tick frames preserve precision at fractional periods, blocks, origins and supported rates", () => {
  for (const rate of [44100, 48000])
    for (const bpm of [60, 60.5, 73, 73.25, 96, 180]) {
      for (const blocks of [[64], [128], [256], [64, 128, 256]]) {
        let cursor = 0,
          index = 0;
        const ticks = [
          0,
          1,
          PPQ / 3,
          4 * PPQ,
          Math.floor(117 * 4 * PPQ + PPQ / 7),
        ];
        const frames = ticks.map((t) => eventFrame(t, bpm, rate, 123));
        for (let i = 0; i < ticks.length; i++)
          assert.ok(
            Math.abs(frames[i] - 123 - (ticks[i] * 60 * rate) / bpm / PPQ) <=
              0.5000001,
          );
        const seen = [];
        while (cursor <= frames.at(-1)) {
          const end = cursor + blocks[index++ % blocks.length];
          for (const f of frames) if (f >= cursor && f < end) seen.push(f);
          cursor = end;
        }
        assert.deepEqual(seen, frames);
      }
      const absolute = eventFrame(491520000, bpm, rate);
      assert.ok(Number.isSafeInteger(absolute));
    }
  for (const args of [
    [-0, 96, 48000],
    [491520001, 96, 48000],
    [1, 59, 48000],
    [1, 181, 48000],
    [1, 96, 44100.5],
    [1, 96, 7999],
    [1, 96, 192001],
    [1, 96, 48000, -1],
    [1, 96, 48000, Number.MAX_SAFE_INTEGER + 1],
    [491520000, 60, 192000, Number.MAX_SAFE_INTEGER],
  ])
    assert.throws(() => eventFrame(...args));
  assert.equal(eventFrame(16, 96, 48000), 1); // Exact half-up, delta rounded before late origin addition.
  assert.equal(
    eventFrame(16, 96, 48000, Number.MAX_SAFE_INTEGER - 1),
    Number.MAX_SAFE_INTEGER,
  );
  assert.equal(
    eventFrame(0, 60, 8000, Number.MAX_SAFE_INTEGER),
    Number.MAX_SAFE_INTEGER,
  );
  const fractional = withEvents();
  fractional.composition.timing.bpm = 73.25;
  assert.equal(
    validateInstrumentProject(fractional, registry()).composition.timing.bpm,
    73.25,
  );
});
test("S1 pure 0/1/2/3 migrations preserve original bytes, recipes and frozen data", () => {
  const beat = toBeatbox(
    fromBeatbox({
      format: "perkusi-project",
      schemaVersion: 1,
      mode: "beatbox",
      title: "Bumi",
      pack: { id: originalRegistry.packId, version: originalRegistry.version },
      timing: { bpm: 96, meter: [4, 4] },
      master: { volume: 0.65 },
      tracks: originalRegistry.roleOrder.map((role) => ({
        role,
        enabled: true,
        variant: 2,
      })),
      export: { bars: 8 },
    }),
  );
  const v0 = {
    format: beat.format,
    schemaVersion: 0,
    title: beat.title,
    packId: beat.pack.id,
    packVersion: beat.pack.version,
    bpm: 96,
    volume: beat.master.volume,
    layers: Object.fromEntries(
      beat.tracks.map(({ role, ...rest }) => [role, rest]),
    ),
    exportBars: 8,
  };
  for (const p of [
    v0,
    beat,
    newStudioProject(),
    compositionDemo("fusion"),
    compositionDemo("malam"),
  ]) {
    const text = " \n" + JSON.stringify(p) + "\n ",
      h = hash(text),
      v = migrateToInstrumentProject(text, registry());
    assert.equal(v.origin.text, text);
    assert.equal(v.origin.schemaVersion, p.schemaVersion);
    assert.equal(hash(text), h);
    assert.deepEqual(v.composition, parseProject(text, compositionRegistry));
    assert.ok(Object.isFrozen(v.composition.patterns[0].steps));
    assert.deepEqual(deriveLegacyProject(v, registry()).project, v.composition);
    assert.equal(deriveLegacyProject(v, registry()).retainedOriginal, v);
    assert.equal(v.clock.lengthTicks, v.composition.chain.length * 4 * PPQ);
    if ([0, 1].includes(p.schemaVersion))
      assert.deepEqual(
        deriveLegacyProject(v, registry(), { target: "beatbox" }).project,
        beat,
      );
  }
});
test("S1 exact legacy and new UTF8 limits include original wrapper/escaping overhead without truncation", () => {
  const text = JSON.stringify(newComposition()),
    exact = " ".repeat(MAX_PROJECT_BYTES - Buffer.byteLength(text)) + text;
  const v = migrateToInstrumentProject(exact, registry());
  assert.equal(Buffer.byteLength(v.origin.text), 65536);
  assert.ok(
    Buffer.byteLength(JSON.stringify(v) + "\n") < MAX_INSTRUMENT_PROJECT_BYTES,
  );
  bad(
    () => migrateToInstrumentProject(exact + " ", registry()),
    "projectTooLarge",
  );
  const serialized = JSON.stringify(v),
    newExact =
      " ".repeat(MAX_INSTRUMENT_PROJECT_BYTES - Buffer.byteLength(serialized)) +
      serialized;
  assert.deepEqual(parseInstrumentProject(newExact, registry()), v);
  bad(
    () => parseInstrumentProject(newExact + " ", registry()),
    "projectTooLarge",
  );
  const unicode = newComposition("音樂");
  const utext = JSON.stringify(unicode);
  const uexact = " ".repeat(65536 - Buffer.byteLength(utext)) + utext;
  assert.equal(
    Buffer.byteLength(
      migrateToInstrumentProject(uexact, registry()).origin.text,
    ),
    65536,
  );
  bad(
    () => migrateToInstrumentProject(uexact + "音", registry()),
    "projectTooLarge",
  );
  const escaped = JSON.stringify(newComposition("音")).replace("音", "\\u97f3");
  const escapedExact =
    "\n".repeat(65536 - Buffer.byteLength(escaped)) + escaped;
  const migrated = migrateToInstrumentProject(escapedExact, registry());
  assert.equal(migrated.origin.text, escapedExact);
  assert.equal(Buffer.byteLength(migrated.origin.text), 65536);
  const b = syntheticBank();
  b.id = "b".repeat(64);
  b.samples[0].id = "s".repeat(64);
  const r = new InstrumentRegistry([b]),
    direct = p4();
  direct.banks = [{ id: b.id, version: b.version }];
  direct.events = Array.from({ length: 4096 }, (_, i) => ({
    ...ev("e".repeat(58) + String(i).padStart(6, "0"), i),
    bankId: b.id,
    sampleId: b.samples[0].id,
  }));
  bad(() => validateInstrumentProject(direct, r), "projectTooLarge");
  while (
    Buffer.byteLength(JSON.stringify(direct) + "\n") >
    MAX_INSTRUMENT_PROJECT_BYTES
  )
    direct.events.pop();
  const gap =
    MAX_INSTRUMENT_PROJECT_BYTES -
    Buffer.byteLength(JSON.stringify(direct) + "\n");
  direct.origin.text = " ".repeat(gap) + direct.origin.text;
  assert.equal(
    Buffer.byteLength(JSON.stringify(direct) + "\n"),
    MAX_INSTRUMENT_PROJECT_BYTES,
  );
  assert.ok(Buffer.byteLength(direct.origin.text) <= MAX_PROJECT_BYTES);
  assert.equal(
    validateInstrumentProject(direct, r).events.length,
    direct.events.length,
  );
  direct.origin.text += " ";
  bad(() => validateInstrumentProject(direct, r), "projectTooLarge");
});
test("S1 reverse/derived/cancel and rejected future data do not touch full stores, undo or pending metadata", () => {
  const map = new Map(),
    storage = {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => map.set(k, v),
      removeItem: (k) => map.delete(k),
    };
  map.set("pending-receipt", "retained-original");
  map.set("undo", "immutable-layer");
  map.set("full-store", "x".repeat(256 * 1024));
  const p = withEvents(),
    bb = toBeatbox(p.composition, true);
  map.set(
    PROJECTS_KEY,
    JSON.stringify({
      version: 1,
      items: Array.from({ length: 30 }, (_, i) => ({
        id: "saved-" + i,
        project: bb,
      })),
    }),
  );
  const snapshot = [...map];
  bad(() => deriveLegacyProject(p, registry()), "needsConversion");
  assert.deepEqual([...map], snapshot);
  const result = deriveLegacyProject(p, registry(), { derived: true });
  assert.deepEqual(result.project, p.composition);
  assert.deepEqual(result.retainedOriginal, p);
  const shallow = Object.freeze(structuredClone(p)),
    retained = deriveLegacyProject(shallow, registry(), {
      derived: true,
    }).retainedOriginal;
  shallow.events[0].tick = 2;
  assert.equal(retained.events[0].tick, 0);
  assert.ok(Object.isFrozen(retained.events[0]));
  const store = new ProjectStore(originalRegistry, () => storage);
  bad(() => store.save(bb), "storageFull");
  assert.deepEqual([...map], snapshot);
  assert.throws(() => store.save(p));
  assert.deepEqual([...map], snapshot);
  assert.throws(() =>
    parseInstrumentProject('{"schemaVersion":5}', registry()),
  );
  assert.deepEqual([...map], snapshot);
  // Existing project serialization and recipes remain authoritative.
  assert.equal(
    JSON.parse(serializeProject(p.composition, compositionRegistry))
      .schemaVersion,
    3,
  );
});
