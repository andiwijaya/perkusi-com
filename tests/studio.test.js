import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  studioDemo,
  newStudioProject,
  emptyPattern,
  ProjectHistory,
} from "../src/project/studio-model.js";
import {
  parseProject,
  serializeProject,
  validateProject,
  MAX_PROJECT_BYTES,
} from "../src/project/schema.js";
import { ProjectStore } from "../src/project/store.js";
import {
  arrangementEvents,
  sequenceEvents,
  stepTime,
  trackGain,
} from "../src/audio/sequencing.js";
import { studioExportBudget } from "../src/audio/studio-exporter.js";
import { Transport } from "../src/audio/transport.js";
import { encodeWav, wavHeader } from "../src/audio/wav.js";
import { studioMessages } from "../src/studio/messages.js";
import { validateStudioCatalog } from "../src/audio/studio-catalog.js";
import { createEventTracker } from "../src/analytics.js";
const manifest = JSON.parse(
  readFileSync(
    new URL("../internal/studio-kits/manifest.json", import.meta.url),
    "utf8",
  ),
);
const catalog = { ...manifest, kind: "studio" };
const valid = (p) => validateProject(p, catalog);
test("Studio persists every pattern, chain, timing and mixer field without affecting Beatbox stores", () => {
  const p = studioDemo("arus");
  p.tracks[0].pan = -0.7;
  p.tracks[2].mute = true;
  p.tracks[4].solo = true;
  assert.deepEqual(parseProject(serializeProject(p, catalog), catalog), p);
  const memory = new Map([
    ["perkusi.projects.v1", "old raw byte sentinel"],
    ["perkusi.draft.v1", "old draft sentinel"],
  ]);
  const storage = {
    getItem: (key) => memory.get(key),
    setItem: (key, value) => memory.set(key, value),
  };
  const store = new ProjectStore(
    catalog,
    () => storage,
    () => "synthetic-id",
    {
      projects: "perkusi.projects.studio.v2",
      draft: "perkusi.draft.studio.v2",
    },
  );
  store.save(p);
  store.saveDraft(p);
  assert.deepEqual(store.load("synthetic-id"), p);
  assert.deepEqual(store.readDraft(), p);
  store.remove("synthetic-id");
  assert.equal(store.read().length, 0);
  assert.equal(memory.get("perkusi.projects.v1"), "old raw byte sentinel");
  assert.equal(memory.get("perkusi.draft.v1"), "old draft sentinel");
});
test("Studio rejects bad kits, orphan chains, polluted fields, hostile steps, future versions and large input atomically", () => {
  const cases = [
    (p) => (p.pack.id = "remote"),
    (p) => (p.timing.bpm = 181),
    (p) => (p.timing.swing = 0.51),
    (p) => (p.timing.meter = [4, 4, 4]),
    (p) => (p.chain = ["missing"]),
    (p) => (p.chain = Array(9).fill("p1")),
    (p) => (p.patterns[0].steps.kick[0] = NaN),
    (p) => p.patterns[0].steps.kick.push(1),
    (p) => (p.tracks[1].role = "kick"),
    (p) => (p.tracks[0].pan = 2),
    (p) => (p.master.volume = 0.76),
    (p) => (p.pack.url = "https://invalid.invalid"),
    (p) => (p.patterns[0].steps.__proto__ = { pollution: 1 }),
    (p) => (p.schemaVersion = 99),
  ];
  for (const mutate of cases) {
    const p = studioDemo();
    mutate(p);
    assert.throws(() => valid(p));
  }
  assert.throws(
    () => parseProject(" ".repeat(MAX_PROJECT_BYTES + 1), catalog),
    (e) => e.code === "projectTooLarge",
  );
  assert.throws(
    () => validateProject(studioDemo(), { packId: "original-groove" }),
    (e) => e.code === "unsupportedMode",
  );
});
test("Four-pattern sequence uses continuous audio-clock timing at BPM60/90/120/180 and audible swing offsets", () => {
  const p = studioDemo();
  for (const bpm of [60, 90, 120, 180]) {
    p.timing.bpm = bpm;
    p.timing.swing = 0.4;
    const t = new Transport({ bpm });
    t.start(4.125);
    for (let s = 0; s < 64; s++)
      assert.ok(
        Math.abs(
          t.timeAt(s / 4 + (s % 2 ? 0.1 : 0)) - (4.125 + stepTime(s, bpm, 0.4)),
        ) < 1e-10,
      );
    assert.ok(stepTime(1, bpm, 0.4) > stepTime(1, bpm, 0));
    assert.equal(stepTime(2, bpm, 0.4), stepTime(2, bpm, 0));
    assert.deepEqual(
      [0, 16, 32, 48].map((s) => sequenceEvents(p, s)[0].patternId),
      p.chain,
    );
    for (const e of arrangementEvents(p))
      assert.equal(e.when, stepTime(e.index, bpm, 0.4));
    assert.equal(studioExportBudget(p, catalog).seconds, (16 * 60) / bpm);
  }
});
test("Mute dominates solo, non-solo tracks mute under another solo, and zero-level arrangement is rejected", () => {
  const p = studioDemo();
  p.tracks[0].solo = true;
  assert.equal(trackGain(p.tracks[0], p.tracks), 0.8);
  assert.equal(trackGain(p.tracks[1], p.tracks), 0);
  p.tracks[0].mute = true;
  assert.equal(trackGain(p.tracks[0], p.tracks), 0);
  assert.throws(
    () => studioExportBudget(p, catalog),
    (e) => e.code === "emptyMix",
  );
  const empty = newStudioProject();
  assert.throws(
    () => studioExportBudget(empty, catalog),
    (e) => e.code === "emptyMix",
  );
});
test("History preserves steps and chain references across pattern duplicate/delete/rename and bounded branching", () => {
  const h = new ProjectHistory(studioDemo(), valid, 3),
    original = structuredClone(h.current);
  h.edit((p) => (p.patterns[0].steps.kick[1] = 1));
  h.edit((p) => {
    const a = structuredClone(p.patterns[0]);
    a.id = "p5";
    a.name = "Fill";
    p.patterns.push(a);
    p.chain[3] = "p5";
  });
  const duplicated = structuredClone(h.current);
  h.edit((p) => {
    p.patterns = p.patterns.filter((a) => a.id !== "p5");
    p.chain[3] = "p4";
  });
  assert.ok(h.undo());
  assert.deepEqual(h.current, duplicated);
  assert.ok(h.undo());
  assert.ok(h.undo());
  assert.deepEqual(h.current, original);
  h.redo();
  h.edit((p) => (p.patterns[0].name = "New"));
  assert.equal(h.future.length, 0);
  for (let i = 0; i < 10; i++) h.edit((p) => (p.timing.bpm = 100 + i));
  assert.equal(h.past.length, 3);
  const before = structuredClone(h.current);
  assert.throws(() => h.edit((p) => (p.chain = ["missing"])));
  assert.deepEqual(h.current, before);
});
test("Stereo PCM16 preserves left/right ordering, sizes, safety and quantization-silence guard; mono contract unchanged", async () => {
  const pcm = [
    Float32Array.from([0.2, 0, -0.2, 0]),
    Float32Array.from([0, 0.3, 0, -0.3]),
  ];
  const out = await encodeWav(
    {
      numberOfChannels: 2,
      length: 4,
      sampleRate: 48000,
      getChannelData: (c) => pcm[c],
    },
    { yieldTask: async () => {} },
  );
  const bytes = await out.blob.arrayBuffer(),
    v = new DataView(bytes);
  assert.equal(bytes.byteLength, 60);
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getInt16(44, true), 6553);
  assert.equal(v.getInt16(46, true), 0);
  assert.equal(v.getInt16(50, true), 9830);
  assert.equal(wavHeader(960000, 48000).data.byteLength, 1920044);
  assert.equal(wavHeader(1536000, 48000, 2).data.byteLength, 6144044);
  assert.throws(() => wavHeader(1536001, 48000, 2));
  await assert.rejects(
    encodeWav(
      {
        numberOfChannels: 2,
        length: 4,
        sampleRate: 48000,
        getChannelData: () => new Float32Array(4).fill(1e-6),
      },
      { yieldTask: async () => {} },
    ),
    (e) => e.code === "emptyMix",
  );
});
test("Arrangement export budget supports eight bars at60BPM in32MiB and refuses impossible retained memory", () => {
  const p = studioDemo();
  p.timing.bpm = 60;
  p.chain = Array(8).fill("p1");
  const b = studioExportBudget(p, catalog, 4 * 1024 * 1024);
  assert.equal(b.frames, 1536000);
  assert.ok(b.bytes < 32 * 1024 * 1024);
  assert.throws(
    () => studioExportBudget(p, catalog, 32 * 1024 * 1024),
    (e) => e.code === "exportLimit",
  );
});
test("Both original kits have eight distinct one-shots, verified hashes/recipe/provenance and exact RIFF geometry", () => {
  validateStudioCatalog(manifest);
  const recipe = readFileSync(
    new URL("../scripts/make-studio-kits.py", import.meta.url),
  );
  const recipeHash = createHash("sha256").update(recipe).digest("hex");
  const hashes = new Set();
  assert.equal(manifest.kits.length, 2);
  for (const kit of manifest.kits) {
    assert.equal(kit.assets.length, 8);
    for (const a of kit.assets) {
      const bytes = readFileSync(
        new URL("../internal/studio-kits/" + a.assetPath, import.meta.url),
      );
      assert.equal(createHash("sha256").update(bytes).digest("hex"), a.sha256);
      assert.equal(a.sourceRecipeSha256, recipeHash);
      assert.equal(a.commercialUse, true);
      assert.equal(a.rawRedistribution, true);
      assert.equal(a.licenseId, "CC0-1.0");
      assert.equal(bytes.readUInt16LE(22), 1);
      assert.equal(bytes.readUInt32LE(24), 48000);
      assert.equal(bytes.readUInt32LE(40), a.frames * 2);
      let peak = 0;
      for (let i = 44; i < bytes.length; i += 2)
        peak = Math.max(peak, Math.abs(bytes.readInt16LE(i)) / 32767);
      assert.ok(peak > 0 && peak <= 0.431);
      hashes.add(a.sha256);
    }
  }
  assert.equal(hashes.size, 16);
});
test("Studio catalog refuses duplicate slots, missing redistribution permission and unexpected source paths", () => {
  for (const edit of [
    (c) => (c.kits[1].id = c.kits[0].id),
    (c) => (c.kits[0].assets[0].rawRedistribution = false),
    (c) => (c.kits[0].assets[0].assetPath = "https://unknown.invalid/one.wav"),
    (c) => (c.kits[0].assets[0].frames = 10),
    (c) => (c.kits[0].assets[1].id = "kick"),
  ]) {
    const m = structuredClone(manifest);
    edit(m);
    assert.throws(() => validateStudioCatalog(m));
  }
});
test("Studio analytics follows the existing production-only narrow event contract", () => {
  const calls = [];
  createEventTracker(true, (...a) => calls.push(a))("studio_open", {
    music: "never forwarded",
  });
  assert.deepEqual(calls, [["event", "studio_open", {}]]);
  createEventTracker(false, (...a) => calls.push(a))("studio_open");
  assert.equal(calls.length, 1);
});
test("Studio bilingual keys have full parity and all essential sound/workflow controls have meaningful copy", () => {
  assert.deepEqual(
    Object.keys(studioMessages.id).sort(),
    Object.keys(studioMessages.en).sort(),
  );
  assert.ok(
    Object.values(studioMessages.id).every(
      (x) => typeof x === "string" && x.trim(),
    ),
  );
  assert.ok(
    Object.values(studioMessages.en).every(
      (x) => typeof x === "string" && x.trim(),
    ),
  );
  assert.equal(emptyPattern().steps.kick.length, 16);
});
