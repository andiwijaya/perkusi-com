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
import { withBass, emptyBassNotes, BASS_CREDITS } from "../src/project/bass.js";
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
  const p = withBass(withKendhang(withPatternLoops(newComposition("Bass QA"))));
  p.timing.bpm = 96;
  p.patterns.push({ ...structuredClone(p.patterns[0]), id: "p2", name: "B" });
  p.chain = ["p1", "p2"];
  p.patterns[0].bassNotes[0] = { pitch: "e1", velocity: 0.6 };
  p.patterns[0].bassNotes[3] = { pitch: "g1", velocity: 0.5 };
  p.patterns[1].bassNotes[7] = { pitch: "b1", velocity: 0.4 };
  return p;
}
test("old compositions remain byte-preserving and editor upgrade adds no bass note", () => {
  const old = withKendhang(withPatternLoops(newComposition())),
    raw = JSON.stringify(old),
    p = withBass(old);
  assert.equal(JSON.stringify(old), raw);
  assert.equal(
    serializeProject(old, compositionRegistry),
    serializeProject(valid(old), compositionRegistry),
  );
  assert(p.patterns.every((a) => a.bassNotes.every((n) => n === null)));
  assert.deepEqual(withBass(p), p);
  assert.doesNotThrow(() => valid(p));
});
test("bass schema strictly rejects extra pitches, invalid velocities, malformed rows and altered provenance", () => {
  for (const mutate of [
    (p) => p.patterns[0].bassNotes.push(null),
    (p) => (p.patterns[0].bassNotes[1] = { pitch: "c1", velocity: 1 }),
    (p) => (p.patterns[0].bassNotes[1] = { pitch: "e1", velocity: 0 }),
    (p) => (p.patterns[0].bassNotes[1] = { pitch: "e1", velocity: Infinity }),
    (p) => (p.bass.credits = "missing"),
    (p) => (p.bass.id = "remote"),
    (p) => delete p.patterns[1].bassNotes,
    (p) => (p.bass.pan = 2),
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
test("pattern duplicate/clear snapshots and undo/redo preserve existing content and independent bass", () => {
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
  h.edit((p) => (p.patterns[2].bassNotes = emptyBassNotes()));
  assert.equal(h.current.patterns[0].bassNotes[0].pitch, "e1");
  assert(h.undo());
  assert.deepEqual(
    h.current.patterns[2].bassNotes,
    h.current.patterns[0].bassNotes,
  );
  assert(h.redo());
  assert(h.current.patterns[2].bassNotes.every((n) => n === null));
  assert.equal(h.current.patterns[0].kendhang.tak[0], 0.5);
  assert.equal(h.current.patterns[0].steps.kick[0], 0.5);
  assert.equal(h.current.patterns[0].notes[0].pitch, "d4");
});
test("new storage and portable JSON retain every bass pattern and explicit Beatbox omission reason", () => {
  const m = new Map(),
    store = new CompositionStore(
      compositionRegistry,
      () => ({
        getItem: (k) => m.get(k) ?? null,
        setItem: (k, v) => m.set(k, v),
        removeItem: (k) => m.delete(k),
      }),
      () => "bass-save",
    ),
    p = fixture();
  const id = store.save(p);
  assert.deepEqual(store.read().find((x) => x.id === id).project, p);
  assert(serializeProject(p, compositionRegistry).includes("CC0-1.0"));
  assert(reverseReasons(p).includes("bass"));
});
test("bounded bass derivation preserves every pre-fade source sample and license/hash provenance; originals unchanged", () => {
  const m = JSON.parse(readFileSync("internal/bass-short/manifest.json"));
  assert.equal(hash(readFileSync(m.recipe)), m.recipeSHA256);
  for (const a of m.assets) {
    const original = readFileSync(a.inputPath),
      b = readFileSync("internal/bass-short/" + a.assetPath);
    assert.equal(hash(original), a.inputSHA256);
    assert.equal(hash(readFileSync(a.originalPath)), a.originalSHA256);
    assert.equal(hash(b), a.sha256);
    assert.equal(b.readUInt16LE(20), 3);
    assert.equal(b.readUInt32LE(24), 48000);
    assert.equal(b.readUInt32LE(40), 57600 * 4);
    for (let i = 0; i < 55200; i++)
      assert.equal(b.readFloatLE(44 + i * 4), original.readFloatLE(44 + i * 4));
    for (let i = 55200; i < 57600; i++) {
      const expected = Math.fround(
        original.readFloatLE(44 + i * 4) *
          (0.5 * (1 + Math.cos((Math.PI * (i - 55200)) / 2399))),
      );
      assert.equal(Math.abs(b.readFloatLE(44 + i * 4) - expected), 0);
    }
    assert.equal(b.readFloatLE(b.length - 4), 0);
    assert.equal(a.durationSeconds, 1.2);
    assert(a.peak <= 0.95);
  }
  assert.equal(
    m.assets.reduce((n, a) => n + a.frames * a.channels * 4, 0),
    691200,
  );
  assert.equal(
    hash(readFileSync("internal/bass-short/LICENSE.txt")),
    m.licenseEvidenceSHA256,
  );
});
test("ordinary two-second one-shot source guard remains intact; bass fits without weakening it", () => {
  const stem = {
    id: "e1",
    url: "/local.wav",
    licenseId: "CC0-1.0",
    durationSeconds: 1.2,
    gainTrim: 0.55,
  };
  const pack = {
    schemaVersion: 1,
    id: "electric-bass-short",
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
      bass: {
        load: async (id) => loaded.push(id),
        get: () => ({ buffer: {} }),
      },
    });
  const p = withBass(withKendhang(withPatternLoops(newComposition())));
  await b.load(p, {});
  assert.deepEqual(loaded, []);
  p.patterns[0].bassNotes[0] = { pitch: "e1", velocity: 0.5 };
  p.patterns.push({ ...structuredClone(p.patterns[0]), id: "p2", name: "B" });
  p.patterns[1].bassNotes[1] = { pitch: "b1", velocity: 0.5 };
  await b.load(p, {});
  assert.deepEqual(loaded, ["e1", "b1"]);
});
test("bass-only WAV is admitted with exact decoded geometry and silence/memory guards, including source credits", () => {
  const p = fixture(),
    ext = compositionExportExtras({}),
    b = ext.budget(p);
  assert.equal(b.decode, 691200);
  assert(b.audible);
  assert.doesNotThrow(() => studioExportBudget(p, compositionRegistry, 0, b));
  assert.equal(ext.credits(p), BASS_CREDITS);
  p.bass.mute = true;
  assert.throws(
    () => studioExportBudget(p, compositionRegistry, 0, ext.budget(p)),
    /emptyMix/,
  );
  p.bass.mute = false;
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
      bass: {
        get: (id) => ({
          stem: { id, gainTrim: 0.55 },
          buffer: { duration: 1.2, id },
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
  test(`${rate}: sounding pattern, swung timing and monophonic 20ms choke agree in live/offline schedules`, () => {
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
        [0, "e1"],
        [3, "g1"],
        [23, "b1"],
      ],
    );
    const voices = [];
    compositionExportExtras({}).schedule(context, master, p, { banks }, voices);
    assert.deepEqual(
      voices.map((v) => [v.pitch, v.when]),
      [
        ["e1", 0],
        ["g1", 0.5],
        ["b1", 3.625],
      ],
    );
    assert(Math.abs(voices[0].endTime - 0.52) < 1e-9);
    assert.equal(voices[1].endTime, 1.7);
    assert.equal(voices[2].endTime, 4.825);
  });
test("cancelled future bass note restores the current short voice natural end instead of leaving a stale choke", () => {
  const { playback: b, context: c, engine: e, p } = setup();
  p.patterns[0].bassNotes[1] = { pitch: "g1", velocity: 0.5 };
  b.step(0, 0.05);
  const prior = [...e.voices][0];
  c.currentTime = 0.08;
  b.step(1, 0.20625);
  assert(Math.abs(prior.endTime - 0.22625) < 1e-9);
  c.currentTime = 0.1;
  b.cancelScheduled(0.1);
  for (const v of [...e.voices]) if (v.when > 0.1) e.removeVoice(v);
  assert.equal(prior.endTime, 1.25);
  assert.equal(e.voices.size, 1);
  assert.equal(b.bassChokes.length, 0);
});
test("same-grid rapid bass pads are last-note-wins, with no accumulating audible older pitches", () => {
  const { playback: b, engine: e } = setup();
  for (const pitch of ["e1", "g1", "b1", "e1", "b1", "g1"])
    b.bassShot({ pitch, velocity: 1 }, 0.05);
  const voices = [...e.voices];
  for (const v of voices.slice(0, -1)) assert.equal(gainValueAt(v, 0.08), 0);
  assert.equal(voices.at(-1).pitch, "g1");
  assert.equal(gainValueAt(voices.at(-1), 0.08), 0.55);
});
test("64-voice admission refuses bass allocation before creating another source", () => {
  const { playback: b, engine: e, context: c } = setup();
  for (let i = 0; i < 64; i++) e.voices.add({ id: "pressure" + i });
  b.step(0, 0.05);
  assert.equal(c.sources.length, 0);
});
test("Stop/replace operation fences a cold bass pad whose decode resolves late", async () => {
  const { playback: b, engine: e, context: c, banks } = setup();
  let release;
  const loaded = new Promise((r) => (release = r)),
    entry = { stem: { id: "e1", gainTrim: 0.55 }, buffer: null };
  banks.bass = {
    get: () => entry,
    load: async () => {
      await loaded;
      entry.buffer = { duration: 1.2 };
    },
  };
  e.ensureContext = () => c;
  e.operation = 0;
  e.disposed = false;
  const pending = b.pad("e1", "bass");
  e.operation++;
  release();
  await pending;
  assert.equal(c.sources.length, 0);
});
