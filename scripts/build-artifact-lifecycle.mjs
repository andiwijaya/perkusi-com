import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import {
  workspaceRoot,
  inside,
  noLinks,
  exists,
  registryLock,
  readRegistry,
  saveRegistry,
  pathsOverlap,
  sealedBuildAncestor,
} from "./build-housekeeping.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const validSHA = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const targetPath = (root, target) =>
  inside(join(root, "qa-artifacts"), resolve(root, target));

// Verify a completed custom builder's entire artifact, including unexpected files.
// Registration does not grant cleanup authority; a separate retirement is required.
async function verifyArtifact(root, path, files) {
  await noLinks(root, path);
  if (!Array.isArray(files) || !files.length)
    throw Error("missingArtifactManifest");
  const expected = new Map();
  for (const item of files) {
    if (
      typeof item.path !== "string" ||
      item.path.includes("\\") ||
      item.path !==
        relative(path, inside(path, resolve(path, item.path))).replaceAll(
          "\\",
          "/",
        ) ||
      !validSHA(item.sha256) ||
      !Number.isSafeInteger(item.bytes) ||
      item.bytes < 0 ||
      expected.has(item.path)
    )
      throw Error("invalidArtifactManifest");
    expected.set(item.path, item);
  }
  let count = 0;
  const visit = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      await noLinks(root, file);
      if (entry.isDirectory()) {
        await visit(file);
        continue;
      }
      if (!entry.isFile()) throw Error("unsafeArtifactFile");
      const key = relative(path, file).replaceAll("\\", "/"),
        item = expected.get(key);
      if (!item) throw Error("unexpectedArtifactFile");
      const before = await lstat(file, { bigint: true }),
        digest = createHash("sha256");
      for await (const chunk of createReadStream(file)) digest.update(chunk);
      const after = await lstat(file, { bigint: true });
      for (const field of ["dev", "ino", "size", "mtimeNs", "ctimeNs"])
        if (before[field] !== after[field]) throw Error("artifactChanged");
      if (
        Number(after.size) !== item.bytes ||
        digest.digest("hex") !== item.sha256
      )
        throw Error("artifactHashMismatch");
      count++;
    }
  };
  await visit(path);
  if (count !== expected.size || !expected.has("index.html"))
    throw Error("incompleteArtifact");
  const sorted = [...expected.values()]
    .map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return {
    manifestSHA256: sha(JSON.stringify(sorted)),
    files: count,
    bytes: sorted.reduce((n, row) => n + row.bytes, 0),
  };
}

export async function registerCompletedArtifact({
  root = workspaceRoot,
  target,
  receipt,
  files,
}) {
  root = resolve(root);
  const path = targetPath(root, target);
  if (
    !receipt ||
    receipt.buildStatus !== "SUCCESS" ||
    receipt.buildExit !== 0 ||
    typeof receipt.id !== "string" ||
    !receipt.id ||
    !validSHA(receipt.sourceSHA256) ||
    receipt.sourceSHA256 !== receipt.sourceAfterSHA256 ||
    resolve(receipt.target) !== path
  )
    throw Error("invalidCompletedArtifact");
  return registryLock(root, async () => {
    const r = await readRegistry(root);
    if (r.activeRoots.some((a) => pathsOverlap(path, a.root)))
      throw Error("activeBuildArtifact");
    if (r.builds.some((b) => b.root !== path && pathsOverlap(path, b.root)))
      throw Error("overlappingBuildArtifact");
    const identity = await verifyArtifact(root, path, files),
      entry = r.builds.find((b) => b.root === path);
    if (
      entry &&
      (entry.id !== receipt.id ||
        entry.status !== "success" ||
        entry.sourceSHA256 !== receipt.sourceSHA256 ||
        (entry.artifact &&
          entry.artifact.manifestSHA256 !== identity.manifestSHA256))
    )
      throw Error("registeredArtifactConflict");
    if (!entry && r.builds.some((b) => b.id === receipt.id))
      throw Error("duplicateBuildIdentity");
    const registered = entry ?? {
      id: receipt.id,
      kind: "managed-build",
      root: path,
      target: path,
      mode: receipt.mode,
      status: "success",
      consumersSettled: true,
      sourceSHA256: receipt.sourceSHA256,
    };
    registered.artifact = identity;
    if (!entry) r.builds.push(registered);
    // Custom rollback artifacts are retained independently of latestSuccess.
    if (!r.retainRoots.includes(path)) r.retainRoots.push(path);
    await saveRegistry(root, r);
    return structuredClone(registered);
  });
}

export async function retireCompletedArtifact({
  root = workspaceRoot,
  target,
  successor,
  successorFiles,
  releaseReview = false,
  reason,
}) {
  root = resolve(root);
  const path = targetPath(root, target),
    next = targetPath(root, successor);
  if (pathsOverlap(path, next) || typeof reason !== "string" || !reason.trim())
    throw Error("invalidArtifactRetirement");
  await noLinks(root, path);
  await noLinks(root, next);
  return registryLock(root, async () => {
    const r = await readRegistry(root),
      entry = r.builds.find((b) => b.root === path),
      replacement = r.builds.find((b) => b.root === next);
    if (
      !entry ||
      entry.kind !== "managed-build" ||
      entry.status !== "success" ||
      entry.consumersSettled !== true ||
      !replacement ||
      replacement.kind !== "managed-build" ||
      replacement.status !== "success" ||
      replacement.consumersSettled !== true ||
      !replacement.artifact ||
      !(await exists(join(next, "index.html")))
    )
      throw Error("unsettledArtifactRetirement");
    if (
      [r.latestSuccess, r.latestFailed]
        .filter(Boolean)
        .some((p) => pathsOverlap(path, p)) ||
      r.activeRoots.some(
        (a) => pathsOverlap(path, a.root) || pathsOverlap(next, a.root),
      ) ||
      r.retainRoots.some((p) => p !== path && pathsOverlap(path, p))
    )
      throw Error("protectedBuildArtifact");
    const liveSuccessor = await verifyArtifact(root, next, successorFiles);
    if (liveSuccessor.manifestSHA256 !== replacement.artifact.manifestSHA256)
      throw Error("successorArtifactChanged");
    // A seal protects the complete evidence packet, not only its HTML.
    if (await sealedBuildAncestor(root, path))
      throw Error("sealedBuildArtifact");
    entry.status = "obsolete";
    entry.retirement = {
      successor: next,
      successorId: replacement.id,
      reason: reason.trim(),
      UTC: new Date().toISOString(),
      releaseReview,
    };
    if (releaseReview) r.retainRoots = r.retainRoots.filter((p) => p !== path);
    if (!r.retainRoots.includes(next)) r.retainRoots.push(next);
    await saveRegistry(root, r);
    return structuredClone(entry);
  });
}
