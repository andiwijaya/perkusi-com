import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { originalRegistry as original } from "../src/project/original-registry.js";
import { compositionRegistry as catalog } from "../src/project/studio-registry.js";
import {
  parseProject,
  migrateProject,
  serializeProject,
  validateProject,
} from "../src/project/schema.js";
import {
  fromBeatbox,
  toBeatbox,
  reverseReasons,
  compositionDemo,
  newComposition,
  mixedStudioView,
  editCompositionClip,
  newCompositionClip,
  CLIP_ROLES,
} from "../src/project/composition-model.js";
import { studioDemo, ProjectHistory } from "../src/project/studio-model.js";
import {
  prepareTransfer,
  incomingTransfer,
  transferReceiptKey,
  MAX_TRANSFER_RECEIPT_BYTES,
} from "../src/project/mode-transfer.js";
import { CompositionStore } from "../src/project/composition-store.js";
import {
  compositionExportExtras,
  compositionNote,
} from "../src/audio/composition.js";
import { studioExportBudget } from "../src/audio/studio-exporter.js";
import { compositionMessages } from "../src/studio/composition-panel.js";
import { createEventTracker } from "../src/analytics.js";
const beatbox = (variant = 1, bars = 4) => ({
  format: "perkusi-project",
  schemaVersion: 1,
  mode: "beatbox",
  title: "Bumi portable",
  pack: { id: original.packId, version: original.version },
  timing: { bpm: 96, meter: [4, 4] },
  master: { volume: 0.65 },
  tracks: original.roleOrder.map((role, i) => ({
    role,
    enabled: i % 2 === 0,
    variant,
  })),
  export: { bars },
});
function storage() {
  const memory = new Map();
  return {
    memory,
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => memory.set(k, v),
    removeItem: (k) => memory.delete(k),
  };
}
test("V0/V1/V1.1 and V2 migrate into a strict canonical composition; old parser remains backward compatible", () => {
  for (const v of [1, 2])
    for (const bars of [4, 8]) {
      const bb = beatbox(v, bars),
        p = migrateProject(bb, catalog);
      assert.deepEqual(toBeatbox(p), bb);
      assert.deepEqual(reverseReasons(p), []);
      assert.equal(p.clipPack.processing, "bumi-presence-v1");
      assert.deepEqual(parseProject(serializeProject(p, catalog), catalog), p);
      assert.deepEqual(
        parseProject(serializeProject(p, catalog), original),
        bb,
      );
    }
  const bb = beatbox();
  const old = {
    format: bb.format,
    schemaVersion: 0,
    title: bb.title,
    packId: bb.pack.id,
    packVersion: bb.pack.version,
    bpm: 96,
    volume: bb.master.volume,
    layers: Object.fromEntries(bb.tracks.map(({ role, ...t }) => [role, t])),
    exportBars: 4,
  };
  assert.deepEqual(toBeatbox(migrateProject(old, catalog)), bb);
  const v2 = studioDemo("arus");
  const p = migrateProject(v2, catalog);
  assert.deepEqual(mixedStudioView(p), v2);
  assert.ok(p.patterns.every((a) => a.notes.length === 16));
  assert.deepEqual(p.clips, []);
});
test("Hostile, corrupt, oversized, unknown and unsupported compositions never coerce or drop data", () => {
  const mutations = [
    (p) => p.clips.push({ ...p.clips[0] }),
    (p) => (p.clips[0].variant = 9),
    (p) => (p.clips[0].volume = -1),
    (p) => (p.clips[0].pan = Infinity),
    (p) => (p.clips[0].enabled = "true"),
    (p) => (p.clipPack.processing = "raw"),
    (p) => (p.clipPack.url = "https://invalid.invalid"),
    (p) => (p.timing.bpm = 120),
    (p) => (p.instrument.id = "remote"),
    (p) => (p.instrument.volume = NaN),
    (p) => (p.patterns[0].notes[0] = { pitch: "c1", velocity: 1 }),
    (p) => (p.patterns[0].notes[0] = { pitch: "d4", velocity: 0 }),
    (p) => p.patterns[0].notes.push(null),
    (p) =>
      (p.patterns[0].notes[0] = { pitch: "d4", velocity: 1, url: "secret" }),
    (p) => (p.patterns[0].steps.__proto__ = { polluted: true }),
    (p) => (p.schemaVersion = 99),
  ];
  for (const mutation of mutations) {
    const p = fromBeatbox(beatbox());
    mutation(p);
    assert.throws(() => validateProject(p, catalog));
    if (Object.getPrototypeOf(p.patterns[0].steps) === Object.prototype)
      assert.throws(() => parseProject(JSON.stringify(p), original));
  }
  assert.throws(
    () => parseProject(" ".repeat(65537), catalog),
    (e) => e.code === "projectTooLarge",
  );
});
test("Incompatible reverse explains every affected musical class and derived copy never mutates the original", () => {
  const p = compositionDemo("fusion");
  p.timing.swing = 0.2;
  p.clips[0].pan = 0.4;
  const before = JSON.stringify(p);
  assert.deepEqual(
    new Set(reverseReasons(p)),
    new Set(["kit", "tempo", "arrangement", "drums", "notes", "mix"]),
  );
  assert.throws(
    () => toBeatbox(p),
    (e) => e.code === "needsConversion",
  );
  const derived = toBeatbox(p, true);
  assert.equal(derived.timing.bpm, 96);
  assert.equal(JSON.stringify(p), before);
  assert.ok(derived.tracks.some((t) => t.enabled));
  const pure = newComposition();
  assert.ok(!toBeatbox(pure, true).tracks.some((t) => t.enabled));
});
test("Mode transfer archives every distinct original across repeated switching and applies only the matching session marker", () => {
  const local = storage(),
    session = storage();
  let next = 0;
  for (let i = 0; i < 20; i++) {
    const source = i % 2 ? compositionDemo("fusion") : beatbox();
    source.title = "Project " + i;
    const target = i % 2 ? "beatbox" : "studio";
    prepareTransfer(source, target, {
      storage: local,
      session,
      makeId: () => `transfer-${++next}`,
    });
    assert.equal(
      incomingTransfer(target === "studio" ? "beatbox" : "studio", local, {
        getItem: () => null,
      }),
      null,
    );
    const incoming = incomingTransfer(target, local, session);
    assert.equal(incoming.project.title, source.title);
    incoming.acknowledge();
    assert.equal(session.getItem("perkusi.mode-transfer.pending.v3"), null);
  }
  const record = JSON.parse(local.getItem("perkusi.mode-transfer.v3"));
  assert.equal(record.originals.length, 20);
  assert.equal(record.originals[1].title, "Project 1");
  assert.ok(record.originals[1].patterns[0].notes.some(Boolean));
  session.setItem("perkusi.mode-transfer.pending.v3", "wrong-id");
  assert.throws(() => incomingTransfer("studio", local, session));
});
test("Failed or denied storage preserves existing transfer bytes and source; corrupted record cannot be overwritten", () => {
  const local = storage(),
    session = storage(),
    source = beatbox();
  prepareTransfer(source, "studio", {
    storage: local,
    session,
    makeId: () => "first",
  });
  const raw = local.getItem("perkusi.mode-transfer.v3");
  const denied = {
    ...session,
    setItem() {
      throw Error("denied");
    },
  };
  assert.throws(() =>
    prepareTransfer(compositionDemo("fusion"), "beatbox", {
      storage: local,
      session: denied,
      makeId: () => "second",
    }),
  );
  assert.equal(local.getItem("perkusi.mode-transfer.v3"), raw);
  local.setItem("perkusi.mode-transfer.v3", "corrupt raw bytes");
  assert.throws(() =>
    prepareTransfer(source, "studio", {
      storage: local,
      session,
      makeId: () => "third",
    }),
  );
  assert.equal(local.getItem("perkusi.mode-transfer.v3"), "corrupt raw bytes");
});
test("V3 saves migrate old projects as copies and preserve legacy stored bytes on save/delete/reload", () => {
  const local = storage(),
    old = studioDemo("arus"),
    raw = JSON.stringify({ version: 1, items: [{ id: "old", project: old }] });
  local.setItem("perkusi.projects.studio.v2", raw);
  local.setItem("perkusi.draft.studio.v2", JSON.stringify(old));
  const store = new CompositionStore(
    catalog,
    () => local,
    () => "new",
  );
  assert.equal(store.read()[0].id, "legacy0-old");
  assert.equal(store.readDraft().schemaVersion, 3);
  store.save(store.load("legacy0-old"));
  assert.equal(local.getItem("perkusi.projects.studio.v2"), raw);
  assert.throws(
    () => store.remove("legacy0-old"),
    (e) => e.code === "legacyOriginal",
  );
  store.remove("new");
  assert.equal(local.getItem("perkusi.projects.studio.v2"), raw);
});
test("Three editable demos have distinct arrangements, a meaningful instrument and bounded mixed WAV budgets", () => {
  const extras = compositionExportExtras({});
  const projects = ["fusion", "malam", "bumi"].map((kind) =>
    validateProject(compositionDemo(kind), catalog),
  );
  assert.equal(
    new Set(projects.map((p) => JSON.stringify(p.patterns))).size,
    3,
  );
  for (const p of projects) {
    assert.equal(p.patterns.length, 4);
    assert.equal(p.chain.length, 4);
    assert.ok(p.patterns.every((a) => a.notes.some(Boolean)));
    const b = studioExportBudget(p, catalog, 0, extras.budget(p));
    assert.equal(b.frames, Math.round(((16 * 60) / p.timing.bpm) * 48000));
    assert.ok(b.bytes < 32 * 1024 * 1024);
    const history = new ProjectHistory(p, (p) => validateProject(p, catalog));
    history.edit((x) => (x.patterns[0].notes[0] = null));
    assert.equal(history.undo(), true);
    assert.deepEqual(history.current, p);
    assert.equal(compositionNote(p, 16).pitch, p.patterns[1].notes[0].pitch);
  }
  const p = fromBeatbox(beatbox());
  p.clips[0].solo = true;
  assert.ok(mixedStudioView(p).tracks.every((t) => t.mute));
  assert.ok(studioExportBudget(p, catalog, 0, extras.budget(p)).frames > 0);
  p.clips.forEach((c) => (c.mute = true));
  assert.throws(
    () => studioExportBudget(p, catalog, 0, extras.budget(p)),
    (e) => e.code === "emptyMix",
  );
});
test("Every original expansion asset has exact RIFF geometry, source recipe, raw redistribution rights and reproducible hash", () => {
  const m = JSON.parse(
      readFileSync("internal/v3-sounds/manifest.json", "utf8"),
    ),
    assets = [...m.kits[0].assets, ...m.instrument.assets],
    recipe = createHash("sha256")
      .update(readFileSync("scripts/make-v3-sounds.py"))
      .digest("hex");
  assert.equal(assets.length, 13);
  const hashes = new Set();
  for (const a of assets) {
    const data = readFileSync("internal/v3-sounds/" + a.assetPath);
    assert.equal(createHash("sha256").update(data).digest("hex"), a.sha256);
    assert.equal(a.sourceRecipeSha256, recipe);
    assert.equal(data.toString("ascii", 0, 4), "RIFF");
    assert.equal(data.readUInt32LE(24), 48000);
    assert.equal(data.readUInt16LE(22), 1);
    assert.equal(data.length, 44 + a.frames * 2);
    assert.equal(a.commercialUse, true);
    assert.equal(a.rawRedistribution, true);
    assert.equal(a.licenseId, "CC0-1.0");
    assert.equal(a.attributionRequired, false);
    hashes.add(a.sha256);
  }
  assert.equal(hashes.size, 13);
  assert.equal(m.listening, "UNVERIFIED");
});
test("V3 messages have ID/EN parity and conversion analytics strips all composition data", () => {
  assert.deepEqual(
    Object.keys(compositionMessages.id).sort(),
    Object.keys(compositionMessages.en).sort(),
  );
  const sent = [];
  const tracker = createEventTracker(true, (...a) => sent.push(a));
  tracker("beatbox_to_studio", { secret: "title", notes: "d4" });
  assert.deepEqual(sent, [["event", "beatbox_to_studio", {}]]);
  createEventTracker(false, (...a) => sent.push(a))("beatbox_to_studio");
  assert.equal(sent.length, 1);
});

