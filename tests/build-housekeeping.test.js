import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  copyFile,
  rm,
  rename,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";
import { createHash } from "node:crypto";
import {
  inside,
  exists,
  readRegistry,
  saveRegistry,
  registryLock,
  cleanupBuilds,
  noLinks,
  acquireBuildConsumer,
  releaseObsoleteReview,
} from "../scripts/build-housekeeping.mjs";
import { runLocalBuild } from "../scripts/local-build.mjs";
const hash = (b) => createHash("sha256").update(b).digest("hex");
async function put(path, data) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, data);
}
async function fixture(t, { obsolete = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "perkusi-retention-"));
  inside(tmpdir(), root);
  t.after(async () => {
    const path = inside(tmpdir(), resolve(root));
    assert.match(basename(path), /^perkusi-retention-[A-Za-z0-9]+$/);
    await rm(path, { recursive: true, force: true });
  });
  const build = join(root, "qa-artifacts/old-build"),
    rows = [
      [
        "source-forms/cdm-porto-candidate-1.0.0/work-000001-source.zip",
        "internal/gamelan-source-forms/archives/work-000001-source.zip",
        "original source bytes",
      ],
      [
        "sounds/cdm-porto-flac-candidate/48000/sample.flac",
        "internal/gamelan-flac/audio/48000/sample.flac",
        "original audio bytes",
      ],
    ];
  for (const [relative, canonical, data] of rows) {
    await put(join(root, canonical), data);
    if (obsolete) await put(join(build, relative), data);
  }
  if (obsolete) {
    await put(join(build, "unique.wav"), "unique measured evidence");
    await put(join(build, "index.html"), "historical compiled page");
  }
  const registry = {
    version: 1,
    builds: obsolete
      ? [
          {
            id: "old",
            kind: "managed-build",
            root: build,
            status: "obsolete",
            consumersSettled: true,
          },
        ]
      : [],
    activeRoots: [],
    retainRoots: [],
    latestSuccess: null,
    latestFailed: null,
  };
  await registryLock(root, () => saveRegistry(root, registry));
  return { root, build, rows, registry };
}
test("post-build dry-run measures eligible duplicates without deleting any payload", async (t) => {
  const f = await fixture(t),
    r = await cleanupBuilds({ root: f.root });
  assert.equal(r.mode, "dry-run");
  assert.equal(r.eligibleFiles, 2);
  assert.equal(r.removedFiles, 0);
  assert.deepEqual(r.measurements[0].before, r.measurements[0].after);
  for (const [p] of f.rows) assert.equal(await exists(join(f.build, p)), true);
  assert.ok(r.restorationManifest);
  assert.equal(await exists(r.receiptPath), true);
});
for (const retain of ["active", "latest-success", "latest-failed", "review"])
  test(`${retain} target excludes all cleanup, regardless of obsolete label`, async (t) => {
    const f = await fixture(t);
    if (retain === "active")
      f.registry.activeRoots.push({ root: f.build, token: "test" });
    else if (retain === "latest-success") f.registry.latestSuccess = f.build;
    else if (retain === "latest-failed") f.registry.latestFailed = f.build;
    else f.registry.retainRoots.push(f.build);
    await registryLock(f.root, () => saveRegistry(f.root, f.registry));
    const r = await cleanupBuilds({ root: f.root, apply: true });
    assert.equal(r.removedFiles, 0);
    assert.ok(r.excluded.length);
  });
