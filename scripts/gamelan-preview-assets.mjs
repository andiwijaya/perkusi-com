// Archived metadata aliases, safe output paths and12-original dev delivery only.
// No failed-feature build mode, bank/archive copy or writeBundle hook remains.
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
const hash = async (file) => {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest("hex");
};
export function previewOutputPath(root, outDir) {
  const out = resolve(root, outDir),
    within = relative(resolve(root, "qa-artifacts"), out);
  if (!within || within.startsWith("..") || isAbsolute(within))
    throw Error(
      "Gamelan preview output must be inside a dedicated qa-artifacts subdirectory",
    );
  return out;
}
export async function originalGrooveDelivery(root) {
  const manifest = JSON.parse(
    await readFile(
      resolve(root, "internal/original-groove/manifest.json"),
      "utf8",
    ),
  );
  if (!Array.isArray(manifest.assets) || manifest.assets.length !== 12)
    throw Error("Incomplete original groove catalogue");
  const seen = new Set(),
    rows = [];
  for (const a of manifest.assets) {
    if (
      !/^audio\/[a-z-]+-[12]\.wav$/.test(a.assetPath) ||
      !/^[a-f0-9]{64}$/.test(a.sha256)
    )
      throw Error("Unsafe original groove asset");
    const sourcePath = "internal/original-groove/" + a.assetPath;
    const source = resolve(root, sourcePath),
      assetPath = "/sounds/original-groove/" + a.assetPath.split("/").at(-1);
    if (seen.has(assetPath)) throw Error("Duplicate original groove asset");
    seen.add(assetPath);
    if (
      (await stat(source)).size !== a.bytes ||
      (await hash(source)) !== a.sha256
    )
      throw Error("Original groove integrity failed: " + assetPath);
    rows.push(
      Object.freeze({
        source,
        sourcePath,
        assetPath,
        bytes: a.bytes,
        sha256: a.sha256,
      }),
    );
  }
  return Object.freeze(rows);
}
export function gamelanOutputPath(root, outDir, publicCandidate = false) {
  const out = resolve(root, outDir);
  if (publicCandidate === true && out === resolve(root, "dist")) return out;
  return previewOutputPath(root, outDir);
}
export function gamelanDeliveryAliases(root, delivery) {
  if (!["pcm", "flac"].includes(delivery))
    throw Error("Unsupported Gamelan delivery candidate");
  return delivery === "flac"
    ? [44100, 48000].map((rate) => ({
        find: `../../internal/instrument-focus/registry-${rate}.json`,
        replacement: resolve(
          root,
          `internal/gamelan-flac/registry-${rate}.json`,
        ),
        // The canonical adapter resolves verified original WAV URLs and PCM
        // receipts. Keep its registry paired with those bytes while all legacy
        // Gamelan consumers still receive the configured FLAC delivery bank.
        customResolver(updatedId, importer) {
          return {
            id: importer
              ?.replaceAll("\\", "/")
              .endsWith("/src/audio/canonical-registered-assets.js")
              ? resolve(root, `internal/instrument-focus/registry-${rate}.json`)
              : updatedId,
          };
        },
      }))
    : [];
}
export function candidateOutput(root, outDir) {
  const path = previewOutputPath(root, outDir);
  if (existsSync(path))
    throw Error(
      "Candidate output already exists; use a fresh QA directory to preserve review evidence",
    );
  return path;
}
export function gamelanPreviewAssets(root) {
  return {
    name: "legacy-original-dev-delivery",
    async configureServer(server) {
      const rows = new Map(
        (await originalGrooveDelivery(root)).map((row) => [row.assetPath, row]),
      );
      server.middlewares.use((req, res, next) => {
        if (!["GET", "HEAD"].includes(req.method)) return next();
        const row = rows.get(new URL(req.url, "http://localhost").pathname);
        if (!row) return next();
        const etag = '"' + row.sha256 + '"';
        res.setHeader("ETag", etag);
        res.setHeader("Cache-Control", "no-cache");
        if (req.headers["if-none-match"] === etag) {
          res.statusCode = 304;
          return res.end();
        }
        res.setHeader("Content-Type", "audio/wav");
        res.setHeader("Content-Length", row.bytes);
        if (req.method === "HEAD") return res.end();
        createReadStream(row.source).on("error", next).pipe(res);
      });
    },
  };
}
