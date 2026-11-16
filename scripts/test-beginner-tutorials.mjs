import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { preview } from "vite";
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
const remoteBase = process.env.PERKUSI_TUTORIAL_BASE_URL;
const output =
  process.env.PERKUSI_TUTORIAL_QA_DIR || "qa-artifacts/beginner-tutorials";
await mkdir(output, { recursive: true });
const server = remoteBase
  ? null
  : await preview({
      preview: { host: "127.0.0.1", port: 4177, strictPort: true },
    });
const base = remoteBase || "http://127.0.0.1:4177";
const evidence = {
  date: new Date().toISOString(),
  base,
  headless: true,
  physicalDevice: false,
  humanListening: false,
  checks: [],
  wav: [],
  errors: [],
  mobileTouchViewports: [360, 390, 430],
};
const check = async (name, task) => {
  await task();
  evidence.checks.push(name);
  console.log("PASS " + name);
};
const csp = (await readFile("public/_headers", "utf8"))
  .split("Content-Security-Policy: ")[1]
  .split(/\r?\n/)[0]
  .trim();
let browser;
async function newContext(options = {}) {
  const context = await browser.newContext({
    reducedMotion: "reduce",
    acceptDownloads: true,
    ...options,
  });
  if (remoteBase) {
    await context.route(
      /googletagmanager\.com|google-analytics\.com/,
      (route) => route.fulfill({ status: 200, body: "" }),
    );
  } else {
    await context.route("**/*", async (route) => {
      if (route.request().resourceType() !== "document")
        return route.continue();
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), "content-security-policy": csp },
      });
    });
  }
  await context.addInitScript(() => {
    window.__tutorialStarts = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      window.__tutorialStarts++;
      return start.apply(this, args);
    };
  });
  return context;
}
async function open(page, tool, locale) {
  const response = await page.goto(
    base + pagePath(tool, locale) + "?lang=" + locale,
  );
  assert.equal(response.status(), 200);
  await page.waitForFunction(
    () =>
      document.querySelector("#year")?.textContent ===
      String(new Date().getFullYear()),
  );
  assert.equal(await page.locator("html").getAttribute("lang"), locale);
}
async function saveWav(page, button, name, seconds) {
  const pending = page.waitForEvent("download");
  await page.locator(button).tap();
  const download = await pending;
  assert.match(download.suggestedFilename(), /\.wav$/);
  const path = join(output, name + ".wav");
  await download.saveAs(path);
  assert.equal(await download.failure(), null);
  const bytes = await readFile(path);
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.toString("ascii", 8, 12), "WAVE");
  const channels = bytes.readUInt16LE(22),
    rate = bytes.readUInt32LE(24),
    bits = bytes.readUInt16LE(34);
  const size = bytes.readUInt32LE(40),
    duration = size / ((rate * channels * bits) / 8);
  assert.equal(rate, 48000);
  assert.equal(bits, 16);
  assert(
    Math.abs(duration - seconds) < 0.01,
    `WAV duration ${duration}, expected ${seconds}`,
  );
  let peak = 0;
  for (let i = 44; i < 44 + size; i += 2)
    peak = Math.max(peak, Math.abs(bytes.readInt16LE(i)));
  assert(peak > 100, "Downloaded WAV must contain audible PCM");
  evidence.wav.push({
    name,
    filename: download.suggestedFilename(),
    bytes: bytes.length,
    channels,
    rate,
    bits,
    duration,
    peak,
  });
}
function watch(page) {
  page.on("pageerror", (error) => evidence.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") evidence.errors.push(message.text());
  });
}
async function guidedJump(page, step) {
  if (!(await page.locator("#tutorial").evaluate((el) => el.open)))
    await page.locator("#tutorial summary").tap();
  const link = page.locator(`#tutorial-step-${step} > [data-tutorial-jump]`);
  const target = (await link.getAttribute("href")).slice(1);
  await link.tap();
  await page.waitForFunction((id) => document.activeElement.id === id, target);
  assert.equal(
    await page.locator("#tutorial").evaluate((el) => el.open),
    false,
  );
  return target;
}
async function backToStep(page, step) {
  await page
    .locator(`.tutorial-return[href="#tutorial-step-${step}"]:visible`)
    .first()
    .tap();
  await page.waitForFunction(
    (id) =>
      document.activeElement.id === id &&
      document.querySelector("#tutorial").open,
    `tutorial-step-${step}`,
  );
}
try {
  browser = await playwright.chromium.launch({
    channel: process.env.PERKUSI_BROWSER_CHANNEL || "chrome",
    headless: true,
  });
  evidence.browser = browser.version();
  const context = await newContext();
  const page = await context.newPage();
  watch(page);
  for (const tool of ["pads", "beatbox", "studio"]) {
    for (const locale of ["id", "en"]) {
      await check(
        `${tool} ${locale}: keyboard tutorial, language continuity and no autoplay`,
        async () => {
          await open(page, tool, locale);
          const guide = page.locator("#tutorial");
          assert.equal(await guide.count(), 1);
          assert.equal(await guide.getAttribute("open"), null);
          const summary = guide.locator("summary");
          await summary.focus();
          await page.keyboard.press("Space");
          assert.equal(await guide.getAttribute("open"), "");
          assert.equal(
            await guide.locator(".tutorial-steps > li").count(),
            tool === "studio" ? 6 : 5,
          );
          const beforeTitle = await summary.innerText();
          await page.evaluate(() => {
            window.__tutorialMain = document.querySelector("main");
          });
          const other = locale === "id" ? "en" : "id";
          await page.locator(`[data-locale="${other}"]`).click();
          assert.equal(await page.locator("html").getAttribute("lang"), other);
          assert.notEqual(await summary.innerText(), beforeTitle);
          assert.equal(await guide.getAttribute("open"), "");
          assert(
            await page.evaluate(
              () => window.__tutorialMain === document.querySelector("main"),
            ),
          );
          if (tool === "pads")
            assert.equal(
              await guide.locator('[data-route="studio"]').getAttribute("href"),
              pagePath("studio", other) + (other === "id" ? "?lang=id" : ""),
            );
          await page.locator(`[data-locale="${locale}"]`).click();
          await summary.focus();
          await page.keyboard.press("Enter");
          assert.equal(await guide.getAttribute("open"), null);
          assert.equal(await page.evaluate(() => window.__tutorialStarts), 0);
          await summary.click();
        },
      );
      for (const width of [320, 360, 390, 430, 768, 1280, 1440, 1920]) {
        await check(
          `${tool} ${locale}: expanded guide at ${width}px`,
          async () => {
            await page.setViewportSize({ width, height: 900 });
            assert(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1,
              ),
            );
            const overflow = await page
              .locator("#tutorial")
              .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
            assert.equal(overflow, false);
            if (tool === "beatbox") {
              assert(
                await page.evaluate(
                  () =>
                    document
                      .querySelector(".bb-transport")
                      .getBoundingClientRect().top >=
                    document.querySelector("#tutorial").getBoundingClientRect()
                      .bottom,
                ),
              );
            }
            if ([390, 1440].includes(width))
              await page.locator("#tutorial").screenshot({
                path: join(output, `${tool}-${locale}-${width}.png`),
              });
          },
        );
      }
    }
  }
  await context.close();
  const staticContext = await browser.newContext({ javaScriptEnabled: false });
  for (const tool of ["pads", "beatbox", "studio"]) {
    for (const locale of ["id", "en"]) {
      await check(
        `${tool} ${locale}: guide remains readable without JavaScript`,
        async () => {
          const staticPage = await staticContext.newPage();
          await staticPage.goto(base + pagePath(tool, locale));
          await staticPage.locator("#tutorial summary").click();
          assert(await staticPage.locator(".tutorial-steps").isVisible());
          await staticPage.close();
        },
      );
    }
  }
  await staticContext.close();
  for (const width of [360, 390, 430]) {
    const mobile = await newContext({
      viewport: { width, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const phone = await mobile.newPage();
    watch(phone);
    for (const tool of ["pads", "beatbox", "studio"]) {
      for (const locale of ["id", "en"]) {
        await check(
          `${tool} ${locale}: touch tutorial links and browser Back at ${width}px`,
          async () => {
            await open(phone, tool, locale);
            await phone.locator("#tutorial summary").tap();
            const steps = await phone
              .locator(".tutorial-steps > li:has(> [data-tutorial-jump])")
              .evaluateAll((elements) =>
                elements.map((el) => Number(el.id.split("-").at(-1))),
              );
            for (const step of steps) {
              const target = await guidedJump(phone, step);
              const bounds = await phone.locator("#" + target).boundingBox();
              assert(
                bounds.y >= 0 && bounds.y < 844,
                `${tool}: ${target} must land in the viewport`,
              );
              assert.equal(
                await phone
                  .locator(".tutorial-return")
                  .first()
                  .getAttribute("href"),
                `#tutorial-step-${step}`,
              );
              await phone.goBack();
              await phone.waitForFunction(
                (id) =>
                  document.querySelector("#tutorial").open &&
                  document.activeElement.id === id,
                `tutorial-step-${step}`,
              );
              assert.equal(
                await phone.locator("html").getAttribute("lang"),
                locale,
              );
            }
            assert.equal(
              await phone.evaluate(() => window.__tutorialStarts),
              0,
            );
            assert(
              await phone.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1,
              ),
            );
            if (tool === "pads") {
              assert(
                await phone
                  .locator("#ps-controls")
                  .evaluate((el) => el.getBoundingClientRect().height <= 150),
              );
              assert.equal(
                await phone.locator('[data-st-pad="kick"] > b').isVisible(),
                false,
              );
            }
          },
        );
      }
    }
    await mobile.close();
  }
  for (const locale of ["id", "en"]) {
    const flowContext = await newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const flow = await flowContext.newPage();
    watch(flow);
    flow.setDefaultTimeout(30000);
    await check(
      `Studio ${locale}: phone tutorial to grid, four bars and downloaded WAV`,
      async () => {
        await open(flow, "studio", locale);
        await flow.waitForFunction(
          () =>
            document.querySelector("#st-preload")?.dataset.state === "ready",
          null,
          { timeout: 60000 },
        );
        await guidedJump(flow, 1);
        await flow.locator("#st-kit").selectOption("ruang");
        await backToStep(flow, 1);
        await guidedJump(flow, 2);
        await flow.locator("#st-bpm").fill("100");
        await flow.locator("#st-bpm").press("Tab");
        await backToStep(flow, 2);
        await guidedJump(flow, 3);
        assert(
          await flow.locator("#st-grid-practice .tutorial-pattern").isVisible(),
        );
        for (const [role, columns] of Object.entries({
          kick: [1, 5, 9, 13],
          snare: [5, 13],
          "closed-hat": [1, 3, 5, 7, 9, 11, 13, 15],
        })) {
          for (const col of columns)
            await flow.locator(`[data-st-step="${role}:${col - 1}"]`).tap();
        }
        assert.equal(
          await flow.locator('[data-st-step][aria-pressed="true"]').count(),
          14,
        );
        await backToStep(flow, 3);
        await guidedJump(flow, 5);
        for (let i = 0; i < 3; i++) await flow.locator("#st-add-chain").tap();
        assert.equal(await flow.locator(".st-chain-slot").count(), 4);
        assert.equal(
          parseFloat(await flow.locator("#st-duration").innerText()),
          9.6,
        );
        await flow.locator("#st-chain-mode").check();
        await backToStep(flow, 5);
        await guidedJump(flow, 4);
        await flow.locator("#st-play").tap();
        await flow.waitForFunction(() =>
          /Memutar|Playing/.test(
            document.querySelector("#st-status").textContent,
          ),
        );
        assert(await flow.evaluate(() => window.__tutorialStarts > 0));
        await flow.locator("#st-pause").tap();
        await backToStep(flow, 4);
        await guidedJump(flow, 6);
        await flow.locator("#st-title").fill("Beat pertamaku");
        await flow.locator("#st-render").tap();
        await flow
          .locator("#st-wav-download")
          .waitFor({ state: "visible", timeout: 60000 });
        await saveWav(
          flow,
          "#st-wav-download",
          `studio-first-beat-${locale}`,
          9.6,
        );
        await flow.screenshot({
          path: join(output, `studio-phone-export-${locale}.png`),
        });
      },
    );
    await check(
      `Pad Station ${locale}: four-count practice, extra instrument and mute/stop controls`,
      async () => {
        await open(flow, "pads", locale);
        await flow.waitForFunction(
          () =>
            document.querySelector('[data-core-loading="drum"]')?.dataset
              .state === "ready",
          null,
          { timeout: 60000 },
        );
        await guidedJump(flow, 2);
        assert.equal(
          await flow.locator("#ps-drums").evaluate((el) => el.open),
          true,
        );
        const kick = flow.locator('[data-st-pad="kick"]'),
          snare = flow.locator('[data-st-pad="snare"]');
        for (const pad of [kick, snare, kick, snare]) await pad.tap();
        assert(await flow.evaluate(() => window.__tutorialStarts >= 4));
        await flow.screenshot({
          path: join(output, `pads-phone-practice-${locale}.png`),
        });
        await backToStep(flow, 2);
        await guidedJump(flow, 3);
        await flow.locator("#ps-extra-instrument").selectOption("kenong-pelog");
        await flow.waitForFunction(
          () =>
            document.querySelector("#ps-extra-loading")?.dataset.state ===
            "ready",
          null,
          { timeout: 60000 },
        );
        await flow.locator(".ps-extra-pad").first().tap();
        await backToStep(flow, 3);
        await guidedJump(flow, 4);
        await flow.locator("#ps-mute").tap();
        await flow.locator("#ps-mute").tap();
        await flow.locator("#ps-stop").tap();
        assert.match(
          await flow.locator("#ps-status").innerText(),
          /dihentikan|stopped/,
        );
        await flow
          .locator('[data-locale="' + (locale === "id" ? "en" : "id") + '"]')
          .click();
        assert.equal(await flow.locator("#ps-mute").isChecked(), false);
      },
    );
    await check(
      `Beatbox ${locale}: three-character mix and demo groove to downloaded audio`,
      async () => {
        await open(flow, "beatbox", locale);
        await flow.waitForFunction(
          () =>
            document.querySelector("#bb-preload")?.dataset.state === "ready",
          null,
          { timeout: 60000 },
        );
        await guidedJump(flow, 1);
        await flow.locator("#bb-play").tap();
        assert.equal(
          await flow.locator('[data-role="kick"]').getAttribute("aria-pressed"),
          "true",
        );
        await backToStep(flow, 1);
        await guidedJump(flow, 2);
        for (const role of ["hat", "vocal-bass"])
          await flow.locator(`[data-role="${role}"]`).tap();
        await flow.waitForFunction(
          () =>
            document.querySelectorAll('.character[aria-pressed="true"]')
              .length === 3,
        );
        await flow.locator("#bb-demo").tap();
        await flow.locator("#bb-pause").tap();
        await backToStep(flow, 2);
        await guidedJump(flow, 5);
        await flow.locator("#project-title").fill("Groove pertamaku");
        await flow.locator("#project-bars").selectOption("4");
        await flow.locator("#project-render").tap();
        await flow
          .locator("#project-download")
          .waitFor({ state: "visible", timeout: 60000 });
        await saveWav(
          flow,
          "#project-download",
          `beatbox-first-groove-${locale}`,
          10,
        );
      },
    );
    await flowContext.close();
  }
  assert.deepEqual(evidence.errors, []);
  evidence.result = "PASS";
} catch (error) {
  evidence.result = "FAIL";
  evidence.failure = error.stack;
  process.exitCode = 1;
  console.error(error);
} finally {
  await browser?.close();
  await server?.close();
  await writeFile(
    join(output, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    JSON.stringify({
      result: evidence.result,
      checks: evidence.checks.length,
      wav: evidence.wav.length,
      errors: evidence.errors.length,
      output,
    }),
  );
}
