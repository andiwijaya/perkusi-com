import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ProjectStore, PROJECTS_KEY } from "../src/project/store.js";
import { validateProject } from "../src/project/schema.js";
import { encodeWav } from "../src/audio/wav.js";

const catalog = JSON.parse(
  readFileSync(
    new URL("../internal/original-groove/manifest.json", import.meta.url),
    "utf8",
  ),
);
const project = (title = "Saved project", role = "kick") => ({
  format: "perkusi-project",
  schemaVersion: 1,
  mode: "beatbox",
  title,
  pack: { id: catalog.packId, version: catalog.version },
  timing: { bpm: 96, meter: [4, 4] },
  master: { volume: 0.65 },
  tracks: catalog.roleOrder.map((r) => ({
    role: r,
    enabled: r === role,
    variant: 1,
  })),
  export: { bars: 4 },
});
const error = (code) => (e) => e.code === code;
const fixture = (items) => {
  let text = JSON.stringify({ version: 1, items }, null, 2);
  let writes = 0;
  const storage = {
    getItem: (key) => (key === PROJECTS_KEY ? text : null),
    setItem: (key, value) => {
      assert.equal(key, PROJECTS_KEY);
      text = value;
      writes++;
    },
  };
  return { storage, text: () => text, writes: () => writes };
};

test("malformed and duplicate internal IDs reject whole stores without rewriting legitimate records", () => {
  const good = {
    id: "19fb0771-28ac-49f4-8f33-7748e7a04a21",
    project: project("Keep me"),
  };
  const malformed = [
    null,
    1,
    0,
    true,
    false,
    ["1"],
    [],
    {},
    "",
    "a".repeat(65),
    "BAD",
    "a/b",
  ];
  const cases = malformed.map((id) => [
    good,
    { id, project: project("Malformed") },
  ]);
  cases.push(
    [
      good,
      { id: 1, project: project("Numeric") },
      { id: "1", project: project("String") },
    ],
    [
      good,
      { id: "1", project: project("First") },
      { id: "1", project: project("Second") },
    ],
    [good, { ...good, project: project("Duplicate UUID") }],
  );
  for (const items of cases) {
    const f = fixture(items),
      before = f.text();
    const store = new ProjectStore(
      catalog,
      () => f.storage,
      () => "new-id",
    );
    for (const action of [
      () => store.read(),
      () => store.load(good.id),
      () => store.remove(good.id),
      () => store.save(project()),
    ])
      assert.throws(action, error("storageUnavailable"));
    assert.equal(f.text(), before);
    assert.equal(f.writes(), 0);
  }
});

test("generated IDs must be unique primitive strings; failed saves retain exact stored bytes", () => {
  const good = { id: "1", project: project("Existing") };
  for (const id of [
    null,
    1,
    true,
    false,
    ["2"],
    [],
    {},
    new String("new-id"),
    "1",
    "",
    "a".repeat(65),
  ]) {
    const f = fixture([good]),
      before = f.text();
    const store = new ProjectStore(
      catalog,
      () => f.storage,
      () => id,
    );
    assert.throws(
      () => store.save(project("New")),
      error("storageUnavailable"),
    );
    assert.equal(f.text(), before);
    assert.equal(f.writes(), 0);
  }
});

test("distinct string IDs load and delete exactly the selected record without aliases", () => {
  const entries = [
    { id: "1", project: project("First", "kick") },
    { id: "01", project: project("Second", "snare") },
    {
      id: "19fb0771-28ac-49f4-8f33-7748e7a04a21",
      project: project("UUID", "hat"),
    },
    { id: "a".repeat(64), project: project("Maximum ID", "hum") },
  ];
  const f = fixture(entries),
    store = new ProjectStore(catalog, () => f.storage);
  for (const entry of entries)
    assert.deepEqual(store.load(entry.id), entry.project);
  const before = f.text();
  for (const id of [1, null, true, ["1"], new String("1")]) {
    assert.throws(() => store.load(id), error("missingProject"));
    assert.throws(() => store.remove(id), error("missingProject"));
  }
  assert.equal(f.text(), before);
  store.remove("01");
  assert.deepEqual(
    store.read(),
    entries.filter((x) => x.id !== "01"),
  );
  store.remove(entries[2].id);
  assert.deepEqual(store.read(), [entries[0], entries[3]]);
});

const audio = (samples) => {
  const pcm = Float32Array.from(samples);
  return {
    numberOfChannels: 1,
    length: pcm.length,
    sampleRate: 48000,
    getChannelData: () => pcm,
  };
};
const fast = { yieldTask: async () => {} };
// Adjacent Float32 values bracket the positive and negative half-LSB boundary.
const belowHalfLSB = new Float32Array([0.5 / 32767]);
const aboveHalfLSB = new Float32Array(belowHalfLSB);
new Uint32Array(aboveHalfLSB.buffer)[0]++;
assert(belowHalfLSB[0] < 0.5 / 32767);
assert(aboveHalfLSB[0] > 0.5 / 32767);
test("positive and negative float energy below PCM16 quantization threshold never publishes a silent WAV", async () => {
  const threshold = 0.5 / 32767;
  for (const samples of [
    [1e-6],
    [-1e-6],
    [threshold * 0.999, -threshold * 0.999],
    [belowHalfLSB[0], -belowHalfLSB[0]],
    Array(65537).fill(1e-6),
  ]) {
    assert(samples.some((x) => x !== 0));
    await assert.rejects(encodeWav(audio(samples), fast), error("emptyMix"));
  }
});

test("PCM16 threshold accepts one quantized sample and preserves its exact level without normalization", async () => {
  const threshold = 0.5 / 32767;
  for (const samples of [
    [threshold * 1.001],
    [-threshold * 1.001],
    [1e-6, 0, threshold * 1.001],
    [aboveHalfLSB[0]],
    [-aboveHalfLSB[0]],
  ]) {
    const buffer = audio(samples),
      result = await encodeWav(buffer, fast);
    const bytes = new DataView(await result.blob.arrayBuffer());
    let nonzero = 0;
    for (let i = 0; i < samples.length; i++) {
      const expected = Math.round(buffer.getChannelData(0)[i] * 32767);
      assert.equal(bytes.getInt16(44 + i * 2, true), expected);
      if (expected !== 0) {
        nonzero++;
        assert.equal(Math.abs(expected), 1);
      }
    }
    assert(nonzero > 0);
    assert.equal(
      result.peak,
      Math.max(...buffer.getChannelData(0).map(Math.abs)),
    );
  }
});

test("quantization silence check keeps cancellation and finite/output guards authoritative", async () => {
  const abort = new AbortController();
  await assert.rejects(
    encodeWav(audio([1e-6]), {
      signal: abort.signal,
      yieldTask: async () => abort.abort(),
    }),
    error("cancelled"),
  );
  for (const samples of [
    [1e-6, NaN],
    [1e-6, Infinity],
    [1e-6, 0.96],
  ])
    await assert.rejects(
      encodeWav(audio(samples), fast),
      error("unsafeOutput"),
    );
});

test("subquantization volume remains valid portable user intent instead of being silently raised", () => {
  const p = project();
  p.master.volume = 0.000001;
  assert.equal(validateProject(p, catalog).master.volume, p.master.volume);
});
