import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  rename,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, dirname, basename } from "node:path";
import {
  cleanupBuilds,
  inside,
  readRegistry,
  saveRegistry,
  registryLock,
  exists,
} from "../scripts/build-housekeeping.mjs";

async function put(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "perkusi-seal-guard-"));
  t.after(async () => {
    const verified = inside(tmpdir(), resolve(root));
    assert.match(basename(verified), /^perkusi-seal-guard-[A-Za-z0-9]+$/);
    await rm(verified, { recursive: true, force: true });
  });
  const target = join(root, "qa-artifacts/packet/old"),
    copies = [
      "source-forms/cdm-porto-candidate-1.0.0/test.zip",
      "sounds/cdm-porto-flac-candidate/48000/test.flac",
    ],
    originals = [
      "internal/gamelan-source-forms/archives/test.zip",
      "internal/gamelan-flac/audio/48000/test.flac",
    ];
  for (let i = 0; i < copies.length; i++) {
    await put(join(target, copies[i]), "original-" + i);
    await put(join(root, originals[i]), "original-" + i);
  }
  await put(join(target, "unique.wav"), "unique capture");
  const registry = {
    version: 1,
    builds: [
      {
        id: "retired",
        root: target,
        kind: "managed-build",
        status: "obsolete",
        consumersSettled: true,
      },
    ],
    activeRoots: [],
    retainRoots: [],
    latestSuccess: null,
    latestFailed: null,
  };
  await registryLock(root, () => saveRegistry(root, registry));
  const check = async (remaining = copies) => {
    for (const key of remaining)
      assert.equal(await exists(join(target, key)), true, key);
    for (let i = 0; i < originals.length; i++)
      assert.equal(
        await readFile(join(root, originals[i]), "utf8"),
        "original-" + i,
      );
    assert.equal(
      await readFile(join(target, "unique.wav"), "utf8"),
      "unique capture",
    );
  };
  return { root, target, copies, check };
}

for (const scope of ["target", "packet", "workspace"])
  test(`already sealed retired ${scope} is excluded before any payload deletion`, async (t) => {
    const f = await fixture(t),
      dir =
        scope === "target"
          ? f.target
          : scope === "packet"
            ? dirname(f.target)
            : f.root;
    await put(join(dir, "SEAL.json"), "malformed seal still protects");
    const r = await cleanupBuilds({ root: f.root, apply: true });
    assert.equal(r.eligibleFiles, 0);
    assert.equal(r.removedFiles, 0);
    assert(r.excluded.some((e) => e.reason === "sealedBuildArtifact"));
    await f.check();
  });

for (const scope of ["target", "packet"])
  test(`seal added to ${scope} after planning refuses the whole planned deletion`, async (t) => {
    const f = await fixture(t);
    const r = await cleanupBuilds({
      root: f.root,
      apply: true,
      beforeRemove: () =>
        put(
          join(scope === "target" ? f.target : dirname(f.target), "SEAL.json"),
          "sealed after plan",
        ),
    });
    assert.equal(r.status, "REFUSED_OR_PARTIAL");
    assert.equal(r.error, "sealedBuildArtifact");
    assert.equal(r.removedFiles, 0);
    await f.check();
  });

for (const protection of [
  "target-seal",
  "packet-seal",
  "nested-seal",
  "lease",
  "review-pin",
  "latest",
  "unsettled",
])
  test(`${protection} introduced after all content prechecks refuses the first unlink`, async (t) => {
    const f = await fixture(t);
    let reached = false;
    const r = await cleanupBuilds({
      root: f.root,
      apply: true,
      beforeDelete: async ({ index, copy }) => {
        assert.equal(index, 0);
        reached = true;
        if (protection.endsWith("seal")) {
          const dir =
            protection === "target-seal"
              ? f.target
              : protection === "packet-seal"
                ? dirname(f.target)
                : dirname(copy);
          await put(join(dir, "SEAL.json"), "late seal");
        } else {
          // Simulate a protection writer that ignores the held cooperative lock.
          const live = await readRegistry(f.root);
          if (protection === "lease")
            live.activeRoots.push({
              root: join(f.target, "sounds"),
              token: "owner-lease",
            });
          if (protection === "review-pin")
            live.retainRoots.push(dirname(f.target));
          if (protection === "latest") live.latestSuccess = f.target;
          if (protection === "unsettled")
            live.builds[0].consumersSettled = false;
          await saveRegistry(f.root, live);
        }
      },
    });
    assert(reached);
    assert.equal(r.status, "REFUSED_OR_PARTIAL");
    assert.equal(r.removedFiles, 0);
    assert.match(r.error, /sealedBuildArtifact|buildRegistryChanged/);
    await f.check();
    if (protection === "lease")
      assert.equal(
        (await readRegistry(f.root)).activeRoots[0].token,
        "owner-lease",
      );
  });

test("seal introduced between file deletions preserves every remaining payload and records partial receipt", async (t) => {
  const f = await fixture(t);
  const r = await cleanupBuilds({
    root: f.root,
    apply: true,
    beforeDelete: async ({ index }) => {
      if (index === 1)
        await put(
          join(dirname(f.target), "SEAL.json"),
          "packet frozen after first unlink",
        );
    },
  });
  assert.equal(r.status, "REFUSED_OR_PARTIAL");
  assert.equal(r.error, "sealedBuildArtifact");
  assert.equal(r.removedFiles, 1);
  assert.equal(await exists(join(f.target, f.copies[0])), false);
  await f.check([f.copies[1]]);
  assert(r.restorationManifest);
  assert.equal(r.removed.length, 1);
});

for (const indexToProtect of [0, 1])
  test(`late payload junction persists terminal refusal and ${indexToProtect} completed removals despite measurement failure`, async (t) => {
    const f = await fixture(t),
      originalDir = join(f.root, "preserved-original-parent"),
      decoyDir = join(f.root, "decoy-parent"),
      key = f.copies[indexToProtect],
      parent = dirname(join(f.target, key)),
      name = basename(key);
    await put(join(decoyDir, name), "decoy survives");
    const r = await cleanupBuilds({
      root: f.root,
      apply: true,
      beforeDelete: async ({ index }) => {
        if (index !== indexToProtect) return;
        await rename(parent, originalDir);
        await symlink(decoyDir, parent, "junction");
      },
    });
    assert.equal(r.status, "REFUSED_OR_PARTIAL");
    assert.equal(r.error, "reparseBuildPath");
    assert.equal(r.removedFiles, indexToProtect);
    assert.equal(r.removed.length, indexToProtect);
    assert.equal(r.measurements[0].after, null);
    assert(
      r.finalizationErrors.some(
        (e) =>
          e.operation === "measureTree" &&
          e.path === f.target &&
          e.error === "reparseBuildPath",
      ),
    );
    const persisted = JSON.parse(await readFile(r.receiptPath));
    assert.equal(persisted.status, "REFUSED_OR_PARTIAL");
    assert.equal(persisted.removedFiles, indexToProtect);
    assert.deepEqual(persisted.finalizationErrors, r.finalizationErrors);
    assert.equal(
      await readFile(join(originalDir, name), "utf8"),
      "original-" + indexToProtect,
    );
    assert.equal(
      await readFile(join(decoyDir, name), "utf8"),
      "decoy survives",
    );
    assert(r.restorationManifest);
    await f.check(indexToProtect === 0 ? f.copies : [f.copies[1]]);
    assert.equal((await readRegistry(f.root)).activeRoots.length, 0);
  });
