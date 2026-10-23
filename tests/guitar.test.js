import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  newComposition,
  withPatternLoops,
  reverseReasons,
} from "../src/project/composition-model.js";
import { withKendhang } from "../src/project/kendhang.js";
import { withBass } from "../src/project/bass.js";
import {
  withGuitar,
  emptyGuitarNotes,
  GUITAR_CREDITS,
} from "../src/project/guitar.js";
import {
  validateProject,
  serializeProject,
  parseProject,
} from "../src/project/schema.js";
import { compositionRegistry } from "../src/project/studio-registry.js";
import { ProjectHistory } from "../src/project/studio-model.js";
import { CompositionStore } from "../src/project/composition-store.js";
import {
  CompositionPlayback,
  CompositionBanks,
  compositionExportExtras,
  createCompositionMixer,
} from "../src/audio/composition.js";
import { Transport } from "../src/audio/transport.js";
import { disconnectVoice, gainValueAt } from "../src/audio/voice.js";
import { studioExportBudget } from "../src/audio/studio-exporter.js";
import { validatePack } from "../src/audio/sample-bank.js";
const hash = (b) => createHash("sha256").update(b).digest("hex"),
  valid = (p) => validateProject(p, compositionRegistry);
function fixture() {
  const p = withGuitar(
    withKendhang(withPatternLoops(newComposition("Guitar QA"))),
  );
  p.timing.bpm = 96;
  p.patterns.push({ ...structuredClone(p.patterns[0]), id: "p2", name: "B" });
  p.chain = ["p1", "p2"];
  p.patterns[0].guitarNotes[0] = { pitch: "b2", velocity: 0.6 };
  p.patterns[0].guitarNotes[3] = { pitch: "e3", velocity: 0.5 };
  p.patterns[1].guitarNotes[7] = { pitch: "g3", velocity: 0.4 };
  return p;
}
test("old compositions including bass remain byte-preserving and editor upgrade adds no guitar note", () => {
  const old = withBass(withKendhang(withPatternLoops(newComposition()))),
    raw = JSON.stringify(old),
    p = withGuitar(old);
  assert.equal(JSON.stringify(old), raw);
  assert.equal(
    serializeProject(old, compositionRegistry),
    serializeProject(valid(old), compositionRegistry),
  );
  assert(p.patterns.every((a) => a.guitarNotes.every((n) => n === null)));
  assert.deepEqual(withGuitar(p), p);
  assert.doesNotThrow(() => valid(p));
  assert.deepEqual(p.bass, old.bass);
  assert.deepEqual(p.patterns[0].bassNotes, old.patterns[0].bassNotes);
});
test("guitar schema strictly rejects extra pitches, invalid velocities, malformed rows and altered provenance", () => {
  for (const mutate of [
    (p) => p.patterns[0].guitarNotes.push(null),
    (p) => (p.patterns[0].guitarNotes[1] = { pitch: "c1", velocity: 1 }),
    (p) => (p.patterns[0].guitarNotes[1] = { pitch: "b2", velocity: 0 }),
    (p) => (p.patterns[0].guitarNotes[1] = { pitch: "b2", velocity: Infinity }),
    (p) => (p.guitar.credits = "missing"),
    (p) => (p.guitar.id = "remote"),
    (p) => delete p.patterns[1].guitarNotes,
    (p) => (p.guitar.pan = 2),
  ]) {
    const p = fixture();
    mutate(p);
    assert.throws(() => valid(p));
  }
  assert.deepEqual(
    parseProject(
      serializeProject(fixture(), compositionRegistry),
      compositionRegistry,
    ),
    fixture(),
  );
});
test("pattern duplicate/clear snapshots and undo/redo preserve existing content and independent guitar", () => {
  const p = fixture();
  p.patterns[0].notes[0] = { pitch: "d4", velocity: 0.4 };
  p.patterns[0].kendhang.tak[0] = 0.5;
  p.patterns[0].steps.kick[0] = 0.5;
  const h = new ProjectHistory(p, valid);
  h.edit((p) => {
    const a = structuredClone(p.patterns[0]);
    a.id = "p3";
    a.name = "C";
    p.patterns.push(a);
  });
  h.edit((p) => (p.patterns[2].guitarNotes = emptyGuitarNotes()));
  assert.equal(h.current.patterns[0].guitarNotes[0].pitch, "b2");
  assert(h.undo());
  assert.deepEqual(
    h.current.patterns[2].guitarNotes,
    h.current.patterns[0].guitarNotes,
  );
  assert(h.redo());
  assert(h.current.patterns[2].guitarNotes.every((n) => n === null));
  assert.equal(h.current.patterns[0].kendhang.tak[0], 0.5);
  assert.equal(h.current.patterns[0].steps.kick[0], 0.5);
  assert.equal(h.current.patterns[0].notes[0].pitch, "d4");
});
test("new storage and portable JSON retain every guitar pattern and explicit Beatbox omission reason", () => {
  const m = new Map(),
    store = new CompositionStore(
      compositionRegistry,
      () => ({
        getItem: (k) => m.get(k) ?? null,
        setItem: (k, v) => m.set(k, v),
        removeItem: (k) => m.delete(k),
      }),
      () => "guitar-save",
    ),
    p = fixture();
  const id = store.save(p);
  assert.deepEqual(store.read().find((x) => x.id === id).project, p);
  assert(serializeProject(p, compositionRegistry).includes("CC0-1.0"));
  assert(reverseReasons(p).includes("guitar"));
});
test("bounded guitar derivation preserves every pre-fade source sample and license/hash provenance; originals unchanged", () => {
  const m = JSON.parse(readFileSync("internal/guitar-short/manifest.json"));
  assert.equal(hash(readFileSync(m.recipe)), m.recipeSHA256);
  for (const a of m.assets) {
    const original = readFileSync(a.inputPath),
      b = readFileSync("internal/guitar-short/" + a.assetPath);
    assert.equal(hash(original), a.inputSHA256);
    assert.equal(hash(readFileSync(a.originalPath)), a.originalSHA256);
    assert.equal(hash(b), a.sha256);
    assert.equal(b.readUInt16LE(20), 3);
    assert.equal(b.readUInt32LE(24), 48000);
    assert.equal(b.readUInt32LE(40), 86400 * 4);
    for (let i = 0; i < 82560; i++)
      assert.equal(b.readFloatLE(44 + i * 4), original.readFloatLE(44 + i * 4));
    for (let i = 82560; i < 86400; i++) {
      const expected = Math.fround(
        original.readFloatLE(44 + i * 4) *
          (0.5 * (1 + Math.cos((Math.PI * (i - 82560)) / 3839))),
      );
      assert.equal(Math.abs(b.readFloatLE(44 + i * 4) - expected), 0);
    }
    assert.equal(b.readFloatLE(b.length - 4), 0);
    assert.equal(a.durationSeconds, 1.8);
    assert(a.peak <= 0.95);
  }
  assert.equal(
    m.assets.reduce((n, a) => n + a.frames * a.channels * 4, 0),
    1036800,
  );
  assert.equal(
    hash(readFileSync("internal/guitar-short/LICENSE.txt")),
    m.licenseEvidenceSHA256,
  );
});
test("ordinary two-second one-shot source guard remains intact; guitar fits without weakening it", () => {
  const stem = {
    id: "b2",
    url: "/local.wav",
    licenseId: "CC0-1.0",
    durationSeconds: 1.8,
    gainTrim: 0.55,
  };
  const pack = {
    schemaVersion: 1,
    id: "nylon-guitar-short",
    kind: "one-shot",
    bpm: 120,
    beatsPerBar: 4,
    bars: 1,
    stems: [stem],
  };
  assert.doesNotThrow(() => validatePack(pack));
  assert.throws(
    () =>
      validatePack({ ...pack, stems: [{ ...stem, durationSeconds: 4.59 }] }),
    /geometry/,
  );
});
test("lazy loading deduplicates only the pitches used across patterns and does not load an empty old project", async () => {
  const loaded = [],
    b = Object.assign(Object.create(CompositionBanks.prototype), {
      loops: [],
      guitar: {
        load: async (id) => loaded.push(id),
        get: () => ({ buffer: {} }),
      },
    });
  const p = withGuitar(withKendhang(withPatternLoops(newComposition())));
  await b.load(p, {});
  assert.deepEqual(loaded, []);
  p.patterns[0].guitarNotes[0] = { pitch: "b2", velocity: 0.5 };
  p.patterns.push({ ...structuredClone(p.patterns[0]), id: "p2", name: "B" });
  p.patterns[1].guitarNotes[1] = { pitch: "g3", velocity: 0.5 };
  await b.load(p, {});
  assert.deepEqual(loaded, ["b2", "g3"]);
});
test("guitar-only WAV is admitted with exact decoded geometry and silence/memory guards, including source credits", () => {
  const p = fixture(),
    ext = compositionExportExtras({}),
    b = ext.budget(p);
  assert.equal(b.decode, 1036800);
  assert(b.audible);
  assert.doesNotThrow(() => studioExportBudget(p, compositionRegistry, 0, b));
  assert.equal(ext.credits(p), GUITAR_CREDITS);
  p.guitar.mute = true;
  assert.throws(
    () => studioExportBudget(p, compositionRegistry, 0, ext.budget(p)),
    /emptyMix/,
  );
  p.guitar.mute = false;
  assert.throws(
    () => studioExportBudget(p, compositionRegistry, 32 * 1024 * 1024, b),
    /exportLimit/,
  );
});
class Param {
  value = 0;
  calls = [];
  setValueAtTime(...a) {
    this.calls.push(["set", ...a]);
  }
  linearRampToValueAtTime(...a) {
    this.calls.push(["linear", ...a]);
  }
  setTargetAtTime(...a) {
    this.calls.push(["target", ...a]);
  }
  cancelAndHoldAtTime() {}
  cancelScheduledValues() {}
}
class Node {
  gain = new Param();
  pan = new Param();
  playbackRate = new Param();
  connect() {}
  disconnect() {
    this.disconnected = true;
  }
  start(...a) {
    this.args = a;
  }
  stop() {}
}
class Context {
  currentTime = 0;
  state = "running";
  sources = [];
  constructor(rate) {
    this.sampleRate = rate;
  }
  createGain() {
    return new Node();
  }
  createStereoPanner() {
    return new Node();
  }
  createChannelMerger() {
    return new Node();
  }
  createBufferSource() {
    const n = new Node();
    this.sources.push(n);
    return n;
  }
}
function setup(rate = 48000) {
  const p = fixture(),
    context = new Context(rate),
    master = new Node(),
    banks = {
      guitar: {
        get: (id) => ({
          stem: { id, gainTrim: 0.55 },
          buffer: { duration: 1.8, id },
        }),
      },
    },
    mixer = createCompositionMixer(context, master, p),
    transport = new Transport({ bpm: 96 });
  transport.start(0.05);
  const events = [],
    engine = {
      transport,
      arrangement: true,
      voices: new Set(),
      stats: { created: 0 },
      record: (type, detail) => events.push({ type, ...detail }),
      removeVoice(v) {
        this.voices.delete(v);
        disconnectVoice(v);
      },
    };
  const playback = Object.assign(Object.create(CompositionPlayback.prototype), {
    project: p,
    engine,
    context,
    banks,
    mixer,
    lastLoopBar: 0,
  });
  return { p, context, master, banks, mixer, engine, playback, events };
}
for (const rate of [44100, 48000])
  test(`${rate}: sounding pattern, swung timing and different-pitch tails agree in live/offline schedules`, () => {
    const { p, context, master, banks, playback: b, events } = setup(rate);
    p.activePattern = "p2";
    p.timing.swing = 0.2;
    for (const i of [0, 3, 23]) {
      b.lastLoopBar = Math.floor(i / 16);
      b.step(i, (i / 4 + (i % 2 ? 0.05 : 0)) * 0.625);
    }
    assert.deepEqual(
      events.map((e) => [e.index, e.pitch]),
      [
        [0, "b2"],
        [3, "e3"],
        [23, "g3"],
      ],
    );
    const voices = [];
    compositionExportExtras({}).schedule(context, master, p, { banks }, voices);
    assert.deepEqual(
      voices.map((v) => [v.pitch, v.when]),
      [
        ["b2", 0],
        ["e3", 0.5],
        ["g3", 3.625],
      ],
    );
    assert.equal(voices[0].endTime, 1.8);
    assert.equal(voices[1].endTime, 2.3);
    assert.equal(voices[2].endTime, 5.425);
  });
