import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { preview } from "vite";
import { messages } from "../src/i18n/messages.js";
import { studioMessages } from "../src/studio/messages.js";
import {
  navigationHref,
  pageAlternates,
  pageFromPath,
  pagePath,
  tutorialGuidePage,
} from "../src/app/routes.js";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  if (!process.env.NODE_REPL_NODE_MODULE_DIRS)
    throw new Error(
      "Playwright is required. Install it locally or provide NODE_REPL_NODE_MODULE_DIRS for the bundled Windows runtime.",
    );
  playwright = require(
    join(process.env.NODE_REPL_NODE_MODULE_DIRS, "playwright"),
  );
}
const output = process.env.PERKUSI_QA_DIR || "qa-artifacts/s1-2026-10-11";
await mkdir(output, { recursive: true });
const server = await preview({
  preview: { host: "127.0.0.1", port: 4174, strictPort: true },
});
let browser;
const evidence = {
  checkedAt: new Date().toISOString(),
  headless: true,
  physicalDevice: false,
  checks: [],
  widths: [],
  errors: [],
  result: "RUNNING",
};
async function check(name, action) {
  await action();
  evidence.checks.push({ name, result: "PASS" });
}
try {
  browser = await playwright.chromium.launch({
    channel: process.env.PERKUSI_BROWSER_CHANNEL || "chrome",
    headless: true,
  });
  evidence.browser = await browser.version();
  const context = await browser.newContext({
    locale: "en-US",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => evidence.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") evidence.errors.push(message.text());
  });
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  const base = "http://127.0.0.1:4174";
  const settle = () =>
    page.waitForFunction(
      () =>
        document.querySelector("#year")?.textContent ===
          String(new Date().getFullYear()) && document.documentElement.lang,
    );
  await check("new visitor en-US receives complete Indonesian", async () => {
    await page.goto(base + "/");
    await settle();
    assert.equal(await page.locator("html").getAttribute("lang"), "id");
    assert.equal(
      await page.locator("h1").textContent(),
      messages.id["home.hero1"] + " " + messages.id["home.hero2"],
    );
    assert.equal(await page.title(), messages.id["meta.home.title"]);
  });
  await check(
    "language switch preserves DOM/session marker and URL hash without reload",
    async () => {
      await page.evaluate(() => {
        window.s1SessionProof = { roles: ["kick", "bass"] };
        window.s1Main = document.querySelector("main");
        history.replaceState(history.state, "", "#tools");
      });
      await page.locator('[data-locale="en"]').click();
      assert.equal(await page.locator("html").getAttribute("lang"), "en");
      assert.equal(new URL(page.url()).pathname, "/en/");
      assert.equal(new URL(page.url()).hash, "#tools");
      assert(
        await page.evaluate(
          () =>
            window.s1Main === document.querySelector("main") &&
            window.s1SessionProof.roles.length === 2,
        ),
      );
      assert.equal(
        await page.evaluate(() => localStorage.getItem("perkusi.locale")),
        "en",
      );
      await page.locator('[data-locale="id"]').click();
      assert.equal(await page.locator("html").getAttribute("lang"), "id");
      assert(
        await page.evaluate(
          () => window.s1Main === document.querySelector("main"),
        ),
      );
    },
  );
  await check("browser back and forward restore explicit locale", async () => {
    await page.goBack();
    assert.equal(await page.locator("html").getAttribute("lang"), "en");
    await page.goForward();
    assert.equal(await page.locator("html").getAttribute("lang"), "id");
  });
  await check(
    "canonical ID and EN paths are stable, and legacy language queries still work",
    async () => {
      await page.evaluate(() => localStorage.setItem("perkusi.locale", "en"));
      await page.goto(base + "/");
      await settle();
      assert.equal(await page.locator("html").getAttribute("lang"), "id");
      assert.equal(new URL(page.url()).pathname, "/");
      await page.evaluate(() => localStorage.setItem("perkusi.locale", "id"));
      await page.goto(base + "/en/beatbox/");
      await settle();
      assert.equal(await page.locator("html").getAttribute("lang"), "en");
      await page.goto(base + "/en/beatbox/?lang=id&ref=release#bb-stage");
      await settle();
      assert.equal(await page.locator("html").getAttribute("lang"), "id");
      assert.equal(new URL(page.url()).pathname, "/beatbox/");
      assert.equal(new URL(page.url()).search, "?ref=release");
      assert.equal(new URL(page.url()).hash, "#bb-stage");
    },
  );
  await check(
    "all direct static routes, refresh, metadata and legacy privacy aliases",
    async () => {
      for (const locale of ["id", "en"])
        for (const screen of ["home", "beatbox", "studio", "privacy"]) {
          const path = pagePath(screen, locale);
          const response = await page.goto(
            base + path + (locale === "id" ? "?lang=id" : ""),
          );
          assert.equal(response.status(), 200);
          await settle();
          await page.reload();
          await settle();
          assert.equal(await page.locator("html").getAttribute("lang"), locale);
          assert.equal(
            await page.title(),
            messages[locale]["meta." + screen + ".title"],
          );
          assert.equal(
            await page.locator('link[rel="canonical"]').getAttribute("href"),
            "https://perkusi.com" + path,
          );
          for (const lang of ["id", "en"])
            assert.equal(
              await page
                .locator('link[hreflang="' + lang + '"]')
                .getAttribute("href"),
              "https://perkusi.com" + pagePath(screen, lang),
            );
          assert.equal(
            await page
              .locator('meta[property="og:url"]')
              .getAttribute("content"),
            "https://perkusi.com" + path,
          );
          assert.equal(
            await page
              .locator('meta[name="description"]')
              .getAttribute("content"),
            messages[locale]["meta." + screen + ".description"],
          );
          assert.equal(
            await page
              .locator('[data-i18n-aria-label="common.language"]')
              .getAttribute("aria-label"),
            messages[locale]["common.language"],
          );
          if (screen === "studio") {
            await page.waitForFunction(
              () =>
                document.querySelector(".studio-page")?.dataset.ready ===
                "true",
            );
            assert.equal(await page.locator(".st-step").count(), 128);
            assert(
              (await page.locator(".eyebrow").textContent()) ===
                studioMessages[locale].eyebrow,
            );
            assert.equal(
              await page.locator("audio,[data-play],.character").count(),
              0,
            );
          }
        }
      for (const path of [
        "/privacy",
        "/en/privacy",
        "/privacy.css",
        "/favicon.svg",
        "/social-card.png",
        "/index.html",
      ])
        assert.equal(
          (await context.request.get(base + path)).status(),
          200,
          path,
        );
    },
  );
  await check(
    "P2 normal UI explicit ID -> Privasi -> home, refresh/back/forward and EN inverse",
    async () => {
      for (const locale of ["id", "en"]) {
        await page.goto(base + "/?lang=id");
        await settle();
        await page
          .locator('[data-locale="' + (locale === "id" ? "en" : "id") + '"]')
          .click();
        await page.goto(base + "/?lang=" + locale);
        await settle();
        assert.equal(
          await page.evaluate(() => localStorage.getItem("perkusi.locale")),
          locale,
        );
        // A later preference change must not override an already rendered explicit link.
        await page.evaluate(
          (value) => localStorage.setItem("perkusi.locale", value),
          locale === "id" ? "en" : "id",
        );
        await page.locator('.site-footer [data-route="privacy"]').click();
        await settle();
        assert.equal(await page.locator("html").getAttribute("lang"), locale);
        assert.equal(
          await page.locator("h1").textContent(),
          messages[locale]["privacy.heading"],
        );
        await page.reload();
        await settle();
        assert.equal(await page.locator("html").getAttribute("lang"), locale);
        await page.locator('.site-header [data-route="home"]').click();
        await settle();
        assert.equal(await page.locator("html").getAttribute("lang"), locale);
        await page.goBack();
        await settle();
        assert.equal(await page.locator("html").getAttribute("lang"), locale);
        assert.equal(
          await page.locator("body").getAttribute("data-page"),
          "privacy",
        );
        await page.goForward();
        await settle();
        assert.equal(await page.locator("html").getAttribute("lang"), locale);
      }
    },
  );
  await check(
    "P2 all rendered internal links encode ID/EN; tool keyboard home/hash and 404 exit",
    async () => {
      for (const locale of ["id", "en"])
        for (const screen of [
          "home",
          "beatbox",
          "studio",
          "privacy",
          "notFound",
        ]) {
          await page.goto(
            base +
              navigationHref(screen, locale) +
              (screen === "notFound" ? `?lang=${locale}` : ""),
          );
          await settle();
          const hrefs = await page
            .locator("[data-route],[data-home-anchor]")
            .evaluateAll((els) => els.map((el) => el.href));
          assert(hrefs.length >= 7);
          for (const href of hrefs) {
            const url = new URL(href);
            if (url.hash && url.pathname === new URL(page.url()).pathname)
              continue;
            assert.equal(url.search, "", href);
            assert.equal(
              url.pathname.startsWith("/en/"),
              locale === "en",
              href,
            );
          }
          if (["beatbox", "studio"].includes(screen)) {
            await page
              .locator('.site-footer [data-home-anchor="tools"]')
              .focus();
            await page.keyboard.press("Enter");
            await settle();
            assert.equal(new URL(page.url()).hash, "#tools");
            assert.equal(
              await page.locator("html").getAttribute("lang"),
              locale,
            );
            await page.reload();
            await settle();
            assert.equal(new URL(page.url()).hash, "#tools");
            assert.equal(
              await page.locator("html").getAttribute("lang"),
              locale,
            );
            await page.goBack();
            await settle();
            assert.equal(
              await page.locator("body").getAttribute("data-page"),
              screen,
            );
            assert.equal(
              await page.locator("html").getAttribute("lang"),
              locale,
            );
            await page.goForward();
            await settle();
            assert.equal(new URL(page.url()).hash, "#tools");
            assert.equal(
              await page.locator("html").getAttribute("lang"),
              locale,
            );
          } else if (screen === "notFound") {
            await page.locator('main [data-route="home"]').click();
            await settle();
            assert.equal(
              await page.locator("html").getAttribute("lang"),
              locale,
            );
          }
        }
    },
  );
  await check(
    "genuine localized 404 and HEAD, no missing URL rewrite",
    async () => {
      for (const [path, locale] of [
        ["/missing-s1?lang=id", "id"],
        ["/en/missing-s1", "en"],
      ]) {
        const response = await page.goto(base + path);
        assert.equal(response.status(), 404);
        assert.equal(
          await page.locator('meta[name="robots"]').getAttribute("content"),
          "noindex",
        );
        assert.equal(
          new URL(page.url()).pathname,
          new URL(base + path).pathname,
        );
        assert.equal(await page.locator("html").getAttribute("lang"), locale);
        assert.equal((await context.request.head(base + path)).status(), 404);
      }
    },
  );
  await check(
    "responsive both languages, all foundation views at eight widths",
    async () => {
      for (const width of [320, 360, 390, 430, 768, 1280, 1440, 1920])
        for (const locale of ["id", "en"])
          for (const screen of [
            "home",
            "privacy",
            "beatbox",
            "studio",
            "tutorials",
          ]) {
            await page.setViewportSize({ width, height: 900 });
            await page.goto(
              base +
                pagePath(screen, locale) +
                (locale === "id" ? "?lang=id" : ""),
            );
            await settle();
            const measure = await page.evaluate(() => ({
              width: innerWidth,
              scrollWidth: document.documentElement.scrollWidth,
              touch: [
                ...document.querySelectorAll(
                  '.language-switch a, a[data-route="beatbox"]',
                ),
              ]
                .filter((el) => el.getClientRects().length)
                .map((el) => ({
                  width: el.getBoundingClientRect().width,
                  height: el.getBoundingClientRect().height,
                })),
              scrollBehavior: getComputedStyle(document.documentElement)
                .scrollBehavior,
            }));
            assert(
              measure.scrollWidth <= width,
              screen +
                " " +
                locale +
                " " +
                width +
                " overflow " +
                measure.scrollWidth,
            );
            assert(measure.touch.every((x) => x.width >= 44 && x.height >= 44));
            assert.equal(measure.scrollBehavior, "auto");
            evidence.widths.push({ screen, locale, ...measure });
            if (screen === "home" && [390, 1440].includes(width))
              await page.screenshot({
                path: join(output, "home-" + locale + "-" + width + ".png"),
                fullPage: true,
              });
          }
    },
  );
  await check(
    "bilingual Tutorial menu, guide links and preserved language",
    async () => {
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const locale of ["id", "en"]) {
          await page.goto(base + navigationHref("home", locale));
          await settle();
          if (width === 390) await page.locator(".menu-toggle").click();
          const menuLink = page.locator(
            '#navigation a[data-route="tutorials"]',
          );
          assert.equal(
            await menuLink.innerText(),
            messages[locale]["common.tutorials"],
          );
          await menuLink.click();
          await page.waitForURL(base + navigationHref("tutorials", locale));
          await settle();
          const hub = page.locator(".tutorial-hub");
          assert.equal(
            await hub.locator("h1").innerText(),
            messages[locale]["tutorialHub.title"],
          );
          assert.equal(await menuLink.getAttribute("aria-current"), "page");
          assert.equal(await hub.locator(".tutorial-hub-link").count(), 3);

          const other = locale === "id" ? "en" : "id";
          await page.locator(`[data-locale="${other}"]`).click();
          assert.equal(
            new URL(page.url()).pathname,
            pagePath("tutorials", other),
          );
          assert.equal(
            await hub.locator("h1").innerText(),
            messages[other]["tutorialHub.title"],
          );
          for (const link of await hub.locator(".tutorial-hub-link").all()) {
            assert.equal(
              await link.getAttribute("href"),
              navigationHref(await link.getAttribute("data-route"), other),
            );
            assert.match(
              await link
                .locator(".tutorial-hub-preview")
                .evaluate((image) => getComputedStyle(image).backgroundImage),
              new RegExp(`-${other}\\.webp`),
            );
          }
          await page.locator(`[data-locale="${locale}"]`).click();
          await page.screenshot({
            path: join(output, `tutorials-${locale}-${width}.png`),
            fullPage: true,
          });
          for (const guide of ["pads", "studio", "beatbox"]) {
            await hub
              .locator(`[data-route="${tutorialGuidePage(guide)}"]`)
              .press("Enter");
            await page.waitForURL(
              base + pagePath(tutorialGuidePage(guide), locale),
            );
            assert(
              await page.locator(".tutorial-guide .tutorial-steps").isVisible(),
            );
            assert(
              await page
                .locator(".tutorial-guide .tutorial-search")
                .isVisible(),
            );
            assert(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
            );
            await page
              .locator(`.tutorial-guide header [data-route="${guide}"]`)
              .press("Enter");
            await page.waitForURL(
              base + navigationHref(guide, locale, "tutorial"),
            );
            await page.waitForFunction(
              () =>
                document.querySelector("#tutorial")?.open &&
                document.activeElement.id === "tutorial",
            );
            assert.equal(
              await page.locator("html").getAttribute("lang"),
              locale,
            );
            assert.equal(
              await page.locator("#tutorial .tutorial-search").isVisible(),
              true,
            );
            await page.goBack();
            await page.waitForURL(
              base + pagePath(tutorialGuidePage(guide), locale),
            );
            await page.goBack();
            await page.waitForURL(base + navigationHref("tutorials", locale));
          }
        }
      }
    },
  );
  await check(
    "Tutorial hub searches all three guides and opens exact localized steps",
    async () => {
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const locale of ["id", "en"]) {
          await page.goto(base + navigationHref("tutorials", locale));
          await settle();
          const search = page.getByRole("searchbox", {
            name: messages[locale]["tutorial.search.all"],
          });
          const results = page.locator("#tutorial-search-results");
          const status = page.locator(".tutorial-search-status");
          assert.equal(await results.isVisible(), false);
          await search.fill("WÁV");
          const paths = await results
            .getByRole("link")
            .evaluateAll((links) =>
              links.map((link) => new URL(link.href).pathname),
            );
          assert.deepEqual(
            [...new Set(paths)].sort(),
            ["pads", "studio", "beatbox"]
              .map((tool) => pagePath(tool, locale))
              .sort(),
          );
          assert.match(
            await status.innerText(),
            locale === "id" ? /hasil/ : /results/,
          );
          assert(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          );
          await page.screenshot({
            path: join(output, `tutorial-search-${locale}-${width}.png`),
          });

          const targets = [
            ["Kenong", "pads", "tutorial-step-3", "home.pads.title"],
            ["tÉmp", "studio", "tutorial-step-2", "home.card1.title"],
            [
              locale === "id" ? "variasi dan isi" : "variations and voices",
              "beatbox",
              "tutorial-step-3",
              "home.card3.title",
            ],
          ];
          for (const [query, tool, target, nameKey] of targets) {
            await search.fill(query);
            const link = results.getByRole("link").first();
            assert.equal(
              await link.locator(".tutorial-result-guide").innerText(),
              messages[locale][nameKey] +
                " · " +
                messages[locale]["tutorial.search.step"].replace(
                  "{step}",
                  target.at(-1),
                ),
            );
            const href = navigationHref(tool, locale, target);
            assert.equal(await link.getAttribute("href"), href);
            await search.press("Enter");
            await page.waitForURL(base + href);
            await page.waitForFunction(
              (id) =>
                document.querySelector("#tutorial")?.open &&
                document.activeElement.id === id,
              target,
            );
            assert.equal(
              await page.locator("html").getAttribute("lang"),
              locale,
            );
            await page.goBack();
            await page.waitForURL(base + navigationHref("tutorials", locale));
            await search.waitFor({ state: "visible" });
            assert.equal(await search.inputValue(), query);
          }

          await search.fill("WAV");
          const other = locale === "id" ? "en" : "id";
          await page.locator(`[data-locale="${other}"]`).click();
          const otherSearch = page.getByRole("searchbox", {
            name: messages[other]["tutorial.search.all"],
          });
          assert.equal(await otherSearch.inputValue(), "WAV");
          assert.equal(
            await results.getByRole("link").first().getAttribute("href"),
            navigationHref("studio", other, "tutorial-step-6"),
          );
          await otherSearch.fill("zz-unmatched-9087");
          assert.equal(
            await status.innerText(),
            messages[other]["tutorial.search.empty"],
          );
          assert.equal(await results.isVisible(), false);
          await page
            .getByRole("button", {
              name: messages[other]["tutorial.search.clear"],
            })
            .click();
          assert.equal(await otherSearch.inputValue(), "");
          assert.equal(await status.innerText(), "");
          assert.equal(
            await page.locator(".tutorial-hub-link:visible").count(),
            3,
          );
        }
      }
    },
  );
  await check(
    "mobile keyboard/menu/Escape, skip link, language control retains focus",
    async () => {
      await page.setViewportSize({ width: 390, height: 900 });
      await page.goto(base + "/?lang=id");
      await settle();
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(() => document.activeElement.getAttribute("href")),
        "#main",
      );
      await page.keyboard.press("Enter");
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "main",
      );
      await page.locator(".menu-toggle").click();
      assert.equal(
        await page.locator(".menu-toggle").getAttribute("aria-expanded"),
        "true",
      );
      await page.keyboard.press("Escape");
      assert.equal(
        await page.locator(".menu-toggle").getAttribute("aria-expanded"),
        "false",
      );
      assert(
        await page
          .locator(".menu-toggle")
          .evaluate((el) => el === document.activeElement),
      );
      await page.locator(".menu-toggle").click();
      await page.locator("#navigation a").first().click();
      assert.equal(
        await page.locator(".menu-toggle").getAttribute("aria-expanded"),
        "false",
      );
      await page.locator('[data-locale="en"]').focus();
      await page.keyboard.press("Enter");
      assert.equal(await page.locator("html").getAttribute("lang"), "en");
      assert(
        await page
          .locator('[data-locale="en"]')
          .evaluate((el) => el === document.activeElement),
      );
    },
  );
  await check(
    "P2 denied storage retains both locales through privacy/home/tool links and 404 refresh",
    async () => {
      const denied = await browser.newContext({ locale: "en-US" });
      await denied.addInitScript(() => {
        Object.defineProperty(window, "localStorage", {
          get() {
            throw new DOMException("denied", "SecurityError");
          },
        });
      });
      const deniedPage = await denied.newPage();
      const deniedErrors = [];
      deniedPage.on("pageerror", (error) => deniedErrors.push(error.message));
      await deniedPage.goto(base + "/");
      assert.equal(await deniedPage.locator("html").getAttribute("lang"), "id");
      await deniedPage.locator('[data-locale="en"]').click();
      assert.equal(await deniedPage.locator("html").getAttribute("lang"), "en");
      for (const locale of ["id", "en"]) {
        await deniedPage.goto(base + "/?lang=" + locale);
        await deniedPage.waitForFunction(
          (lang) => document.documentElement.lang === lang,
          locale,
        );
        await deniedPage.locator('.site-footer [data-route="privacy"]').click();
        await deniedPage.waitForFunction(
          (lang) => document.documentElement.lang === lang,
          locale,
        );
        await deniedPage.reload();
        await deniedPage.waitForFunction(
          (lang) => document.documentElement.lang === lang,
          locale,
        );
        await deniedPage
          .locator('.site-footer [data-home-anchor="approach"]')
          .click();
        await deniedPage.waitForFunction(
          (lang) => document.documentElement.lang === lang,
          locale,
        );
        assert.equal(new URL(deniedPage.url()).hash, "#approach");
        await deniedPage.goto(base + navigationHref("studio", locale));
        await deniedPage
          .locator('.site-footer [data-home-anchor="tools"]')
          .focus();
        await deniedPage.keyboard.press("Enter");
        await deniedPage.waitForFunction(
          (lang) => document.documentElement.lang === lang,
          locale,
        );
        assert.equal(new URL(deniedPage.url()).hash, "#tools");
      }
      await deniedPage.goto(base + "/en/p2-missing");
      await deniedPage.locator('[data-locale="id"]').click();
      await deniedPage.reload();
      await deniedPage.waitForFunction(
        () => document.documentElement.lang === "id",
      );
      assert.equal(new URL(deniedPage.url()).pathname, "/en/p2-missing");
      await deniedPage.locator('[data-locale="en"]').click();
      await deniedPage.reload();
      await deniedPage.waitForFunction(
        () => document.documentElement.lang === "en",
      );
      await deniedPage.locator('main [data-route="home"]').click();
      await deniedPage.waitForFunction(
        () => document.documentElement.lang === "en",
      );
      assert.deepEqual(deniedErrors, []);
      await denied.close();
    },
  );
  await check(
    "no-JavaScript direct navigation retains localized SEO/legal/coming-soon",
    async () => {
      const staticContext = await browser.newContext({
        javaScriptEnabled: false,
        reducedMotion: "reduce",
      });
      const staticPage = await staticContext.newPage();
      for (const locale of ["id", "en"])
        for (const screen of [
          "home",
          "privacy",
          "beatbox",
          "studio",
          "tutorials",
        ]) {
          const response = await staticPage.goto(
            base + pagePath(screen, locale),
          );
          assert.equal(response.status(), 200);
          assert.equal(
            await staticPage.locator("html").getAttribute("lang"),
            locale,
          );
          assert.equal(
            await staticPage.title(),
            messages[locale]["meta." + screen + ".title"],
          );
          if (screen === "tutorials") {
            assert.equal(
              await staticPage.locator(".tutorial-search").isVisible(),
              false,
            );
            const link = staticPage.locator(
              '.tutorial-hub [data-route="tutorial-pads"]',
            );
            assert.equal(
              await link.getAttribute("href"),
              navigationHref("tutorial-pads", locale),
            );
            await link.click();
            await staticPage.waitForURL(
              base + pagePath("tutorial-pads", locale),
            );
            const steps = staticPage.locator(".tutorial-steps");
            assert(await steps.isVisible());
            assert.equal(
              await steps.locator("li[data-tutorial-topic]").count(),
              5,
            );
            await staticPage
              .locator('.tutorial-guide header [data-route="pads"]')
              .click();
            await staticPage.waitForURL(
              base + navigationHref("pads", locale, "tutorial"),
            );
            if (!(await steps.isVisible()))
              await staticPage.locator("#tutorial > summary").press("Enter");
            assert.equal(await steps.isVisible(), true);
          }
          const href = await staticPage
            .locator('.site-footer [data-route="privacy"]')
            .getAttribute("href");
          assert.equal(href, navigationHref("privacy", locale));
          await staticPage
            .locator('.site-footer [data-route="privacy"]')
            .click();
          assert.equal(
            await staticPage.locator("html").getAttribute("lang"),
            locale,
          );
          await staticPage.locator('.site-header [data-route="home"]').click();
          assert.equal(
            await staticPage.locator("html").getAttribute("lang"),
            locale,
          );
        }
      await staticContext.close();
    },
  );
  await check(
    "sitemap entries resolve and production revision/security files retained",
    async () => {
      const xml = await (
        await context.request.get(base + "/sitemap.xml")
      ).text();
      const entries = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)];
      assert.equal(entries.length, 52);
      for (const [, canonical] of entries) {
        const pathname = new URL(canonical).pathname;
        const response = await context.request.get(base + pathname, {
          maxRedirects: 0,
        });
        assert.equal(response.status(), 200, pathname);
        const html = await response.text();
        assert(
          html.includes(`<link rel="canonical" href="${canonical}">`),
          pathname,
        );
        for (const [lang, url] of pageAlternates(pageFromPath(pathname)))
          assert(
            html.includes(
              `<link rel="alternate" hreflang="${lang}" href="${url}">`,
            ),
            pathname,
          );
        assert(!/noindex/i.test(response.headers()["x-robots-tag"] ?? ""));
      }
      assert.deepEqual(
        await (await context.request.get(base + "/version.json")).json(),
        { commit: "local", branch: "local" },
      );
      assert.equal(
        await readFile("public/_headers", "utf8"),
        await readFile("dist/_headers", "utf8"),
      );
    },
  );
  await check(
    "homepage contains no audio engine bundle/assets and no GA on localhost",
    async () => {
      assert(!requests.some((url) => url.includes("googletagmanager")));
      const homeContext = await browser.newContext();
      const homePage = await homeContext.newPage(),
        homeRequests = [];
      homePage.on("request", (request) => homeRequests.push(request.url()));
      await homePage.goto(base + "/");
      await homePage.waitForFunction(
        () =>
          document.querySelector("#year")?.textContent ===
          String(new Date().getFullYear()),
      );
      assert(
        !homeRequests.some((url) =>
          /\.(wav|flac|mp3|ogg)(\?|$)|audio-packs|googletagmanager/.test(url),
        ),
      );
      const jsFiles = homeRequests
        .filter((url) => url.endsWith(".js"))
        .map((url) => new URL(url).pathname.split("/").pop());
      for (const file of jsFiles) {
        const code = await readFile(join("dist/assets", file), "utf8");
        assert(
          !/AudioContext|OfflineAudioContext|AudioBufferSourceNode|audio-packs/.test(
            code,
          ),
          file,
        );
      }
      await homeContext.close();
    },
  );
  assert.deepEqual(
    evidence.errors.filter((x) => !x.includes("404 (Not Found)")),
    [],
  );
  evidence.result = "PASS";
} catch (error) {
  evidence.result = "FAIL";
  evidence.failure = { message: error.message, stack: error.stack };
  process.exitCode = 1;
  console.error(error);
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
  await writeFile(
    join(output, "browser.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    JSON.stringify({
      result: evidence.result,
      browser: evidence.browser,
      checks: evidence.checks.length,
      viewports: evidence.widths.length,
      output,
    }),
  );
}
