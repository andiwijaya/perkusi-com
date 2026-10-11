import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { preview } from "vite";
import { characterDefinitions } from "../src/characters/characters.js";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(
    join(process.env.NODE_REPL_NODE_MODULE_DIRS, "playwright"),
  );
}
const channel = process.env.PERKUSI_AUDIO_CHANNEL || "chrome";
const output =
  process.env.PERKUSI_BEATBOX_QA_DIR || "qa-artifacts/s4-2026-10-11/chrome";
await mkdir(output, { recursive: true });
const server = await preview({
  build: { outDir: "dist" },
  preview: { host: "127.0.0.1", port: 4188, strictPort: true },
});
const evidence = {
  checkedAt: new Date().toISOString(),
  channel,
  headless: true,
  listening: "UNVERIFIED",
  physicalDevice: "UNVERIFIED",
  checks: [],
  errors: [],
  result: "RUNNING",
};
const check = async (name, fn) => {
  const detail = await fn();
  evidence.checks.push({ name, result: "PASS", detail });
  console.log("PASS " + name);
};
let browser;
try {
  browser = await playwright.chromium.launch({ channel, headless: true });
  evidence.browser = browser.version();
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage(),
    base = "http://127.0.0.1:4188";
  page.on("pageerror", (e) => evidence.errors.push(e.message));
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  const csp = (await readFile("public/_headers", "utf8"))
    .split("Content-Security-Policy: ")[1]
    .trim();
  await context.route("**/*", async (route) => {
    if (route.request().resourceType() !== "document") return route.continue();
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), "content-security-policy": csp },
    });
  });
  const state = () =>
    page.evaluate(() => window.perkusiBeatbox.engine.snapshot());
  const ready = () =>
    page.waitForFunction(
      () => window.perkusiBeatbox?.engine.status === "playing",
    );
  await check(
    "ID default; six accessible characters; no autoplay/sample/GA request under actual CSP",
    async () => {
      await page.goto(base + "/beatbox/");
      await page.waitForFunction(() => window.perkusiBeatbox);
      assert.equal(await page.locator("html").getAttribute("lang"), "id");
      assert.equal((await state()).contextState, "absent");
      assert.equal(await page.locator(".character").count(), 6);
      assert(!requests.some((url) => /\.wav|googletagmanager/.test(url)));
      assert.equal(
        await page
          .locator('[data-role="kick"] .char-loading')
          .evaluate((el) => getComputedStyle(el).display),
        "none",
      );
      return { sampleRequests: 0, context: "absent", cspApplied: true };
    },
  );
  await check(
    "first gesture loads actual PCM; quantized A/B replacement retains origin and native phase",
    async () => {
      await page.locator('[data-role="kick"]').click();
      await ready();
      const before = await state();
      assert(before.stems.kick.active);
      assert(before.resources.decodedBytes > 0);
      await page
        .locator('[data-variant-role="kick"][data-variant="2"]')
        .click();
      await page.waitForFunction(
        () =>
          window.perkusiBeatbox.engine.snapshot().stems.kick.pendingAt !== null,
      );
      const pending = await state();
      assert.equal(pending.origin, before.origin);
      assert.equal(pending.stems.kick.appliedVariant, 1);
      await page.waitForFunction(
        () =>
          window.perkusiBeatbox.engine.snapshot().stems.kick.appliedVariant ===
          2,
      );
      const event = await page.evaluate(() =>
        window.perkusiBeatbox.engine.events.findLast(
          (e) => e.type === "voice-start" && e.variant === 2,
        ),
      );
      const expected = (((event.when - before.origin) % 5) + 5) % 5;
      assert(Math.abs(event.phase - expected) < 1e-8);
      return {
        origin: before.origin,
        pendingAt: pending.stems.kick.pendingAt,
        replacement: event,
        snapshot: await state(),
      };
    },
  );
  await check(
    "language switches preserve audio ownership, variation and transport",
    async () => {
      await page.evaluate(() => {
        window.savedBeatboxContext = window.perkusiBeatbox.engine.context;
      });
      const before = await state();
      await page.locator('[data-locale="en"]').click();
      assert.equal(
        await page.locator('[data-role-label="kick"]').textContent(),
        "Lip kick",
      );
      assert(
        await page.evaluate(
          () =>
            window.savedBeatboxContext === window.perkusiBeatbox.engine.context,
        ),
      );
      assert.equal((await state()).origin, before.origin);
      assert.equal((await state()).stems.kick.variant, 2);
      await page.locator('[data-locale="id"]').click();
      return {
        sameContext: true,
        sameOrigin: true,
        variant: 2,
        languages: ["en", "id"],
      };
    },
  );
  await check(
    "rapid last intent, pause/reset/replay and actual native suspend leave one bounded graph",
    async () => {
      await page.evaluate(async () => {
        const e = window.perkusiBeatbox.engine;
        for (let i = 0; i < 24; i++) {
          e.setLayer("hat", i % 2 === 0);
          await e.setVariation("kick", (i % 2) + 1);
        }
      });
      assert.equal((await state()).stems.hat.enabled, false);
      for (let i = 0; i < 12; i++) {
        await page.locator("#bb-pause").click();
        await page.locator("#bb-play").click();
        await ready();
      }
      await page.evaluate(() => window.perkusiBeatbox.engine.suspend());
      assert.equal((await state()).contextState, "suspended");
      await page.locator("#bb-play").click();
      await ready();
      await page.locator("#bb-reset").click();
      const reset = await state();
      assert.equal(reset.beat, 0);
      assert(
        Object.values(reset.stems).every((s) => !s.enabled && s.variant === 1),
      );
      await page.locator("#bb-demo").click();
      await ready();
      assert.equal(
        Object.values((await state()).stems).filter((s) => s.enabled).length,
        3,
      );
      assert((await state()).resources.voices <= 6);
      assert(
        await page.evaluate(
          () =>
            window.savedBeatboxContext === window.perkusiBeatbox.engine.context,
        ),
      );
      return {
        repeatedPauseReplay: 12,
        rapidIntents: 24,
        reset,
        after: await state(),
      };
    },
  );
  await check(
    "keyboard shortcut/native activation, reduced motion, ID/EN responsive pixels and 44px targets",
    async () => {
      await page.locator("#bb-pause").click();
      await page.locator('[data-role="kick"]').focus();
      await page.keyboard.press("3");
      assert.equal((await state()).stems.hat.enabled, false);
      await page.keyboard.press("Enter");
      assert.equal((await state()).stems.kick.enabled, false);
      const layouts = [];
      for (const locale of ["id", "en"]) {
        await page.locator(`[data-locale="${locale}"]`).click();
        for (const [width, height] of [
          [320, 700],
          [360, 800],
          [390, 844],
          [430, 932],
          [640, 900],
          [768, 1024],
          [1024, 768],
          [1280, 800],
          [1440, 900],
          [1920, 1080],
          [844, 390],
        ]) {
          await page.setViewportSize({ width, height });
          const result = await page.evaluate(() => ({
            width: innerWidth,
            scroll: document.documentElement.scrollWidth,
            controls: [
              ...document.querySelectorAll(
                ".beatbox-page button:not([hidden]),.beatbox-page input",
              ),
            ].map((el) => ({
              w: el.getBoundingClientRect().width,
              h: el.getBoundingClientRect().height,
            })),
            animation: getComputedStyle(document.querySelector(".char-body"))
              .animationName,
          }));
          assert(
            result.scroll <= width,
            `overflow ${locale} ${width} ${result.scroll}`,
          );
          assert(result.controls.every((r) => r.w >= 44 && r.h >= 44));
          assert.equal(result.animation, "none");
          if ([320, 390, 1440, 844].includes(width))
            await page.screenshot({
              path: join(output, `${locale}-${width}x${height}.png`),
              fullPage: true,
            });
          layouts.push({ locale, width, height, ...result });
        }
      }
      return layouts;
    },
  );
  await check(
    "P3 standalone SVG has hidden idle status without stylesheet; external CSS reveals only selected state",
    async () => {
      const probe = await context.newPage(),
        rows = [];
      for (const { role, name: characterName } of characterDefinitions) {
        const svg = await readFile(
          `internal/original-groove/characters/${characterName.toLowerCase()}.svg`,
          "utf8",
        );
        await probe.setContent(svg);
        for (const name of ["char-status", "char-loading", "char-error"])
          assert.equal(
            await probe
              .locator("." + name)
              .evaluate((el) => getComputedStyle(el).display),
            "none",
          );
        rows.push({ role, idleHidden: true });
      }
      const css = await readFile("src/characters/characters.css", "utf8");
      await probe.route("**/src/characters/characters.css", (route) =>
        route.fulfill({ contentType: "text/css", body: css }),
      );
      await probe.setContent(
        `<link rel="stylesheet" href="${base}/src/characters/characters.css"><button class="character" data-state="loading">${await readFile("internal/original-groove/characters/bumi.svg", "utf8")}</button>`,
      );
      assert.notEqual(
        await probe
          .locator(".char-loading")
          .evaluate((el) => getComputedStyle(el).display),
        "none",
      );
      assert.equal(
        await probe
          .locator(".char-error")
          .evaluate((el) => getComputedStyle(el).display),
        "none",
      );
      await probe
        .locator("button")
        .evaluate((el) => (el.dataset.state = "error"));
      assert.notEqual(
        await probe
          .locator(".char-error")
          .evaluate((el) => getComputedStyle(el).display),
        "none",
      );
      assert.equal(
        await probe
          .locator(".char-loading")
          .evaluate((el) => getComputedStyle(el).display),
        "none",
      );
      await probe.close();
      return rows;
    },
  );
  await check(
    "actual missing candidate preserves current voice; retry and cancelled slow load recover",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator("#bb-reset").click();
      await page.locator('[data-role="hum"]').click();
      await ready();
      const path = await page.evaluate(
        () => window.perkusiBeatbox.engine.variants.get("hum").get(2).stem.url,
      );
      const url = new URL(path, base).href;
      await page.route(url, (route) =>
        route.fulfill({ status: 404, body: "missing QA candidate" }),
      );
      await page.locator('[data-variant-role="hum"][data-variant="2"]').click();
      await page.waitForFunction(
        () =>
          window.perkusiBeatbox.engine.snapshot().stems.hum.state === "error",
      );
      const failure = await state();
      assert.equal(failure.stems.hum.appliedVariant, 1);
      assert.equal(failure.stems.hum.active, true);
      assert.equal(failure.status, "playing");
      await page.screenshot({
        path: join(output, "actual-asset-error.png"),
        fullPage: true,
      });
      await page.unroute(url);
      await page.locator('[data-retry="hum"]').click();
      await page.waitForFunction(
        () =>
          window.perkusiBeatbox.engine.snapshot().stems.hum.appliedVariant ===
          2,
      );
      const delayedPath = await page.evaluate(
        () =>
          window.perkusiBeatbox.engine.variants.get("percussion-fx").get(2).stem
            .url,
      );
      const delayedUrl = new URL(delayedPath, base).href;
      await page.route(delayedUrl, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 600));
        await route.continue().catch(() => {});
      });
      await page
        .locator('[data-variant-role="percussion-fx"][data-variant="2"]')
        .click();
      await page.waitForFunction(
        () =>
          window.perkusiBeatbox.engine.snapshot().stems["percussion-fx"]
            .state === "loading",
      );
      await page.screenshot({
        path: join(output, "actual-loading.png"),
        fullPage: true,
      });
      await page.locator("#bb-pause").click();
      assert.equal((await state()).resources.timer, false);
      await page.unroute(delayedUrl);
      await page.locator("#bb-play").click();
      await ready();
      assert.equal((await state()).stems["percussion-fx"].variant, 2);
      return { failure, recovered: await state(), cancelledSlowRequest: true };
    },
  );
  if (process.env.PERKUSI_BEATBOX_CAPTURE === "120")
    await check(
      "120s actual six-role Beatbox graph capture, signal/phase positive control",
      async () => {
        await page.locator("#bb-reset").click();
        await page.evaluate(() => {
          const e = window.perkusiBeatbox.engine;
          for (const id of e.enabled.keys()) e.setLayer(id, true);
        });
        await page.locator("#bb-play").click();
        await ready();
        console.log(
          "Native 120s Beatbox capture started; listening remains UNVERIFIED.",
        );
        const capture = await page.evaluate(async () => {
          const e = window.perkusiBeatbox.engine,
            output = e.createCapture(),
            mime = "audio/webm;codecs=opus";
          if (!MediaRecorder.isTypeSupported(mime))
            throw new Error("Capture MIME unavailable");
          const recorder = new MediaRecorder(output.stream, { mimeType: mime }),
            chunks = [];
          recorder.ondataavailable = (event) => {
            if (event.data.size) chunks.push(event.data);
          };
          const start = e.context.currentTime,
            wall = performance.now();
          let timer;
          let blob;
          try {
            blob = await new Promise((resolve, reject) => {
              recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
              recorder.onerror = (event) =>
                reject(new Error(event.error?.message));
              recorder.start(1000);
              timer = setInterval(() => {
                if (e.context.currentTime - start >= 120) {
                  clearInterval(timer);
                  recorder.stop();
                } else if (performance.now() - wall > 135000) {
                  clearInterval(timer);
                  recorder.stop();
                  reject(new Error("Audio clock stalled"));
                }
              }, 30);
            });
          } finally {
            clearInterval(timer);
            output.dispose();
          }
          const bytes = await blob.arrayBuffer(),
            b = await e.context.decodeAudioData(bytes.slice(0)),
            d = b.getChannelData(0),
            rate = b.sampleRate;
          let peak = 0,
            energy = 0;
          for (const x of d) {
            peak = Math.max(peak, Math.abs(x));
            energy += x * x;
          }
          function find(shift = 0) {
            let best = { lag: 0, correlation: -1 };
            for (let lag = -80; lag <= 80; lag++) {
              let dot = 0,
                aa = 0,
                bb = 0;
              for (let i = 0; i < Math.round(0.8 * rate); i += 4) {
                const a = d[Math.round(2 * rate) + i],
                  v = d[Math.round(112 * rate) + i + lag + shift];
                dot += a * v;
                aa += a * a;
                bb += v * v;
              }
              const correlation = dot / Math.sqrt(aa * bb);
              if (correlation > best.correlation) best = { lag, correlation };
            }
            return best;
          }
          return {
            bytes: Array.from(new Uint8Array(bytes)),
            metrics: {
              mime,
              elapsedAudioSeconds: e.context.currentTime - start,
              wallSeconds: (performance.now() - wall) / 1000,
              decodedDuration: b.duration,
              sampleRate: rate,
              channels: b.numberOfChannels,
              peak,
              rms: Math.sqrt(energy / d.length),
              actual: find(),
              positive53SampleShift: find(53),
              scope:
                "120s aggregate native graph, 2→112 second windows; physical/listening UNVERIFIED",
            },
          };
        });
        const bytes = Buffer.from(capture.bytes);
        await writeFile(join(output, "beatbox-realtime-120s.webm"), bytes);
        capture.metrics.sha256 = createHash("sha256")
          .update(bytes)
          .digest("hex");
        await writeFile(
          join(output, "capture-analysis.json"),
          JSON.stringify(capture.metrics, null, 2),
        );
        assert(capture.metrics.elapsedAudioSeconds >= 120);
        assert(capture.metrics.peak > 0.01 && capture.metrics.peak < 0.95);
        assert(capture.metrics.rms > 0.001);
        assert.equal(capture.metrics.actual.lag, 0);
        assert(capture.metrics.actual.correlation > 0.995);
        assert.equal(capture.metrics.positive53SampleShift.lag, -53);
        assert.equal((await state()).resources.captures, 0);
        return capture.metrics;
      },
    );
  await check(
    "all six native roles choose A/B at shared boundaries; three-layer quick start and normal motion",
    async () => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.locator("#bb-reset").click();
      const started = Date.now();
      await page.locator("#bb-demo").click();
      await ready();
      const seconds = (Date.now() - started) / 1000;
      assert(seconds < 30);
      assert.equal(
        Object.values((await state()).stems).filter((s) => s.active).length,
        3,
      );
      for (const id of ["snare", "hum", "percussion-fx"])
        await page.locator(`[data-role="${id}"]`).click();
      await page.waitForFunction(() =>
        Object.values(window.perkusiBeatbox.engine.snapshot().stems).every(
          (s) => s.active,
        ),
      );
      const origin = (await state()).origin;
      for (const variant of [2, 1]) {
        for (const { role } of characterDefinitions)
          await page
            .locator(`[data-variant-role="${role}"][data-variant="${variant}"]`)
            .click();
        await page.waitForFunction(
          (variant) =>
            Object.values(window.perkusiBeatbox.engine.snapshot().stems).every(
              (s) => s.appliedVariant === variant,
            ),
          variant,
        );
        assert.equal((await state()).origin, origin);
      }
      await page.waitForFunction(
        () => window.perkusiBeatbox.engine.voices.size === 6,
      );
      const bounds = await page.evaluate(() =>
        window.perkusiBeatbox.engine.cacheBounds(),
      );
      assert(bounds.bytes < 32 * 1024 * 1024);
      assert(bounds.peak < 0.95);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.waitForFunction(
        () =>
          Number(
            document
              .querySelector('[data-role="kick"]')
              .style.getPropertyValue("--pulse"),
          ) > 0.3,
      );
      const motion = await page
        .locator('[data-role="kick"] .char-body')
        .evaluate((el) => getComputedStyle(el).transform);
      assert.notEqual(motion, "none");
      await page.screenshot({
        path: join(output, "six-active-normal-motion.png"),
        fullPage: true,
      });
      await page.emulateMedia({ reducedMotion: "reduce" });
      return {
        automatedWarmDemoSeconds: seconds,
        noviceUserTrials: "UNVERIFIED",
        allTwelveNativeChoices: true,
        origin,
        bounds,
        motion,
        snapshot: await state(),
      };
    },
  );
  await check(
    "pagehide disposes graph, timer and capture ownership",
    async () => {
      const result = await page.evaluate(async () => {
        const e = window.perkusiBeatbox.engine;
        window.dispatchEvent(new Event("pagehide"));
        await e.dispose();
        return e.snapshot();
      });
      assert.equal(result.resources.voices, 0);
      assert.equal(result.resources.timer, false);
      assert.equal(result.resources.captures, 0);
      return result;
    },
  );
  assert.deepEqual(evidence.errors, []);
  evidence.result = "PASS";
  await context.close();
} catch (error) {
  evidence.result = "FAIL";
  evidence.failure = error.stack;
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server.httpServer.close();
  await writeFile(
    join(output, "beatbox-browser.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    JSON.stringify({
      result: evidence.result,
      checks: evidence.checks.length,
      output,
    }),
  );
}