test("hash mismatch refuses that file while keeping unique evidence and original bytes", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.build, f.rows[0][0]), "unique different source");
  const r = await cleanupBuilds({ root: f.root, apply: true });
  assert.equal(r.removedFiles, 1);
  assert.ok(r.excluded.some((e) => e.reason === "hashMismatch"));
  assert.equal(
    await readFile(join(f.build, f.rows[0][0]), "utf8"),
    "unique different source",
  );
  assert.equal(
    await readFile(join(f.build, "unique.wav"), "utf8"),
    "unique measured evidence",
  );
  for (const [, p, data] of f.rows)
    assert.equal(await readFile(join(f.root, p), "utf8"), data);
});
test("apply stores recovery map before removal and restores every removed byte exactly", async (t) => {
  const f = await fixture(t);
  let sawPersisted = false;
  const r = await cleanupBuilds({
    root: f.root,
    apply: true,
    beforeRemove: async () => {
      const { readdir } = await import("node:fs/promises");
      sawPersisted = (
        await readdir(join(f.root, "qa-artifacts/build-retention"))
      ).some((n) => n.startsWith("restore-"));
    },
  });
  assert.equal(sawPersisted, true);
  assert.equal(r.removedFiles, 2);
  assert.equal(
    r.measurements[0].before.bytes - r.measurements[0].after.bytes,
    r.removedBytes,
  );
  const raw = await readFile(join(f.root, r.restorationManifest.path));
  assert.equal(hash(raw), r.restorationManifest.sha256);
  const map = JSON.parse(raw);
  for (const item of map.files) {
    const p = join(f.build, item.copyRelative);
    assert.equal(await exists(p), false);
    await copyFile(join(f.root, item.canonicalRelative), p);
    assert.equal(hash(await readFile(p)), item.sha256);
  }
  assert.equal(
    await readFile(join(f.build, "index.html"), "utf8"),
    "historical compiled page",
  );
});
test("action-time content or active-registry change refuses removal before any file disappears", async (t) => {
  for (const change of ["content", "registry"]) {
    const f = await fixture(t);
    const r = await cleanupBuilds({
      root: f.root,
      apply: true,
      beforeRemove: async () => {
        if (change === "content")
          await writeFile(
            join(f.build, f.rows[0][0]),
            "changed after planning",
          );
        else {
          f.registry.activeRoots.push({ root: f.build, token: "late" });
          await saveRegistry(f.root, f.registry);
        }
      },
    });
    assert.equal(r.status, "REFUSED_OR_PARTIAL");
    assert.equal(r.removedFiles, 0);
    for (const [p] of f.rows)
      assert.equal(await exists(join(f.build, p)), true);
  }
});
test("registry lock prevents competing cleanup and unregistered roots never gain delete authority", async (t) => {
  const f = await fixture(t);
  await registryLock(f.root, () =>
    assert.rejects(
      cleanupBuilds({ root: f.root, apply: true }),
      /buildRegistryBusy/,
    ),
  );
  f.registry.builds[0].kind = "unknown";
  await registryLock(f.root, () => saveRegistry(f.root, f.registry));
  const r = await cleanupBuilds({ root: f.root, apply: true });
  assert.equal(r.removedFiles, 0);
  assert.throws(
    () => inside(join(f.root, "qa-artifacts"), join(f.root, "src")),
    /unsafeBuildPath/,
  );
});
test("junction/reparse path is refused without following or deleting its payload", async (t) => {
  const f = await fixture(t),
    path = join(f.build, "sounds/cdm-porto-flac-candidate/48000"),
    real = join(f.root, "canonical-junction-target");
  await rename(path, real);
  try {
    await symlink(real, path, "junction");
  } catch (e) {
    if (["EPERM", "ENOTSUP"].includes(e.code)) {
      t.skip("junction creation unavailable");
      return;
    }
    throw e;
  }
  await assert.rejects(noLinks(f.root, path), /reparseBuildPath/);
  await assert.rejects(
    cleanupBuilds({ root: f.root, apply: true }),
    /reparseBuildPath/,
  );
  assert.equal(await exists(join(real, "sample.flac")), true);
});
test("failed managed build retains last-good and latest failure, then still runs post-build cleanup", async (t) => {
  const f = await fixture(t, { obsolete: false }),
    target = join(f.root, "dist");
  await put(join(target, "index.html"), "last good");
  const r = await runLocalBuild({
    root: f.root,
    runner: async ({ candidate }) => {
      await put(join(candidate, "failure.txt"), "diagnosis");
      return { code: 2 };
    },
  });
  assert.equal(r.buildExit, 2);
  assert.equal(r.buildStatus, "FAILED");
  assert.equal(await readFile(join(target, "index.html"), "utf8"), "last good");
  assert.ok(r.cleanup);
  const registry = await readRegistry(f.root);
  assert.equal(registry.latestFailed, r.candidate);
  assert.equal(await exists(join(r.candidate, "failure.txt")), true);
});
test("successful managed builds rotate only after success and prune only obsolete duplicate assets", async (t) => {
  const f = await fixture(t, { obsolete: false }),
    target = "qa-artifacts/current-build";
  const runner = async ({ candidate }) => {
    await put(join(candidate, "index.html"), "new complete page");
    for (const [copy, canonical] of f.rows) {
      await mkdir(resolve(join(candidate, copy), ".."), { recursive: true });
      await copyFile(join(f.root, canonical), join(candidate, copy));
    }
    return { code: 0 };
  };
  const first = await runLocalBuild({ root: f.root, outDir: target, runner });
  assert.equal(first.buildStatus, "SUCCESS");
  const second = await runLocalBuild({ root: f.root, outDir: target, runner });
  assert.equal(second.buildStatus, "SUCCESS");
  assert.equal(second.cleanup.removedFiles, 2);
  const registry = await readRegistry(f.root);
  assert.equal(registry.latestSuccess, resolve(f.root, target));
  assert.equal(await exists(join(registry.latestSuccess, f.rows[0][0])), true);
  const old = registry.builds.find((b) => b.status === "obsolete");
  assert.equal(await exists(join(old.root, "index.html")), true);
  assert.equal(await exists(join(old.root, f.rows[0][0])), false);
});
test("active target and unknown existing candidate are refused before launching another build", async (t) => {
  const f = await fixture(t, { obsolete: false }),
    target = join(f.root, "qa-artifacts/current");
  await put(join(target, "index.html"), "keep");
  let calls = 0;
  let r = await runLocalBuild({
    root: f.root,
    outDir: target,
    runner: async () => {
      calls++;
      return { code: 0 };
    },
  });
  assert.equal(r.error, "unregisteredExistingBuildTarget");
  assert.equal(calls, 0);
  const registry = await readRegistry(f.root);
  registry.activeRoots.push({ root: target, token: "browser" });
  await registryLock(f.root, () => saveRegistry(f.root, registry));
  r = await runLocalBuild({
    root: f.root,
    outDir: target,
    runner: async () => {
      calls++;
      return { code: 0 };
    },
  });
  assert.equal(r.error, "activeBuildTarget");
  assert.equal(calls, 0);
  assert.equal(await readFile(join(target, "index.html"), "utf8"), "keep");
});