test("Even inaudible Studio settings and pattern names require an explicit derived-copy explanation", () => {
  const base = fromBeatbox(beatbox());
  for (const [mutate, reason] of [
    [(p) => (p.pack.id = "arus"), "kit"],
    [(p) => (p.patterns[0].name = "Named idea"), "arrangement"],
    [(p) => (p.tracks[0].volume = 0.4), "mix"],
    [(p) => (p.instrument.pan = 0.5), "mix"],
    [(p) => (p.timing.quantize = false), "arrangement"],
  ]) {
    const p = structuredClone(base);
    mutate(p);
    assert.ok(reverseReasons(p).includes(reason));
    assert.throws(
      () => toBeatbox(p),
      (e) => e.code === "needsConversion",
    );
  }
});

test("A derived Beatbox copy respects the global solo mix and cannot resurrect inaudible loops", () => {
  for (const soloRole of ["instrument", "drum"]) {
    const p = fromBeatbox(beatbox());
    if (soloRole === "instrument") p.instrument.solo = true;
    else p.tracks[0].solo = true;
    assert.equal(toBeatbox(p, true).tracks.filter((t) => t.enabled).length, 0);
    assert.ok(reverseReasons(p).includes("mix"));
  }
});

test("Every supported partial clip cardinality edits omitted roles without changing existing intent; invalid edits are atomic", () => {
  for (const count of [0, 1, 2, 5, 6])
    for (const [field, value] of [
      ["enabled", true],
      ["variant", 2],
      ["volume", 0.35],
      ["pan", -0.4],
      ["mute", true],
      ["solo", true],
    ]) {
      const p = fromBeatbox(beatbox());
      p.clips = p.clips.slice(0, count);
      if (p.clips[0])
        Object.assign(p.clips[0], { variant: 2, volume: 0.37, pan: -0.25 });
      if (count === 6) p.clips.find((c) => c.role === "hum").enabled = false;
      const before = structuredClone(p),
        role = count === 6 ? "hum" : CLIP_ROLES[count];
      const history = new ProjectHistory(p, (x) => validateProject(x, catalog));
      history.edit((x) => editCompositionClip(x, role, field, value));
      const after = history.current;
      assert.equal(after.clips.find((c) => c.role === role)[field], value);
      for (const c of before.clips.filter((c) => c.role !== role))
        assert.deepEqual(
          after.clips.find((x) => x.role === c.role),
          c,
        );
      assert.deepEqual(after.patterns, before.patterns);
      assert.deepEqual(after.tracks, before.tracks);
      if (field !== "enabled" && count < 6)
        assert.equal(after.clips.find((c) => c.role === role).enabled, false);
      assert.deepEqual(
        parseProject(serializeProject(after, catalog), catalog),
        after,
      );
      assert.equal(history.undo(), true);
      assert.deepEqual(history.current, before);
      assert.equal(history.redo(), true);
      assert.deepEqual(
        toBeatbox(fromBeatbox(toBeatbox(after, true))),
        toBeatbox(after, true),
      );
    }
  const p = newComposition(),
    raw = JSON.stringify(p);
  for (const [role, field, value] of [
    ["unknown", "enabled", true],
    ["hum", "url", "https://invalid"],
    ["hum", "enabled", "true"],
    ["hum", "volume", 2],
    ["hum", "pan", NaN],
    ["hum", "variant", 3],
    ["hum", "mute", 1],
  ]) {
    assert.throws(() => editCompositionClip(p, role, field, value));
    assert.equal(JSON.stringify(p), raw);
  }
  assert.throws(() => newCompositionClip("unknown"));
});

