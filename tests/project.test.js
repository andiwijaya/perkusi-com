import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PROJECT_FORMAT,
  validateProject,
  parseProject,
  serializeProject,
  cleanTitle,
  MAX_PROJECT_BYTES,
  migrateProject,
} from "../src/project/schema.js";
import { ProjectStore, PROJECTS_KEY, DRAFT_KEY } from "../src/project/store.js";
import {
  captureBeatboxProject,
  applyBeatboxProject,
} from "../src/project/beatbox-model.js";
import {
  safeFilename,
  readProjectFile,
  FileDelivery,
} from "../src/project/files.js";
import { projectMessages } from "../src/project/messages.js";
import { encodeWav, wavHeader } from "../src/audio/wav.js";
import { exportBudget, OfflineWavExporter } from "../src/audio/exporter.js";
import { createEventTracker } from "../src/analytics.js";
const catalog = JSON.parse(
  readFileSync(
    new URL("../internal/original-groove/manifest.json", import.meta.url),
    "utf8",
  ),
);
test("cancelled export retains single-job ownership until uninterruptible native decodes settle", async () => {
  const pending = [];
  const context = {
    decodeAudioData: () => new Promise((resolve) => pending.push(resolve)),
  };
  const pack = {
    schemaVersion: 1,
    id: catalog.packId,
    bpm: 96,
    beatsPerBar: 4,
    bars: 2,
    stems: catalog.roleOrder.map((id) => ({
      id,
      variant: 1,
      gainTrim: 0.1,
      url: "/official.wav",
      licenseId: "CC0",
    })),
  };
  const exporter = new OfflineWavExporter({
    catalog,
    packForSelection: () => pack,
    contextFactory: () => context,
    bankOptions: {
      fetcher: async () => ({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(1),
      }),
    },
  });
  const promise = exporter.render(project());
  while (pending.length < 3)
    await new Promise((resolve) => setImmediate(resolve));
  exporter.cancel();
  await new Promise((resolve) => setImmediate(resolve));
  assert(exporter.active);
  await assert.rejects(exporter.render(project()), error("exportBusy"));
  for (const resolve of pending) resolve({});
  await assert.rejects(promise, error("cancelled"));
  assert.equal(exporter.active, null);
});
const project = () => ({
  format: PROJECT_FORMAT,
  schemaVersion: 1,
  mode: "beatbox",
  title: "Irama pagi",
  pack: { id: catalog.packId, version: catalog.version },
  timing: { bpm: 96, meter: [4, 4] },
  master: { volume: 0.65 },
  tracks: catalog.roleOrder.map((role, i) => ({
    role,
    enabled: i % 2 === 0,
    variant: (i % 2) + 1,
  })),
  export: { bars: 8 },
});
const error = (code) => (e) => e.code === code;
test("project canonical round trip preserves all six distinct roles, variants, volume and exact official pack", () => {
  const p = project();
  assert.deepEqual(parseProject(serializeProject(p, catalog), catalog), p);
  const reversed = { ...p, tracks: [...p.tracks].reverse() };
  assert.deepEqual(validateProject(reversed, catalog), p);
  const v = validateProject(p, catalog);
  v.tracks[0].enabled = false;
  assert(p.tracks[0].enabled);
});
test("malformed, oversized UTF8, unknown versions/packs/modes and unsafe extra fields reject", () => {
  assert.throws(() => parseProject("{", catalog), error("invalidProject"));
  assert.throws(
    () => parseProject("é".repeat(MAX_PROJECT_BYTES), catalog),
    error("projectTooLarge"),
  );
  for (const [mutate, code] of [
    [(p) => (p.schemaVersion = 2), "unsupportedVersion"],
    [(p) => (p.mode = "studio"), "unsupportedMode"],
    [(p) => (p.pack.id = "https://evil.invalid/"), "unknownPack"],
    [(p) => (p.pack.version = "9.0.0"), "unknownPack"],
    [(p) => (p.assetURL = "javascript:alert(1)"), "invalidProject"],
    [(p) => (p.master.volume = 0.76), "invalidProject"],
    [(p) => (p.master.volume = NaN), "invalidProject"],
    [(p) => (p.timing.bpm = 120), "invalidProject"],
    [(p) => (p.tracks[1].role = p.tracks[0].role), "invalidProject"],
    [(p) => (p.tracks[0].variant = 9), "invalidProject"],
    [(p) => (p.tracks[0].enabled = 1), "invalidProject"],
    [(p) => (p.export.bars = 16), "invalidProject"],
  ]) {
    const p = project();
    mutate(p);
    assert.throws(() => validateProject(p, catalog), error(code));
  }
  assert.throws(
    () =>
      parseProject(
        JSON.stringify(project()).replace(
          '"title":',
          '"__proto__":{},"title":',
        ),
        catalog,
      ),
    error("invalidProject"),
  );
});
test("explicit version zero migration retains role state and rejects unknown or executable fields", () => {
  const p = project(),
    legacy = {
      format: p.format,
      schemaVersion: 0,
      title: p.title,
      packId: p.pack.id,
      packVersion: p.pack.version,
      bpm: 96,
      volume: 0.65,
      layers: Object.fromEntries(p.tracks.map(({ role, ...s }) => [role, s])),
      exportBars: 8,
    };
  assert.deepEqual(migrateProject(legacy, catalog), p);
  assert.throws(
    () => migrateProject({ ...legacy, url: "data:evil" }, catalog),
    error("invalidProject"),
  );
});
test("title sanitization and filenames preserve display text without introducing URLs or paths", () => {
  assert.equal(cleanTitle("  <Beat>\u0000\u202epagi  "), "Beatpagi");
  assert.throws(() => cleanTitle(" ".repeat(2)), error("invalidTitle"));
  assert.throws(() => cleanTitle("a".repeat(81)), error("invalidTitle"));
  for (const name of [
    "../evil",
    "javascript:alert(1)",
    "😀",
    "CON",
    "https://evil.invalid/?a=b",
  ])
    assert.match(
      safeFilename(name, "perkusi.json"),
      /^[a-zA-Z0-9_-]+\.perkusi\.json$/,
    );
  assert.throws(() => safeFilename("x", "exe"));
  assert.equal(safeFilename("CON", "perkusi.json"), "perkusi-CON.perkusi.json");
  assert.equal(safeFilename("lpt1", "wav"), "perkusi-lpt1.wav");
});
test("file import checks extension and size before reading and reports native read failure", async () => {
  let reads = 0;
  await assert.rejects(
    readProjectFile(
      { name: "audio.wav", size: 1, text: () => reads++ },
      catalog,
    ),
    error("invalidProject"),
  );
  await assert.rejects(
    readProjectFile(
      {
        name: "x.perkusi.json",
        size: MAX_PROJECT_BYTES + 1,
        text: () => reads++,
      },
      catalog,
    ),
    error("projectTooLarge"),
  );
  assert.equal(reads, 0);
  await assert.rejects(
    readProjectFile(
      {
        name: "x.perkusi.json",
        size: 2,
        text: async () => {
          throw Error();
        },
      },
      catalog,
    ),
    error("fileReadFailed"),
  );
  assert.deepEqual(
    await readProjectFile(
      new File([serializeProject(project(), catalog)], "x.perkusi.json"),
      catalog,
    ),
    project(),
  );
});
const storage = () => {
  const m = new Map();
  return {
    m,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => m.set(k, v),
  };
};
test("local store refresh/load/delete/draft round trips atomically with unique IDs and bounded capacity", () => {
  const s = storage();
  let id = 0;
  const store = new ProjectStore(
      catalog,
      () => s,
      () => `id-${++id}`,
    ),
    p = project();
  const key = store.save(p);
  assert.deepEqual(new ProjectStore(catalog, () => s).load(key), p);
  store.saveDraft(p);
  assert.deepEqual(store.readDraft(), p);
  store.remove(key);
  assert.deepEqual(store.read(), []);
  for (let i = 0; i < 30; i++) store.save(p);
  const before = s.getItem(PROJECTS_KEY);
  assert.throws(() => store.save(p), error("storageFull"));
  assert.equal(s.getItem(PROJECTS_KEY), before);
  assert.throws(() => store.load("missing"), error("missingProject"));
});
test("denied/corrupt/low-quota storage is explicit and preserved, never substituted with fake success", () => {
  const s = storage(),
    store = new ProjectStore(
      catalog,
      () => s,
      () => "a",
    );
  s.setItem(PROJECTS_KEY, "corrupt");
  assert.throws(() => store.save(project()), error("storageUnavailable"));
  assert.equal(s.getItem(PROJECTS_KEY), "corrupt");
  s.setItem(DRAFT_KEY, "corrupt");
  assert.throws(() => store.readDraft(), error("storageUnavailable"));
  const denied = new ProjectStore(catalog, () => {
    throw Error("denied");
  });
  assert.throws(() => denied.read(), error("storageUnavailable"));
  const quota = storage();
  quota.setItem = () => {
    throw Error("quota");
  };
  assert.throws(
    () =>
      new ProjectStore(
        catalog,
        () => quota,
        () => "a",
      ).save(project()),
    error("storageUnavailable"),
  );
});
test("capture/apply preserves user intent without playback; invalid input cannot mutate engine", async () => {
  const p = project(),
    calls = [];
  const engine = {
    volume: 0.65,
    enabled: new Map(p.tracks.map((t) => [t.role, t.enabled])),
    selectedVariant: new Map(p.tracks.map((t) => [t.role, t.variant])),
    reset: () => calls.push("reset"),
    setVolume: (v) => calls.push(v),
    setVariation: (...a) => calls.push(a),
    setLayer: (...a) => calls.push(a),
  };
  assert.deepEqual(captureBeatboxProject(engine, catalog, p.title, 8), p);
  await applyBeatboxProject(engine, p, catalog);
  assert.equal(calls[0], "reset");
  assert.equal(calls.length, 14);
  const before = calls.length;
  assert.throws(() =>
    applyBeatboxProject(
      engine,
      { ...p, pack: { id: "evil", version: "1" } },
      catalog,
    ),
  );
  assert.equal(calls.length, before);
});
test("WAV mono PCM16 headers, sample lengths and mix quantization are exact", async () => {
  const pcm = Float32Array.from([0, 0.5, -0.5, 0.9, -0.9]);
  const result = await encodeWav(
    {
      numberOfChannels: 1,
      length: 5,
      sampleRate: 48000,
      getChannelData: () => pcm,
    },
    { yieldTask: async () => {} },
  );
  const bytes = await result.blob.arrayBuffer(),
    d = new DataView(bytes);
  assert.equal(bytes.byteLength, 54);
  assert.equal(d.getUint32(4, true), 46);
  assert.equal(d.getUint16(22, true), 1);
  assert.equal(d.getUint32(24, true), 48000);
  assert.equal(d.getUint32(40, true), 10);
  for (let i = 0; i < 5; i++)
    assert.equal(d.getInt16(44 + i * 2, true), Math.round(pcm[i] * 32767));
  assert.throws(() => wavHeader(960001, 48000));
});
test("WAV invalid/nonfinite/silent render and encode cancellation are bounded with no publication", async () => {
  const make = (x) => ({
    numberOfChannels: 1,
    length: x.length,
    sampleRate: 48000,
    getChannelData: () => Float32Array.from(x),
  });
  for (const x of [[0, 0], [NaN], [1]])
    await assert.rejects(
      encodeWav(make(x)),
      error(x[0] === 0 ? "emptyMix" : "unsafeOutput"),
    );
  const abort = new AbortController();
  await assert.rejects(
    encodeWav(make([0.1, 0.2]), {
      signal: abort.signal,
      yieldTask: async () => abort.abort(),
    }),
    error("cancelled"),
  );
});
test("export budget has exact 4/8-bar duration and refuses empty/zero-volume/unsafe memory before allocation", async () => {
  const p = project();
  assert.equal(exportBudget(p, catalog).frames, 960000);
  assert.equal(
    exportBudget({ ...p, export: { bars: 4 } }, catalog).frames,
    480000,
  );
  assert.throws(
    () => exportBudget(p, catalog, 32 * 1024 * 1024),
    error("exportLimit"),
  );
  assert.throws(
    () => exportBudget({ ...p, master: { volume: 0 } }, catalog),
    error("emptyMix"),
  );
  assert.throws(
    () =>
      exportBudget(
        { ...p, tracks: p.tracks.map((t) => ({ ...t, enabled: false })) },
        catalog,
      ),
    error("emptyMix"),
  );
  let allocations = 0;
  const e = new OfflineWavExporter({
    catalog,
    retainedBytes: () => 32 * 1024 * 1024,
    contextFactory: () => allocations++,
  });
  await assert.rejects(e.render(p), error("exportLimit"));
  assert.equal(allocations, 0);
  assert.equal(e.active, null);
});
test("new project dictionaries have complete parity and privacy/analytics never send musical content", () => {
  assert.deepEqual(
    Object.keys(projectMessages.id).sort(),
    Object.keys(projectMessages.en).sort(),
  );
  for (const locale of ["id", "en"])
    assert(
      Object.values(projectMessages[locale]).every(
        (v) => typeof v === "string" && v.length,
      ),
    );
  const sent = [],
    track = createEventTracker(true, (...x) => sent.push(x));
  for (const name of ["project_saved", "export_succeeded", "export_failed"])
    track(name, { title: "private", file: "private", tracks: [1] });
  assert.deepEqual(sent, [
    ["event", "project_saved", {}],
    ["event", "export_succeeded", {}],
    ["event", "export_failed", { category: "other" }],
  ]);
});
test("file delivery checks exact capability, honors share cancellation, falls back and releases object URLs", async () => {
  const revoked = [],
    links = [],
    timers = new Map();
  let tick = 0;
  const deps = {
    url: {
      createObjectURL: () => `blob:test-${++tick}`,
      revokeObjectURL: (u) => revoked.push(u),
    },
    document: {
      body: { append: () => {} },
      createElement: () => {
        const a = { click: () => links.push(a.download), remove: () => {} };
        return a;
      },
    },
    navigator: {},
    timers: {
      setTimeout: (fn) => {
        timers.set(tick, fn);
        return tick;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  };
  const d = new FileDelivery(deps),
    file = new File([new Uint8Array(50)], "beat.wav", { type: "audio/wav" });
  assert.equal(await d.share(file), "shareFallback");
  assert.equal(links.length, 1);
  d.navigator = {
    canShare: () => true,
    share: async () => {
      throw Object.assign(Error(), { name: "AbortError" });
    },
  };
  assert.equal(await d.share(file), "shareCancelled");
  assert.equal(links.length, 1);
  d.navigator.share = async () => {
    throw Error("blocked");
  };
  assert.equal(await d.share(file), "shareFallback");
  d.navigator.share = async () => {};
  assert.equal(await d.share(file), "shared");
  d.navigator.canShare = () => {
    throw Error();
  };
  assert.equal(d.canShare(file), false);
  assert.throws(() => d.download(file, "../../evil.wav"));
  d.dispose();
  assert.equal(d.urls.size, 0);
  assert.equal(timers.size, 0);
  assert.equal(revoked.length, 2);
});