test("consumer lease blocks an obsolete target until its exact token is released", async (t) => {
  const f = await fixture(t),
    lease = await acquireBuildConsumer({
      root: f.root,
      target: f.build,
      kind: "browser",
    });
  let r = await cleanupBuilds({ root: f.root, apply: true });
  assert.equal(r.removedFiles, 0);
  await lease.release();
  await lease.release();
  r = await cleanupBuilds({ root: f.root, apply: true });
  assert.equal(r.removedFiles, 2);
});
test("unregistered root dist is preserved as retained last-good only after a new build succeeds", async (t) => {
  const f = await fixture(t, { obsolete: false }),
    target = join(f.root, "dist");
  await put(join(target, "index.html"), "original V4 output");
  const r = await runLocalBuild({
    root: f.root,
    runner: async ({ candidate }) => {
      await put(join(candidate, "index.html"), "new output");
      return { code: 0 };
    },
  });
  assert.equal(r.buildStatus, "SUCCESS");
  assert.equal(
    await readFile(join(target, "index.html"), "utf8"),
    "new output",
  );
  const registry = await readRegistry(f.root),
    old = registry.builds.find((b) => b.status === "retained");
  assert.ok(old);
  assert.equal(
    await readFile(join(old.root, "index.html"), "utf8"),
    "original V4 output",
  );
  assert.ok(registry.retainRoots.includes(old.root));
});
test("previous UI-review build keeps its payload until an explicit obsolete-review release", async (t) => {
  const f = await fixture(t, { obsolete: false }),
    outDir = "qa-artifacts/current";
  const runner = async ({ candidate }) => {
    await put(join(candidate, "index.html"), "complete");
    for (const [copy, canonical] of f.rows) {
      await mkdir(resolve(join(candidate, copy), ".."), { recursive: true });
      await copyFile(join(f.root, canonical), join(candidate, copy));
    }
    return { code: 0 };
  };
  await runLocalBuild({ root: f.root, outDir, runner });
  const second = await runLocalBuild({
    root: f.root,
    outDir,
    runner,
    retainPrevious: true,
  });
  assert.equal(second.cleanup.removedFiles, 0);
  assert.ok(second.previousRetainedRoot);
  assert.equal(
    await exists(join(second.previousRetainedRoot, f.rows[0][0])),
    true,
  );
  await releaseObsoleteReview({
    root: f.root,
    target: second.previousRetainedRoot,
  });
  const c = await cleanupBuilds({ root: f.root, apply: true });
  assert.equal(c.removedFiles, 2);
  await assert.rejects(
    releaseObsoleteReview({ root: f.root, target: resolve(f.root, outDir) }),
    /notObsoleteManagedBuild/,
  );
});