test("Displaced raw drafts from both modes remain downloadable identities across repeat transfers, including legacy and corrupt data", () => {
  const local = storage(),
    session = storage();
  let next = 0;
  const raws = [
    JSON.stringify(compositionDemo("fusion")),
    " CORRUPT STUDIO RAW ",
    JSON.stringify(beatbox(2, 8)),
    " CORRUPT BEATBOX RAW ",
  ];
  for (let i = 0; i < 12; i++) {
    const target = i % 2 ? "beatbox" : "studio",
      key =
        target === "studio" ? "perkusi.draft.studio.v3" : "perkusi.draft.v1";
    local.setItem(key, raws[i % 4]);
    prepareTransfer(
      target === "studio" ? beatbox() : fromBeatbox(beatbox()),
      target,
      { storage: local, session, makeId: () => `repeat-${++next}` },
    );
    incomingTransfer(target, local, session).acknowledge();
    const record = JSON.parse(local.getItem("perkusi.mode-transfer.v3"));
    assert.equal(record.version, 4);
    for (const raw of raws.slice(0, Math.min(i + 1, 4)))
      assert.ok(record.drafts.some((d) => d.raw === raw));
  }
  local.removeItem("perkusi.draft.studio.v3");
  const legacy = JSON.stringify(studioDemo("arus"));
  local.setItem("perkusi.draft.studio.v2", legacy);
  prepareTransfer(beatbox(), "studio", {
    storage: local,
    session,
    makeId: () => "legacy-copy",
  });
  assert.ok(
    JSON.parse(local.getItem("perkusi.mode-transfer.v3")).drafts.some(
      (d) => d.key === "perkusi.draft.studio.v2" && d.raw === legacy,
    ),
  );
  assert.equal(local.getItem("perkusi.draft.studio.v2"), legacy);
});

