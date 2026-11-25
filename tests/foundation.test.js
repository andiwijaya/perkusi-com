import test from "node:test";
import assert from "node:assert/strict";
import { messages } from "../src/i18n/messages.js";
import {
  createTranslator,
  resolveLocale,
  readLocale,
  saveLocale,
  localeKey,
} from "../src/i18n/locale.js";
import {
  pagePath,
  navigationHref,
  pageFromPath,
  buildEntries,
  indexablePages,
  pageAlternates,
  pages,
  siteOrigin,
} from "../src/app/routes.js";
import { renderSitemap } from "../scripts/seo-sitemap.mjs";
import { renderDocument, escapeHtml } from "../src/app/document.js";
import { createSession } from "../src/app/session.js";

test("catalog parity, no empty values, complete rendering in both languages", () => {
  assert.deepEqual(
    Object.keys(messages.id).sort(),
    Object.keys(messages.en).sort(),
  );
  for (const locale of ["id", "en"]) {
    assert(
      Object.values(messages[locale]).every(
        (value) => typeof value === "string" && value.trim(),
      ),
    );
    for (const page of pages) {
      const html = renderDocument(page, locale);
      assert(html.includes('lang="' + locale + '"'));
      assert(
        !html.includes("undefined") && !html.includes("translation_missing"),
      );
      assert(html.includes('hreflang="id"') && html.includes('hreflang="en"'));
    }
  }
});
test("new visitors default to id independently of browser preference", () => {
  assert.equal(
    resolveLocale({ pathname: "/", navigatorLanguage: "en-US" }),
    "id",
  );
  assert.equal(
    resolveLocale({ pathname: "/beatbox/", storedLocale: "invalid" }),
    "id",
  );
});
test("explicit query or English URL outranks remembered preference", () => {
  assert.equal(
    resolveLocale({ pathname: "/en/beatbox/", storedLocale: "id" }),
    "en",
  );
  assert.equal(
    resolveLocale({
      pathname: "/en/",
      explicitLocale: "id",
      storedLocale: "en",
    }),
    "id",
  );
  assert.equal(
    resolveLocale({
      pathname: "/studio/",
      explicitLocale: "en",
      storedLocale: "id",
    }),
    "en",
  );
});
test("remembered locale outranks implicit default, invalid query is ignored", () => {
  assert.equal(resolveLocale({ pathname: "/", storedLocale: "en" }), "en");
  assert.equal(
    resolveLocale({
      pathname: "/privacy.html",
      explicitLocale: "fr",
      storedLocale: "en",
    }),
    "en",
  );
});
test("storage denial and corrupt preferences safely retain usable default", () => {
  const denied = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
  };
  assert.equal(readLocale(denied), null);
  assert.doesNotThrow(() => saveLocale(denied, "en"));
  const data = new Map([[localeKey, "junk"]]);
  const storage = {
    getItem: (key) => data.get(key),
    setItem: (key, value) => data.set(key, value),
  };
  assert.equal(readLocale(storage), null);
  saveLocale(storage, "en");
  assert.equal(readLocale(storage), "en");
  saveLocale(storage, "fr");
  assert.equal(readLocale(storage), "en");
});
test("missing EN uses id and reports the bug; unknown keys never disappear", () => {
  const seen = [];
  const t = createTranslator(
    { id: { key: "Indonesia" }, en: {} },
    "en",
    (...args) => seen.push(args),
  );
  assert.equal(t("key"), "Indonesia");
  assert.deepEqual(seen, [["key", "en"]]);
  assert.throws(() => t("unknown"), /Unknown translation/);
});
test("route entries cover static localized pages and legacy privacy aliases", () => {
  assert.equal(Object.keys(buildEntries).length, 54);
  assert.equal(buildEntries.pads_id, "pad-station/index.html");
  assert.equal(buildEntries.pads_en, "en/pad-station/index.html");
  assert.equal(buildEntries.home_id, "index.html");
  assert.equal(buildEntries.beatbox_en, "en/beatbox/index.html");
  assert.equal(buildEntries.tutorials_id, "tutorial/index.html");
  assert.equal(buildEntries.tutorials_en, "en/tutorial/index.html");
  assert.equal(
    buildEntries["tutorial-pads_id"],
    "tutorial/pad-station/index.html",
  );
  assert.equal(buildEntries.privacy_id, "privacy.html");
  assert.equal(buildEntries.privacy_en, "en/privacy.html");
  for (const locale of ["id", "en"])
    for (const page of pages) {
      assert.equal(pageFromPath(pagePath(page, locale)), page);
    }
  assert.equal(pageFromPath("/privacy"), "privacy");
  assert.equal(pageFromPath("/en/privacy"), "privacy");
  assert.equal(pageFromPath("/tutorial"), "tutorials");
  assert.equal(pageFromPath("/en/tutorial"), "tutorials");
  assert.equal(pageFromPath("/not-a-route"), "notFound");
  assert.equal(pageFromPath("/en/missing"), "notFound");
});

