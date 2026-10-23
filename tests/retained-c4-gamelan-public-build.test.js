// C4 retained data/shared assertions; retired engine/UI scenarios separately archived.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
test("Homepage compatibility leaves the retained tools plus Pad Station", () => {
  for (const locale of ["id", "en"]) {
    const original = renderDocument("home", locale),
      decorated = publicCandidateHTML(original, { page: "home", locale });
    assert.ok(!original.includes("data-gamelan-link"));
    assert.equal(decorated, original);
    assert.equal((decorated.match(/class="tool-card"/g) ?? []).length, 3);
    assert.ok(!decorated.includes("data-gamelan-link"));
  }
});
