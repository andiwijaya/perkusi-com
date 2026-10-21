import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import config from "../vite.config.js";
import { renderDocument } from "../src/app/document.js";
import {
  effectivePagesHeaders,
  pagesHeaderRules,
} from "./helpers/pages-headers.js";
import { publicCandidateHTML } from "../scripts/gamelan-public-pages.mjs";

test("home advertises only ordinary Rhythm Studio and Beatbox in every build mode and locale", () => {
  const cfg = config({ mode: "retirement-release" });
  assert.equal(cfg.define, undefined);
  for (const locale of ["id", "en"]) {
    const html = publicCandidateHTML(renderDocument("home", locale), {
      page: "home",
      locale,
      v5UX: true,
      finalStudio: true,
    });
    assert.equal((html.match(/class="tool-card"/g) ?? []).length, 2);
    assert(html.includes('data-i18n="home.card1.title"'));
    assert(html.includes('data-i18n="home.card3.title"'));
    assert(!html.includes('data-i18n="home.card2.title"'));
    assert(!html.includes('data-i18n="home.card4.title"'));
    assert(!html.includes("data-v5-loop-card"));
    assert(!html.includes('data-i18n="common.gamelanPreview"'));
    assert(!html.includes('data-i18n="common.gamelan"'));
    assert(
      !/href="[^"]*(?:gamelan|loop-station|candidate=canonical)/.test(html),
    );
    for (const mode of [
      "production",
      "retirement-review",
      "retirement-release",
    ]) {
      const transform = config({ mode }).plugins.find(
        (p) => p.name === "localized-static-pages",
      ).transformIndexHtml.handler;
      const path = locale === "en" ? "/en/index.html" : "/index.html";
      const built = transform(readFileSync("." + path, "utf8"), { path });
      assert.equal((built.match(/class="tool-card"/g) ?? []).length, 2);
      assert(
        !/href="[^"]*(?:gamelan|loop-station|candidate=canonical)/.test(built),
      );
    }
  }
});

test("cold ID/EN retired Loop notices retain canonical alternates and recovery while ordinary public Studio remains indexable", () => {
  const cfg = config({ mode: "retirement-release" }),
    transform = cfg.plugins.find((p) => p.name === "localized-static-pages")
      .transformIndexHtml.handler;
  for (const locale of ["id", "en"]) {
    const path = (locale === "en" ? "/en" : "") + "/loop-station/",
      html = transform(readFileSync("." + path + "index.html", "utf8"), {
        path: path + "index.html",
      }),
      meta = { canonical: "https://perkusi.com" + path };
    assert(html.includes('name="robots" content="noindex,follow"'));
    assert(html.includes('rel="canonical" href="' + meta.canonical + '"'));
    for (const lang of ["id", "en"])
      assert(html.includes('hreflang="' + lang + '"'));
    assert(html.includes('data-perkusi-retired="loop"'));
    assert(!/<script\b/i.test(html));
    assert(html.includes("/studio/recovery/originals/?lang=" + locale));
    assert(!meta.canonical.includes("?"));
  }
  const studio = readFileSync("studio/index.html", "utf8");
  assert(
    !transform(studio, { path: "/studio/index.html" }).includes(
      'name="robots" content="noindex,nofollow"',
    ),
  );
});

test("default build selects two-tool retirement while rendering and global mic denial remain bounded", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(
    pkg.scripts.build,
    "node scripts/local-build.mjs --mode retirement-release",
  );
  assert.match(
    readFileSync("public/_headers", "utf8"),
    /camera=\(\), microphone=\(\), geolocation=\(\)/,
  );
  const html = publicCandidateHTML(renderDocument("home", "id"), {
    page: "home",
    locale: "id",
    v5UX: true,
  });
  assert.doesNotMatch(html, /Gamelan Preview|data-loop-link/);
  assert.equal((html.match(/class="tool-card"/g) ?? []).length, 2);
});

test("approved mic permission is same-origin only on exact bilingual Loop Station and Studio document aliases", () => {
  const text = readFileSync("public/_headers", "utf8"),
    rules = pagesHeaderRules(text),
    paths = [
      "/loop-station",
      "/loop-station/",
      "/loop-station/index.html",
      "/en/loop-station",
      "/en/loop-station/",
      "/en/loop-station/index.html",
      "/studio",
      "/studio/",
      "/studio/index.html",
      "/en/studio",
      "/en/studio/",
      "/en/studio/index.html",
    ];
  assert.deepEqual(
    rules.slice(1).map((r) => r.path),
    paths,
  );
  for (const path of paths)
    for (const query of ["", "?lang=id", "?lang=en&view=studio"]) {
      const h = effectivePagesHeaders(
        text,
        "https://perkusi.com" + path + query,
      );
      assert.equal(
        h["permissions-policy"],
        "camera=(), microphone=(self), geolocation=()",
      );
      assert.equal(h["x-frame-options"], "DENY");
      assert.equal(
        h["content-security-policy"],
        rules[0].set["content-security-policy"],
      );
    }
});

test("other documents, missing descendants and lookalike paths retain the original denial and security headers", () => {
  const text = readFileSync("public/_headers", "utf8");
  for (const path of [
    "/",
    "/en/",
    "/beatbox/",
    "/gamelan/",
    "/gamelan/credits/",
    "/privacy.html",
    "/404.html",
    "/assets/app.js",
    "/loop-station/unknown",
    "/loop-station-evil/",
    "/LOOP-STATION/",
    "/en/loop-station/extra",
    "/studio/unknown",
    "/studio-evil/",
    "/STUDIO/",
    "/en/studio/extra",
  ]) {
    const h = effectivePagesHeaders(text, "https://perkusi.com" + path);
    assert.equal(
      h["permissions-policy"],
      "camera=(), microphone=(), geolocation=()",
      path,
    );
    assert.equal(h["x-frame-options"], "DENY");
  }
});

test("failed modes and package commands cannot reactivate retired features", () => {
  for (const mode of [
    "gamelan-preview",
    "gamelan-public-candidate",
    "gamelan-v5-ux",
    "gamelan-v5-public-candidate",
    "gamelan-v5-canonical-release",
    "gamelan-v5-final",
  ])
    assert.throws(() => config({ mode }), /retiredBuildMode/);
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  for (const key of [
    "build:v5",
    "build:gamelan-candidate",
    "build:gamelan-public",
  ])
    assert.equal(pkg.scripts[key], undefined);
});