test("running build owns stable target and overlaps until its exact operation releases", async (t) => {
  const f = await fixture(t, { obsolete: false }),
    outDir = "qa-artifacts/group/current",
    target = resolve(f.root, outDir);
  let entered, release;
  const started = new Promise((r) => (entered = r)),
    gate = new Promise((r) => (release = r));
  const pending = runLocalBuild({
    root: f.root,
    outDir,
    runner: async ({ candidate }) => {
      await put(join(candidate, "index.html"), "first accepted source");
      entered();
      await gate;
      return { code: 0 };
    },
  });
  await started;
  const foreign = await acquireBuildConsumer({
    root: f.root,
    target: "qa-artifacts/unrelated",
  });
  let first;
  try {
    const active = (await readRegistry(f.root)).activeRoots;
    assert.ok(
      active.some((a) => a.root === target && a.kind === "build-target"),
    );
    assert.ok(active.some((a) => a.kind === "build-candidate"));
    let calls = 0;
    for (const overlap of [outDir, outDir + "/child", "qa-artifacts/group"]) {
      const refused = await runLocalBuild({
        root: f.root,
        outDir: overlap,
        runner: async () => {
          calls++;
          return { code: 0 };
        },
      });
      assert.equal(refused.buildStatus, "FAILED");
      assert.equal(refused.error, "activeBuildTarget");
    }
    assert.equal(calls, 0);
  } finally {
    release();
    first = await pending;
  }
  assert.equal(first.buildStatus, "SUCCESS");
  assert.deepEqual(
    (await readRegistry(f.root)).activeRoots.map((a) => a.token),
    [foreign.token],
  );
  await foreign.release();
  await put(join(f.root, "src/version.js"), "new source");
  const newer = await runLocalBuild({
    root: f.root,
    outDir,
    runner: async ({ candidate }) => {
      await put(join(candidate, "index.html"), "newer accepted source");
      return { code: 0 };
    },
  });
  assert.equal(newer.buildStatus, "SUCCESS");
  assert.equal(
    await readFile(join(target, "index.html"), "utf8"),
    "newer accepted source",
  );
  assert.equal((await readRegistry(f.root)).activeRoots.length, 0);
});