test("cancelled future guitar note restores the current short voice natural end instead of leaving a stale choke", () => {
  const { playback: b, context: c, engine: e, p } = setup();
  p.patterns[0].guitarNotes[1] = { pitch: "b2", velocity: 0.5 };
  b.step(0, 0.05);
  const prior = [...e.voices][0];
  c.currentTime = 0.08;
  b.step(1, 0.20625);
  assert(Math.abs(prior.endTime - 0.21625) < 1e-9);
  c.currentTime = 0.1;
  b.cancelScheduled(0.1);
  for (const v of [...e.voices]) if (v.when > 0.1) e.removeVoice(v);
  assert.equal(prior.endTime, 1.85);
  assert.equal(e.voices.size, 1);
  assert.equal(b.guitarChokes.length, 0);
});
test("different pitches ring together; rapid same-pitch retriggers are last-note-wins", () => {
  const { playback: b, engine: e } = setup();
  for (const pitch of ["b2", "e3", "g3", "b2", "g3", "e3"])
    b.guitarShot({ pitch, velocity: 1 }, 0.05);
  const voices = [...e.voices];
  for (const v of voices.slice(0, 3)) assert.equal(gainValueAt(v, 0.08), 0);
  for (const v of voices.slice(3)) {
    assert.equal(gainValueAt(v, 0.08), 0.55);
    assert.equal(v.endTime, 1.85);
  }
  assert.equal(voices.length, 6);
});
test("64-voice admission refuses guitar allocation before creating another source", () => {
  const { playback: b, engine: e, context: c } = setup();
  for (let i = 0; i < 64; i++) e.voices.add({ id: "pressure" + i });
  b.step(0, 0.05);
  assert.equal(c.sources.length, 0);
});

