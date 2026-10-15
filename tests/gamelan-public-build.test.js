import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  gamelanHostAllowed,
  gamelanBuildMode,
  gamelanPublicMetadata,
} from "../src/gamelan/public-context.js";
import { instrumentRouteContext } from "../src/gamelan/route-context.js";
import { validateSourceForms } from "../scripts/gamelan-source-forms.mjs";
import { publicCandidateHTML } from "../scripts/gamelan-public-pages.mjs";
import { renderDocument } from "../src/app/document.js";
import { gamelanOutputPath } from "../scripts/gamelan-preview-assets.mjs";
import { resolve } from "node:path";
test("only explicit public mode permits existing dist convention; preview still refuses it", () => {
  assert.throws(() => gamelanOutputPath(process.cwd(), "dist", false));
  assert.equal(gamelanOutputPath(process.cwd(), "dist", true), resolve("dist"));
  for (const p of [".", "public", "node_modules", ".git", "../outside"])
    assert.throws(() => gamelanOutputPath(process.cwd(), p, true));
});
test("public Preview host admission requires explicit build flag and exact existing production host", () => {
  for (const host of ["127.0.0.1", "localhost", "[::1]"])
    assert.equal(gamelanHostAllowed(host, false), true);
  for (const host of ["perkusi.com", "www.perkusi.com"]) {
    assert.equal(gamelanHostAllowed(host, false), false);
    assert.equal(gamelanHostAllowed(host, "true"), false);
    assert.equal(gamelanHostAllowed(host, true), true);
  }
  for (const host of [
    "evil.test",
    "perkusi.com.evil.test",
    "pages.dev",
    "wwwperkusi.com",
  ])
    assert.equal(gamelanHostAllowed(host, true), false);
});
test("only opt-in Gamelan modes select shared Studio route and localized public metadata", () => {
  for (const mode of ["production", "development", "public", "audio-prototype"])
    assert.equal(gamelanBuildMode(mode), false);
  for (const mode of ["gamelan-preview", "gamelan-public-candidate"]) {
    assert.deepEqual(
      instrumentRouteContext("/studio/", "?workspace=gamelan", mode),
      { studio: true },
    );
    assert.equal(instrumentRouteContext("/studio/", "", mode), null);
  }
  assert.equal(
    gamelanPublicMetadata("en").canonical,
    "https://perkusi.com/en/gamelan/",
  );
  assert.equal(
    gamelanPublicMetadata("id", { studio: true }).canonical,
    "https://perkusi.com/studio/?workspace=gamelan",
  );
});
test("source publication rejects missing originals, duplicate/traversal archives and oversize/invalid identities", () => {
  const manifest = JSON.parse(
      readFileSync("internal/gamelan-source-forms/manifest.json", "utf8"),
    ),
    credits = JSON.parse(
      readFileSync("internal/gamelan-delivery/credits.json", "utf8"),
    );
  assert.equal(validateSourceForms(manifest, credits), manifest);
  for (const change of [
    (m) => m.archives.pop(),
    (m) => (m.archives[0].name = "../outside.zip"),
    (m) => (m.archives[0].name = m.archives[1].name),
    (m) => (m.archives[0].name = "work-999999-source.zip"),
    (m) => (m.archives[0].sha256 = "broken"),
    (m) => (m.archives[0].bytes = 25 * 1024 * 1024 + 1),
    (m) => (m.namespace = "../outside"),
  ]) {
    const bad = structuredClone(manifest);
    change(bad);
    assert.throws(() => validateSourceForms(bad, credits));
  }
});
test("public-only document decoration links playable Preview with truthful pending copy and keeps index suppression", () => {
  for (const locale of ["id", "en"]) {
    const original = renderDocument("home", locale),
      decorated = publicCandidateHTML(original, { page: "home", locale });
    assert.ok(!original.includes("data-gamelan-link"));
    assert.ok(decorated.includes("data-gamelan-link"));
    assert.ok(
      decorated.includes(
        locale === "id" ? "Validasi budaya" : "Culture, listening",
      ),
    );
    const page = publicCandidateHTML(
      '<html><head><meta name="robots" content="noindex,nofollow"><title>Local</title></head></html>',
      { locale, credits: true },
    );
    assert.ok(page.includes('content="noindex,nofollow"'));
    assert.ok(page.includes('hreflang="x-default"'));
    assert.ok(page.includes("/gamelan/credits/"));
  }
});