test("Existing S9 transfer records preserve their raw destination draft on upgrade and acknowledge without rewriting legacy shape", () => {
  const local = storage(),
    session = storage();
  const raw = " legacy/corrupt raw exactly ";
  local.setItem("perkusi.draft.studio.v3", raw);
  const first = prepareTransfer(beatbox(), "studio", {
    storage: local,
    session,
    makeId: () => "old-record",
  });
  delete first.drafts;
  first.version = 3;
  local.setItem("perkusi.mode-transfer.v3", JSON.stringify(first));
  incomingTransfer("studio", local, session).acknowledge();
  assert.equal(
    JSON.parse(local.getItem("perkusi.mode-transfer.v3")).version,
    3,
  );
  prepareTransfer(fromBeatbox(beatbox()), "beatbox", {
    storage: local,
    session,
    makeId: () => "upgraded",
  });
  const r = JSON.parse(local.getItem("perkusi.mode-transfer.v3"));
  assert.equal(r.version, 4);
  assert.ok(r.drafts.some((d) => d.target === "studio" && d.raw === raw));
});

test("Combined retention and byte limits refuse new transfers before changing either store, keeping all protected work", () => {
  const local = storage(),
    session = storage();
  for (let i = 0; i < 15; i++) {
    const p = beatbox();
    p.title = `Source-${i}`;
    local.setItem("perkusi.draft.studio.v3", `Raw draft-${i}`);
    prepareTransfer(p, "studio", {
      storage: local,
      session,
      makeId: () => `limit-${i}`,
    });
    incomingTransfer("studio", local, session).acknowledge();
  }
  const before = local.getItem("perkusi.mode-transfer.v3"),
    marker = session.getItem("perkusi.mode-transfer.pending.v3");
  local.setItem("perkusi.draft.studio.v3", "New protected draft");
  assert.throws(
    () =>
      prepareTransfer(beatbox(), "studio", {
        storage: local,
        session,
        makeId: () => "full",
      }),
    (e) => e.code === "storageFull",
  );
  assert.equal(local.getItem("perkusi.mode-transfer.v3"), before);
  assert.equal(session.getItem("perkusi.mode-transfer.pending.v3"), marker);
  const fresh = storage();
  fresh.setItem("perkusi.draft.studio.v3", "界".repeat(90000));
  assert.throws(
    () =>
      prepareTransfer(beatbox(), "studio", {
        storage: fresh,
        session,
        makeId: () => "byte-limit",
      }),
    (e) => e.code === "storageFull",
  );
  assert.equal(fresh.getItem("perkusi.mode-transfer.v3"), null);
  assert.equal(fresh.getItem("perkusi.draft.studio.v3"), "界".repeat(90000));
});

