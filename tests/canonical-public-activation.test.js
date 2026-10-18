import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalLocalRoute,
  canonicalLocalSession,
  canonicalLegacyHref,
  canonicalRecoveryHref,
} from "../src/studio/canonical-route.js";
import {
  discoverLegacyProjects,
  legacyCopyBlob,
} from "../src/project/legacy-discovery.js";
import { newComposition } from "../src/project/composition-model.js";
import { importCanonicalFile } from "../src/project/canonical-package.js";
import { canonicalFixtureRegistry as registry } from "./helpers/canonical-fixtures.js";
import { AudioMemory } from "../src/audio/audio-memory.js";

test("public canonical release flag requires deliberate known-origin opt-in and preserves explicit fallback", () => {
  for (const prefix of [
    "https://perkusi.com",
    "https://www.perkusi.com",
    "http://127.0.0.1:6031",
  ])
    for (const path of ["/studio/", "/en/studio/"]) {
      assert.equal(canonicalLocalRoute(false, prefix + path, true), false);
      assert.equal(
        canonicalLocalRoute(
          false,
          prefix + path + "?candidate=canonical",
          true,
        ),
        true,
      );
      assert.equal(
        canonicalLocalRoute(
          false,
          prefix + path + "?candidate=canonical&workspace=legacy",
          true,
        ),
        false,
      );
    }
  for (const prefix of [
    "http://perkusi.com",
    "https://perkusi.com.example",
    "https://localhost.example",
    "https://192.168.1.2",
  ])
    assert.equal(
      canonicalLocalRoute(false, prefix + "/studio/?candidate=canonical", true),
      false,
    );
  assert.equal(
    canonicalLocalRoute(
      false,
      "https://perkusi.com/studio/?candidate=canonical",
      false,
    ),
    false,
  );
  assert.equal(
    canonicalLocalSession(
      false,
      "https://perkusi.com/loop-station/?candidate=canonical",
      true,
    ),
    true,
  );
  assert.equal(
    canonicalLegacyHref("en"),
    "/en/studio/?workspace=legacy&lang=en",
  );
  assert.equal(canonicalRecoveryHref(), "/studio/recovery/?lang=id");
});
test("bounded discovery is readonly, isolates corrupt lists, and refuses a stale source before copy", async () => {
  const p = newComposition("Untouched old project"),
    raw = JSON.stringify({
      version: 1,
      items: [{ id: "old-one", project: p }],
    }),
    data = new Map([
      ["perkusi.projects.studio.v3", raw],
      ["perkusi.projects.studio.v2", "{broken"],
      ["perkusi.draft.v1", " ".repeat(262145)],
    ]),
    before = structuredClone(data),
    storage = { getItem: (k) => data.get(k) ?? null };
  const found = discoverLegacyProjects(storage);
  assert.equal(found.rows.length, 1);
  assert.equal(found.rows[0].id, "old-one");
  assert.equal(found.issues.length, 2);
  assert.deepEqual(data, before);
  assert.deepEqual(
    JSON.parse(await legacyCopyBlob(found.rows[0], storage).text()),
    p,
  );
  data.set("perkusi.projects.studio.v3", raw + " ");
  assert.throws(
    () => legacyCopyBlob(found.rows[0], storage),
    (e) => e.code === "legacySourceChanged",
  );
});
test("discovered legacy copy preserves original project content; unsupported versions do not become accepted copies", async () => {
  const p = newComposition("Copy without moving original"),
    data = new Map([["perkusi.draft.studio.v3", JSON.stringify(p)]]),
    storage = { getItem: (k) => data.get(k) ?? null },
    row = discoverLegacyProjects(storage).rows[0],
    memory = new AudioMemory(),
    blob = legacyCopyBlob(row, storage),
    b = await importCanonicalFile(blob, { registry, memory });
  try {
    const origin = b.project.origins.find(
      (o) => o.id === b.project.compatibility.rootOriginId,
    );
    assert.equal(
      await b.originals.get(origin.sha256).text(),
      await blob.text(),
    );
    assert.equal(data.get(row.key), row.raw);
  } finally {
    b.dispose();
  }
  assert.equal(memory.snapshot().bytes, 0);
  const future = { ...p, schemaVersion: 99 };
  data.set(row.key, JSON.stringify(future));
  const invalid = discoverLegacyProjects(storage).rows[0];
  await assert.rejects(
    importCanonicalFile(legacyCopyBlob(invalid, storage), { registry, memory }),
  );
  assert.equal(data.get(row.key), JSON.stringify(future));
  assert.equal(memory.snapshot().bytes, 0);
});
