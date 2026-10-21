import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { migrateLegacyMetadata } from "../src/project/canonical-metadata.js";
import {
  createCanonicalBundle,
  importCanonicalPackage,
} from "../src/project/canonical-package.js";
import {
  canonicalBeatboxCopy,
  stageCanonicalBeatboxCopy,
} from "../src/project/canonical-beatbox-copy.js";
import {
  prepareTransfer,
  incomingTransfer,
} from "../src/project/mode-transfer.js";
import {
  canonicalFixtureRegistry as registry,
  fixturePCM,
} from "./helpers/canonical-fixtures.js";
const storage = () => {
  const map = new Map();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
};
const envelope = "perkusi.mode-transfer.v3";
const sourceOf = (p) => {
  const placed = new Set(
    p.sections
      .find((s) => s.id === p.activeSection)
      .placements.filter((a) => a.sourceRef.kind === "working")
      .map((a) => a.sourceRef.id),
  );
  return p.sourceDefs.find(
    (d) =>
      d.kind === "composition" && (placed.has(d.id) || placed.has(d.parentId)),
  );
};
async function specimen(name = "schema3-fifteen-lanes", edit = () => {}) {
  const raw = new Uint8Array(
      await readFile(
        new URL(
          `./fixtures/v5-canonical/${name}.perkusi.json`,
          import.meta.url,
        ),
      ),
    ),
    migrated = await migrateLegacyMetadata(raw, { registry }),
    p = structuredClone(migrated.project),
    entries = new Map(),
    memory = new AudioMemory();
  edit(p);
  if (name.startsWith("schema5")) {
    const pcm = fixturePCM();
    for (const [i, a] of p.assets.entries())
      entries.set(a.id, {
        blob: new Blob([pcm[i].buffer]),
        provenance: "QA synthetic memory-only original take",
      });
  }
  const bundle = await createCanonicalBundle(p, {
    registry,
    memory,
    entries,
    originals: migrated.originals,
  });
  return {
    bundle,
    memory,
    sourceId: sourceOf(p).id,
  };
}
for (const name of ["schema0-beatbox", "schema1-zero-master"])
  test(`compatible reverse copy preserves all original controls, including zero master: ${name}`, async () => {
    const f = await specimen(name),
      result = await canonicalBeatboxCopy(f.bundle.project, {
        registry,
        sourceId: f.sourceId,
      });
    assert.equal(result.compatible, true);
    const s = storage(),
      session = storage();
    prepareTransfer(result.candidate, "beatbox", { storage: s, session });
    let delivered;
    await incomingTransfer("beatbox", s, session).deliver((p) => {
      delivered = p;
    });
    assert.deepEqual(delivered, result.candidate);
    assert.equal(
      result.candidate.master.volume,
      name.includes("zero") ? 0 : f.bundle.project.master.volume,
    );
    f.bundle.dispose();
    assert.equal(f.memory.snapshot().bytes, 0);
  });
test("derived reverse reads edited active pattern rather than retained source, and respects inner solo/mute", async () => {
  const f = await specimen(undefined, (p) => {
      p.title = "Edited current title";
      const d = sourceOf(p),
        g = d.programme;
      for (const t of g.percussion) t.solo = false;
      g.bilah.solo = false;
      g.activePattern = g.patterns.at(-1).id;
      for (const b of g.patterns.at(-1).beatbox)
        Object.assign(b, {
          enabled: true,
          volume: 1,
          mute: false,
          solo: false,
        });
      Object.assign(g.patterns.at(-1).beatbox[0], { variant: 2, solo: true });
      Object.assign(g.patterns.at(-1).beatbox[1], { solo: true, mute: true });
    }),
    before = JSON.stringify(f.bundle.project),
    result = await canonicalBeatboxCopy(f.bundle.project, {
      registry,
      sourceId: f.sourceId,
    });
  assert.equal(result.compatible, false);
  assert.equal(result.candidate.title, "Edited current title");
  assert.deepEqual(
    result.candidate.tracks.filter((t) => t.enabled).map((t) => t.role),
    ["kick"],
  );
  assert.equal(result.candidate.tracks[0].variant, 2);
  assert.equal(JSON.stringify(f.bundle.project), before);
  f.bundle.dispose();
  assert.equal(f.memory.snapshot().bytes, 0);
});
for (const mute of [
  "outerMute",
  "outerZero",
  "otherSolo",
  "localMasterZero",
  "drumSolo",
])
  test(`derived reverse never revives excluded accompaniment: ${mute}`, async () => {
    const f = await specimen("schema5-eq-overdub-alignment", (p) => {
        const d = sourceOf(p),
          parent = d.parentId || d.id,
          a = p.sections[0].placements.find((a) => a.sourceRef.id === parent),
          t = p.tracks.find((t) => t.id === a.trackId);
        const g = d.programme;
        for (const b of g.patterns.find((a) => a.id === g.activePattern)
          .beatbox)
          Object.assign(b, {
            enabled: true,
            volume: 1,
            solo: false,
            mute: false,
          });
        if (mute === "outerMute") t.mix.mute = true;
        if (mute === "outerZero") t.mix.volume = 0;
        if (mute === "otherSolo")
          p.tracks.find((x) => x.id !== t.id).mix.solo = true;
        if (mute === "localMasterZero")
          p.sourceDefs.find((s) => s.id === parent).master = {
            binding: "local",
            volume: 0,
          };
        if (mute === "drumSolo") g.percussion[0].solo = true;
      }),
      result = await canonicalBeatboxCopy(f.bundle.project, {
        registry,
        sourceId: f.sourceId,
      });
    assert.equal(
      result.candidate.tracks.some((t) => t.enabled),
      false,
    );
    f.bundle.dispose();
    assert.equal(f.memory.snapshot().bytes, 0);
  });
