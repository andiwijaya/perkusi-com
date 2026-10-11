import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  createPackFromCatalog,
  validatePackCatalog,
  VOCAL_ROLES,
} from "../src/audio/pack-catalog.js";
import {
  characterDefinitions,
  characterSvg,
} from "../src/characters/characters.js";
import { labMessages } from "../internal/sound-lab/messages.js";

const base = new URL("../internal/original-groove/", import.meta.url);
const catalog = JSON.parse(await readFile(new URL("manifest.json", base)));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
test("Original Groove catalog projects all 64 choices into six stable engine roles", () => {
  validatePackCatalog(catalog);
  assert.equal(catalog.assets.length, 12);
  for (let bits = 0; bits < 64; bits++) {
    const selection = Object.fromEntries(
      VOCAL_ROLES.map((role, i) => [role, 1 + ((bits >> i) & 1)]),
    );
    const pack = createPackFromCatalog(
      catalog,
      selection,
      (path) => `/local/${path}`,
    );
    assert.deepEqual(
      pack.stems.map((stem) => stem.id),
      VOCAL_ROLES,
    );
    assert(pack.stems.every((stem) => stem.variant === selection[stem.id]));
    assert.equal(pack.stems.length, 6);
  }
});
test("catalog rejects incompatible, duplicate, unlicensed and traversal assets", () => {
  for (const mutate of [
    (c) => (c.assets[0].rawRedistribution = false),
    (c) => (c.assets[0].commercialUse = false),
    (c) => (c.assets[0].assetPath = "../outside.wav"),
    (c) => (c.assets[0].loopEnd = 6),
    (c) => (c.assets[0].frames = 20),
    (c) => (c.assets[0].sha256 = "guess"),
    (c) => c.assets.push(c.assets[0]),
    (c) => c.assets.pop(),
    (c) => (c.roleOrder[0] = "unknown"),
  ]) {
    const copy = structuredClone(catalog);
    mutate(copy);
    assert.throws(() => validatePackCatalog(copy));
  }
  assert.throws(() => createPackFromCatalog(catalog, { kick: 99 }));
  assert.throws(() => createPackFromCatalog(catalog, { unknown: 1 }));
});
test("actual twelve WAV bytes match provenance, loop geometry and commercial/raw license flags", async () => {
  let total = 0;
  for (const asset of catalog.assets) {
    const bytes = await readFile(new URL(asset.assetPath, base));
    total += bytes.length;
    assert.equal(sha(bytes), asset.sha256);
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
    assert.equal(bytes.toString("ascii", 8, 12), "WAVE");
    assert.equal(bytes.readUInt16LE(22), 1);
    assert.equal(bytes.readUInt32LE(24), 32000);
    assert.equal(bytes.readUInt16LE(34), 16);
    assert.equal(bytes.readUInt32LE(40) / 2, 160000);
    assert.equal(bytes.readInt16LE(44), 0);
    assert.equal(bytes.readInt16LE(bytes.length - 2), 0);
    assert(asset.commercialUse && asset.rawRedistribution);
    assert.equal(asset.listening, "UNVERIFIED");
    assert.equal(asset.acceptedVocalBeatbox, false);
    assert.equal(
      sha(await readFile(new URL("../" + asset.sourceRecipe, import.meta.url))),
      asset.sourceRecipeSha256,
    );
  }
  assert.equal(total, 3840528);
  assert(
    (await readFile(new URL("LICENSE.txt", base), "utf8")).includes(
      "redistribution of the raw WAV",
    ),
  );
});
test("six original silhouettes and actual SVG exports match the registry", async () => {
  const registry = JSON.parse(
    await readFile(new URL("characters/provenance.json", base)),
  );
  assert.equal(new Set(characterDefinitions.map((c) => c.body)).size, 6);
  assert.equal(new Set(characterDefinitions.map((c) => c.silhouette)).size, 6);
  assert.deepEqual(
    characterDefinitions.map((c) => c.role),
    VOCAL_ROLES,
  );
  for (const record of registry.characters) {
    const bytes = await readFile(new URL("../" + record.path, import.meta.url));
    assert.equal(sha(bytes), record.sha256);
    assert.equal(bytes.toString(), characterSvg(record.role) + "\n");
    assert(record.commercialUse && record.rawRedistribution);
    assert.equal(record.states.length, 6);
  }
});
test("sound lab copy has full ID/EN keys and six localized role labels", () => {
  assert.deepEqual(
    Object.keys(labMessages.id).sort(),
    Object.keys(labMessages.en).sort(),
  );
  assert.deepEqual(
    Object.keys(labMessages.id.states).sort(),
    Object.keys(labMessages.en.states).sort(),
  );
  for (const locale of ["id", "en"])
    assert(VOCAL_ROLES.every((role) => labMessages[locale].states[role]));
});

test("S3 P3 duration and required recipe/master provenance mutations are rejected", () => {
  for (const field of [
    "durationSeconds",
    "sourceRecipeSha256",
    "sourceMaster",
    "masterSha256",
    "sourceRecipe",
    "licensePath",
    "author",
    "sourceType",
    "createdAt",
    "attributionRequired",
  ]) {
    const copy = structuredClone(catalog);
    delete copy.assets[0][field];
    assert.throws(() => validatePackCatalog(copy), field);
  }
  for (const value of ["invalid", "5", null, NaN, Infinity, 0, -5]) {
    const copy = structuredClone(catalog);
    copy.assets[0].durationSeconds = value;
    assert.throws(() => validatePackCatalog(copy));
  }
  for (const field of ["sourceRecipeSha256", "masterSha256"]) {
    const copy = structuredClone(catalog);
    copy.assets[0][field] = "not-a-hash";
    assert.throws(() => validatePackCatalog(copy));
  }
  const traversal = structuredClone(catalog);
  traversal.assets[0].sourceMaster = "../outside.wav";
  assert.throws(() => validatePackCatalog(traversal));
});

test("S3 P3 standalone SVG defaults hide status marks without inline style or external CSS", () => {
  for (const role of VOCAL_ROLES) {
    const svg = characterSvg(role);
    for (const name of ["char-status", "char-loading", "char-error"])
      assert(svg.includes(`class="${name}" display="none"`));
    assert(
      !svg.includes("<style") &&
        !svg.includes("style=") &&
        !svg.includes("<script"),
    );
  }
});
