import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { loadConfigFromFile } from "vite";
import {
  retirementProvenance,
  RETIREMENT_PROVENANCE,
} from "../scripts/retirement-provenance.mjs";

test("all four retired Gamelan routes are script-free and preserve same-tab data recovery and complete credits", async () => {
  const credits = JSON.parse(
      await fs.readFile("internal/gamelan-delivery/credits.json"),
    ),
    flags = JSON.parse(
      await fs.readFile("internal/gamelan-delivery/quality-flags.json"),
    );
  for (const locale of ["id", "en"])
    for (const details of [false, true]) {
      const prefix = locale === "en" ? "en/" : "",
        path = prefix + "gamelan/" + (details ? "credits/" : "") + "index.html",
        html = await fs.readFile(path, "utf8");
      assert(
        !/<script\b|on(?:load|click)\s*=|target\s*=\s*["']_blank/i.test(html),
      );
      assert(
        html.includes(
          "/" + prefix + "studio/recovery/originals/?lang=" + locale,
        ),
      );
      assert(html.includes('data-perkusi-retired="gamelan"'));
      assert(html.includes(credits.librarySourceURL));
      if (details) {
        for (const row of credits.rows) {
          assert(html.includes(row.sourcePage));
          assert(html.includes(row.sourceIdentity.SHA256));
          assert(html.includes(row.licenseURL));
        }
        for (const flag of flags) assert(html.includes(flag.sampleId));
      }
    }
});

test("candidate/production transforms cannot revive Gamelan notices or omit the recovery entries", async () => {
  for (const mode of ["retirement-review", "retirement-release"]) {
    const { config } = await loadConfigFromFile(
        { command: "build", mode },
        "vite.config.js",
      ),
      transform = config.plugins.find(
        (p) => p.name === "localized-static-pages",
      ).transformIndexHtml.handler;
    for (const path of [
      "/gamelan/",
      "/gamelan/credits/",
      "/en/gamelan/",
      "/en/gamelan/credits/",
    ]) {
      const html = await fs.readFile(path.slice(1) + "index.html", "utf8");
      assert.equal(transform(html, { path }), html);
    }
    assert.equal(
      config.build.rollupOptions.input.originalsId,
      "studio/recovery/originals/index.html",
    );
    assert.equal(
      config.build.rollupOptions.input.recoveryEn,
      "en/studio/recovery/index.html",
    );
  }
});

test("static provenance publication preserves exact license/manifest bytes and emits no audio/archive payload", async () => {
  const emitted = [],
    plugin = retirementProvenance(process.cwd());
  await plugin.generateBundle.call({ emitFile: (item) => emitted.push(item) });
  assert.equal(emitted.length, 11);
  for (const row of emitted) {
    assert(RETIREMENT_PROVENANCE.includes(row.fileName));
    assert(!/\.(wav|flac|zip|f32le|webm)$/.test(row.fileName));
    assert.deepEqual(row.source, await fs.readFile(row.fileName));
  }
});