test("reverse stages complete current schema6 plus exact recordings before small-envelope delivery and keeps old destination", async () => {
  const f = await specimen("schema5-eq-overdub-alignment", (p) => {
      p.title = "Current full recording project";
    }),
    s = storage(),
    session = storage(),
    before = f.memory.snapshot().bytes;
  s.setItem("perkusi.draft.v1", "previous destination bytes");
  let saved;
  const store = {
    stage: async (blob, meta) => {
      assert.equal(s.getItem(envelope), null);
      saved = { blob, ...meta };
      return meta;
    },
  };
  const result = await stageCanonicalBeatboxCopy(f.bundle, {
    registry,
    memory: f.memory,
    sourceId: f.sourceId,
    store,
    storage: s,
    session,
  });
  assert.equal(saved.kind, "legacy");
  assert.equal(result.archive.id, saved.id);
  assert.equal(f.memory.snapshot().bytes, before);
  const imported = await importCanonicalPackage(saved.blob, {
    registry,
    memory: f.memory,
  });
  assert.deepEqual(imported.project, f.bundle.project);
  for (const a of f.bundle.project.assets)
    assert.deepEqual(
      new Uint8Array(await imported.entries.get(a.id).blob.arrayBuffer()),
      new Uint8Array(await f.bundle.entries.get(a.id).blob.arrayBuffer()),
    );
  const record = JSON.parse(s.getItem(envelope));
  assert.equal(record.candidate.schemaVersion, 1);
  assert.equal(record.destinationDraft, "previous destination bytes");
  assert.equal(s.getItem("perkusi.draft.v1"), "previous destination bytes");
  assert.ok(new TextEncoder().encode(s.getItem(envelope)).length < 256 * 1024);
  imported.dispose();
  f.bundle.dispose();
  assert.equal(f.memory.snapshot().bytes, 0);
});
for (const failure of ["archive", "stale", "envelope"])
  test(`reverse ${failure} failure does not publish destination or discard source`, async () => {
    const f = await specimen(),
      s = storage(),
      session = storage(),
      before = f.memory.snapshot().bytes;
    s.setItem("perkusi.draft.v1", "original destination");
    let archived = false;
    const store = {
      stage: async (_, meta) => {
        if (failure === "archive") throw Error("quota");
        archived = true;
        return meta;
      },
    };
    if (failure === "envelope")
      s.setItem = () => {
        throw Error("quota");
      };
    await assert.rejects(
      stageCanonicalBeatboxCopy(f.bundle, {
        registry,
        memory: f.memory,
        sourceId: f.sourceId,
        store,
        storage: s,
        session,
        check: () => {
          if (failure === "stale" && archived) throw Error("newer revision");
        },
      }),
    );
    assert.equal(s.getItem("perkusi.draft.v1"), "original destination");
    assert.equal(s.getItem(envelope), null);
    assert.equal(f.memory.snapshot().bytes, before);
    assert.equal(f.bundle.project.schemaVersion, 6);
    f.bundle.dispose();
    assert.equal(f.memory.snapshot().bytes, 0);
  });