test("source change during runner refuses publication and retains candidate plus last-good", async (t) => {
  const f = await fixture(t, { obsolete: false }),
    outDir = "qa-artifacts/current";
  await put(join(f.root, "src/version.js"), "old source");
  const good = await runLocalBuild({
    root: f.root,
    outDir,
    runner: async ({ candidate }) => {
      await put(join(candidate, "index.html"), "last good");
      return { code: 0 };
    },
  });
  const changed = await runLocalBuild({
    root: f.root,
    outDir,
    runner: async ({ candidate }) => {
      await put(join(candidate, "index.html"), "not frozen source");
      await put(join(f.root, "src/version.js"), "changed during runner");
      return { code: 0 };
    },
  });
  assert.equal(changed.buildStatus, "FAILED");
  assert.equal(changed.error, "buildSourceChanged");
  assert.notEqual(changed.sourceSHA256, changed.sourceAfterSHA256);
  assert.equal(
    await readFile(join(good.target, "index.html"), "utf8"),
    "last good",
  );
  assert.equal(
    await readFile(join(changed.candidate, "index.html"), "utf8"),
    "not frozen source",
  );
  const registry = await readRegistry(f.root);
  assert.equal(registry.latestSuccess, good.target);
  assert.equal(registry.latestFailed, changed.candidate);
  assert.equal(registry.activeRoots.length, 0);
  assert.equal(changed.cleanup.removedFiles, 0);
});

for (const scope of ["root", "ancestor"])
  for (const when of ["before-launch", "during-runner"])
    test(`seal on target ${scope} ${when} preserves frozen output and recoverable candidate`, async (t) => {
      const f = await fixture(t, { obsolete: false }),
        outDir = "qa-artifacts/group/current",
        target = resolve(f.root, outDir),
        seal = join(
          scope === "root" ? target : resolve(target, ".."),
          "SEAL.json",
        );
      const runner = async ({ candidate }) => {
        await put(join(candidate, "index.html"), "sealed last good");
        for (const [copy, canonical] of f.rows) {
          await mkdir(resolve(join(candidate, copy), ".."), {
            recursive: true,
          });
          await copyFile(join(f.root, canonical), join(candidate, copy));
        }
        return { code: 0 };
      };
      const first = await runLocalBuild({ root: f.root, outDir, runner });
      assert.equal(first.buildStatus, "SUCCESS");
      if (when === "before-launch") await put(seal, "frozen marker");
      let calls = 0;
      const refused = await runLocalBuild({
        root: f.root,
        outDir,
        runner: async ({ candidate }) => {
          calls++;
          await runner({ candidate });
          await writeFile(
            join(candidate, "index.html"),
            "recoverable unpromoted",
          );
          await put(seal, "frozen marker");
          return { code: 0 };
        },
      });
      assert.equal(refused.buildStatus, "FAILED");
      assert.equal(refused.error, "frozenBuildTarget");
      assert.equal(calls, when === "before-launch" ? 0 : 1);
      assert.equal(await readFile(seal, "utf8"), "frozen marker");
      assert.equal(
        await readFile(join(target, "index.html"), "utf8"),
        "sealed last good",
      );
      assert.equal(refused.cleanup.removedFiles, 0);
      const registry = await readRegistry(f.root);
      assert.equal(registry.latestSuccess, target);
      assert.equal(
        registry.builds.find((b) => b.id === first.id).status,
        "success",
      );
      assert.equal(registry.activeRoots.length, 0);
      if (when === "during-runner") {
        assert.equal(registry.latestFailed, refused.candidate);
        assert.equal(
          await readFile(join(refused.candidate, "index.html"), "utf8"),
          "recoverable unpromoted",
        );
        for (const [copy] of f.rows)
          assert.equal(await exists(join(refused.candidate, copy)), true);
      } else assert.equal(registry.latestFailed, null);
      for (const [copy, canonical, bytes] of f.rows) {
        assert.equal(await readFile(join(target, copy), "utf8"), bytes);
        assert.equal(await readFile(join(f.root, canonical), "utf8"), bytes);
      }
    });
