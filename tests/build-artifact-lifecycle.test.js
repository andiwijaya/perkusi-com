import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";
import { createHash } from "node:crypto";
import {
  registerCompletedArtifact,
  retireCompletedArtifact,
} from "../scripts/build-artifact-lifecycle.mjs";
import {
  inside,
  readRegistry,
  saveRegistry,
  registryLock,
  cleanupBuilds,
  releaseObsoleteReview,
} from "../scripts/build-housekeeping.mjs";
const hash = (b) => createHash("sha256").update(b).digest("hex");
async function put(path, bytes) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, bytes);
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "perkusi-lifecycle-"));
  t.after(async () => {
    const verified = inside(tmpdir(), root);
    assert.match(basename(verified), /^perkusi-lifecycle-[A-Za-z0-9]+$/);
    await rm(verified, { recursive: true, force: true });
  });
  const rows = [
    { path: "index.html", text: "compiled page" },
    {
      path: "sounds/cdm-porto-flac-candidate/48000/test.flac",
      text: "original source",
    },
    { path: "unique.wav", text: "unique measurement" },
  ];
  const files = rows.map(({ path, text }) => ({
    path,
    bytes: Buffer.byteLength(text),
    sha256: hash(text),
  }));
  await put(
    join(root, "internal/gamelan-flac/audio/48000/test.flac"),
    "original source",
  );
  const old = join(root, "qa-artifacts/old"),
    next = join(root, "qa-artifacts/next");
  for (const target of [old, next])
    for (const row of rows) await put(join(target, row.path), row.text);
  const register = (target, extra = {}) =>
    registerCompletedArtifact({
      root,
      target,
      files,
      receipt: {
        id: basename(target),
        target,
        buildStatus: "SUCCESS",
        buildExit: 0,
        sourceSHA256: hash("source"),
        sourceAfterSHA256: hash("source"),
        mode: "custom-rollback",
      },
      ...extra,
    });
  const retire = (extra = {}) =>
    retireCompletedArtifact({
      root,
      target: old,
      successor: next,
      successorFiles: files,
      reason: "Verified successor replaces completed review",
      ...extra,
    });
  const mutate = async (fn) =>
    registryLock(root, async () => {
      const r = await readRegistry(root);
      fn(r);
      await saveRegistry(root, r);
    });
  return { root, old, next, files, register, retire, mutate };
}

test("custom completed builds register idempotently, remain retained, and reject incomplete/changed outputs", async (t) => {
  const f = await fixture(t);
  const first = await f.register(f.old);
  assert.deepEqual(await f.register(f.old), first);
  let r = await readRegistry(f.root);
  assert.equal(r.builds.length, 1);
  assert.deepEqual(r.retainRoots, [f.old]);
  assert.equal(r.latestSuccess, null);
  await assert.rejects(
    f.register(f.next, { files: f.files.slice(1) }),
    /unexpectedArtifactFile/,
  );
  await writeFile(join(f.next, "index.html"), "changed");
  await assert.rejects(f.register(f.next), /artifactHashMismatch/);
  r = await readRegistry(f.root);
  assert.equal(r.builds.length, 1);
});

test("explicit retirement keeps its review pin by default and only hashes duplicate payloads after release", async (t) => {
  const f = await fixture(t);
  await f.register(f.old);
  await f.register(f.next);
  await f.retire();
  let result = await cleanupBuilds({ root: f.root, apply: true });
  assert.equal(result.removedFiles, 0);
  await releaseObsoleteReview({ root: f.root, target: f.old });
  result = await cleanupBuilds({ root: f.root, apply: true });
  assert.equal(result.removedFiles, 1);
  assert.equal(
    await readFile(join(f.old, "unique.wav"), "utf8"),
    "unique measurement",
  );
  assert.equal(
    await readFile(join(f.old, "index.html"), "utf8"),
    "compiled page",
  );
  assert.equal(
    await readFile(join(f.next, f.files[1].path), "utf8"),
    "original source",
  );
  const r = await readRegistry(f.root);
  assert.equal(r.builds[0].retirement.successorId, "next");
  assert.ok(r.retainRoots.includes(f.next));
});

for (const guard of [
  "active",
  "latest",
  "failed",
  "unsettled",
  "seal",
  "changed-successor",
])
  test(`retirement refuses ${guard} without removing protection or changing status`, async (t) => {
    const f = await fixture(t);
    await f.register(f.old);
    await f.register(f.next);
    if (guard === "active")
      await f.mutate((r) =>
        r.activeRoots.push({ root: f.old, token: "owner" }),
      );
    if (guard === "latest")
      await f.mutate((r) => {
        r.latestSuccess = f.old;
      });
    if (guard === "failed")
      await f.mutate((r) => {
        r.builds[0].status = "failed";
      });
    if (guard === "unsettled")
      await f.mutate((r) => {
        r.builds[0].consumersSettled = false;
      });
    if (guard === "seal")
      await put(join(f.old, "SEAL.json"), "unique sealed packet");
    if (guard === "changed-successor")
      await writeFile(join(f.next, "index.html"), "changed");
    const before = await readRegistry(f.root);
    await assert.rejects(
      f.retire({ releaseReview: true }),
      /protectedBuildArtifact|unsettledArtifactRetirement|sealedBuildArtifact|artifactHashMismatch/,
    );
    assert.deepEqual(await readRegistry(f.root), before);
  });

test("registration refuses escapes, manifest traversal and reparse points", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.register(join(f.root, "src")), /unsafeBuildPath/);
  await assert.rejects(
    f.register(f.old, {
      files: [{ path: "../escape", bytes: 0, sha256: hash("") }],
    }),
    /unsafeBuildPath/,
  );
  const link = join(f.old, "junction");
  await symlink(f.next, link, "junction");
  await assert.rejects(f.register(f.old), /reparseBuildPath/);
});

for (const guard of ["active", "latest", "unsettled", "seal"])
  test(`obsolete review pin cannot be released while ${guard}`, async (t) => {
    const f = await fixture(t);
    await f.register(f.old);
    await f.register(f.next);
    await f.retire();
    await f.mutate((r) => {
      if (guard === "active")
        r.activeRoots.push({ root: f.old, token: "owner" });
      if (guard === "latest") r.latestSuccess = f.old;
      if (guard === "unsettled") r.builds[0].consumersSettled = false;
    });
    if (guard === "seal")
      await put(join(f.old, "SEAL.json"), "sealed old review");
    const before = await readRegistry(f.root);
    await assert.rejects(
      releaseObsoleteReview({ root: f.root, target: f.old }),
      /protectedBuildReview|sealedBuildReview/,
    );
    assert.deepEqual(await readRegistry(f.root), before);
  });