test("Quota/session failure and acknowledgment refusal preserve protected histories and previous markers", () => {
  const local = storage(),
    session = storage();
  local.setItem("perkusi.draft.studio.v3", "Previous raw unsaved");
  prepareTransfer(beatbox(), "studio", {
    storage: local,
    session,
    makeId: () => "first",
  });
  incomingTransfer("studio", local, session).acknowledge();
  const raw = local.getItem("perkusi.mode-transfer.v3");
  session.setItem("perkusi.mode-transfer.pending.v3", "old-marker");
  for (const failStore of ["local", "session"]) {
    let failed = false;
    const wrapped = {
      ...(failStore === "local" ? local : session),
      setItem(k, v) {
        if (!failed) {
          failed = true;
          throw new DOMException("quota", "QuotaExceededError");
        }
        (failStore === "local" ? local : session).setItem(k, v);
      },
    };
    assert.throws(
      () =>
        prepareTransfer(fromBeatbox(beatbox()), "beatbox", {
          storage: failStore === "local" ? wrapped : local,
          session: failStore === "session" ? wrapped : session,
          makeId: () => "second",
        }),
      (e) => e.code === "storageUnavailable",
    );
    assert.equal(local.getItem("perkusi.mode-transfer.v3"), raw);
    assert.equal(
      session.getItem("perkusi.mode-transfer.pending.v3"),
      "old-marker",
    );
  }
  prepareTransfer(beatbox(), "studio", {
    storage: local,
    session,
    makeId: () => "ack-denied",
  });
  const pending = local.getItem("perkusi.mode-transfer.v3");
  const denied = {
    ...local,
    setItem() {
      throw Error("denied");
    },
  };
  assert.throws(() =>
    incomingTransfer("studio", denied, session).acknowledge(),
  );
  assert.equal(local.getItem("perkusi.mode-transfer.v3"), pending);
  assert.equal(
    session.getItem("perkusi.mode-transfer.pending.v3"),
    "ack-denied",
  );
});

test("Persistent local quota failure cannot strand a new session marker when local rollback also fails", () => {
  const local = storage(),
    session = storage();
  local.setItem("perkusi.draft.studio.v3", "Protected raw");
  prepareTransfer(beatbox(), "studio", {
    storage: local,
    session,
    makeId: () => "first",
  });
  incomingTransfer("studio", local, session).acknowledge();
  const raw = local.getItem("perkusi.mode-transfer.v3");
  const denied = {
    ...local,
    setItem() {
      throw new DOMException("persistent quota", "QuotaExceededError");
    },
  };
  assert.throws(() =>
    prepareTransfer(fromBeatbox(beatbox()), "beatbox", {
      storage: denied,
      session,
      makeId: () => "second",
    }),
  );
  assert.equal(local.getItem("perkusi.mode-transfer.v3"), raw);
  assert.equal(session.getItem("perkusi.mode-transfer.pending.v3"), null);
});

const transferKey = "perkusi.mode-transfer.v3";
const transferMarker = "perkusi.mode-transfer.pending.v3";
function boundaryTransfer(
  bytes,
  { pending = true, version = 3, unicode = false } = {},
) {
  const original = beatbox(),
    record = {
      version,
      originals: [original],
      id: "legacy-boundary",
      target: "studio",
      pending,
      original,
      candidate: fromBeatbox(original),
      destinationDraft: unicode ? '界"\\\n' : "",
    };
  if (version === 4)
    record.drafts = [
      {
        target: "studio",
        key: "perkusi.draft.studio.v3",
        raw: record.destinationDraft,
      },
    ];
  const fields = version === 4 ? 2 : 1;
  let padding = bytes - Buffer.byteLength(JSON.stringify(record));
  if (padding % fields) {
    record.id += "-";
    padding--;
  }
  record.destinationDraft += "x".repeat(padding / fields);
  if (version === 4) record.drafts[0].raw = record.destinationDraft;
  const raw = JSON.stringify(record);
  assert.equal(Buffer.byteLength(raw), bytes);
  return { record, raw };
}

test("Acknowledgment refuses exact-limit pending legacy and v4 data before mutation; adjacent UTF8 limits stay strict and repeatedly readable", () => {
  for (const version of [3, 4])
    for (const unicode of [false, true])
      for (const bytes of [262143, 262144, 262145]) {
        const { record, raw } = boundaryTransfer(bytes, { version, unicode }),
          local = storage(),
          session = storage();
        local.setItem(transferKey, raw);
        session.setItem(transferMarker, record.id);
        if (bytes > 262144) {
          for (let i = 0; i < 3; i++)
            assert.throws(
              () => incomingTransfer("studio", local, session),
              (e) => e.code === "storageUnavailable",
            );
        } else if (bytes === 262144) {
          for (let i = 0; i < 3; i++) {
            const incoming = incomingTransfer("studio", local, session);
            assert.deepEqual(incoming.project, record.candidate);
            assert.throws(
              () => incoming.acknowledge(),
              (e) => e.code === "storageFull",
            );
            assert.equal(local.getItem(transferKey), raw);
            assert.equal(session.getItem(transferMarker), record.id);
          }
        } else {
          incomingTransfer("studio", local, session).acknowledge();
          const done = local.getItem(transferKey);
          assert.equal(Buffer.byteLength(done), 262144);
          assert.equal(JSON.parse(done).pending, false);
          assert.equal(
            JSON.parse(done).destinationDraft,
            record.destinationDraft,
          );
          assert.equal(session.getItem(transferMarker), null);
          for (let i = 0; i < 3; i++)
            assert.equal(incomingTransfer("studio", local, session), null);
        }
        if (bytes >= 262144) {
          assert.equal(local.getItem(transferKey), raw);
          assert.equal(session.getItem(transferMarker), record.id);
        }
      }
});

