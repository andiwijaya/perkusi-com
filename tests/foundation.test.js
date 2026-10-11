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
  pages,
} from "../src/app/routes.js";
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
  assert.equal(Object.keys(buildEntries).length, 10);
  assert.equal(buildEntries.home_id, "index.html");
  assert.equal(buildEntries.beatbox_en, "en/beatbox/index.html");
  for (const locale of ["id", "en"])
    for (const page of pages) {
      assert.equal(pageFromPath(pagePath(page, locale)), page);
    }
  assert.equal(pageFromPath("/privacy"), "privacy");
  assert.equal(pageFromPath("/en/privacy"), "privacy");
  assert.equal(pageFromPath("/not-a-route"), "notFound");
  assert.equal(pageFromPath("/en/missing"), "notFound");
});

test("internal navigation carries active locale over an opposite saved preference", () => {
  for (const locale of ["id", "en"])
    for (const page of pages)
      for (const anchor of ["", "tools", "approach"]) {
        const url = new URL(
          navigationHref(page, locale, anchor),
          "https://perkusi.com",
        );
        assert.equal(
          resolveLocale({
            pathname: url.pathname,
            explicitLocale: url.searchParams.get("lang"),
            storedLocale: locale === "id" ? "en" : "id",
          }),
          locale,
        );
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
            storedLocale: locale === "id" ? "en" : "id",
          }),
          locale,
        );
      }
    }
});
test("static metadata is localized, canonical excludes query, 404 is noindex", () => {
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
      assert(
        html.includes(
          'rel="canonical" href="https://perkusi.com' +
            pagePath(page, locale) +
            '"',
        ),
      );
      assert.equal(
        html.includes('name="robots" content="noindex"'),
        page === "notFound",
      );
    }
});
test("unavailable tools stay honest, no playable controls or audio imports", () => {
  for (const locale of ["id", "en"])
    for (const page of ["studio"]) {
      const html = renderDocument(page, locale);
      assert(html.includes(messages[locale]["common.comingSoon"]));
      assert(!html.includes("<audio") && !html.includes("audio-packs"));
      assert(!html.includes("cta.startAudio"));
    }
});
test("homepage promotes the localized playable Beatbox while future tools remain upcoming", () => {
  for (const locale of ["id", "en"]) {
    const html = renderDocument("home", locale);
    assert(html.includes(messages[locale]["home.explore"]));
    assert.equal([...html.matchAll(/data-route="beatbox"/g)].length, 3);
    assert.equal([...html.matchAll(/data-i18n="common.upcoming"/g)].length, 3);
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
