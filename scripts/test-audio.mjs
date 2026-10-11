import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { preview } from "vite";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(
    join(process.env.NODE_REPL_NODE_MODULE_DIRS, "playwright"),
  );
}
const output = process.env.PERKUSI_AUDIO_QA_DIR || "qa-artifacts/s2-2026-10-11";
const channel = process.env.PERKUSI_AUDIO_CHANNEL || "chrome";
const prototypeDist =
  process.env.PERKUSI_AUDIO_DIST || "qa-artifacts/s2-2026-10-11/prototype-dist";
const full = process.env.PERKUSI_AUDIO_FULL !== "0";
await mkdir(output, { recursive: true });
const evidence = {
  checkedAt: new Date().toISOString(),
  channel,
  headless: true,
  listening: "UNVERIFIED",
  physicalDevice: "UNVERIFIED",
  checks: [],
  errors: [],
  result: "RUNNING",
  unavailableBrowsers: Object.fromEntries(
    ["firefox", "webkit"].map((name) => [
      name,
      {
        path: playwright[name].executablePath(),
        available: existsSync(playwright[name].executablePath()),
      },
    ]),
  ),
};
const server = await preview({
  mode: "audio-prototype",
  build: { outDir: prototypeDist },
  preview: { host: "127.0.0.1", port: 4182, strictPort: true },
});
let browser;
const base = "http://127.0.0.1:4182";
async function check(name, action) {
  const detail = await action();
  evidence.checks.push({ name, result: "PASS", detail: detail ?? null });
  console.log("PASS " + name);
}
try {
  browser = await playwright.chromium.launch({ channel, headless: true });
  evidence.browser = browser.version();
  const context = await browser.newContext({
    locale: "en-US",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => evidence.errors.push(error.message));
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  const state = () =>
    page.evaluate(() => window.perkusiAudioPrototype.snapshot());
  const ready = async () => {
    await page.waitForFunction(() =>
      ["playing", "error"].includes(window.perkusiAudioPrototype?.status),
    );
    const result = await state();
    assert.equal(result.status, "playing", JSON.stringify(result));
  };
  await check(
    "no autoplay or fixture fetch; internal noindex, ID default, no GA",
    async () => {
      await page.goto(base + "/internal/audio/");
      await page.waitForFunction(() => window.perkusiAudioPrototype);
      assert.equal(await page.locator("html").getAttribute("lang"), "id");
      assert.equal((await state()).contextState, "absent");
      assert(
        (
          await page.locator('meta[name="robots"]').getAttribute("content")
        ).includes("noindex"),
      );
      assert(!requests.some((url) => /\.wav|googletagmanager/.test(url)));
    },
  );
  await check(
    "gesture decodes three WAVs; one native context, equal starts and phase, locale preserves audio",
    async () => {
      await page.locator("#play").click();
      await ready();
      const before = await state();
      assert.equal(before.resources.voices, 3);
      assert.equal(
        Object.values(before.stems).filter((s) => s.state === "ready").length,
        3,
      );
      const starts = before.events.filter((e) => e.type === "voice-start");
      assert.equal(new Set(starts.map((e) => e.when)).size, 1);
      assert(starts.every((e) => e.phase === 0));
      await page.evaluate(() => {
        window.qaContext = window.perkusiAudioPrototype.context;
      });
      await page.locator('[data-locale="en"]').click();
      assert.equal(await page.locator("html").getAttribute("lang"), "en");
      assert(
        await page.evaluate(
          () => window.qaContext === window.perkusiAudioPrototype.context,
        ),
      );
      await page.goBack();
      await page.waitForFunction(() => document.documentElement.lang === "id");
      assert.equal(await page.locator("html").getAttribute("lang"), "id");
      assert.equal((await state()).stats.created, 3);
      return {
        resources: before.resources,
        starts,
        sampleRate: await page.evaluate(() => window.qaContext.sampleRate),
      };
    },
  );
  await check(
    "native quantized off/on and rapid scheduled cancellation; two- then three-stem mix",
    async () => {
      await page.locator('[data-stem="hum"]').click();
      const queued = (await state()).stems.hum.pendingAt;
      assert(queued !== null);
      await page.waitForFunction(
        () => !window.perkusiAudioPrototype.snapshot().stems.hum.active,
        null,
        { timeout: 8000 },
      );
      await page.waitForFunction(
        () => window.perkusiAudioPrototype.voices.size === 2,
      );
      await page.locator('[data-stem="hum"]').click();
      await page.waitForFunction(
        () => window.perkusiAudioPrototype.snapshot().stems.hum.active,
      );
      await page.waitForFunction(() => {
        const e = window.perkusiAudioPrototype;
        return (
          e.transport.nextBar(e.context.currentTime) - e.context.currentTime <
          0.1
        );
      });
      const cancel = await page.evaluate(() => {
        const e = window.perkusiAudioPrototype;
        e.setLayer("air", false);
        const scheduled = e.pending.get("air")?.scheduled;
        for (let i = 0; i < 40; i++) e.setLayer("air", i % 2 === 0);
        e.setLayer("air", true);
        return {
          scheduled,
          pending: e.pending.has("air"),
          voices: e.voices.size,
          end: e.roleVoice.get("air").endTime,
          events: e.snapshot().events.slice(-5),
        };
      });
      assert(cancel.scheduled);
      assert(!cancel.pending);
      assert.equal(cancel.voices, 3);
      assert.equal(cancel.end, null);
      return { queued, cancel };
    },
  );
  await check(
    "20 real play/pause cycles preserve held phase and reclaim sources; reset downbeat",
    async () => {
      for (let i = 0; i < 20; i++) {
        await page.locator("#pause").click();
        await page.waitForFunction(
          () => window.perkusiAudioPrototype.voices.size === 0,
        );
        const paused = await state();
        assert(!paused.resources.timer);
        await page.locator("#play").click();
        await ready();
        const resumed = await state();
        const event = resumed.events.filter((e) => e.type === "play").at(-1);
        assert(
          Math.abs((event.when - event.origin) / 0.625 - paused.beat) < 1e-9,
        );
        assert.equal(resumed.resources.voices, 3);
      }
      await page.locator("#reset").click();
      await page.waitForFunction(
        () => window.perkusiAudioPrototype.voices.size === 0,
      );
      const reset = await state();
      assert.equal(reset.beat, 0);
      assert(Object.values(reset.stems).every((s) => !s.enabled));
      assert.equal(reset.stats.created, reset.stats.disposed);
      for (const id of ["thump", "air", "hum"])
        await page.locator(`[data-stem="${id}"]`).click();
      await page.locator("#play").click();
      await ready();
      return reset.stats;
    },
  );
  await check(
    "native context suspend freezes transport; user resume restores phase",
    async () => {
      await page.locator("#suspend").click();
      await page.waitForFunction(
        () =>
          window.perkusiAudioPrototype.context.state === "suspended" &&
          window.perkusiAudioPrototype.status === "suspended" &&
          window.perkusiAudioPrototype.voices.size === 0,
      );
      const paused = await state();
      assert.equal(paused.resources.voices, 0);
      assert(!paused.resources.timer);
      await page.locator("#play").click();
      await ready();
      const resumed = await state();
      const event = resumed.events.filter((e) => e.type === "play").at(-1);
      assert(
        Math.abs((event.when - event.origin) / 0.625 - paused.beat) < 1e-9,
      );
      return { heldBeat: paused.beat, nativeState: paused.contextState };
    },
  );
  await check(
    "per-role HTTP failure, retry, canceled load, all-fail retry and rejected resume",
    async () => {
      const failurePage = await context.newPage();
      failurePage.on("pageerror", (error) =>
        evidence.errors.push(error.message),
      );
      await failurePage.route(/\/air-[^/]+\.wav/, (route) =>
        route.fulfill({ status: 503, body: "test failure" }),
      );
      await failurePage.goto(base + "/internal/audio/?lang=en");
      await failurePage.locator("#play").click();
      await failurePage.waitForFunction(
        () => window.perkusiAudioPrototype.status === "playing",
      );
      let failed = await failurePage.evaluate(() =>
        window.perkusiAudioPrototype.snapshot(),
      );
      assert.equal(failed.stems.air.state, "error");
      assert.equal(failed.resources.voices, 2);
      assert(await failurePage.locator('[data-retry="air"]').isVisible());
      await failurePage.unrouteAll();
      await failurePage.locator('[data-retry="air"]').click();
      await failurePage.waitForFunction(
        () => window.perkusiAudioPrototype.snapshot().stems.air.active,
      );
      assert.equal(
        await failurePage.evaluate(
          () => window.perkusiAudioPrototype.voices.size,
        ),
        3,
      );
      await failurePage.evaluate(() => window.perkusiAudioPrototype.dispose());
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      await failurePage.route(/\/thump-[^/]+\.wav/, async (route) => {
        await gate;
        await route.abort().catch(() => {});
      });
      await failurePage.reload();
      await failurePage.locator("#play").click();
      await failurePage.waitForFunction(
        () =>
          window.perkusiAudioPrototype.bank.get("thump").state === "loading",
      );
      await failurePage.locator("#pause").click();
      release();
      await failurePage.unrouteAll();
      assert.equal(
        await failurePage.evaluate(() => window.perkusiAudioPrototype.status),
        "paused",
      );
      await failurePage.locator("#play").click();
      await failurePage.waitForFunction(
        () => window.perkusiAudioPrototype.status === "playing",
      );
      await failurePage.evaluate(() => window.perkusiAudioPrototype.dispose());
      await failurePage.route(/\.wav$/, (route) =>
        route.fulfill({ status: 503, body: "test failure" }),
      );
      await failurePage.reload();
      await failurePage.locator("#play").click();
      await failurePage.waitForFunction(
        () => window.perkusiAudioPrototype.status === "error",
      );
      failed = await failurePage.evaluate(() =>
        window.perkusiAudioPrototype.snapshot(),
      );
      assert.equal(failed.resources.voices, 0);
      assert(!failed.resources.timer);
      await failurePage.unrouteAll();
      await failurePage.locator("#play").click();
      await failurePage.waitForFunction(
        () => window.perkusiAudioPrototype.status === "playing",
      );
      await failurePage.locator("#pause").click();
      await failurePage.evaluate(() => {
        const e = window.perkusiAudioPrototype;
        window.qaResume = e.context.resume.bind(e.context);
        e.context.resume = () =>
          Promise.reject(
            new DOMException("QA gesture blocked", "NotAllowedError"),
          );
      });
      await failurePage.locator("#play").click();
      await failurePage.waitForFunction(
        () => window.perkusiAudioPrototype.status === "error",
      );
      await failurePage.evaluate(() => {
        window.perkusiAudioPrototype.context.resume = window.qaResume;
      });
      await failurePage.locator("#play").click();
      await failurePage.waitForFunction(
        () => window.perkusiAudioPrototype.status === "playing",
      );
      await failurePage.evaluate(() => window.perkusiAudioPrototype.dispose());
      await failurePage.close();
      return {
        failureModes: [
          "per-role HTTP503",
          "cancel pending fetch",
          "all roles HTTP503",
          "resume rejection",
        ],
        recovered: true,
      };
    },
  );
  await check(
    "offline 120-second shared graph has signal/headroom and repeated sample phase; WAV preview",
    async () => {
      const result = await page.evaluate(async () => {
        const rendered = await window.perkusiAudioQA.render(120);
        const data = rendered.getChannelData(0);
        const rate = rendered.sampleRate;
        let peak = 0,
          energy = 0,
          delta = 0,
          maxJump = 0;
        for (let i = 0; i < data.length; i++) {
          peak = Math.max(peak, Math.abs(data[i]));
          energy += data[i] * data[i];
          if (i) maxJump = Math.max(maxJump, Math.abs(data[i] - data[i - 1]));
        }
        for (let i = rate; i < 4 * rate; i++)
          delta = Math.max(delta, Math.abs(data[i] - data[i + 110 * rate]));
        const count = 10 * rate;
        const bytes = new ArrayBuffer(44 + count * 2);
        const view = new DataView(bytes);
        const ascii = (at, s) =>
          [...s].forEach((char, i) =>
            view.setUint8(at + i, char.charCodeAt(0)),
          );
        ascii(0, "RIFF");
        view.setUint32(4, 36 + count * 2, true);
        ascii(8, "WAVE");
        ascii(12, "fmt ");
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, rate, true);
        view.setUint32(28, rate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        ascii(36, "data");
        view.setUint32(40, count * 2, true);
        for (let i = 0; i < count; i++)
          view.setInt16(
            44 + 2 * i,
            Math.round(Math.max(-1, Math.min(1, data[i])) * 32767),
            true,
          );
        return {
          metrics: {
            duration: rendered.duration,
            sampleRate: rate,
            channels: rendered.numberOfChannels,
            frames: data.length,
            peak,
            rms: Math.sqrt(energy / data.length),
            maxRepeatDelta110Seconds: delta,
            maxAdjacentJump: maxJump,
          },
          wav: Array.from(new Uint8Array(bytes)),
        };
      });
      assert.equal(result.metrics.duration, 120);
      assert(result.metrics.peak > 0.01 && result.metrics.peak < 0.95);
      assert(result.metrics.rms > 0.001);
      assert(result.metrics.maxRepeatDelta110Seconds < 0.0001);
      await writeFile(
        join(output, "fixture-mix-4bars.wav"),
        Buffer.from(result.wav),
      );
      await writeFile(
        join(output, "offline-analysis.json"),
        JSON.stringify(result.metrics, null, 2),
      );
      return result.metrics;
    },
  );
  if (full)
    await check(
      "120 seconds native realtime three stems + MediaRecorder graph capture and phase analysis",
      async () => {
        await page.locator("#reset").click();
        for (const id of ["thump", "air", "hum"])
          await page.locator(`[data-stem="${id}"]`).click();
        await page.locator("#play").click();
        await ready();
        const before = await state();
        console.log(
          "Realtime capture started; waiting for 120 AudioContext seconds.",
        );
        const capture = await page.evaluate(async () => {
          const e = window.perkusiAudioPrototype;
          const output = e.createCapture();
          const mime = [
            "audio/webm;codecs=opus",
            "audio/webm",
            "audio/ogg;codecs=opus",
          ].find((type) => MediaRecorder.isTypeSupported(type));
          if (!mime) throw new Error("No supported graph recorder MIME");
          const recorder = new MediaRecorder(output.stream, { mimeType: mime });
          const chunks = [];
          recorder.ondataavailable = (event) => {
            if (event.data.size) chunks.push(event.data);
          };
          const start = e.context.currentTime;
          const wallStart = performance.now();
          const blob = await new Promise((resolve, reject) => {
            recorder.onerror = (event) =>
              reject(new Error(event.error?.message || "recorder failed"));
            recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
            recorder.start(1000);
            const timer = setInterval(() => {
              if (e.context.currentTime - start >= 120) {
                clearInterval(timer);
                recorder.stop();
              } else if (performance.now() - wallStart > 135000) {
                clearInterval(timer);
                recorder.stop();
                reject(new Error("Realtime audio clock stalled"));
              }
            }, 30);
          });
          const elapsed = e.context.currentTime - start;
          output.dispose();
          const bytes = await blob.arrayBuffer();
          const decoded = await e.context.decodeAudioData(bytes.slice(0));
          const data = decoded.getChannelData(0);
          const rate = decoded.sampleRate;
          let peak = 0,
            energy = 0;
          for (const sample of data) {
            peak = Math.max(peak, Math.abs(sample));
            energy += sample * sample;
          }
          let best = { lag: 0, correlation: -1 };
          const first = Math.round(5 * rate),
            last = Math.round(115 * rate),
            length = Math.round(2 * rate);
          for (let lag = -128; lag <= 128; lag++) {
            let dot = 0,
              aa = 0,
              bb = 0;
            for (let i = 0; i < length; i += 4) {
              const a = data[first + i],
                b = data[last + i + lag];
              dot += a * b;
              aa += a * a;
              bb += b * b;
            }
            const correlation = dot / Math.sqrt(aa * bb);
            if (correlation > best.correlation) best = { lag, correlation };
          }
          return {
            bytes: Array.from(new Uint8Array(bytes)),
            metrics: {
              mime,
              bytes: bytes.byteLength,
              elapsedAudioSeconds: elapsed,
              wallSeconds: (performance.now() - wallStart) / 1000,
              decodedDuration: decoded.duration,
              sampleRate: rate,
              channels: decoded.numberOfChannels,
              peak,
              rms: Math.sqrt(energy / data.length),
              comparison: {
                firstSecond: 5,
                lastSecond: 115,
                spanSeconds: 110,
                bestLagSamples: best.lag,
                bestLagMs: (1000 * best.lag) / rate,
                correlation: best.correlation,
              },
            },
          };
        });
        await writeFile(
          join(output, "realtime-120s.webm"),
          Buffer.from(capture.bytes),
        );
        await writeFile(
          join(output, "realtime-analysis.json"),
          JSON.stringify(capture.metrics, null, 2),
        );
        assert(capture.metrics.elapsedAudioSeconds >= 120);
        assert(capture.metrics.peak > 0.01 && capture.metrics.peak < 0.95);
        assert(capture.metrics.rms > 0.001);
        assert(capture.metrics.comparison.correlation > 0.995);
        assert(Math.abs(capture.metrics.comparison.bestLagSamples) <= 8);
        const after = await state();
        assert.equal(after.stats.created, before.stats.created);
        assert.equal(after.resources.voices, 3);
        assert.equal(after.resources.captures, 0);
        const starts = after.events
          .filter((e) => e.type === "voice-start")
          .slice(-3);
        assert.equal(new Set(starts.map((e) => e.when)).size, 1);
        return {
          ...capture.metrics,
          before: before.resources,
          after: after.resources,
          continuousSourcesAdded: after.stats.created - before.stats.created,
          quantizedChangesDeferred: after.stats.deferredChanges,
        };
      },
    );
  await check(
    "prototype layout/keyboard and cleanup; normal build excludes internal fixture route/assets",
    async () => {
      for (const width of [320, 390, 768, 1440])
        for (const locale of ["id", "en"]) {
          await page.setViewportSize({ width, height: 900 });
          await page.locator(`[data-locale="${locale}"]`).click();
          assert(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          );
          assert(
            await page
              .locator("button")
              .evaluateAll((els) =>
                els
                  .filter((el) => !el.hidden)
                  .every((el) => el.getBoundingClientRect().height >= 44),
              ),
          );
        }
      await page.screenshot({
        path: join(output, "prototype-en-1440.png"),
        fullPage: true,
      });
      await page.locator("#pause").focus();
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        () => window.perkusiAudioPrototype.voices.size === 0,
      );
      await page.locator("#dispose").click();
      await page.waitForFunction(
        () => window.perkusiAudioPrototype.status === "disposed",
      );
      const closed = await state();
      assert.equal(closed.contextState, "closed");
      assert.equal(closed.resources.voices, 0);
      assert(!closed.resources.timer);
      assert.equal(closed.resources.decodedBytes, 0);
      assert.equal(closed.stats.created, closed.stats.disposed);
      assert(!existsSync("dist/internal"));
      const assets = await readdir("dist/assets");
      assert.equal(assets.filter((file) => /\.wav$/.test(file)).length, 12);
      for (const file of assets.filter((file) => file.endsWith(".js")))
        assert(
          !/s2-technical-fixture|perkusiAudioPrototype/.test(
            await readFile(join("dist/assets", file), "utf8"),
          ),
        );
      return closed.resources;
    },
  );
  assert.deepEqual(evidence.errors, []);
  await context.close();
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
    join(output, "audio-browser.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    JSON.stringify({
      result: evidence.result,
      browser: evidence.browser,
      checks: evidence.checks.length,
      fullRealtime: full,
      output,
    }),
  );
}
