import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { preview } from "vite";
const require = createRequire(import.meta.url);
const pw = require(join(process.env.NODE_REPL_NODE_MODULE_DIRS, "playwright"));
const channel = process.env.PERKUSI_RC_BROWSER || "chrome";
const out =
  process.env.PERKUSI_RC_QA_DIR || `qa-artifacts/v1-release-${channel}`;
await mkdir(out, { recursive: true });
const evidence = {
  checkedAt: new Date().toISOString(),
  channel,
  headless: true,
  listening: "UNVERIFIED",
  physicalDevice: "UNVERIFIED",
  checks: [],
  result: "RUNNING",
};
const server = await preview({
  build: { outDir: "dist" },
  preview: { host: "127.0.0.1", port: 4201, strictPort: true },
});
const base = "http://127.0.0.1:4201";
let browser;
const check = async (name, fn) => {
  const detail = await fn();
  evidence.checks.push({ name, result: "PASS", detail });
  console.log("PASS " + name);
};
const launch =
  channel === "firefox" || channel === "webkit"
    ? () =>
        pw[channel].launch({
          headless: true,
          ...(process.env.PERKUSI_RC_EXECUTABLE
            ? { executablePath: process.env.PERKUSI_RC_EXECUTABLE }
            : {}),
        })
    : () => pw.chromium.launch({ channel, headless: true });
