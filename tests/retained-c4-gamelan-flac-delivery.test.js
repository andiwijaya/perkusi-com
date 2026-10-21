// C4 retained data/shared assertions; retired engine/UI scenarios separately archived.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import { gamelanDeliveryAliases } from "../scripts/gamelan-preview-assets.mjs";
import { flacDeliveryBudget } from "../scripts/gamelan-delivery-budget.mjs";
const read = (n) => JSON.parse(readFileSync(n, "utf8"));
const sha = (a) => createHash("sha256").update(a).digest("hex");
const lossless = read("internal/gamelan-flac/asset-map.json");
test("FLAC build budgets cover all48 focuses and reject file/missing/duplicate regressions without raising64MiB admission", () => {
  const catalogs = Object.fromEntries(
    [44100, 48000].map((r) => [
      r,
      read(`internal/gamelan-flac/registry-${r}.json`),
    ]),
  );
  const result = flacDeliveryBudget(lossless, catalogs);
  assert.equal(result.physicalFocusRows.length, 48);
  assert.equal(result.budgets.unchangedApplicationAdmission, 64 * 1024 * 1024);
  const bad = structuredClone(lossless);
  bad.files[0].bytes = 8 * 1024 * 1024 + 1;
  assert.throws(() => flacDeliveryBudget(bad, catalogs), /budget/);
  const missing = structuredClone(lossless);
  missing.files.pop();
  assert.throws(() => flacDeliveryBudget(missing, catalogs));
  const duplicate = structuredClone(lossless);
  duplicate.files[0].assetPath = duplicate.files[1].assetPath;
  assert.throws(() => flacDeliveryBudget(duplicate, catalogs), /Duplicate/);
});
test("FLAC202 identities preserve canonical integer PCM, exact geometry and embedded attribution without larger encoded bounds", () => {
  const raw = read("internal/gamelan-delivery/asset-map.json"),
    paths = new Set();
  assert.equal(lossless.files.length, 202);
  for (const r of lossless.files) {
    const pcm = raw.files.find((p) => p.assetPath === r.referencePCM.assetPath);
    assert.deepEqual(r.referencePCM, pcm);
    assert.equal(paths.has(r.assetPath), false);
    paths.add(r.assetPath);
    const file = readFileSync(r.sourcePath);
    assert.equal(file.length, r.bytes);
    assert.equal(sha(file), r.sha256);
    assert.ok(r.bytes <= pcm.bytes && r.bytes <= 16 * 1024 * 1024);
    assert.equal(file.toString("ascii", 0, 4), "fLaC");
    assert.equal(file.readUIntBE(5, 3), 34);
    const packed = file.readBigUInt64BE(18);
    assert.equal(Number(packed & ((1n << 36n) - 1n)), r.frames);
    assert.equal(Number(packed >> 44n), r.rate);
    assert.equal(Number((packed >> 41n) & 7n) + 1, 2);
    assert.equal(Number((packed >> 36n) & 31n) + 1, 24);
    assert.equal(file.subarray(26, 42).toString("hex"), r.pcm24MD5);
    const commentSize = file.readUIntBE(43, 3),
      comments = file.subarray(46, 46 + commentSize).toString("utf8");
    assert.match(comments, /ARTIST=Digitopia/);
    assert.match(
      comments,
      /LICENSE=https:\/\/creativecommons.org\/licenses\/by\/3.0\//,
    );
    assert.ok(comments.includes("PCM24_SHA256=" + pcm.sha256));
  }
  assert.equal(
    sha(readFileSync("scripts/gamelan-flac-encode.py")),
    lossless.encoderSourceSHA256,
  );
  assert.deepEqual(
    readFileSync("scripts/gamelan-flac-encode.py"),
    readFileSync("internal/gamelan-flac/encode-reference.py"),
  );
});
test("FLAC registry changes only transport fields and preserves all source IDs, banks, tuning, gains, voice policy and Original Groove", () => {
  for (const rate of [44100, 48000]) {
    const pcm = read(`internal/instrument-focus/registry-${rate}.json`),
      flac = read(`internal/gamelan-flac/registry-${rate}.json`);
    new InstrumentRegistry(flac.banks);
    const restored = structuredClone(flac);
    for (let b = 0; b < pcm.banks.length; b++)
      for (let s = 0; s < pcm.banks[b].samples.length; s++) {
        const old = pcm.banks[b].samples[s],
          selected = restored.banks[b].samples[s];
        if (old.assetPath.startsWith("/sounds/cdm-porto-candidate/")) {
          const row = lossless.files.find(
            (r) => r.referencePCM.assetPath === old.assetPath,
          );
          assert.equal(selected.assetPath, row.assetPath);
          assert.equal(selected.sha256, row.sha256);
          assert.equal(selected.encodedBytes, row.bytes);
          Object.assign(selected, {
            assetPath: old.assetPath,
            sha256: old.sha256,
            encodedBytes: old.encodedBytes,
          });
        }
      }
    assert.deepEqual(restored, pcm);
  }
});
test("Delivery switch defaults to canonical PCM, selects only two trusted opt-in aliases, and rejects unknown formats", () => {
  assert.deepEqual(gamelanDeliveryAliases(process.cwd(), "pcm"), []);
  const aliases = gamelanDeliveryAliases(process.cwd(), "flac");
  assert.deepEqual(
    aliases.map(({ find, replacement }) => ({ find, replacement })),
    [44100, 48000].map((r) => ({
      find: `../../internal/instrument-focus/registry-${r}.json`,
      replacement: resolve(`internal/gamelan-flac/registry-${r}.json`),
    })),
  );
  for (const [index, rate] of [44100, 48000].entries()) {
    const alias = aliases[index];
    assert.equal(
      alias.customResolver(
        alias.replacement,
        resolve("src/gamelan/registry.js"),
      ).id,
      alias.replacement,
    );
    assert.equal(
      alias.customResolver(
        alias.replacement,
        resolve("src/audio/canonical-registered-assets.js"),
      ).id,
      resolve(`internal/instrument-focus/registry-${rate}.json`),
    );
  }
  for (const kind of ["mp3", "opus", "auto", "../outside", "FLAC"])
    assert.throws(() => gamelanDeliveryAliases(process.cwd(), kind));
});