test("Previously acknowledged legacy records at the bound remain accepted; over-limit reader refusal never changes raw backups", () => {
  for (const bytes of [262143, 262144, 262145]) {
    const { raw } = boundaryTransfer(bytes, { pending: false, unicode: true }),
      local = storage(),
      session = storage();
    local.setItem(transferKey, raw);
    for (let i = 0; i < 3; i++)
      assert.throws(
        () =>
          prepareTransfer(beatbox(), "studio", {
            storage: local,
            session,
            makeId: () => "next",
          }),
        (e) =>
          e.code === (bytes > 262144 ? "storageUnavailable" : "storageFull"),
      );
    assert.equal(local.getItem(transferKey), raw);
    assert.equal(session.getItem(transferMarker), null);
  }
});

test("Acknowledgment checks its actual serialized size, allowing exact-limit formatted legacy input without changing opaque backup data", () => {
  const { record, raw } = boundaryTransfer(262143, { unicode: true }),
    local = storage(),
    session = storage();
  local.setItem(transferKey, " " + raw);
  session.setItem(transferMarker, record.id);
  assert.equal(Buffer.byteLength(local.getItem(transferKey)), 262144);
  incomingTransfer("studio", local, session).acknowledge();
  const done = JSON.parse(local.getItem(transferKey));
  assert.equal(done.pending, false);
  assert.equal(done.destinationDraft, record.destinationDraft);
  assert.equal(Buffer.byteLength(local.getItem(transferKey)), 262144);
  assert.equal(session.getItem(transferMarker), null);
});

test("Bounded acknowledgment with persistent write denial retains the exact pending record and marker for another readable recovery attempt", () => {
  const { record, raw } = boundaryTransfer(262143),
    local = storage(),
    session = storage();
  local.setItem(transferKey, raw);
  session.setItem(transferMarker, record.id);
  const denied = {
    ...local,
    setItem() {
      throw new DOMException("quota", "QuotaExceededError");
    },
  };
  for (let i = 0; i < 3; i++) {
    assert.throws(() =>
      incomingTransfer("studio", denied, session).acknowledge(),
    );
    assert.equal(local.getItem(transferKey), raw);
    assert.equal(session.getItem(transferMarker), record.id);
    assert.deepEqual(
      incomingTransfer("studio", local, session).project,
      record.candidate,
    );
  }
});

const destinationKey = (target) =>
  target === "studio" ? "perkusi.draft.studio.v3" : "perkusi.draft.v1";
function oldWork(target, title = "Protected old destination") {
  const p = target === "studio" ? newComposition(title) : beatbox();
  p.title = title;
  if (target === "studio") {
    p.patterns[0].steps.tom[11] = 0.7;
    p.patterns[0].notes[5] = { pitch: "a4", velocity: 0.6 };
  }
  return p;
}
function startDelivery(target) {
  const local = storage(),
    session = storage(),
    old = oldWork(target),
    source = target === "studio" ? beatbox() : fromBeatbox(beatbox());
  local.setItem(destinationKey(target), JSON.stringify(old));
  const record = prepareTransfer(source, target, {
    storage: local,
    session,
    makeId: () => "delivery-first",
  });
  return { local, session, old, record };
}
function newerWork(p, target) {
  const next = structuredClone(p);
  next.title = "NEWER USER EDIT MUST SURVIVE";
  if (target === "studio") next.patterns[0].steps.tom[11] = 1;
  else next.tracks[4].enabled = !next.tracks[4].enabled;
  return next;
}

test("Delivery reserves and persists before one editable application; retries/duplicate handles never replay over later edits", async () => {
  for (const target of ["studio", "beatbox"]) {
    const { local, session, old, record } = startDelivery(target);
    let calls = 0;
    const incoming = incomingTransfer(target, local, session);
    let release;
    const waiting = new Promise((r) => (release = r));
    const applied = async (p) => {
      calls++;
      assert.equal(
        JSON.parse(local.getItem(transferReceiptKey(target))).state,
        "reserved",
      );
      assert.deepEqual(JSON.parse(local.getItem(destinationKey(target))), p);
      await waiting;
    };
    const first = incoming.deliver(applied),
      second = incoming.deliver(() => {
        throw Error("duplicate application");
      });
    assert.equal(first, second);
    release();
    await first;
    assert.equal(calls, 1);
    assert.equal(
      JSON.parse(local.getItem(transferReceiptKey(target))).state,
      "applied",
    );
    assert.equal(JSON.parse(local.getItem(transferKey)).pending, false);
    assert.equal(session.getItem(transferMarker), null);
    const edited = JSON.stringify(newerWork(record.candidate, target));
    local.setItem(destinationKey(target), edited);
    await incoming.deliver(() => calls++);
    assert.equal(calls, 1);
    assert.equal(local.getItem(destinationKey(target)), edited);
    assert.equal(
      JSON.parse(local.getItem(transferKey)).destinationDraft,
      JSON.stringify(old),
    );
    session.setItem(transferMarker, record.id);
    await incomingTransfer(target, local, session).deliver(() => {
      throw Error("acknowledged replay");
    });
    assert.equal(session.getItem(transferMarker), null);
    assert.equal(local.getItem(destinationKey(target)), edited);
  }
});

