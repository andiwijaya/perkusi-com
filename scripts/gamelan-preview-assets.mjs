import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  readFile,
  readdir,
  stat,
  mkdir,
  copyFile,
  writeFile,
} from "node:fs/promises";
import { resolve, relative, dirname, isAbsolute } from "node:path";
import { flacDeliveryBudget } from "./gamelan-delivery-budget.mjs";
import { copyGamelanSourceForms } from "./gamelan-source-forms.mjs";

export function previewOutputPath(root, outDir) {
  const out = resolve(root, outDir),
    within = relative(resolve(root, "qa-artifacts"), out);
  if (!within || within.startsWith("..") || isAbsolute(within))
    throw Error(
      "Gamelan preview output must be inside a dedicated qa-artifacts subdirectory",
    );
  return out;
}
const hash = async (file) => {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest("hex");
};
// The legacy renderer uses these public URLs in both dev and built previews.
// Vite's public directory does not contain the generated build copies in dev.
// Resolve only the twelve registered originals, with the same integrity check
// used by packaging; never turn this into a general filesystem route.
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
export function gamelanPreviewAssets(
  root,
  { delivery: deliveryKind = "pcm", localV5 = false } = {},
) {
  gamelanDeliveryAliases(root, deliveryKind);
  let output;
  return {
    name: "local-gamelan-preview-delivery",
    configResolved(config) {
      output = gamelanOutputPath(
        root,
        config.build.outDir,
        ["gamelan-public-candidate", "gamelan-v5-public-candidate", "gamelan-v5-canonical-release", "gamelan-v5-final"].includes(
          config.mode,
        ),
      );
    },
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
    async writeBundle() {
      const load = async (path) =>
          JSON.parse(await readFile(resolve(root, path), "utf8")),
        rows = [],
        seen = new Set();
      const add = async (sourcePath, assetPath, expected = {}) => {
        if (
          !sourcePath.startsWith("internal/") ||
          !assetPath.startsWith("/") ||
          /(?:^|\/)\.\.?\//.test(sourcePath + "/" + assetPath) ||
          /[\\?#%]/.test(sourcePath + assetPath)
        )
          throw Error("Unsafe preview asset path");
        const source = resolve(root, sourcePath),
          target = resolve(output, "." + assetPath),
          within = relative(output, target);
        if (
          !within ||
          within.startsWith("..") ||
          isAbsolute(within) ||
          seen.has(assetPath)
        )
          throw Error("Unsafe/duplicate preview output");
        seen.add(assetPath);
        const bytes = (await stat(source)).size,
          sha256 = await hash(source);
        if (
          expected.bytes !== undefined &&
          (bytes !== expected.bytes || sha256 !== expected.sha256)
        )
          throw Error("Preview asset integrity failed: " + assetPath);
        rows.push({ sourcePath, assetPath, bytes, sha256, source, target });
      };
      const delivery = await load("internal/gamelan-delivery/asset-map.json");
      if (
        delivery.files.length !== 202 ||
        delivery.files.reduce((s, a) => s + a.bytes, 0) !== 479867000
      )
        throw Error("Unexpected accepted delivery catalogue");
      let selected = delivery.files;
      if (deliveryKind === "flac") {
        const lossless = await load("internal/gamelan-flac/asset-map.json");
        if (lossless.files.length !== 202)
          throw Error("Incomplete lossless delivery catalogue");
        const byPCM = new Map(
          lossless.files.map((r) => [r.referencePCM.assetPath, r]),
        );
        if (byPCM.size !== 202) throw Error("Duplicate lossless source");
        for (const row of delivery.files) {
          const candidate = byPCM.get(row.assetPath);
          if (
            !candidate ||
            candidate.referencePCM.sha256 !== row.sha256 ||
            candidate.referencePCM.bytes !== row.bytes ||
            candidate.frames !== row.frames ||
            candidate.channels !== row.channels ||
            candidate.rate !== row.rate ||
            candidate.bytes > row.bytes
          )
            throw Error("Lossless source identity/geometry changed");
          // Preserve canonical source bytes; package only the selected transport.
          if ((await hash(resolve(root, row.sourcePath))) !== row.sha256)
            throw Error("Canonical PCM source changed");
        }
        for (const rate of [44100, 48000]) {
          const canonical = await load(
            `internal/instrument-focus/registry-${rate}.json`,
          );
          const converted = await load(
            `internal/gamelan-flac/registry-${rate}.json`,
          );
          for (const bank of canonical.banks)
            for (const sample of bank.samples) {
              const r = byPCM.get(sample.assetPath);
              if (r)
                Object.assign(sample, {
                  assetPath: r.assetPath,
                  sha256: r.sha256,
                  encodedBytes: r.bytes,
                });
            }
          if (JSON.stringify(canonical) !== JSON.stringify(converted))
            throw Error("Lossless catalogue changed musical/source fields");
        }
        selected = lossless.files;
        const budget = flacDeliveryBudget(lossless, {
          44100: await load("internal/gamelan-flac/registry-44100.json"),
          48000: await load("internal/gamelan-flac/registry-48000.json"),
        });
        await writeFile(
          resolve(output, "gamelan-delivery-budget.json"),
          JSON.stringify(budget, null, 2),
        );
      }
      for (const row of selected) await add(row.sourcePath, row.assetPath, row);
      for (const row of await originalGrooveDelivery(root))
        await add(row.sourcePath, row.assetPath, row);
      for (const dir of ["studio-kits", "v3-sounds"]) {
        const m = await load("internal/" + dir + "/manifest.json");
        for (const a of [
          ...(m.kits ?? []).flatMap((k) => k.assets),
          ...(m.instrument?.assets ?? []),
        ])
          await add(
            "internal/" + dir + "/" + a.assetPath,
            "/internal/" + dir + "/" + a.assetPath,
            a,
          );
      }
      // Carry complete notices, source metadata and reference recipes with the files.
      // New note recordings are installed only in the explicit V5 distribution.
      // The manifest links every derivative to the preserved licensed original.
      if (localV5) {
        const m = await load("internal/loop-instruments/manifest.json");
        for (const a of m.assets)
          await add(
            "internal/loop-instruments/" + a.derivative.path,
            "/sounds/loop-instruments/" +
              a.profileRate +
              "/" +
              a.sampleId +
              ".wav",
            a.derivative,
          );
        const walkNotes = async (dir) => {
          for (const entry of await readdir(resolve(root, dir), {
            withFileTypes: true,
          })) {
            const p = dir + "/" + entry.name;
            if (entry.isDirectory()) await walkNotes(p);
            else if (entry.isFile() && !p.includes("/audio/"))
              await add(p, "/" + p);
          }
        };
        await walkNotes("internal/loop-instruments");
      }
      for (const dir of [
        "gamelan-delivery",
        ...(deliveryKind === "flac" ? ["gamelan-flac"] : []),
        "original-groove",
        "studio-kits",
        "v3-sounds",
      ]) {
        for (const entry of await readdir(resolve(root, "internal", dir), {
          withFileTypes: true,
        }))
          if (entry.isFile() && !entry.name.endsWith(".wav"))
            await add(
              "internal/" + dir + "/" + entry.name,
              "/internal/" + dir + "/" + entry.name,
            );
      }
      for (const row of rows) {
        await mkdir(dirname(row.target), { recursive: true });
        await copyFile(row.source, row.target);
        if ((await hash(row.target)) !== row.sha256)
          throw Error("Copied preview asset changed: " + row.assetPath);
      }
      await copyGamelanSourceForms(root, output);
      await writeFile(
        resolve(output, "gamelan-preview-delivery.json"),
        JSON.stringify(
          {
            kind: "local-only-preview",
            production: false,
            pcmMode:
              deliveryKind === "flac"
                ? "FLAC24 lossless container of accepted separate44.1/48k stereo PCM24; native exactness/review packet required; no extra DSP"
                : "byte-exact accepted separate44.1/48k stereo PCM24; codec/CDN decision pending",
            gamelanFiles: 202,
            gamelanBytes: selected.reduce((s, r) => s + r.bytes, 0),
            files: rows.map(({ source, target, ...row }) => {
              void source;
              void target;
              return row;
            }),
          },
          null,
          2,
        ),
      );
    },
  };
}
