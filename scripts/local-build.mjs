import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir, mkdir, rename, statfs } from "node:fs/promises";
import { resolve, join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  workspaceRoot,
  inside,
  noLinks,
  exists,
  atomicJSON,
  controlDir,
  registryLock,
  readRegistry,
  saveRegistry,
  measureTree,
  cleanupBuilds,
  pathsOverlap,
} from "./build-housekeeping.mjs";
async function sourceID(root) {
  const h = createHash("sha256");
  const walk = async (dir) => {
    if (!(await exists(dir))) return;
    for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const p = join(dir, e.name);
      await noLinks(root, p);
      if (e.isDirectory() && e.name !== "__pycache__") await walk(p);
      else if (e.isFile()) {
        h.update(relative(root, p));
        h.update(await readFile(p));
      }
    }
  };
  await walk(join(root, "src"));
  await walk(join(root, "scripts"));
  await walk(join(root, "public"));
  for (const name of ["package.json", "vite.config.js"]) {
    const p = join(root, name);
    if (await exists(p)) h.update(await readFile(p));
  }
  return h.digest("hex");
}
export async function buildPayloadMinimum(
  root,
  mode = "gamelan-public-candidate",
) {
  if (mode === "audio-prototype")
    return (await measureTree(root, join(root, "public"))).bytes;
  let bytes = 0;
  const load = async (p) =>
    (await exists(join(root, p)))
      ? JSON.parse(await readFile(join(root, p), "utf8"))
      : null;
  const delivery =
    process.env.PERKUSI_GAMELAN_DELIVERY ??
    ([
      "gamelan-public-candidate",
      "gamelan-v5-ux",
      "gamelan-v5-public-candidate",
    ].includes(mode)
      ? "flac"
      : "pcm");
  const flac = await load(
      "internal/" +
        (delivery === "flac" ? "gamelan-flac" : "gamelan-delivery") +
        "/asset-map.json",
    ),
    forms = await load("internal/gamelan-source-forms/manifest.json");
  bytes +=
    (flac?.files ?? []).reduce((n, a) => n + a.bytes, 0) +
    (forms?.archives ?? []).reduce((n, a) => n + a.bytes, 0);
  const original = await load("internal/original-groove/manifest.json");
  bytes += (original?.assets ?? []).reduce((n, a) => n + a.bytes, 0);
  for (const name of ["studio-kits", "v3-sounds"]) {
    const m = await load("internal/" + name + "/manifest.json");
    for (const a of [
      ...(m?.kits ?? []).flatMap((k) => k.assets),
      ...(m?.instrument?.assets ?? []),
    ])
      bytes += a.bytes;
  }
  bytes += (await measureTree(root, join(root, "public"))).bytes;
  if (["gamelan-v5-ux", "gamelan-v5-public-candidate"].includes(mode)) {
    const notes = await load("internal/loop-instruments/manifest.json");
    bytes += (notes?.assets ?? []).reduce((n, a) => n + a.derivative.bytes, 0);
    bytes += (
      await measureTree(
        root,
        join(root, "internal/loop-instruments/source-forms"),
      )
    ).bytes;
  }
  if (!Number.isSafeInteger(bytes) || bytes < 0)
    throw Error("invalidBuildPayload");
  return bytes;
}
async function assertUnsealed(root, target) {
  for (let path = target; ; path = dirname(path)) {
    inside(root, path, true);
    await noLinks(root, path);
    if (await exists(join(path, "SEAL.json"))) throw Error("frozenBuildTarget");
    if (path === root) return;
  }
}
export function viteRunner({
  root,
  mode,
  candidate,
  timeoutMs = 120000,
  onPID,
}) {
  return new Promise((res, rej) => {
    const child = spawn(
      process.execPath,
      [
        join(root, "node_modules/vite/bin/vite.js"),
        "build",
        "--mode",
        mode,
        "--outDir",
        candidate,
        "--emptyOutDir",
      ],
      { cwd: root, shell: false, stdio: "inherit", windowsHide: true },
    );
    onPID?.(child.pid);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.once("error", (e) => {
      clearTimeout(timer);
      rej(e);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      res({ code: timedOut ? 124 : (code ?? 1), timedOut, pid: child.pid });
    });
  });
}
export async function runLocalBuild({
  root = workspaceRoot,
  mode = "gamelan-public-candidate",
  outDir = "dist",
  runner = viteRunner,
  timeoutMs = 120000,
  retainPrevious = false,
} = {}) {
  root = resolve(root);
  if (
    ![
      "gamelan-public-candidate",
      "gamelan-preview",
      "gamelan-v5-ux",
      "gamelan-v5-public-candidate",
      "audio-prototype",
    ].includes(mode)
  )
    throw Error("unsupportedBuildMode");
  const target = inside(root, resolve(root, outDir)),
    isDist = target === join(root, "dist");
  if (!isDist) inside(join(root, "qa-artifacts"), target);
  for (const reserved of [
    join(root, "qa-artifacts/local-build"),
    controlDir(root),
  ])
    if (pathsOverlap(target, reserved)) throw Error("reservedBuildTarget");
  await noLinks(root, target);
  const id = randomUUID(),
    candidate = inside(
      join(root, "qa-artifacts"),
      join(root, "qa-artifacts/local-build", "candidate-" + id),
    ),
    receiptPath = join(controlDir(root), "runs", id + ".json"),
    started = Date.now(),
    source = await sourceID(root),
    free = await statfs(root),
    minimum = await buildPayloadMinimum(root, mode),
    recommended = minimum + 256 * 1024 ** 2 + 2 * 1024 ** 3,
    result = {
      version: 1,
      id,
      UTC: new Date().toISOString(),
      mode,
      target,
      candidate,
      sourceSHA256: source,
      buildExit: null,
      buildStatus: "PREPARING",
      cleanup: null,
      preflight: {
        freeBytes: free.bavail * free.bsize,
        payloadMinimumBytes: minimum,
        recommendedFreeBytes: recommended,
      },
      before: await measureTree(root, target),
    };
  if (result.preflight.freeBytes < recommended)
    throw Error("insufficientBuildSpace");
  let registered = false;
  try {
    await registryLock(root, async () => {
      const r = await readRegistry(root);
      await assertUnsealed(root, target);
      if (
        r.activeRoots.some((a) => pathsOverlap(a.root, target)) ||
        r.retainRoots.some((p) => pathsOverlap(p, target))
      )
        throw Error("activeBuildTarget");
      const old = r.builds.find(
        (b) => b.root === target && b.status === "success",
      );
      if ((await exists(target)) && !old && !isDist)
        throw Error("unregisteredExistingBuildTarget");
      if (await exists(candidate)) throw Error("candidateAlreadyExists");
      await mkdir(dirname(candidate), { recursive: true });
      r.builds.push({
        id,
        kind: "managed-build",
        root: candidate,
        target,
        mode,
        status: "building",
        consumersSettled: false,
        sourceSHA256: source,
      });
      for (const [path, kind] of [
        [target, "build-target"],
        [candidate, "build-candidate"],
      ])
        r.activeRoots.push({
          root: path,
          token: id,
          pid: process.pid,
          kind,
        });
      await saveRegistry(root, r);
      registered = true;
    });
    await atomicJSON(receiptPath, result);
    const built = await runner({
      root,
      mode,
      candidate,
      timeoutMs,
      onPID: (pid) => {
        result.pid = pid;
      },
    });
    result.buildExit = built.code;
    result.timedOut = !!built.timedOut;
    // This is an observed fingerprint, not a frozen source checkout. Refuse
    // successful publication if these inputs changed while the runner worked.
    result.sourceAfterSHA256 = await sourceID(root);
    if (built.code === 0) {
      if (result.sourceAfterSHA256 !== source)
        throw Error("buildSourceChanged");
      if (!(await exists(join(candidate, "index.html"))))
        throw Error("incompleteBuildOutput");
      // Traverse without following links before any directory promotion.
      await measureTree(root, candidate);
      await registryLock(root, async () => {
        const r = await readRegistry(root),
          entry = r.builds.find((b) => b.id === id);
        if (
          !entry ||
          ![target, candidate].every((path) =>
            r.activeRoots.some((a) => a.token === id && a.root === path),
          )
        )
          throw Error("buildLeaseLost");
        if (
          r.activeRoots.some(
            (a) => a.token !== id && pathsOverlap(a.root, target),
          ) ||
          r.retainRoots.some((p) => pathsOverlap(p, target))
        )
          throw Error("activeBuildTarget");
        await assertUnsealed(root, target);
        let retired = null,
          previous = r.builds.find(
            (b) => b.root === target && b.status === "success",
          );
        if (await exists(target)) {
          retired = inside(
            join(root, "qa-artifacts"),
            join(root, "qa-artifacts/local-build", "retired-" + id),
          );
          await noLinks(root, target);
          await noLinks(root, retired);
          // Both resolved absolute paths are strictly inside this workspace; the
          // previous complete output moves only after the fresh build succeeded.
          inside(root, target);
          inside(root, retired);
          await rename(target, retired);
        }
        try {
          await mkdir(dirname(target), { recursive: true });
          inside(root, candidate);
          inside(root, target);
          await rename(candidate, target);
        } catch (e) {
          if (retired) {
            inside(root, retired);
            inside(root, target);
            await rename(retired, target);
          }
          throw e;
        }
        if (retired) {
          if (previous) {
            previous.root = retired;
            previous.status = "obsolete";
            previous.consumersSettled = true;
            if (retainPrevious) {
              r.retainRoots.push(retired);
              result.previousRetainedRoot = retired;
            }
          } else {
            r.builds.push({
              id: "retained-" + id,
              kind: "managed-build",
              root: retired,
              status: "retained",
              consumersSettled: true,
            });
            r.retainRoots.push(retired);
          }
        }
        // A later successful build resolves only this wrapper's earlier failed
        // candidates for the same target; explicit review retains still win.
        for (const old of r.builds)
          if (
            old.id !== id &&
            old.target === target &&
            old.status === "failed"
          ) {
            old.status = "obsolete";
            old.consumersSettled = true;
          }
        entry.root = target;
        entry.status = "success";
        entry.consumersSettled = true;
        r.activeRoots = r.activeRoots.filter((a) => a.token !== id);
        r.latestSuccess = target;
        if (
          r.latestFailed &&
          r.builds.some((b) => b.root === r.latestFailed && b.target === target)
        )
          r.latestFailed = null;
        try {
          await saveRegistry(root, r);
        } catch (e) {
          inside(root, target);
          inside(root, candidate);
          await rename(target, candidate);
          if (retired) {
            inside(root, retired);
            inside(root, target);
            await rename(retired, target);
          }
          throw e;
        }
      });
      result.buildStatus = "SUCCESS";
    } else result.buildStatus = "FAILED";
  } catch (e) {
    result.buildExit = result.buildExit || 1;
    result.buildStatus = "FAILED";
    result.error = e.message;
  } finally {
    if (registered && result.buildStatus !== "SUCCESS")
      await registryLock(root, async () => {
        const r = await readRegistry(root),
          entry = r.builds.find((b) => b.id === id);
        if (entry) {
          entry.status = "failed";
          entry.consumersSettled = true;
          r.latestFailed = entry.root;
        }
        r.activeRoots = r.activeRoots.filter((a) => a.token !== id);
        await saveRegistry(root, r);
      });
    result.durationMs = Date.now() - started;
    result.after = await measureTree(root, target);
    await atomicJSON(receiptPath, result);
    try {
      const c = await cleanupBuilds({ root, apply: true });
      result.cleanup = {
        status: c.status,
        removedFiles: c.removedFiles,
        removedBytes: c.removedBytes,
        receiptPath: c.receiptPath,
      };
    } catch (e) {
      result.cleanup = { status: "SKIPPED_OR_FAILED", error: e.message };
    }
    const fs = await statfs(root);
    result.freeAfterBytes = fs.bavail * fs.bsize;
    await atomicJSON(receiptPath, result);
  }
  return { ...result, receiptPath };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2),
    options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--retain-previous") {
      options.retainPrevious = true;
      continue;
    }
    if (!["--mode", "--outDir"].includes(args[i]) || !args[i + 1])
      throw Error("Use --mode MODE --outDir PATH");
    options[args[i] === "--mode" ? "mode" : "outDir"] = args[++i];
  }
  const result = await runLocalBuild(options);
  console.log(
    JSON.stringify({
      buildStatus: result.buildStatus,
      exit: result.buildExit,
      target: result.target,
      cleanup: result.cleanup,
      receipt: result.receiptPath,
    }),
  );
  process.exitCode = result.buildExit ?? 1;
}