test("An exact-limit legacy recovery is refused before copy persistence/application, and current/newer drafts stay untouched on every boot", async () => {
  const { record, raw } = boundaryTransfer(262144),
    local = storage(),
    session = storage();
  local.setItem(transferKey, raw);
  session.setItem(transferMarker, record.id);
  const existing = oldWork("studio");
  local.setItem(destinationKey("studio"), JSON.stringify(existing));
  let calls = 0;
  for (let i = 0; i < 3; i++) {
    await assert.rejects(
      incomingTransfer("studio", local, session).deliver(() => calls++),
      (e) => e.code === "storageFull",
    );
    assert.equal(local.getItem(transferKey), raw);
    assert.equal(session.getItem(transferMarker), record.id);
    assert.equal(local.getItem(transferReceiptKey("studio")), null);
    assert.deepEqual(
      JSON.parse(local.getItem(destinationKey("studio"))),
      existing,
    );
  }
  const edited = JSON.stringify(newerWork(existing, "studio"));
  local.setItem(destinationKey("studio"), edited);
  await assert.rejects(
    incomingTransfer("studio", local, session).deliver(() => calls++),
  );
  assert.equal(calls, 0);
  assert.equal(local.getItem(destinationKey("studio")), edited);
});

test("Persistent/transient acknowledgment write failure keeps the durable delivered receipt and never replaces subsequent user work", async () => {
  for (const target of ["studio", "beatbox"])
    for (const persistent of [true, false]) {
      const { local, session, record } = startDelivery(target);
      const before = local.getItem(transferKey);
      let denied = true,
        calls = 0;
      const wrapped = {
        ...local,
        setItem(k, v) {
          if (k === transferKey && denied)
            throw new DOMException("ack quota", "QuotaExceededError");
          local.setItem(k, v);
        },
      };
      await assert.rejects(
        incomingTransfer(target, wrapped, session).deliver(() => calls++),
      );
      assert.equal(calls, 1);
      assert.equal(local.getItem(transferKey), before);
      assert.equal(session.getItem(transferMarker), record.id);
      assert.equal(
        JSON.parse(local.getItem(transferReceiptKey(target))).state,
        "applied",
      );
      const edited = JSON.stringify(newerWork(record.candidate, target));
      local.setItem(destinationKey(target), edited);
      denied = persistent;
      for (let i = 0; i < 3; i++) {
        const incoming = incomingTransfer(target, wrapped, session);
        if (!incoming) break;
        const retry = incoming.deliver(() => {
          throw Error("replay over newer work");
        });
        if (persistent) await assert.rejects(retry);
        else await retry;
        assert.equal(local.getItem(destinationKey(target)), edited);
      }
      assert.equal(calls, 1);
      if (!persistent) assert.equal(session.getItem(transferMarker), null);
    }
});

test("Legacy pending records reconcile already-delivered values, but quarantine newer destination work without rewriting it", async () => {
  for (const target of ["studio", "beatbox"]) {
    const { local, session, old, record } = startDelivery(target);
    const legacy = { ...record, version: 3 };
    delete legacy.drafts;
    local.setItem(transferKey, JSON.stringify(legacy));
    local.setItem(destinationKey(target), JSON.stringify(record.candidate));
    await incomingTransfer(target, local, session).deliver(() => {
      throw Error("legacy duplicate");
    });
    assert.equal(session.getItem(transferMarker), null);
    local.removeItem(transferReceiptKey(target));
    local.setItem(transferKey, JSON.stringify(legacy));
    session.setItem(transferMarker, record.id);
    const edited = JSON.stringify(newerWork(record.candidate, target));
    local.setItem(destinationKey(target), edited);
    await assert.rejects(
      incomingTransfer(target, local, session).deliver(() => {
        throw Error("legacy overwrite");
      }),
    );
    assert.equal(local.getItem(destinationKey(target)), edited);
    assert.equal(
      JSON.parse(local.getItem(transferReceiptKey(target))).state,
      "blocked",
    );
    local.setItem(destinationKey(target), JSON.stringify(old));
    await assert.rejects(
      incomingTransfer(target, local, session).deliver(() => {
        throw Error("blocked replay after undo");
      }),
    );
    assert.deepEqual(JSON.parse(local.getItem(destinationKey(target))), old);
  }
});

test("Receipt/target-write/application failures cannot expose an unprotected replay; reserved recovery keeps newer work or completes metadata only", async () => {
  for (const target of ["studio", "beatbox"])
    for (const step of ["receipt", "draft", "apply"]) {
      const { local, session, old, record } = startDelivery(target);
      const before = local.getItem(transferKey);
      let calls = 0;
      const wrapped = {
        ...local,
        setItem(k, v) {
          if (
            (step === "receipt" && k === transferReceiptKey(target)) ||
            (step === "draft" && k === destinationKey(target))
          )
            throw new DOMException("stage denial", "QuotaExceededError");
          local.setItem(k, v);
        },
      };
      await assert.rejects(
        incomingTransfer(target, wrapped, session).deliver(() => {
          calls++;
          if (step === "apply") throw Error("owner aborted");
        }),
      );
      assert.equal(local.getItem(transferKey), before);
      assert.equal(session.getItem(transferMarker), record.id);
      assert.equal(calls, step === "apply" ? 1 : 0);
      const edited = JSON.stringify(
        newerWork(step === "apply" ? record.candidate : old, target),
      );
      local.setItem(destinationKey(target), edited);
      await assert.rejects(
        incomingTransfer(target, local, session).deliver(() => {
          throw Error("failed stage replay");
        }),
      );
      assert.equal(local.getItem(destinationKey(target)), edited);
      if (step !== "receipt") {
        local.setItem(destinationKey(target), JSON.stringify(record.candidate));
        await incomingTransfer(target, local, session).deliver(() => {
          throw Error("reserved duplicate apply");
        });
        assert.equal(session.getItem(transferMarker), null);
      }
    }
});

