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
        ["gamelan-public-candidate", "gamelan-v5-public-candidate"].includes(
          config.mode,
        ),
      );
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
      const original = await load("internal/original-groove/manifest.json");
      for (const a of original.assets)
        await add(
          "internal/original-groove/" + a.assetPath,
          "/sounds/original-groove/" + a.assetPath.split("/").at(-1),
          a,
        );
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
