import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { build } from "vite";
import { gamelanDeliveryAliases } from "../scripts/gamelan-preview-assets.mjs";
import original from "../internal/instrument-focus/registry-48000.json" with { type: "json" };

test("compiled canonical catalogue retains PCM identity when the surrounding Gamelan build uses FLAC aliases", async () => {
  const result = await build({
    root: resolve("."),
    configFile: false,
    publicDir: false,
    logLevel: "silent",
    resolve: { alias: gamelanDeliveryAliases(resolve("."), "flac") },
    build: {
      write: false,
      minify: false,
      lib: {
        entry: resolve("src/audio/canonical-registered-assets.js"),
        formats: ["es"],
      },
    },
  });
  const output = (Array.isArray(result) ? result[0] : result).output,
    code = output.find((o) => o.type === "chunk").code,
    compiled = await import(
      "data:text/javascript;base64," + Buffer.from(code).toString("base64")
    ),
    assets = compiled.canonicalRegisteredAssets(48000, (d) => "/" + d.path),
    bank = original.banks.find((b) => b.id === "cdm-pelog"),
    sample = bank.samples[0];
  assert.equal(
    assets.registry.sample(bank.id, bank.version, sample.id).sha256,
    sample.sha256,
  );
  assert.equal(
    assets.nativeURL(sample.assetPath),
    "/internal/gamelan-delivery/audio/48000/s261938.wav",
  );
});

test("the compiled print processor is a separate same-origin asset rather than an inline URL", async () => {
  const result = await build({
    root: resolve("."),
    configFile: false,
    publicDir: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: false,
      lib: {
        entry: resolve("src/audio/canonical-print-voice.js"),
        formats: ["es"],
      },
    },
  });
  const output = (Array.isArray(result) ? result[0] : result).output,
    asset = output.find(
      (o) =>
        o.type === "asset" && o.fileName.includes("canonical-print-processor"),
    ),
    code = output
      .filter((o) => o.type === "chunk")
      .map((o) => o.code)
      .join("\n");
  assert(
    asset,
    "Worklet must be emitted even below the ordinary inline threshold",
  );
  assert(code.includes(asset.fileName));
  assert(!code.includes("createObjectURL"));
});