test("Receipt validation stays bounded and malformed/reused identity never authorizes overwriting a target draft", async () => {
  for (const raw of [
    "corrupt",
    "x".repeat(MAX_TRANSFER_RECEIPT_BYTES + 1),
    JSON.stringify({
      version: 1,
      id: "delivery-first",
      target: "studio",
      state: "unsafe",
      candidate: fromBeatbox(beatbox()),
    }),
    JSON.stringify({
      version: 1,
      id: "delivery-first",
      target: "studio",
      state: "applied",
      candidate: oldWork("studio", "Wrong same-id copy"),
    }),
  ]) {
    const { local, session, old } = startDelivery("studio");
    local.setItem(transferReceiptKey("studio"), raw);
    const before = local.getItem(transferKey);
    await assert.rejects(
      incomingTransfer("studio", local, session).deliver(() => {
        throw Error("bad receipt applied");
      }),
    );
    assert.equal(local.getItem(transferReceiptKey("studio")), raw);
    assert.equal(local.getItem(transferKey), before);
    assert.deepEqual(JSON.parse(local.getItem(destinationKey("studio"))), old);
  }
});

test("A replaced transfer during async owner application cannot be acknowledged from a stale handle or overwrite its protected history", async () => {
  const { local, session } = startDelivery("studio");
  const first = incomingTransfer("studio", local, session);
  let replacement;
  await assert.rejects(
    first.deliver(() => {
      const source = beatbox(2);
      source.title = "NEW TRANSFER";
      prepareTransfer(source, "studio", {
        storage: local,
        session,
        makeId: () => "replacement",
      });
      replacement = local.getItem(transferKey);
    }),
  );
  assert.equal(local.getItem(transferKey), replacement);
  assert.equal(session.getItem(transferMarker), "replacement");
  assert.throws(() => first.acknowledge());
  assert.equal(local.getItem(transferKey), replacement);
  await incomingTransfer("studio", local, session).deliver(() => {});
  assert.equal(JSON.parse(local.getItem(transferKey)).pending, false);
});

test("Delivery treats callback/public copies as values; receipt signature and protected candidate cannot be mutated by callers", async () => {
  const { local, session, record } = startDelivery("studio"),
    incoming = incomingTransfer("studio", local, session);
  incoming.project.title = "External mutation";
  await incoming.deliver((p) => {
    p.title = "Callback mutation";
  });
  assert.deepEqual(
    JSON.parse(local.getItem(destinationKey("studio"))),
    record.candidate,
  );
  assert.deepEqual(
    JSON.parse(local.getItem(transferReceiptKey("studio"))).candidate,
    record.candidate,
  );
});

test("Post-application receipt write denial preserves the reserved guard and later edits without any future candidate replay", async () => {
  const { local, session, record } = startDelivery("studio");
  const wrapped = {
    ...local,
    setItem(k, v) {
      if (
        k === transferReceiptKey("studio") &&
        JSON.parse(v).state === "applied"
      )
        throw Error("receipt commit denied");
      local.setItem(k, v);
    },
  };
  let calls = 0;
  await assert.rejects(
    incomingTransfer("studio", wrapped, session).deliver(() => calls++),
  );
  assert.equal(calls, 1);
  assert.equal(
    JSON.parse(local.getItem(transferReceiptKey("studio"))).state,
    "reserved",
  );
  const edited = JSON.stringify(newerWork(record.candidate, "studio"));
  local.setItem(destinationKey("studio"), edited);
  for (let i = 0; i < 3; i++)
    await assert.rejects(
      incomingTransfer("studio", local, session).deliver(() => {
        throw Error("reserved replay");
      }),
    );
  assert.equal(local.getItem(destinationKey("studio")), edited);
});

test("Session-marker cleanup failure leaves a bounded acknowledged record and receipts; refresh cleans metadata without replaying later edits", async () => {
  const { local, session, record } = startDelivery("studio"),
    denied = {
      ...session,
      removeItem() {
        throw new DOMException("session denied", "SecurityError");
      },
    };
  await assert.rejects(
    incomingTransfer("studio", local, denied).deliver(() => {}),
  );
  assert.equal(JSON.parse(local.getItem(transferKey)).pending, false);
  assert.equal(
    JSON.parse(local.getItem(transferReceiptKey("studio"))).state,
    "applied",
  );
  assert.equal(session.getItem(transferMarker), record.id);
  const edited = JSON.stringify(newerWork(record.candidate, "studio"));
  local.setItem(destinationKey("studio"), edited);
  await incomingTransfer("studio", local, session).deliver(() => {
    throw Error("false-record replay");
  });
  assert.equal(local.getItem(destinationKey("studio")), edited);
  assert.equal(session.getItem(transferMarker), null);
});