for (const rate of [44100, 48000])
  test(`${rate}: offline same-pitch retrigger fades only its pitch, including chain boundary`, () => {
    const { p, context, master, banks } = setup(rate);
    p.patterns[0].guitarNotes[1] = { pitch: "b2", velocity: 0.5 };
    p.patterns[0].guitarNotes[15] = { pitch: "g3", velocity: 0.5 };
    p.patterns[1].guitarNotes[0] = { pitch: "g3", velocity: 0.5 };
    const voices = [];
    compositionExportExtras({}).schedule(context, master, p, { banks }, voices);
    const b2 = voices.filter((v) => v.pitch === "b2"),
      g3 = voices.filter((v) => v.pitch === "g3");
    assert.equal(b2.length, 2);
    assert.equal(b2[0].endTime, 0.16625);
    assert.equal(b2[1].endTime, 1.95625);
    assert.equal(voices.find((v) => v.pitch === "e3").endTime, 2.26875);
    assert.equal(g3[0].endTime, 2.51);
    assert.equal(g3[1].endTime, 3.60375);
    assert.equal(g3[2].endTime, 5.39375);
  });
test("Stop/replace operation fences a cold guitar pad whose decode resolves late", async () => {
  const { playback: b, engine: e, context: c, banks } = setup();
  let release;
  const loaded = new Promise((r) => (release = r)),
    entry = { stem: { id: "b2", gainTrim: 0.55 }, buffer: null };
  banks.guitar = {
    get: () => entry,
    load: async () => {
      await loaded;
      entry.buffer = { duration: 1.8 };
    },
  };
  e.ensureContext = () => (e.context = c);
  e.operation = 0;
  e.disposed = false;
  const pending = b.pad("b2", "guitar");
  e.operation++;
  release();
  await pending;
  assert.equal(c.sources.length, 0);
});