try {
  browser = await launch();
  evidence.browser = browser.version();
  const context = await browser.newContext({
    locale: "en-US",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const snap = () =>
    page.evaluate(() => window.perkusiBeatbox.engine.snapshot());
  const ready = () =>
    page.waitForFunction(
      () => window.perkusiBeatbox?.engine.status === "playing",
    );
  await check(
    "new visitor enters localized homepage CTA and reaches three actual layers within 30 seconds",
    async () => {
      await page.goto(base);
      assert.equal(await page.locator("html").getAttribute("lang"), "id");
      const started = Date.now();
      await page.locator(".hero .button").click();
      await page.waitForFunction(() => window.perkusiBeatbox);
      await page.locator("#bb-demo").click();
      await ready();
      await page.waitForFunction(
        () =>
          Object.values(window.perkusiBeatbox.engine.snapshot().stems).filter(
            (s) => s.active,
          ).length === 3,
      );
      const elapsedMs = Date.now() - started;
      assert(elapsedMs < 30000);
      return { elapsedMs, snapshot: await snap(), noviceTrials: "UNVERIFIED" };
    },
  );
  await check(
    "twenty real UI pause/play cycles, one context, valid graph, offline-after-load, all twelve native decodes",
    async () => {
      await page.evaluate(
        () => (window.rcContext = window.perkusiBeatbox.engine.context),
      );
      for (let i = 0; i < 20; i++) {
        await page.locator("#bb-pause").click();
        await page.locator("#bb-play").click();
        await ready();
      }
      assert(
        await page.evaluate(
          () => window.rcContext === window.perkusiBeatbox.engine.context,
        ),
      );
      for (const role of [
        "kick",
        "snare",
        "hat",
        "vocal-bass",
        "hum",
        "percussion-fx",
      ]) {
        await page
          .locator(`[data-variant-role="${role}"][data-variant="2"]`)
          .click();
        await page.waitForFunction(
          (r) =>
            window.perkusiBeatbox.engine.snapshot().stems[r].state === "ready",
          role,
        );
      }
      let s = await snap();
      assert(Object.values(s.stems).every((r) => r.state === "ready"));
      assert(s.resources.decodedBytes <= 32 * 1024 * 1024);
      assert(s.resources.voices <= 6);
      await context.setOffline(true);
      await page.locator("#bb-pause").click();
      await page.locator("#bb-play").click();
      await ready();
      await context.setOffline(false);
      return {
        cycles: 20,
        sameContext: true,
        after: await snap(),
        offline: "cached sounds resumed; no offline-first claim",
      };
    },
  );
  await check(
    "actual suspend, closed-context recreation, reload-mid-play, reset, bilingual retained state",
    async () => {
      await page.evaluate(() => window.perkusiBeatbox.engine.context.suspend());
      await page.waitForFunction(
        () =>
          window.perkusiBeatbox.engine.snapshot().contextState === "suspended",
      );
      await page.locator("#bb-play").click();
      await ready();
      await page.evaluate(() => window.perkusiBeatbox.engine.context.close());
      await page.waitForFunction(
        () => window.perkusiBeatbox.engine.snapshot().contextState === "closed",
      );
      await page.locator("#bb-play").click();
      await ready();
      assert(
        await page.evaluate(
          () => window.rcContext !== window.perkusiBeatbox.engine.context,
        ),
      );
      await page.reload();
      await page.waitForFunction(() => window.perkusiBeatbox);
      assert.equal((await snap()).contextState, "absent");
      await page.locator("#bb-demo").click();
      await ready();
      const before = await snap();
      await page.locator('[data-locale="en"]').click();
      assert.equal((await snap()).origin, before.origin);
      await page.locator("#bb-reset").click();
      const after = await snap();
      assert.equal(after.beat, 0);
      assert(Object.values(after.stems).every((r) => !r.enabled));
      return { before, after };
    },
  );
  await context.close();
  await check(
    "real HTTP 404 for every sound: localized error, recoverable role retry and Play",
    async () => {
      const c = await browser.newContext();
      let fail = true;
      await c.route("**/*.wav", (r) =>
        fail
          ? r.fulfill({ status: 404, body: "missing QA asset" })
          : r.continue(),
      );
      const p = await c.newPage();
      await p.goto(base + "/beatbox/");
      await p.waitForFunction(() => window.perkusiBeatbox);
      await p.locator("#bb-demo").click();
      await p.waitForFunction(
        () => window.perkusiBeatbox.engine.status === "error",
      );
      assert((await p.locator("#bb-status").textContent()).includes("Putar"));
      assert.equal(await p.locator("[data-retry]:visible").count(), 6);
      await p.locator('[data-locale="en"]').click();
      assert((await p.locator("#bb-status").textContent()).includes("Play"));
      const failed = await p.evaluate(() =>
        window.perkusiBeatbox.engine.snapshot(),
      );
      fail = false;
      await p.locator('[data-retry="kick"]').click();
      await p.waitForFunction(
        () =>
          window.perkusiBeatbox.engine.snapshot().stems.kick.state === "ready",
      );
      await p.locator("#bb-play").click();
      await p.waitForFunction(
        () => window.perkusiBeatbox.engine.status === "playing",
      );
      await c.close();
      return { failed, recovered: true };
    },
  );
  await check(
    "missing WebAudio and rejected native resume show recoverable errors; storage denial keeps locale usable",
    async () => {
      const findings = [];
      for (const mode of ["missing", "resume-rejected", "storage-denied"]) {
        const c = await browser.newContext();
        await c.addInitScript((mode) => {
          if (mode === "missing") {
            window.savedContext = window.AudioContext;
            window.AudioContext = undefined;
            window.webkitAudioContext = undefined;
          }
          if (mode === "resume-rejected") {
            const resume = AudioContext.prototype.resume;
            AudioContext.prototype.resume = function () {
              AudioContext.prototype.resume = resume;
              return Promise.reject(
                new DOMException("QA permission rejection", "NotAllowedError"),
              );
            };
          }
          if (mode === "storage-denied") {
            Storage.prototype.getItem = () => {
              throw new DOMException("QA storage denial", "SecurityError");
            };
            Storage.prototype.setItem = () => {
              throw new DOMException("QA storage denial", "SecurityError");
            };
          }
        }, mode);
        const p = await c.newPage();
        const pageErrors = [];
        p.on("pageerror", (e) => pageErrors.push(e.message));
        await p.goto(base + "/beatbox/");
        await p.waitForFunction(() => window.perkusiBeatbox);
        await p.locator("#bb-play").click();
        if (mode !== "storage-denied") {
          await p.waitForFunction(
            () => window.perkusiBeatbox.engine.status === "error",
          );
          assert(
            (await p.locator("#bb-status").textContent()).includes(
              mode === "missing" ? "browser" : "Putar",
            ),
          );
          if (mode === "missing")
            await p.evaluate(() => (window.AudioContext = window.savedContext));
          await p.locator("#bb-play").click();
        }
        await p.waitForFunction(
          () => window.perkusiBeatbox.engine.status === "playing",
        );
        await p.locator('[data-locale="en"]').click();
        assert.equal(await p.locator("html").getAttribute("lang"), "en");
        assert.equal(pageErrors.length, 0);
        findings.push({
          mode,
          fixture:
            mode !== "storage-denied"
              ? "controlled API failure on native browser"
              : "controlled Storage denial",
          recovered: true,
        });
        await c.close();
      }
      return findings;
    },
  );
  // Intercept the production hostname using the local build: no request reaches GA or production.
  await check(
    "production-origin local simulation: six milestones, zero composition payload; blocked and throwing analytics preserve audio",
    async () => {
      const details = [];
      for (const mode of ["normal", "blocked", "throwing"]) {
        const c = await browser.newContext();
        let fail = true;
        const external = [];
        if (mode === "throwing")
          await c.addInitScript(() => (window.dataLayer = Object.freeze([])));
        await c.route("**/*", async (route) => {
          const u = new URL(route.request().url());
          if (u.hostname === "www.googletagmanager.com") {
            external.push(u.href);
            return mode === "blocked"
              ? route.abort()
              : route.fulfill({
                  contentType: "text/javascript",
                  body: "/* QA inert GA loader: no remote collection */",
                });
          }
          if (u.hostname !== "perkusi.com")
            throw new Error("unexpected external " + u.hostname);
          if (u.pathname.endsWith(".wav") && fail)
            return route.fulfill({
              status: 404,
              body: "QA genuine HTTP failure",
            });
          const response = await fetch(base + u.pathname + u.search);
          let headers = Object.fromEntries(response.headers);
          if (route.request().resourceType() === "document") {
            headers["content-security-policy"] = (
              await readFile("public/_headers", "utf8")
            )
              .split("Content-Security-Policy: ")[1]
              .trim();
          }
          await route.fulfill({
            status: response.status,
            headers,
            body: Buffer.from(await response.arrayBuffer()),
          });
        });
        const p = await c.newPage();
        const pageErrors = [];
        p.on("pageerror", (e) => pageErrors.push(e.message));
        await p.goto("https://perkusi.com/beatbox/");
        await p.locator("#bb-play").waitFor();
        await p.waitForFunction(
          () => !document.querySelector("#bb-play").disabled,
        );
        assert.equal(
          await p.evaluate(() => typeof window.perkusiBeatbox),
          "undefined",
        );
        await p.locator("#bb-demo").click();
        await p.waitForFunction(
          () => document.querySelector('[data-retry="kick"]').hidden === false,
        );
        fail = false;
        await p.locator("#bb-play").click();
        await p.waitForFunction(
          () => document.querySelectorAll('[data-active="true"]').length === 3,
        );
        await p.locator('[data-locale="en"]').click();
        if (mode !== "throwing") {
          await p.waitForFunction(
            () =>
              Array.from(window.dataLayer, (args) => Array.from(args)).some(
                (args) =>
                  args[0] === "event" && args[1] === "three_layers_reached",
              ),
            null,
            { timeout: 10000 },
          );
          const layer = await p.evaluate(() =>
            Array.from(window.dataLayer, (args) => Array.from(args)),
          );
          const events = layer.filter((args) => args[0] === "event");
          assert.deepEqual(
            [...new Set(events.map((args) => args[1]))].sort(),
            [
              "audio_error",
              "audio_started",
              "first_layer_enabled",
              "language_changed",
              "playground_open",
              "three_layers_reached",
            ].sort(),
          );
          assert(
            events.every((args) =>
              Object.keys(args[2]).every((k) => k === "language"),
            ),
          );
          assert(
            events.filter((args) => args[1] === "audio_started").length === 1,
          );
          const config = layer.find((args) => args[0] === "config");
          assert.equal(config[1], "G-G9ETDLX4XP");
          assert.equal(config[2].allow_google_signals, false);
          assert.equal(config[2].allow_ad_personalization_signals, false);
          details.push({
            mode,
            events,
            config,
            interceptedGA: external.length,
          });
        } else
          details.push({
            mode,
            audioPlaying: true,
            interceptedGA: external.length,
          });
        assert.equal(pageErrors.length, 0);
        await c.close();
      }
      return { simulatedOrigin: true, noActualGATraffic: true, details };
    },
  );
  assert.equal(errors.length, 0);
  evidence.result = "PASS";
} catch (error) {
  evidence.result = browser ? "FAIL" : "UNAVAILABLE";
  evidence.error = error.stack;
  console.error(error.stack);
  if (browser) process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise((r) => server.httpServer.close(r));
  await writeFile(
    join(out, "release-browser.json"),
    JSON.stringify(evidence, null, 2),
  );
}
