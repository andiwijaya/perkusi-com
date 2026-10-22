import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  newComposition,
  withPatternLoops,
  allMix,
  reverseReasons,
} from "../src/project/composition-model.js";
import {
  withKendhang,
  emptyKendhang,
  KENDHANG_CREDITS,
} from "../src/project/kendhang.js";
import {
  validateProject,
  serializeProject,
  parseProject,
} from "../src/project/schema.js";
import { compositionRegistry } from "../src/project/studio-registry.js";
import { CompositionStore } from "../src/project/composition-store.js";
import { ProjectHistory } from "../src/project/studio-model.js";
import {
  CompositionBanks,
  CompositionPlayback,
  compositionExportExtras,
  createCompositionMixer,
} from "../src/audio/composition.js";
import { studioExportBudget } from "../src/audio/studio-exporter.js";
import { wavHeader, wavWithCredits } from "../src/audio/wav.js";
const valid = (p) => validateProject(p, compositionRegistry);
function fixture() {
  const p = withKendhang(withPatternLoops(newComposition("Ciblon test")));
  p.timing.bpm = 96;
  p.patterns.push({ ...structuredClone(p.patterns[0]), id: "p2", name: "B" });
  p.chain = ["p1", "p2"];
  p.patterns[0].kendhang.tak[0] = 0.7;
  p.patterns[0].kendhang.tak[4] = 0.5;
  p.patterns[1].kendhang.thung[8] = 0.6;
  return p;
}
test("legacy project bytes remain accepted; editor upgrade is silent and independent for every pattern", () => {
  const old = withPatternLoops(newComposition()),
    raw = JSON.stringify(old),
    p = withKendhang(old);
  assert.equal(JSON.stringify(old), raw);
  assert.equal(
    serializeProject(old, compositionRegistry),
    serializeProject(valid(old), compositionRegistry),
  );
  assert(
    p.patterns.every((a) =>
      Object.values(a.kendhang)
        .flat()
        .every((x) => x === 0),
    ),
  );
  assert.deepEqual(withKendhang(p), p);
  assert.doesNotThrow(() => valid(p));
});
test("strict two-articulation rows and pinned attribution reject malformed/future data without dropping it", () => {
  for (const mutate of [
    (p) => p.patterns[0].kendhang.tak.push(1),
    (p) => (p.patterns[1].kendhang.thung[2] = NaN),
    (p) => (p.patterns[0].kendhang.tak[1] = 1.1),
    (p) => (p.patterns[0].kendhang.other = []),
    (p) => (p.kendhang.credits = "missing"),
    (p) => (p.kendhang.id = "remote"),
    (p) => delete p.patterns[1].kendhang,
    (p) => (p.kendhang.pan = 2),
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
test("snapshot duplicate, clear, undo and redo retain independent hits, loops, drums and Bilah", () => {
  const p = fixture();
  p.patterns[0].steps.kick[0] = 1;
  p.patterns[0].notes[1] = { pitch: "d4", velocity: 0.5 };
  const h = new ProjectHistory(p, valid);
  h.edit((p) => {
    const a = structuredClone(p.patterns[0]);
    a.id = "p3";
    a.name = "C";
    p.patterns.push(a);
  });
  h.edit((p) => (p.patterns[2].kendhang = emptyKendhang()));
  assert.equal(h.current.patterns[0].kendhang.tak[0], 0.7);
  assert(h.undo());
  assert.deepEqual(
    h.current.patterns[2].kendhang,
    h.current.patterns[0].kendhang,
  );
  assert(h.redo());
  assert.deepEqual(h.current.patterns[2].kendhang, emptyKendhang());
  assert.equal(h.current.patterns[0].steps.kick[0], 1);
  assert.equal(h.current.patterns[0].notes[1].pitch, "d4");
});
test("storage roundtrip includes every pattern and original source notices; Beatbox conversion explicitly warns", () => {
  const values = new Map(),
    store = new CompositionStore(
      compositionRegistry,
      () => ({
        getItem: (k) => values.get(k) ?? null,
        setItem: (k, v) => values.set(k, v),
        removeItem: (k) => values.delete(k),
      }),
      () => "kendhang-save",
    );
  const p = fixture(),
    id = store.save(p);
  assert.deepEqual(store.read().find((a) => a.id === id).project, p);
  assert(serializeProject(p, compositionRegistry).includes("CC BY 3.0"));
  assert(reverseReasons(p).includes("kendhang"));
});
test("only kendhang can make an export audible; mute/solo and decoded budget remain guarded", () => {
  const p = fixture(),
    ext = compositionExportExtras({}),
    extra = ext.budget(p);
  assert.equal(extra.decode, 604808);
  assert(extra.audible);
  assert.doesNotThrow(() =>
    studioExportBudget(p, compositionRegistry, 0, extra),
  );
  p.kendhang.mute = true;
  assert.throws(
    () => studioExportBudget(p, compositionRegistry, 0, ext.budget(p)),
    /emptyMix/,
  );
  p.kendhang.mute = false;
  p.kendhang.solo = true;
  assert.equal(allMix(p).filter((t) => t.solo)[0].role, "kendhang");
  assert.throws(
    () => studioExportBudget(p, compositionRegistry, 32 * 1024 * 1024, extra),
    /exportLimit/,
  );
});
test("lazy bank loading loads no old-project sample and deduplicates only required articulations across patterns", async () => {
  const loaded = [],
    b = Object.assign(Object.create(CompositionBanks.prototype), {
      kendhang: {
        load: async (id) => loaded.push(id),
        get: () => ({ buffer: {} }),
      },
      loops: [],
    });
  const p = withKendhang(withPatternLoops(newComposition()));
  await b.load(p, {});
  assert.deepEqual(loaded, []);
  p.patterns[0].kendhang.tak[0] = 1;
  p.patterns.push({ ...structuredClone(p.patterns[0]), id: "p2", name: "B" });
  await b.load(p, {});
  assert.deepEqual(loaded, ["tak"]);
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
function setup(rate) {
  const p = fixture(),
    context = new Context(rate),
    master = new Node(),
    banks = {
      kendhang: {
        get: (id) => ({
          stem: { id, gainTrim: 0.55 },
          buffer: { duration: id === "tak" ? 0.89125 : 0.683770833333, id },
        }),
      },
    },
    mixer = createCompositionMixer(context, master, p);
  return { p, context, master, banks, mixer };
}
for (const rate of [44100, 48000])
  test(`${rate}: live and offline use sounding pattern, swing times and same-articulation choke; editor selection is independent`, () => {
    const { p, context, master, banks, mixer } = setup(rate);
    p.activePattern = "p2";
    p.timing.swing = 0.2;
    p.patterns[0].kendhang.tak[4] = 0;
    p.patterns[0].kendhang.tak[3] = 0.5;
    p.patterns[1].kendhang.thung[8] = 0;
    p.patterns[1].kendhang.thung[7] = 0.6;
    const events = [],
      engine = {
        arrangement: true,
        voices: new Set(),
        stats: { created: 0 },
        record: (type, detail) => events.push({ type, ...detail }),
      };
    const b = Object.assign(Object.create(CompositionPlayback.prototype), {
      project: p,
      engine,
      context,
      banks,
      mixer,
      lastLoopBar: 0,
    });
    for (const i of [0, 3, 23]) {
      b.lastLoopBar = Math.floor(i / 16);
      b.step(i, (i / 4 + (i % 2 ? 0.05 : 0)) * 0.625);
    }
    assert.deepEqual(
      events.map((e) => [e.index, e.pitch, e.velocity]),
      [
        [0, "tak", 0.7],
        [3, "tak", 0.5],
        [23, "thung", 0.6],
      ],
    );
    const voices = [];
    compositionExportExtras({}).schedule(context, master, p, { banks }, voices);
    assert.deepEqual(
      voices.map((v) => [v.pitch, v.when]),
      [
        ["tak", 0],
        ["tak", 0.5],
        ["thung", 3.625],
      ],
    );
    assert(Math.abs(voices[0].endTime - 0.504) < 1e-9);
    assert.equal(voices[1].pitch, "tak");
    assert.equal(voices[2].pitch, "thung");
  });
test("64 voice guard refuses additional kendhang shots without allocating nodes", () => {
  const { p, context, banks, mixer } = setup(48000),
    engine = {
      arrangement: true,
      voices: new Set(Array.from({ length: 64 }, (_, i) => i)),
      stats: { created: 0 },
      record() {},
    };
  const b = Object.assign(Object.create(CompositionPlayback.prototype), {
    project: p,
    engine,
    context,
    banks,
    mixer,
    lastLoopBar: 0,
  });
  b.step(0, 0);
  assert.equal(context.sources.length, 0);
});
test("WAV embeds CC BY attribution without changing any PCM byte or data length; old WAV is unchanged", async () => {
  const { data } = wavHeader(8, 48000, 2),
    old = new Blob([data], { type: "audio/wav" });
  assert.equal(await wavWithCredits(old, null), old);
  const blob = await wavWithCredits(old, KENDHANG_CREDITS),
    b = new Uint8Array(await blob.arrayBuffer()),
    v = new DataView(b.buffer);
  assert.equal(v.getUint32(4, true), b.length - 8);
  assert.equal(v.getUint32(40, true), 32);
  assert.deepEqual(b.slice(12, 76), new Uint8Array(data).slice(12));
  assert(new TextDecoder().decode(b.slice(76)).includes("CC BY 3.0"));
  assert.equal(new TextDecoder().decode(b.slice(76, 80)), "LIST");
});
test("retained FLAC and work-source archives match the precise acquired identities and notices exist", () => {
  const j = JSON.parse(
      readFileSync("internal/gamelan-flac/registry-48000.json"),
    ),
    code = readFileSync("src/studio/kendhang-pack.js", "utf8");
  for (const id of ["261992", "261991"]) {
    const sample = j.banks
        .flatMap((b) => b.samples)
        .find((a) => a.id === "fs-" + id),
      f = "internal/gamelan-flac/audio/48000/s" + id + ".flac",
      bytes = readFileSync(f);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      sample.sha256,
    );
    assert(code.includes(sample.sha256));
    assert(
      existsSync(
        "internal/gamelan-source-forms/archives/work-" + id + "-source.zip",
      ),
    );
  }
  for (const f of [
    "LICENSE_CC_BY_3.0.txt",
    "LICENSE_ARTISTIC_2.0.txt",
    "NOTICE.txt",
  ])
    assert(existsSync("internal/gamelan-delivery/" + f));
});
