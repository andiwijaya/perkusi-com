import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
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
const output =
  process.env.PERKUSI_SOUND_QA_DIR || "qa-artifacts/s3-2026-10-11/chrome";
const dist =
  process.env.PERKUSI_AUDIO_DIST || "qa-artifacts/s3-2026-10-11/prototype-dist";
const channel = process.env.PERKUSI_AUDIO_CHANNEL || "chrome";
const seconds = Number(process.env.PERKUSI_CAPTURE_SECONDS || 120);
assert([15, 120].includes(seconds));
await mkdir(output, { recursive: true });
const server = await preview({
  mode: "audio-prototype",
  build: { outDir: dist },
  preview: { host: "127.0.0.1", port: 4186, strictPort: true },
});
const evidence = {
  checkedAt: new Date().toISOString(),
  channel,
  checks: [],
  errors: [],
  result: "RUNNING",
  headless: true,
  listening: "UNVERIFIED",
  physicalDevice: "UNVERIFIED",
};
let browser;
async function check(name, fn) {
  const detail = await fn();
  evidence.checks.push({ name, result: "PASS", detail });
  console.log("PASS " + name);
}
try {
  browser = await playwright.chromium.launch({ channel, headless: true });
  evidence.browser = browser.version();
  const context = await browser.newContext({
      locale: "en-US",
      reducedMotion: "reduce",
    }),
    page = await context.newPage();
  page.on("pageerror", (e) => evidence.errors.push(e.message));
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  const base = "http://127.0.0.1:4186/internal/sound-lab/";
  const state = () =>
    page.evaluate(() => window.perkusiSoundLab.engine.snapshot());
  const ready = () =>
    page.waitForFunction(
      () => window.perkusiSoundLab.engine.status === "playing",
    );
  await check(
    "local lab ID default, no autoplay/WAV fetch/GA, six original semantic controls",
    async () => {
      await page.goto(base);
      await page.waitForFunction(() => window.perkusiSoundLab);
      assert.equal(await page.locator("html").getAttribute("lang"), "id");
      assert.equal((await state()).contextState, "absent");
      assert(!requests.some((url) => /\.wav|googletagmanager/.test(url)));
      assert.equal(await page.locator(".character").count(), 6);
      assert(
        (
          await page.locator('meta[name="robots"]').getAttribute("content")
        ).includes("noindex"),
      );
      return { autoplay: false, initialAudioFetches: 0, characters: 6 };
    },
  );
  await check(
    "all twelve actual native decodes: duration, finite signal, wrap edges, sizes and cold timings",
    async () => {
      const rows = await page.evaluate(async () => {
        const lab = window.perkusiSoundLab,
          c = new AudioContext({ sampleRate: 48000 });
        try {
          const rows = [];
          for (const asset of lab.manifest.assets) {
            const roleSelection = {
              ...lab.selection,
              [asset.role]: asset.variant,
            };
            // The lab exposes resolved choices without asking Web Audio for a second engine.
            const prior = lab.selection[asset.role];
            lab.selection[asset.role] = asset.variant;
            const url = lab
              .createPack()
              .stems.find((s) => s.id === asset.role).url;
            lab.selection[asset.role] = prior;
            const started = performance.now(),
              response = await fetch(url),
              bytes = await response.arrayBuffer(),
              size = bytes.byteLength,
              decodeStarted = performance.now();
            const b = await c.decodeAudioData(bytes),
              decodedMs = performance.now() - decodeStarted,
              d = b.getChannelData(0);
            let peak = 0,
              sum = 0;
            for (const x of d) {
              if (!Number.isFinite(x))
                throw new Error("Nonfinite decoded sample");
              peak = Math.max(peak, Math.abs(x));
              sum += x * x;
            }
            rows.push({
              id: asset.id,
              variant: roleSelection[asset.role],
              bytes: size,
              duration: b.duration,
              rate: b.sampleRate,
              frames: b.length,
              peak,
              rms: Math.sqrt(sum / d.length),
              decodeMs: decodedMs,
              fetchAndDecodeMs: performance.now() - started,
              decodedBytes: b.length * b.numberOfChannels * 4,
              wrapJump: Math.abs(d[0] - d.at(-1)),
            });
          }
          return rows;
        } finally {
          await c.close();
        }
      });
      for (const row of rows) {
        assert.equal(row.duration, 5);
        assert(row.peak > 0 && row.peak < 0.95);
        assert(row.rms > 0);
        assert(row.wrapJump < 0.005);
      }
      assert.equal(rows.length, 12);
      await writeFile(
        join(output, "native-decode.json"),
        JSON.stringify(rows, null, 2),
      );
      return {
        assets: 12,
        totalEncodedBytes: rows.reduce((s, r) => s + r.bytes, 0),
        maxDecodeMs: Math.max(...rows.map((r) => r.decodeMs)),
        maxFetchAndDecodeMs: Math.max(...rows.map((r) => r.fetchAndDecodeMs)),
        decodedReferenceBytes: rows.reduce((s, r) => s + r.decodedBytes, 0),
        maxWrapJump: Math.max(...rows.map((r) => r.wrapJump)),
      };
    },
  );
  await check(
    "six native equal starts; locale preserves context and selected musical roles",
    async () => {
      const start = Date.now();
      await page.locator("#play").click();
      await ready();
      const gestureToPlayingMs = Date.now() - start;
      const before = await state();
      assert.equal(before.resources.voices, 6);
      const starts = before.events
        .filter((e) => e.type === "voice-start")
        .slice(-6);
      assert.equal(new Set(starts.map((e) => e.when)).size, 1);
      await page.locator('[data-locale="en"]').click();
      assert.equal(await page.locator("html").getAttribute("lang"), "en");
      assert.equal((await state()).origin, before.origin);
      return {
        gestureToPlayingMs,
        voices: 6,
        contextState: before.contextState,
        decodedBankBytes: before.resources.decodedBytes,
      };
    },
  );
  await check(
    `${seconds}s actual MediaRecorder shared-graph capture, signal/headroom and phase detector positive control`,
    async () => {
      console.log(
        `Native ${seconds}s six-role capture started; listening remains UNVERIFIED.`,
      );
      const before = await state();
      const capture = await page.evaluate(async (seconds) => {
        const e = window.perkusiSoundLab.engine,
          output = e.createCapture();
        const mime = [
          "audio/webm;codecs=opus",
          "audio/webm",
          "audio/ogg;codecs=opus",
        ].find((type) => MediaRecorder.isTypeSupported(type));
        if (!mime) throw new Error("No native capture MIME");
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
            recorder.onerror = (event) => {
              clearInterval(timer);
              reject(new Error(event.error?.message || "Capture failed"));
            };
            recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
            recorder.start(1000);
            timer = setInterval(() => {
              if (e.context.currentTime - start >= seconds) {
                clearInterval(timer);
                recorder.stop();
              } else if (performance.now() - wall > (seconds + 15) * 1000) {
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
        const elapsed = e.context.currentTime - start,
          bytes = await blob.arrayBuffer(),
          encodedSize = bytes.byteLength,
          b = await e.context.decodeAudioData(bytes.slice(0)),
          d = b.getChannelData(0),
          rate = b.sampleRate;
        let peak = 0,
          energy = 0;
        for (const x of d) {
          peak = Math.max(peak, Math.abs(x));
          energy += x * x;
        }
        const first = Math.round(2 * rate),
          last = Math.round((seconds === 120 ? 112 : 12) * rate),
          length = Math.round(0.8 * rate);
        const find = (shift = 0) => {
          let best = { lag: 0, correlation: -1 };
          for (let lag = -80; lag <= 80; lag++) {
            let dot = 0,
              aa = 0,
              bb = 0;
            for (let i = 0; i < length; i += 4) {
              const a = d[first + i],
                v = d[last + i + lag + shift];
              dot += a * v;
              aa += a * a;
              bb += v * v;
            }
            const correlation = dot / Math.sqrt(aa * bb);
            if (correlation > best.correlation) best = { lag, correlation };
          }
          return best;
        };
        return {
          bytes: Array.from(new Uint8Array(bytes)),
          metrics: {
            mime,
            encodedBytes: encodedSize,
            elapsedAudioSeconds: elapsed,
            wallSeconds: (performance.now() - wall) / 1000,
            decodedDuration: b.duration,
            rate,
            frames: b.length,
            channels: b.numberOfChannels,
            peak,
            rms: Math.sqrt(energy / d.length),
            comparison: {
              firstSeconds: 2,
              lastSeconds: seconds === 120 ? 112 : 12,
              windowSeconds: 0.8,
              actual: find(),
              positive37SampleShift: find(37),
            },
            scope:
              "steady six-role aggregate graph; no physical/listening certification",
          },
        };
      }, seconds);
      const path = join(output, `realtime-${seconds}s.webm`),
        bytes = Buffer.from(capture.bytes);
      await writeFile(path, bytes);
      capture.metrics.sha256 = createHash("sha256").update(bytes).digest("hex");
      await writeFile(
        join(output, "capture-analysis.json"),
        JSON.stringify(capture.metrics, null, 2),
      );
      assert(capture.metrics.elapsedAudioSeconds >= seconds);
      assert(capture.metrics.peak > 0.01 && capture.metrics.peak < 0.95);
      assert(capture.metrics.rms > 0.001);
      assert.equal(capture.metrics.comparison.actual.lag, 0);
      assert(capture.metrics.comparison.actual.correlation > 0.995);
      assert.equal(capture.metrics.comparison.positive37SampleShift.lag, -37);
      assert.equal((await state()).stats.created, before.stats.created);
      assert.equal((await state()).resources.captures, 0);
      return capture.metrics;
    },
  );
  await check(
    "native quantized layer mute/rejoin, pause and variant B pack projection, old context reclaimed",
    async () => {
      await page.locator('[data-role="hat"]').click();
      await page.waitForFunction(
        () => !window.perkusiSoundLab.engine.applied.get("hat"),
      );
      assert.equal((await state()).resources.voices, 5);
      await page.locator('[data-role="hat"]').click();
      await page.waitForFunction(() =>
        window.perkusiSoundLab.engine.applied.get("hat"),
      );
      await page.locator("#pause").click();
      await page.evaluate(() => {
        window.oldSoundEngine = window.perkusiSoundLab.engine;
      });
      for (const role of [
        "kick",
        "snare",
        "hat",
        "vocal-bass",
        "hum",
        "percussion-fx",
      ]) {
        await page.locator(`[data-variant="${role}"]`).selectOption("2");
        await page.waitForFunction(
          () => !document.querySelector("#play").disabled,
        );
      }
      assert.equal(
        await page.evaluate(() => window.oldSoundEngine.context.state),
        "closed",
      );
      await page.locator("#play").click();
      await ready();
      assert.equal((await state()).resources.voices, 6);
      assert(
        await page.evaluate(() =>
          window.perkusiSoundLab.engine.pack.stems.every(
            (s) => s.variant === 2,
          ),
        ),
      );
      await page.locator("#pause").click();
      return {
        quantizedMuteRejoin: true,
        allSixVariantsB: true,
        oldContext: "closed",
      };
    },
  );
  await check(
    "original cast states, ID/EN layout 320–1920, keyboard and reduced motion",
    async () => {
      const widths = [];
      for (const locale of ["id", "en"]) {
        await page.locator(`[data-locale="${locale}"]`).click();
        for (const width of [320, 360, 390, 430, 768, 1280, 1440, 1920]) {
          await page.setViewportSize({ width, height: 950 });
          const info = await page.evaluate(() => ({
            width: innerWidth,
            scroll: document.documentElement.scrollWidth,
            buttons: [...document.querySelectorAll("button")]
              .filter(
                (el) => !el.hidden && el.getBoundingClientRect().width > 0,
              )
              .map((el) => ({
                width: el.getBoundingClientRect().width,
                height: el.getBoundingClientRect().height,
              })),
          }));
          assert(info.scroll <= width);
          assert(info.buttons.every((b) => b.width >= 44 && b.height >= 44));
          widths.push({ locale, ...info });
        }
      }
      await writeFile(
        join(output, "layout.json"),
        JSON.stringify(widths, null, 2),
      );
      await page.locator('[data-copy="statesTitle"]').click();
      for (const state of [
        "idle",
        "active",
        "selected",
        "loading",
        "error",
        "focus",
      ]) {
        await page.locator(`[data-preview="${state}"]`).click();
        assert.equal(
          await page.locator(`.character[data-state="${state}"]`).count(),
          6,
        );
        await page
          .locator("#cast")
          .screenshot({ path: join(output, `cast-state-${state}.png`) });
      }
      await page.locator('[data-preview="auto"]').click();
      await page.setViewportSize({ width: 390, height: 950 });
      await page.locator('[data-locale="id"]').click();
      await page.screenshot({
        path: join(output, "cast-id-390.png"),
        fullPage: true,
      });
      await page.setViewportSize({ width: 1440, height: 950 });
      await page.locator('[data-locale="en"]').click();
      await page.screenshot({
        path: join(output, "cast-en-1440.png"),
        fullPage: true,
      });
      const first = page.locator(".character").first();
      await first.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      assert.equal(
        await first.evaluate((el) => getComputedStyle(el).outlineWidth),
        "4px",
      );
      await first.press("Space");
      assert.equal(await first.getAttribute("aria-pressed"), "false");
      assert.equal(
        await first
          .locator(".char-body")
          .evaluate((el) => getComputedStyle(el).animationName),
        "none",
      );
      return {
        layoutCases: 16,
        states: 6,
        characters: 6,
        keyboard: true,
        reducedMotion: true,
      };
    },
  );
  await check(
    "dispose reclaims graph; public build remains free of candidate audio and lab",
    async () => {
      await page.evaluate(() => window.perkusiSoundLab.dispose());
      const final = await state();
      assert.equal(final.contextState, "closed");
      assert.equal(final.resources.voices, 0);
      assert.equal(final.resources.decodedBytes, 0);
      assert.equal(final.resources.timer, false);
      assert.equal(final.resources.captures, 0);
      assert.equal(final.stats.created, final.stats.disposed);
      const home = await readFile("dist/index.html", "utf8");
      assert(!/sound-lab|original-groove/.test(home));
      return final.resources;
    },
  );
  assert.deepEqual(evidence.errors, []);
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
    join(output, "sound-assets-browser.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    JSON.stringify({
      result: evidence.result,
      browser: evidence.browser,
      checks: evidence.checks.length,
      output,
    }),
  );
}
