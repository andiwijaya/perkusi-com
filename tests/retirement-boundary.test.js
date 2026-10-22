import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { loadConfigFromFile } from "vite";
import { legacyRecoveryHref } from "../src/app/legacy-recovery-link.js";
import { canonicalRecoveryHref } from "../src/studio/canonical-route.js";
import { renderStudio } from "../src/studio/page.js";
import { pagesReleaseMode } from "../scripts/pages-release-policy.mjs";
import { publicCandidateHTML } from "../scripts/gamelan-public-pages.mjs";
import { renderDocument } from "../src/app/document.js";

test("stable recovery navigation keeps the exact ID/EN legacy URL without importing the candidate router", () => {
  for (const locale of ["id", "en"]) {
    assert.equal(legacyRecoveryHref(locale), canonicalRecoveryHref(locale));
    const html = renderStudio(locale);
    assert(
      html.includes(
        'data-st-recovery href="' + legacyRecoveryHref(locale) + '"',
      ),
    );
    assert(!html.includes("candidate=canonical"));
  }
});

test("ordinary owners have no candidate activation and retain separate handoff access", async () => {
  const [main, studio, beatbox] = await Promise.all(
    ["src/main.js", "src/studio/main.js", "src/beatbox/main.js"].map((p) =>
      fs.readFile(p, "utf8"),
    ),
  );
  assert(!main.includes("route-studio"));
  assert(!studio.includes("canonicalCandidate"));
  assert(!studio.includes("canonical-entry"));
  assert(!studio.includes("canonical-workspace"));
  assert(!studio.includes("CANONICAL_"));
  assert(beatbox.includes('import("./canonical-origin.js")'));
  assert(beatbox.includes("attachCanonicalBeatboxOrigin"));
});

test("local review entries isolate unchanged recovery, omit unqualified B2 and retain static retirement routes", async () => {
  const { config } = await loadConfigFromFile(
      { command: "build", mode: "retirement-review" },
      "vite.config.js",
    ),
    input = config.build.rollupOptions.input;
  assert.equal(input.recoveryId, "studio/recovery/index.html");
  assert.equal(input.recoveryEn, "en/studio/recovery/index.html");
  assert.equal(input.retiredLoopId, "loop-station/index.html");
  assert.equal(input.retiredLoopEn, "en/loop-station/index.html");
  assert(!Object.values(input).some((p) => p.includes("internal/recovery")));
  assert.equal(input.retiredGamelanId, "gamelan/index.html");
  assert.equal(input.retiredCreditsEn, "en/gamelan/credits/index.html");
  assert(
    !config.plugins.some((p) => p.name === "local-gamelan-preview-delivery"),
  );
  assert.equal(config.define, undefined);
  assert.throws(
    () =>
      pagesReleaseMode("retirement-review", {
        CF_PAGES: "1",
        CF_PAGES_BRANCH: "main",
        CF_PAGES_COMMIT_SHA: "a".repeat(40),
      }),
    /unreviewedPagesProductionMode/,
  );
});

test("Loop notices have no runtime scripts and link to retained export and stable tools in both languages", async () => {
  for (const locale of ["id", "en"]) {
    const base = locale === "en" ? "en/" : "",
      html = await fs.readFile(base + "loop-station/index.html", "utf8");
    assert(html.includes('lang="' + locale + '"'));
    assert(!/<script\b/i.test(html));
    for (const path of ["studio/", "beatbox/", "studio/recovery/"])
      assert(html.includes("/" + base + path + "?lang=" + locale));
  }
});

test("recovery entries are independent of feature flags and production transforms preserve retirement notice metadata", async () => {
  for (const locale of ["id", "en"])
    for (const page of ["home", "studio", "beatbox", "privacy", "notFound"]) {
      const html = renderDocument(page, locale);
      assert.equal(
        publicCandidateHTML(html, { page, locale, finalStudio: true }),
        html,
      );
      assert(!html.includes("data-gamelan-link"));
      assert(!html.includes("data-loop-link"));
    }
  for (const mode of [
    "production",
    "development",
    "retirement-review",
    "retirement-release",
  ]) {
    const { config } = await loadConfigFromFile(
      { command: "build", mode },
      "vite.config.js",
    );
    assert.equal(
      config.build.rollupOptions.input.recoveryId,
      "studio/recovery/index.html",
    );
    assert.equal(
      config.build.rollupOptions.input.recoveryEn,
      "en/studio/recovery/index.html",
    );
    const transform = config.plugins.find(
      (p) => p.name === "localized-static-pages",
    ).transformIndexHtml.handler;
    for (const path of ["/loop-station/", "/en/loop-station/"]) {
      const html = await fs.readFile(path.slice(1) + "index.html", "utf8");
      assert.equal(transform(html, { path }), html);
    }
  }
});
