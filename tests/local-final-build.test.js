import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPayloadMinimum, runLocalBuild } from "../scripts/local-build.mjs";

test("archival capacity accounting preserves source/media size admission without enabling a legacy build", async () => {
  const root = await mkdtemp(join(tmpdir(), "perkusi-final-budget-"));
  const put = async (name, data) => {
    const path = join(root, name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, JSON.stringify(data));
  };
  await mkdir(join(root, "public"));
  await put("internal/gamelan-flac/asset-map.json", {
    files: [{ bytes: 101 }],
  });
  await put("internal/gamelan-delivery/asset-map.json", {
    files: [{ bytes: 999 }],
  });
  await put("internal/gamelan-source-forms/manifest.json", {
    archives: [{ bytes: 103 }],
  });
  await put("internal/original-groove/manifest.json", {
    assets: [{ bytes: 107 }],
  });
  await put("internal/loop-instruments/manifest.json", {
    assets: [{ derivative: { bytes: 109 } }],
  });
  await mkdir(join(root, "internal/loop-instruments/source-forms"));
  await writeFile(
    join(root, "internal/loop-instruments/source-forms/original.txt"),
    "original",
  );
  const expected = 999 + 103 + 107;
  assert.equal(await buildPayloadMinimum(root, "retirement-release"), expected);
  assert.equal(await buildPayloadMinimum(root, "retirement-review"), expected);
  await assert.rejects(
    buildPayloadMinimum(root, "audio-prototype"),
    /unsupportedBuildMode/,
  );
  await assert.rejects(
    buildPayloadMinimum(root, "gamelan-v5-final"),
    /unsupportedBuildMode/,
  );
});

test("retirement release uses the managed source fingerprint and refuses promotion after source changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "perkusi-final-build-"));
  await mkdir(join(root, "public"));
  await mkdir(join(root, "src"));
  const source = join(root, "src/source.js");
  await writeFile(source, "original source");
  const outDir = "qa-artifacts/final";
  const good = await runLocalBuild({
    root,
    mode: "retirement-release",
    outDir,
    runner: async ({ candidate, mode }) => {
      assert.equal(mode, "retirement-release");
      await mkdir(candidate, { recursive: true });
      await writeFile(join(candidate, "index.html"), "accepted final");
      return { code: 0 };
    },
  });
  assert.equal(good.buildStatus, "SUCCESS");
  assert.equal(good.sourceSHA256, good.sourceAfterSHA256);
  const changed = await runLocalBuild({
    root,
    mode: "retirement-release",
    outDir,
    runner: async ({ candidate }) => {
      await mkdir(candidate, { recursive: true });
      await writeFile(join(candidate, "index.html"), "unreviewed change");
      await writeFile(source, "changed source");
      return { code: 0 };
    },
  });
  assert.equal(changed.buildStatus, "FAILED");
  assert.equal(changed.error, "buildSourceChanged");
  assert.equal(
    await readFile(join(good.target, "index.html"), "utf8"),
    "accepted final",
  );
  assert.equal(
    await readFile(join(changed.candidate, "index.html"), "utf8"),
    "unreviewed change",
  );
});

test("a requested official build can defer cleanup without changing admission or output identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "perkusi-deferred-build-"));
  await mkdir(join(root, "public"));
  const result = await runLocalBuild({
    root,
    mode: "retirement-release",
    outDir: "qa-artifacts/preview",
    cleanupAfterBuild: false,
    runner: async ({ candidate }) => {
      await mkdir(candidate, { recursive: true });
      await writeFile(join(candidate, "index.html"), "preview");
      return { code: 0 };
    },
  });
  assert.equal(result.buildStatus, "SUCCESS");
  assert.equal(result.cleanup.status, "DEFERRED_BY_REQUEST");
  assert.equal(result.cleanup.removedFiles, 0);
  assert.equal(result.cleanup.removedBytes, 0);
  assert.equal(result.sourceSHA256, result.sourceAfterSHA256);
  assert.equal(
    result.preflight.recommendedFreeBytes,
    result.preflight.payloadMinimumBytes + 256 * 1024 ** 2 + 2 * 1024 ** 3,
  );
});
