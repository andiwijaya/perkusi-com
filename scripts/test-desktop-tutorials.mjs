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
const remote = process.env.PERKUSI_TUTORIAL_BASE_URL;
const output =
  process.env.PERKUSI_DESKTOP_QA_DIR || "qa-artifacts/desktop-tutorials";
await mkdir(output, { recursive: true });
const server = remote
  ? null
  : await preview({
      preview: { host: "127.0.0.1", port: 4178, strictPort: true },
    });
const base = remote || "http://127.0.0.1:4178";
const csp = (await readFile("public/_headers", "utf8"))
  .split("Content-Security-Policy: ")[1]
  .split(/\r?\n/)[0]
  .trim();
const evidence = {
  date: new Date().toISOString(),
  base,
  checks: [],
  wav: [],
  errors: [],
  viewports: [1280, 1440, 1920],
  humanListening: false,
  recruitedUsers: false,
};
let browser;
async function check(name, task) {
  await task();
  evidence.checks.push(name);
  console.log("PASS " + name);
}
async function context(width = 1280) {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
    reducedMotion: "reduce",
    acceptDownloads: true,
    hasTouch: false,
  });
  if (remote)
    await ctx.route(/googletagmanager\.com|google-analytics\.com/, (route) =>
      route.fulfill({ status: 200, body: "" }),
    );
  else
    await ctx.route("**/*", async (route) => {
      if (route.request().resourceType() !== "document")
        return route.continue();
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), "content-security-policy": csp },
      });
    });
  await ctx.addInitScript(() => {
    window.__desktopStarts = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      window.__desktopStarts++;
      return start.apply(this, args);
    };
  });
  return ctx;
}
async function open(page, tool, locale) {
  assert.equal(
    (
      await page.goto(base + pagePath(tool, locale) + "?lang=" + locale)
    ).status(),
    200,
  );
  if (tool === "studio")
    await page.waitForFunction(
      () => document.querySelector(".studio-page")?.dataset.ready === "true",
    );
  else
    await page.waitForFunction(
      (id) => document.querySelector(id)?.dataset.state !== "waiting",
      tool === "pads" ? '[data-core-loading="drum"]' : "#bb-preload",
    );
  assert.equal(await page.locator("html").getAttribute("lang"), locale);
}
async function jump(page, step, keyboard = false) {
  if (!(await page.locator("#tutorial").evaluate((el) => el.open)))
    await page.locator("#tutorial summary").click();
  const link = page.locator(`#tutorial-step-${step} > [data-tutorial-jump]`);
  const id = (await link.getAttribute("href")).slice(1);
  if (keyboard) await link.press("Enter");
  else await link.click();
  await page.waitForFunction(
    (target) => document.activeElement.id === target,
    id,
  );
  assert.equal(
    await page.locator("#tutorial").evaluate((el) => el.open),
    false,
  );
  const visible = await page.locator("#" + id).evaluate((el) => {
    const box = el.getBoundingClientRect();
    const bar = document.querySelector(
      ".ps-controls,.st-transport,.bb-transport",
    );
    const style = getComputedStyle(bar);
    const followsBar = !!(
      bar.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING
    );
    const ceiling =
      style.position === "sticky" &&
      style.top !== "auto" &&
      bar !== el &&
      followsBar
        ? bar.getBoundingClientRect().bottom
        : 0;
    return box.top >= ceiling - 1 && box.top < innerHeight;
  });
  assert(
    visible,
    `Destination ${id} must be visible below any sticky controls`,
  );
  return id;
}
async function back(page, step) {
  await page
    .locator(`.tutorial-return[href="#tutorial-step-${step}"]:visible`)
    .first()
    .click();
  await page.waitForFunction(
    (id) =>
      document.querySelector("#tutorial").open &&
      document.activeElement.id === id,
    `tutorial-step-${step}`,
  );
}
function watch(page) {
  page.on("pageerror", (error) => evidence.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") evidence.errors.push(message.text());
  });
}
async function download(page, button, name, seconds, channels) {
  const pending = page.waitForEvent("download");
  await page.locator(button).click();
  const file = await pending,
    path = join(output, name + ".wav");
  await file.saveAs(path);
  assert.equal(await file.failure(), null);
  const data = await readFile(path);
  assert.equal(data.toString("ascii", 0, 4), "RIFF");
  assert.equal(data.toString("ascii", 8, 12), "WAVE");
  assert.equal(data.readUInt16LE(22), channels);
  assert.equal(data.readUInt32LE(24), 48000);
  assert.equal(data.readUInt16LE(34), 16);
  const duration = data.readUInt32LE(40) / (48000 * channels * 2);
  assert(Math.abs(duration - seconds) < 0.01);
  let peak = 0;
  for (let i = 44; i < 44 + data.readUInt32LE(40); i += 2)
    peak = Math.max(peak, Math.abs(data.readInt16LE(i)));
  assert(peak > 100);
  evidence.wav.push({ name, bytes: data.length, duration, channels, peak });
}
try {
  browser = await playwright.chromium.launch({
    channel: process.env.PERKUSI_BROWSER_CHANNEL || "chrome",
    headless: true,
  });
  evidence.browser = browser.version();
  for (const width of evidence.viewports) {
    const ctx = await context(width),
      page = await ctx.newPage();
    watch(page);
    for (const tool of ["pads", "studio", "beatbox"])
      for (const locale of ["id", "en"]) {
        await check(
          `${tool} ${locale}: mouse, Enter, Back and desktop layout at ${width}px`,
          async () => {
            await open(page, tool, locale);
            await page.locator("#tutorial summary").click();
            const steps = await page
              .locator(".tutorial-steps > li:has(> [data-tutorial-jump])")
              .evaluateAll((items) =>
                items.map((el) => Number(el.id.split("-").at(-1))),
              );
            for (const step of steps) {
              await jump(page, step, step === 1);
              if (tool === "studio" && step === 3) {
                const compact = await page
                  .locator("#st-grid-practice")
                  .evaluate((el) => {
                    const intro = el
                      .querySelector(".tutorial-practice-body > p")
                      .getBoundingClientRect();
                    const table = el
                      .querySelector("table")
                      .getBoundingClientRect();
                    return (
                      table.left >= intro.right &&
                      el.getBoundingClientRect().height < 330
                    );
                  });
                assert(compact, "Desktop recipe must use two readable columns");
              }
              await page.goBack();
              await page.waitForFunction(
                (id) =>
                  document.querySelector("#tutorial").open &&
                  document.activeElement.id === id,
                `tutorial-step-${step}`,
              );
            }
            assert.equal(await page.evaluate(() => window.__desktopStarts), 0);
            assert(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1,
              ),
            );
            if (tool === "pads") {
              await jump(page, 2);
              assert(
                await page
                  .locator("#ps-drums .tutorial-desktop-note")
                  .isVisible(),
              );
              const sizes = await page
                .locator('[data-st-pad="kick"]')
                .evaluate((el) => ({
                  name: parseFloat(
                    getComputedStyle(el.querySelector("span")).fontSize,
                  ),
                  key: parseFloat(
                    getComputedStyle(el.querySelector("b")).fontSize,
                  ),
                }));
              assert(sizes.name > sizes.key);
            } else if (tool === "beatbox") {
              await jump(page, 2);
              assert(
                await page
                  .locator("#bb-stage .tutorial-desktop-note")
                  .isVisible(),
              );
              assert.equal(
                await page
                  .locator("#bb-stage .tutorial-mobile-note")
                  .isVisible(),
                false,
              );
            } else await jump(page, 3);
            if (width === 1440)
              await page.screenshot({
                path: join(output, `${tool}-${locale}-desktop.png`),
              });
          },
        );
      }
    await ctx.close();
  }
  for (const locale of ["id", "en"]) {
    const ctx = await context(),
      page = await ctx.newPage();
    watch(page);
    await check(
      `Studio ${locale}: mouse and keyboard first beat to WAV`,
      async () => {
        await open(page, "studio", locale);
        await page.waitForFunction(
          () => document.querySelector("#st-preload").dataset.state === "ready",
          null,
          { timeout: 60000 },
        );
        await jump(page, 1);
        await page.locator("#st-kit").selectOption("ruang");
        await back(page, 1);
        await jump(page, 2);
        await page.locator("#st-bpm").fill("100");
        await page.locator("#st-bpm").press("Tab");
        await back(page, 2);
        await jump(page, 3);
        for (const [role, cols] of Object.entries({
          kick: [1, 5, 9, 13],
          snare: [5, 13],
          "closed-hat": [1, 3, 5, 7, 9, 11, 13, 15],
        }))
          for (const col of cols)
            await page.locator(`[data-st-step="${role}:${col - 1}"]`).click();
        const cell = page.locator('[data-st-step="kick:0"]');
        await cell.click();
        await cell.press("Space");
        assert.equal(
          await page.locator('[data-st-step][aria-pressed="true"]').count(),
          14,
        );
        assert.equal(await page.evaluate(() => window.__desktopStarts), 0);
        await back(page, 3);
        await jump(page, 5);
        for (let i = 0; i < 3; i++) await page.locator("#st-add-chain").click();
        assert.equal(await page.locator(".st-chain-slot").count(), 4);
        await back(page, 5);
        await jump(page, 4);
        await page.locator("#st-play").click();
        await page.waitForFunction(() =>
          /Memutar|Playing/.test(
            document.querySelector("#st-status").textContent,
          ),
        );
        await page.locator("#st-pause").click();
        await back(page, 4);
        await jump(page, 6);
        await page.locator("#st-title").fill("Desktop first beat");
        await page.locator("#st-render").click();
        await page
          .locator("#st-wav-download")
          .waitFor({ state: "visible", timeout: 60000 });
        await download(
          page,
          "#st-wav-download",
          `studio-desktop-${locale}`,
          9.6,
          2,
        );
      },
    );
    await check(
      `Pad Station ${locale}: click and keyboard 1-2-1-2`,
      async () => {
        await open(page, "pads", locale);
        await page.waitForFunction(
          () =>
            document.querySelector('[data-core-loading="drum"]').dataset
              .state === "ready",
          null,
          { timeout: 60000 },
        );
        await jump(page, 2);
        await page.locator('[data-st-pad="kick"]').click();
        for (const key of ["1", "2", "1", "2"]) await page.keyboard.press(key);
        await page.waitForFunction(() => window.__desktopStarts >= 5);
        await page.locator("#ps-stop").click();
        assert.match(
          await page.locator("#ps-status").innerText(),
          /dihentikan|stopped/,
        );
      },
    );
    await check(
      `Beatbox ${locale}: start, keys 3 and 4, then WAV`,
      async () => {
        await open(page, "beatbox", locale);
        await page.waitForFunction(
          () => document.querySelector("#bb-preload").dataset.state === "ready",
          null,
          { timeout: 60000 },
        );
        await jump(page, 1);
        await page.locator("#bb-play").click();
        await back(page, 1);
        await jump(page, 2);
        await page.keyboard.press("3");
        await page.keyboard.press("4");
        assert.equal(
          await page.locator('.character[aria-pressed="true"]').count(),
          3,
        );
        await page.locator("#bb-pause").click();
        await back(page, 2);
        await jump(page, 5);
        await page.locator("#project-title").fill("Desktop first groove");
        await page.locator("#project-bars").selectOption("4");
        await page.locator("#project-render").click();
        await page
          .locator("#project-download")
          .waitFor({ state: "visible", timeout: 60000 });
        await download(
          page,
          "#project-download",
          `beatbox-desktop-${locale}`,
          10,
          1,
        );
      },
    );
    await ctx.close();
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
