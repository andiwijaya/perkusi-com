import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  readFile,
  writeFile,
  rename,
  mkdir,
  open,
  unlink,
  lstat,
  readdir,
  statfs,
} from "node:fs/promises";
import {
  resolve,
  relative,
  join,
  isAbsolute,
  dirname,
  extname,
} from "node:path";
import { fileURLToPath } from "node:url";
export const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
const policy = JSON.parse(
  await readFile(
    new URL("./build-retention-policy.json", import.meta.url),
    "utf8",
  ),
);
const exactRules = [
  [
    "source-forms/cdm-porto-candidate-1.0.0",
    ".zip",
    "internal/gamelan-source-forms/archives",
  ],
  [
    "sounds/cdm-porto-flac-candidate/44100",
    ".flac",
    "internal/gamelan-flac/audio/44100",
  ],
  [
    "sounds/cdm-porto-flac-candidate/48000",
    ".flac",
    "internal/gamelan-flac/audio/48000",
  ],
];
if (
  JSON.stringify(
    policy.rules.map((r) => [
      r.copyRelativeRoot,
      r.extension,
      r.canonicalRelativeRoot,
    ]),
  ) !== JSON.stringify(exactRules)
)
  throw Error("invalidRetentionPolicy");
const hash = (b) => createHash("sha256").update(b).digest("hex");
export const controlDir = (root) =>
  join(root, "qa-artifacts", "build-retention");
