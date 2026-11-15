import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { preview } from "vite";
import { instruments } from "../src/instruments/catalog.js";
import { articleContent } from "../src/instruments/content.js";
import { pagePath } from "../src/app/routes.js";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(
    join(process.env.NODE_REPL_NODE_MODULE_DIRS, "playwright"),
  );
}
const output =
  process.env.PERKUSI_ARTICLE_QA_DIR || "qa-artifacts/instrument-articles";
await mkdir(output, { recursive: true });
const remoteBase = process.env.PERKUSI_ARTICLE_BASE_URL;
const server = remoteBase
  ? null
  : await preview({
      preview: { host: "127.0.0.1", port: 4175, strictPort: true },
    });
const base = remoteBase || "http://127.0.0.1:4175";
const evidence = {
  date: new Date().toISOString(),
  baseUrl: base,
  checks: [],
  instruments: [],
  errors: [],
  physicalDevice: false,
  humanListening: false,
};
let browser;
const check = async (name, task) => {
  await task();
  evidence.checks.push(name);
  console.log("PASS " + name);
};
const audioRegex = /\.(wav|flac|mp3)(?:\?|$)/;
try {
  browser = await playwright.chromium.launch({
    channel: process.env.PERKUSI_BROWSER_CHANNEL || "chrome",
    headless: true,
  });
  evidence.browser = await browser.version();
  const context = await browser.newContext({ reducedMotion: "reduce" });
  if (remoteBase) {
    // Keep release QA visits out of the production analytics property.
    await context.route(
      /googletagmanager\.com|google-analytics\.com/,
      (route) => route.fulfill({ status: 200, body: "" }),
    );
  }
  await context.addInitScript(() => {
    const state = (window.__articleAudio = {
      starts: 0,
      sources: [],
      contexts: [],
      peak: 0,
      closed: 0,
    });
    const Native = window.AudioContext;
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination, ...args) {
      if (destination === this.context.destination) {
        const analyser = this.context.createAnalyser();
        analyser.fftSize = 2048;
        const data = new Float32Array(2048);
        setInterval(() => {
          analyser.getFloatTimeDomainData(data);
          for (const v of data) state.peak = Math.max(state.peak, Math.abs(v));
        }, 8);
        connect.call(this, analyser);
        connect.call(analyser, destination);
        return destination;
      }
      return connect.call(this, destination, ...args);
    };
    window.AudioContext = class extends Native {
      constructor(...args) {
        super(...args);
        state.contexts.push(this);
      }
      createBufferSource() {
        const source = super.createBufferSource(),
          start = source.start.bind(source);
        source.start = (...args) => {
          state.starts++;
          state.sources.push({
            loop: source.loop,
            length: source.buffer?.length,
            duration: source.buffer?.duration,
          });
          return start(...args);
        };
        return source;
      }
      close() {
        state.closed++;
        return super.close();
      }
    };
  });
  const page = await context.newPage();
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("pageerror", (e) => evidence.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") evidence.errors.push(m.text());
  });
  await check("homepage card opens complete instrument index", async () => {
    await page.goto(base + "/?lang=id");
    assert.equal(await page.locator(".tool-card").count(), 4);
    await page.locator("[data-instrument-articles-card] a").click();
    await page.waitForSelector(".instrument-filters:not([hidden])");
    assert.equal(await page.locator(".instrument-card").count(), 16);
    await page.screenshot({
      path: output + "/index-desktop.png",
      fullPage: true,
    });
    await page.locator("#instrument-search").fill("kenong");
    assert.equal(await page.locator(".instrument-card:visible").count(), 1);
    await page.locator("#instrument-category").selectOption("strings");
    assert.equal(await page.locator(".instrument-card:visible").count(), 0);
    assert(await page.locator("#instrument-empty").isVisible());
    await page.locator("#instrument-search").fill("");
    assert.equal(await page.locator(".instrument-card:visible").count(), 2);
    await page.locator('[data-locale="en"]').click();
    assert.equal(
      await page.locator("h1").textContent(),
      "Meet the instrument. Discover its story. Play its sound.",
    );
    assert.equal(
      await page.locator("#instrument-category").inputValue(),
      "strings",
    );
  });
  for (const locale of ["id", "en"]) {
    for (const instrument of instruments) {
      await check(
        locale + " / " + instrument.slug + " / every sound produces output",
        async () => {
          const startRequest = requests.length;
          const response = await page.goto(
            base + pagePath(instrument.page, locale) + "?lang=" + locale,
          );
          assert.equal(response.status(), 200);
          await page.waitForFunction(
            () => !document.querySelector("#article-prepare").disabled,
          );
          assert.equal(
            await page.locator("h1").textContent(),
            articleContent[instrument.slug][locale].title,
          );
          assert.equal(
            await page.locator(".instrument-reading section").count(),
            6,
          );
          assert(
            await page
              .locator(".instrument-cover")
              .evaluate((img) => img.complete && img.naturalWidth === 1536),
          );
          assert.equal(
            await page.evaluate(() => window.__articleAudio.starts),
            0,
          );
          assert.equal(
            requests.slice(startRequest).filter((u) => audioRegex.test(u))
              .length,
            0,
            "no audio fetch before explicit prepare",
          );
          let strikes = 0;
          for (const [bankIndex, bank] of instrument.banks.entries()) {
            if (bankIndex === 0) await page.locator("#article-prepare").click();
            else await page.locator("#article-bank").selectOption(bank.key);
            await page.waitForSelector('.article-pad[data-state="ready"]', {
              timeout: 45000,
            });
            assert.equal(
              await page.evaluate(() => window.__articleAudio.starts),
              strikes,
              "preparing does not autoplay",
            );
            assert.equal(
              await page.locator("[data-article-note]:enabled").count(),
              bank.notes.length,
            );
            for (const [id] of bank.notes) {
              await page.locator("#article-stop").click();
              await page.waitForTimeout(45);
              await page.evaluate(() => {
                window.__articleAudio.peak = 0;
              });
              const before = await page.evaluate(
                () => window.__articleAudio.starts,
              );
              await page.locator('[data-article-note="' + id + '"]').click();
              await page.waitForFunction(
                (n) =>
                  window.__articleAudio.starts === n + 1 &&
                  window.__articleAudio.peak > 0.000001,
                before,
                { timeout: 5000 },
              );
              const peak = await page.evaluate(
                () => window.__articleAudio.peak,
              );
              assert(peak <= 0.91, "output ceiling");
              strikes++;
            }
            await page.locator("#article-stop").click();
          }
          assert.equal(strikes, instrument.count);
          assert(
            await page.evaluate(() =>
              window.__articleAudio.sources.every(
                (s) => !s.loop && s.length > 0,
              ),
            ),
          );
          evidence.instruments.push({
            locale,
            slug: instrument.slug,
            strikes,
            audioRequests: requests
              .slice(startRequest)
              .filter((u) => audioRegex.test(u)).length,
            result: "PASS",
          });
        },
      );
    }
  }
  await check(
    "language switch preserves prepared owner and browser history",
    async () => {
      await page.goto(base + "/instrumen/kenong/?lang=id");
      await page.locator("#article-prepare:enabled").click();
      await page.waitForSelector('.article-pad[data-state="ready"]');
      await page.evaluate(() => {
        window.__articlePadElement = document.querySelector(".article-pad");
      });
      await page.locator('[data-locale="en"]').click();
      assert.equal(
        await page.locator("h1").textContent(),
        articleContent.kenong.en.title,
      );
      assert(
        await page.evaluate(
          () =>
            window.__articlePadElement ===
              document.querySelector(".article-pad") &&
            window.__articleAudio.contexts.length === 1,
        ),
      );
      const schema = JSON.parse(
        await page.locator("[data-article-schema]").textContent(),
      );
      assert.equal(schema.inLanguage, "en");
      assert.equal(schema.headline, articleContent.kenong.en.title);
      await page.goBack();
      assert.equal(
        await page.locator("h1").textContent(),
        articleContent.kenong.id.title,
      );
      await page.keyboard.press("1");
      await page.waitForFunction(() => window.__articleAudio.starts === 1);
      await page.evaluate(() =>
        window.dispatchEvent(new PageTransitionEvent("pagehide")),
      );
      await page.waitForFunction(() =>
        window.__articleAudio.contexts.every((c) => c.state === "closed"),
      );
    },
  );
  await check(
    "network failure is recoverable without autoplay or reloading",
    async () => {
      await page.goto(base + "/instrumen/gitar-nylon/?lang=id");
      await page.route(/\.wav(?:\?|$)/, (r) =>
        r.fulfill({ status: 503, body: "Unavailable" }),
      );
      await page.locator("#article-prepare:enabled").click();
      await page.waitForSelector('.article-pad[data-state="error"]');
      assert.equal(
        await page.locator("[data-article-note]:enabled").count(),
        0,
      );
      await page.unroute(/\.wav(?:\?|$)/);
      await page.locator("#article-prepare").click();
      await page.waitForSelector('.article-pad[data-state="ready"]');
      assert.equal(await page.evaluate(() => window.__articleAudio.starts), 0);
    },
  );
  await check(
    "slow preparation, stop and rapid scale replacement remain bounded",
    async () => {
      await page.goto(base + "/instrumen/kenong/?lang=id");
      await page.route(/\.flac(?:\?|$)/, async (r) => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        await r.continue().catch(() => {});
      });
      await page.locator("#article-prepare:enabled").click();
      await page.locator("#article-stop").click();
      await page.locator("#article-bank").selectOption("kenong-slendro");
      await page.locator("#article-bank").selectOption("kenong-pelog");
      await page.waitForSelector('.article-pad[data-state="ready"]');
      assert.equal(
        await page.locator("[data-article-note]:enabled").count(),
        6,
      );
      assert.equal(await page.evaluate(() => window.__articleAudio.starts), 0);
      await page.unroute(/\.flac(?:\?|$)/);
    },
  );
  await check(
    "responsive ID/EN index and article have no horizontal overflow",
    async () => {
      for (const locale of ["id", "en"])
        for (const width of [320, 360, 390, 430, 768, 1280, 1440, 1920]) {
          await page.setViewportSize({ width, height: 900 });
          for (const route of ["/", "/instrumen/", "/instrumen/gong-ageng/"]) {
            await page.goto(
              base + (locale === "en" ? "/en" : "") + route + "?lang=" + locale,
            );
            await page.evaluate(() => document.fonts.ready);
            assert(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1,
              ),
              locale + route + width,
            );
            if (width === 390 || width === 1440)
              await page.screenshot({
                path: `${output}/${locale}-${route.includes("gong") ? "article" : route.includes("instrumen") ? "index" : "home"}-${width}.png`,
                fullPage: true,
              });
          }
        }
    },
  );
  await check(
    "static reading, canonical metadata, sitemap, image and source assets",
    async () => {
      const noJS = await browser.newContext({ javaScriptEnabled: false });
      const staticPage = await noJS.newPage();
      for (const locale of ["id", "en"])
        for (const instrument of instruments) {
          await staticPage.goto(base + pagePath(instrument.page, locale));
          assert.equal(
            await staticPage.locator("h1").textContent(),
            articleContent[instrument.slug][locale].title,
          );
          assert.equal(
            await staticPage.locator(".instrument-reading section").count(),
            6,
          );
          assert.equal(
            await staticPage.locator("#article-prepare").isDisabled(),
            true,
          );
          assert.equal(
            await staticPage
              .locator('link[rel="canonical"]')
              .getAttribute("href"),
            "https://perkusi.com" + pagePath(instrument.page, locale),
          );
          const data = JSON.parse(
            await staticPage.locator("[data-article-schema]").textContent(),
          );
          assert.equal(data.inLanguage, locale);
          assert.equal(
            data.headline,
            articleContent[instrument.slug][locale].title,
          );
        }
      const sitemap = await readFile("dist/sitemap.xml", "utf8");
      for (const instrument of instruments) {
        assert(sitemap.includes(pagePath(instrument.page, "id")));
        assert(sitemap.includes(pagePath(instrument.page, "en")));
        assert.equal(
          (await context.request.get(base + instrument.image)).status(),
          200,
        );
      }
      assert.equal(
        (await context.request.get(base + "/instrumen/unknown/")).status(),
        404,
      );
      await noJS.close();
    },
  );
  // The deliberate 503 cases are expected browser-console errors, not app errors.
  evidence.errors = evidence.errors.filter(
    (e) => /503|server responded with a status/.test(e) === false,
  );
  assert.deepEqual(evidence.errors, []);
  evidence.result = "PASS";
} catch (error) {
  evidence.result = "FAIL";
  evidence.failure = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(
    output + "/browser-evidence.json",
    JSON.stringify(evidence, null, 2),
  );
  await browser?.close();
  await server?.close();
}