test("internal navigation links point directly at the localized canonical with optional fragments", () => {
  for (const locale of ["id", "en"])
    for (const page of pages)
      for (const anchor of ["", "tools", "approach"]) {
        const url = new URL(
          navigationHref(page, locale, anchor),
          "https://perkusi.com",
        );
        assert.equal(url.pathname, pagePath(page, locale));
        assert.equal(url.search, "");
        assert.equal(url.hash, anchor ? "#" + anchor : "");
        assert.equal(pagePath(page, locale).includes("?"), false);
      }
});

test("static header, footer, privacy and 404 navigation retain active locale", () => {
  for (const locale of ["id", "en"])
    for (const page of pages) {
      const html = renderDocument(page, locale);
      const links = [
        ...html.matchAll(
          /<a [^>]*(?:data-route|data-home-anchor)="[^"]+"[^>]*href="([^"]+)"/g,
        ),
      ];
      assert(links.length >= 7, page);
      for (const [, href] of links) {
        const url = new URL(href, "https://perkusi.com");
        assert.equal(
          resolveLocale({
            pathname: url.pathname,
            explicitLocale: url.searchParams.get("lang"),
          }),
          locale,
        );
      }
    }
});
test("static metadata and sitemap agree on localized canonicals and alternate URLs", () => {
  const titles = new Set();
  const descriptions = new Set();
  const sitemap = new Map(
    [
      ...renderSitemap().matchAll(
        /<url>\s*<loc>([^<]+)<\/loc>([\s\S]*?)<\/url>/g,
      ),
    ].map(([, url, rest]) => [url, rest]),
  );
  assert.equal(sitemap.size, indexablePages.length * 2);
  for (const locale of ["id", "en"])
    for (const page of pages) {
      const html = renderDocument(page, locale);
      assert(
        html.includes(
          "<title>" +
            escapeHtml(messages[locale]["meta." + page + ".title"]) +
            "</title>",
        ),
      );
      const canonical = siteOrigin + pagePath(page, locale);
      if (page === "notFound") {
        assert(html.includes('name="robots" content="noindex"'));
        assert(!html.includes('rel="canonical"'));
        assert(!sitemap.has(canonical));
        continue;
      }
      assert(html.includes(`rel="canonical" href="${canonical}"`));
      assert(!html.includes('name="robots" content="noindex"'));
      assert(sitemap.has(canonical), canonical);
      for (const [lang, href] of pageAlternates(page)) {
        const alternate = `rel="alternate" hreflang="${lang}" href="${href}"`;
        assert(html.includes(`<link ${alternate}>`));
        assert(sitemap.get(canonical).includes(`<xhtml:link ${alternate}/>`));
      }
      const title = messages[locale][`meta.${page}.title`];
      const description = messages[locale][`meta.${page}.description`];
      assert(!titles.has(title), title);
      assert(!descriptions.has(description), description);
      titles.add(title);
      descriptions.add(description);
    }
});
test("playable Studio has honest localized metadata and initialization-guarded controls without autoplay", () => {
  for (const locale of ["id", "en"]) {
    const html = renderDocument("studio", locale);
    assert(html.includes(messages[locale]["meta.studio.title"]));
    assert(!html.includes(messages[locale]["common.comingSoon"]));
    assert(html.includes('id="st-play"') && html.includes("disabled"));
    assert.equal([...html.matchAll(/data-st-step=/g)].length, 128);
    assert(!html.includes("<audio") && !html.includes("AudioContext"));
  }
});
test("homepage links all three playable tools with concise bilingual guidance", () => {
  for (const locale of ["id", "en"]) {
    const html = renderDocument("home", locale);
    assert(html.includes(messages[locale]["home.explore"]));
    assert.equal([...html.matchAll(/data-route="beatbox"/g)].length, 2);
    assert.equal([...html.matchAll(/data-i18n="common.upcoming"/g)].length, 0);
    assert.equal([...html.matchAll(/data-route="studio"/g)].length, 2);
    assert(html.includes('data-i18n="common.playable"'));
    assert(!html.includes("AudioContext") && !html.includes(".wav"));
  }
});
test("locale update keeps future workspace state and object ownership", () => {
  const project = { roles: ["kick", "bass"], tempo: 90 };
  const session = createSession({ locale: "id", project });
  session.update({ locale: "en" });
  assert.equal(session.snapshot().project, project);
  assert.equal(session.snapshot().locale, "en");
  const snapshot = session.snapshot();
  snapshot.locale = "id";
  assert.equal(session.snapshot().locale, "en");
});
test("copy renderer escapes markup", () => {
  assert.equal(
    escapeHtml("<script a=\"x\"> & 'y'"),
    "&lt;script a=&quot;x&quot;&gt; &amp; &#39;y&#39;",
  );
});