export function inside(root, path, allowRoot = false) {
  const p = resolve(path),
    r = relative(resolve(root), p);
  if (
    (!r && !allowRoot) ||
    r === ".." ||
    r.startsWith("..\\") ||
    r.startsWith("../") ||
    isAbsolute(r)
  )
    throw Error("unsafeBuildPath");
  return p;
}
export async function noLinks(root, path) {
  const p = inside(root, path, true);
  let current = resolve(root);
  for (const part of [
    "",
    ...relative(current, p).split(/[\\/]/).filter(Boolean),
  ]) {
    if (part) current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw Error("reparseBuildPath");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  return p;
}
export async function exists(p) {
  try {
    await lstat(p);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
}
export async function atomicJSON(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = path + "." + randomUUID() + ".tmp";
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
  await rename(temp, path);
}
export async function readRegistry(root) {
  const p = join(controlDir(root), "registry.json");
  await noLinks(root, p);
  if (!(await exists(p)))
    return {
      version: 1,
      builds: [],
      activeRoots: [],
      retainRoots: [],
      latestSuccess: null,
      latestFailed: null,
    };
  const r = JSON.parse(await readFile(p, "utf8"));
  if (
    r.version !== 1 ||
    !Array.isArray(r.builds) ||
    !Array.isArray(r.activeRoots) ||
    !Array.isArray(r.retainRoots)
  )
    throw Error("invalidBuildRegistry");
  return r;
}
export async function registryLock(root, fn) {
  const dir = controlDir(root);
  await noLinks(root, dir);
  await mkdir(dir, { recursive: true });
  const path = join(dir, "operation.lock"),
    token = randomUUID();
  let handle;
  try {
    handle = await open(path, "wx");
  } catch (e) {
    if (e.code === "EEXIST") throw Error("buildRegistryBusy", { cause: e });
    throw e;
  }
  try {
    await handle.writeFile(token);
    return await fn();
  } finally {
    await handle.close();
    if ((await readFile(path, "utf8")) === token) await unlink(path);
  }
}
export async function saveRegistry(root, r) {
  await atomicJSON(join(controlDir(root), "registry.json"), r);
}
export async function acquireBuildConsumer({
  root = workspaceRoot,
  target,
  kind = "test",
}) {
  const path = inside(root, resolve(root, target));
  if (path !== resolve(root, "dist")) inside(join(root, "qa-artifacts"), path);
  await noLinks(root, path);
  const token = randomUUID();
  let released = false;
  await registryLock(root, async () => {
    const r = await readRegistry(root);
    r.activeRoots.push({ root: path, kind, token, pid: process.pid });
    await saveRegistry(root, r);
  });
  return Object.freeze({
    root: path,
    token,
    async release() {
      if (released) return;
      await registryLock(root, async () => {
        const r = await readRegistry(root);
        r.activeRoots = r.activeRoots.filter((a) => a.token !== token);
        await saveRegistry(root, r);
      });
      released = true;
    },
  });
}
export async function releaseObsoleteReview({ root = workspaceRoot, target }) {
  const path = inside(join(root, "qa-artifacts"), resolve(root, target));
  await noLinks(root, path);
  await registryLock(root, async () => {
    const r = await readRegistry(root),
      entry = r.builds.find((b) => b.root === path);
    if (!entry || entry.status !== "obsolete" || entry.kind !== "managed-build")
      throw Error("notObsoleteManagedBuild");
    r.retainRoots = r.retainRoots.filter((p) => p !== path);
    await saveRegistry(root, r);
  });
}
const overlap = (a, b) => {
  const child = (x, y) => {
    const r = relative(resolve(x), resolve(y));
    return !r || (!r.startsWith("..") && !isAbsolute(r));
  };
  return child(a, b) || child(b, a);
};
export const pathsOverlap = overlap;
function retainReason(root, entry, r) {
  const path = resolve(entry.root);
  if (path === resolve(root, "dist")) return "rootDistProtected";
  for (const p of [r.latestSuccess, r.latestFailed, ...r.retainRoots].filter(
    Boolean,
  ))
    if (overlap(path, p)) return "latestOrRetained";
  for (const a of r.activeRoots)
    if (overlap(path, a.root)) return "activeConsumer";
  if (
    entry.status !== "obsolete" ||
    entry.kind !== "managed-build" ||
    entry.consumersSettled !== true
  )
    return "notExplicitlyObsolete";
  return null;
}
export async function measureTree(root, path) {
  await noLinks(root, path);
  let bytes = 0,
    files = 0;
  if (!(await exists(path))) return { bytes, files };
  const visit = async (p) => {
    for (const e of await readdir(p, { withFileTypes: true })) {
      const q = join(p, e.name);
      await noLinks(root, q);
      if (e.isDirectory()) await visit(q);
      else if (e.isFile()) {
        const s = await lstat(q);
        bytes += s.size;
        files++;
      }
    }
  };
  await visit(path);
  return { bytes, files };
}
async function digestFile(p) {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(p)) h.update(chunk);
  return h.digest("hex");
}
async function metadata(p) {
  const s = await lstat(p, { bigint: true });
  if (!s.isFile() || s.isSymbolicLink()) throw Error("unsafeBuildFile");
  return {
    bytes: Number(s.size),
    mtimeNs: String(s.mtimeNs),
    ctimeNs: String(s.ctimeNs),
    dev: String(s.dev),
    ino: String(s.ino),
  };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export async function planCleanup(root, r) {
  const entries = [],
    excluded = [],
    measurements = [],
    mapping = new Map();
  for (const entry of r.builds) {
    if (entry.status !== "obsolete") continue;
    let target;
    try {
      target = inside(join(root, "qa-artifacts"), entry.root);
      await noLinks(root, target);
    } catch (e) {
      excluded.push({ root: entry.root, reason: e.message });
      continue;
    }
    const reason = retainReason(root, entry, r);
    if (reason) {
      excluded.push({ root: target, reason });
      continue;
    }
    measurements.push({
      root: target,
      before: await measureTree(root, target),
    });
    for (const rule of policy.rules) {
      const copyRoot = inside(target, join(target, rule.copyRelativeRoot));
      try {
        await noLinks(root, copyRoot);
      } catch (e) {
        excluded.push({ path: copyRoot, reason: e.message });
        continue;
      }
      if (!(await exists(copyRoot))) continue;
      for (const e of await readdir(copyRoot, { withFileTypes: true })) {
        if (e.isSymbolicLink()) {
          excluded.push({
            path: join(copyRoot, e.name),
            reason: "reparseBuildPath",
          });
          continue;
        }
        if (
          !e.isFile() ||
          extname(e.name) !== rule.extension ||
          !/^[A-Za-z0-9_.-]+$/.test(e.name)
        )
          continue;
        const copy = inside(copyRoot, join(copyRoot, e.name)),
          canonical = inside(
            root,
            join(root, rule.canonicalRelativeRoot, e.name),
          );
        try {
          await noLinks(root, copy);
          await noLinks(root, canonical);
          if (
            r.builds.some(
              (b) => b.status === "obsolete" && overlap(b.root, canonical),
            )
          )
            throw Error("canonicalIsCleanupTarget");
          if (!(await exists(canonical))) throw Error("missingCanonical");
          const cm = await metadata(copy),
            om = await metadata(canonical),
            canonicalHash = await digestFile(canonical),
            copyHash = await digestFile(copy);
          if (cm.bytes !== om.bytes || copyHash !== canonicalHash)
            throw Error("hashMismatch");
          if (
            !same(cm, await metadata(copy)) ||
            !same(om, await metadata(canonical))
          )
            throw Error("metadataChanged");
          const key = rule.copyRelativeRoot + "/" + e.name,
            map = {
              copyRelative: key,
              canonicalRelative: rule.canonicalRelativeRoot + "/" + e.name,
              bytes: om.bytes,
              sha256: canonicalHash,
            };
          mapping.set(key, map);
          entries.push({
            root: target,
            copy,
            canonical,
            key,
            copyMetadata: cm,
            canonicalMetadata: om,
            sha256: canonicalHash,
            bytes: cm.bytes,
          });
        } catch (err) {
          excluded.push({ path: copy, reason: err.message });
        }
      }
    }
  }
  return {
    entries,
    excluded,
    measurements,
    mapping: [...mapping.values()].sort((a, b) =>
      a.copyRelative.localeCompare(b.copyRelative),
    ),
  };
}
export async function cleanupBuilds({
  root = workspaceRoot,
  apply = false,
  beforeRemove,
} = {}) {
  root = resolve(root);
  return registryLock(root, async () => {
    const r = await readRegistry(root),
      registryPath = join(controlDir(root), "registry.json"),
      registryHash = (await exists(registryPath))
        ? hash(await readFile(registryPath))
        : null,
      plan = await planCleanup(root, r),
      fs = await statfs(root),
      id = randomUUID(),
      receipt = {
        version: 1,
        id,
        UTC: new Date().toISOString(),
        mode: apply ? "apply" : "dry-run",
        status: "PLANNED",
        eligibleFiles: plan.entries.length,
        eligibleBytes: plan.entries.reduce((n, e) => n + e.bytes, 0),
        removedFiles: 0,
        removedBytes: 0,
        excluded: plan.excluded,
        measurements: plan.measurements,
        freeBeforeBytes: fs.bavail * fs.bsize,
        restorationManifest: null,
        removed: [],
      };
    const receiptPath = join(controlDir(root), "receipts", id + ".json");
    try {
      if (plan.entries.length) {
        const data = {
            version: 1,
            policySHA256: policy.sourceSHA256,
            files: plan.mapping,
          },
          encoded = JSON.stringify(data, null, 2) + "\n",
          mapHash = hash(encoded),
          mapPath = join(controlDir(root), "restore-" + mapHash + ".json");
        await noLinks(root, mapPath);
        if (await exists(mapPath)) {
          if (hash(await readFile(mapPath)) !== mapHash)
            throw Error("recoveryMapMismatch");
        } else await writeFile(mapPath, encoded, { flag: "wx" });
        receipt.restorationManifest = {
          path: relative(root, mapPath),
          sha256: mapHash,
        };
      }
      // Persist the recovery identity and intended roots before any removal.
      await atomicJSON(receiptPath, receipt);
      if (apply) {
        await beforeRemove?.(plan);
        // Recheck all authority before the first file is removed.
        if (
          registryHash !==
          ((await exists(registryPath))
            ? hash(await readFile(registryPath))
            : null)
        )
          throw Error("buildRegistryChanged");
        for (const e of plan.entries) {
          const live = await readRegistry(root),
            entry = live.builds.find((b) => resolve(b.root) === e.root);
          if (!entry || retainReason(root, entry, live))
            throw Error("targetBecameActive");
          await noLinks(root, e.copy);
          await noLinks(root, e.canonical);
          if (
            !same(e.copyMetadata, await metadata(e.copy)) ||
            !same(e.canonicalMetadata, await metadata(e.canonical)) ||
            (await digestFile(e.copy)) !== e.sha256 ||
            (await digestFile(e.canonical)) !== e.sha256
          )
            throw Error("cleanupRecheckFailed");
        }
        for (const e of plan.entries) {
          // Registry remains locked; use only the individually verified literal file.
          if (hash(await readFile(registryPath)) !== registryHash)
            throw Error("buildRegistryChanged");
          if (
            !same(e.copyMetadata, await metadata(e.copy)) ||
            !same(e.canonicalMetadata, await metadata(e.canonical))
          )
            throw Error("metadataChanged");
          await unlink(e.copy);
          receipt.removedFiles++;
          receipt.removedBytes += e.bytes;
          receipt.removed.push({ root: e.root, key: e.key });
          if (
            (await exists(e.copy)) ||
            (await digestFile(e.canonical)) !== e.sha256
          )
            throw Error("cleanupVerificationFailed");
        }
      }
      receipt.status = apply ? "APPLIED" : "DRY_RUN";
    } catch (e) {
      receipt.status = "REFUSED_OR_PARTIAL";
      receipt.error = e.message;
    } finally {
      for (const m of receipt.measurements)
        m.after = await measureTree(root, m.root);
      const after = await statfs(root);
      receipt.freeAfterBytes = after.bavail * after.bsize;
      await atomicJSON(receiptPath, receipt);
    }
    return { ...receipt, receiptPath };
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await cleanupBuilds({
    apply: process.argv.includes("--apply"),
  });
  console.log(
    JSON.stringify({
      status: result.status,
      mode: result.mode,
      removedFiles: result.removedFiles,
      removedBytes: result.removedBytes,
      receipt: result.receiptPath,
    }),
  );
  if (result.status === "REFUSED_OR_PARTIAL") process.exitCode = 1;
}
