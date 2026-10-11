import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { preview } from "vite";
const require = createRequire(import.meta.url);
let pw;
try {
  pw = require("playwright");
} catch {
  pw = require(join(process.env.NODE_REPL_NODE_MODULE_DIRS, "playwright"));
}
const channel = process.env.PERKUSI_AUDIO_CHANNEL || "chrome";
const output =
  process.env.PERKUSI_REPAIR_QA_DIR ||
  `qa-artifacts/s4-repair-2026-10-11/${channel}-repair`;
await mkdir(output, { recursive: true });
const server = await preview({
  build: { outDir: process.env.PERKUSI_BEATBOX_DIST || "dist" },
  preview: { host: "127.0.0.1", port: 4198, strictPort: true },
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
let browser;
const check = async (name, fn) => {
  const detail = await fn();
  evidence.checks.push({ name, result: "PASS", detail });
  console.log("PASS " + name);
};
function wav(rate, seconds, peak) {
  const frames = rate * seconds,
    body = Buffer.alloc(44 + frames * 2);
  body.write("RIFF");
  body.writeUInt32LE(body.length - 8, 4);
  body.write("WAVEfmt ", 8);
  body.writeUInt32LE(16, 16);
  body.writeUInt16LE(1, 20);
  body.writeUInt16LE(1, 22);
  body.writeUInt32LE(rate, 24);
  body.writeUInt32LE(rate * 2, 28);
  body.writeUInt16LE(2, 32);
  body.writeUInt16LE(16, 34);
  body.write("data", 36);
  body.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) {
    const fade = Math.min(
      1,
      i / (rate * 0.004),
      (frames - 1 - i) / (rate * 0.004),
    );
    body.writeInt16LE(
      Math.round(
        peak * Math.sin((2 * Math.PI * 200 * i) / rate) * fade * 32767,
      ),
      44 + i * 2,
    );
  }
  return body;
}
try {
  browser = await pw.chromium.launch({ channel, headless: true });
  evidence.browser = browser.version();
  const context = await browser.newContext({
    locale: "en-US",
    reducedMotion: "reduce",
  });
  const csp = (await readFile("public/_headers", "utf8"))
    .split("Content-Security-Policy: ")[1]
    .trim();
  await context.route("**/*", async (route) => {
    if (route.request().resourceType() !== "document") return route.continue();
    const response = await route.fetch();
    return route.fulfill({
      response,
      headers: { ...response.headers(), "content-security-policy": csp },
    });
  });
  const page = await context.newPage(),
    base = "http://127.0.0.1:4198";
  page.on("pageerror", (e) => evidence.errors.push(e.message));
  const init = async (locale = "id") => {
    await page.goto(
      `${base}/${locale === "en" ? "en/" : ""}beatbox/?lang=${locale}`,
    );
    await page.waitForFunction(() => window.perkusiBeatbox);
  };
  const ready = () =>
    page.waitForFunction(
      () => window.perkusiBeatbox.engine.status === "playing",
    );
  const twoFrames = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  await check(
    "P2-S4-02 native Tab/Shift+Tab and scroll: targets, outline and interior hit points clear transport at every required layout",
    async () => {
      const cases = [];
      for (const locale of ["id", "en"])
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
          await init(locale);
          await page.locator("#main").focus();
          const rows = [],
            keys = [];
          async function observe(direction, index) {
            await twoFrames();
            const row = await page.evaluate(() => {
              const el = document.activeElement;
              if (!el.closest(".beatbox-page")) return null;
              const r = el.getBoundingClientRect(),
                p = document
                  .querySelector(".bb-transport")
                  .getBoundingClientRect(),
                insidePanel = !!el.closest(".bb-transport");
              const inset = Math.min(12, r.width / 4, r.height / 4),
                points = [
                  [r.x + r.width / 2, r.y + r.height / 2],
                  [r.left + inset, r.top + inset],
                  [r.right - inset, r.top + inset],
                  [r.left + inset, r.bottom - inset],
                  [r.right - inset, r.bottom - inset],
                ].map(([x, y]) => {
                  const hit = document.elementFromPoint(x, y);
                  return {
                    x,
                    y,
                    visible: hit === el || el.contains(hit),
                    hit: hit?.id || hit?.tagName,
                  };
                });
              const overlap =
                !insidePanel &&
                r.left < p.right &&
                r.right > p.left &&
                r.top < p.bottom &&
                r.bottom > p.top;
              return {
                id:
                  el.id ||
                  el.dataset.role ||
                  `${el.dataset.variantRole || ""}${el.dataset.variant || ""}` ||
                  el.tagName,
                tag: el.tagName,
                rect: {
                  x: r.x,
                  y: r.y,
                  w: r.width,
                  h: r.height,
                  bottom: r.bottom,
                },
                panel: { x: p.x, y: p.y, w: p.width, h: p.height },
                insidePanel,
                overlap,
                outline: getComputedStyle(el).outline,
                outlineVisible: r.top >= 8 && r.bottom <= innerHeight - 8,
                points,
                scrollY,
              };
            });
            if (!row) return null;
            if (
              row.overlap ||
              !row.outlineVisible ||
              !row.points.every((p) => p.visible)
            ) {
              await page.screenshot({
                path: join(
                  output,
                  `FAIL-${locale}-${width}-${direction}-${index}.png`,
                ),
              });
            }
            assert(
              !row.overlap,
              `${locale} ${width} ${direction} ${row.id} overlaps transport`,
            );
            assert(
              row.outlineVisible,
              `${locale} ${width} ${direction} ${row.id} clipped outline ${JSON.stringify(row.rect)}`,
            );
            assert(
              row.points.every((p) => p.visible),
              `${locale} ${width} ${direction} ${row.id} covered hit target`,
            );
            if (row.tag === "BUTTON" || row.tag === "INPUT")
              assert(row.rect.w >= 44 && row.rect.h >= 44);
            if (row.tag !== "A") assert(row.outline.includes("solid"));
            if (direction === "Tab") keys.push(row.id);
            if (
              [320, 390, 844, 1440].includes(width) &&
              ["kick1", "hum2"].includes(row.id) &&
              direction === "Tab"
            )
              await page.screenshot({
                path: join(
                  output,
                  `${locale}-${width}x${height}-${row.id}-focus.png`,
                ),
              });
            rows.push({ direction, ...row });
            return row;
          }
          for (let i = 0; i < 26; i++) {
            await page.keyboard.press("Tab");
            if (!(await observe("Tab", i))) break;
          }
          assert.equal(keys.length, 25);
          await page.locator(".bb-bottom a").focus();
          await twoFrames();
          for (let i = 0; i < 24; i++) {
            await page.keyboard.press("Shift+Tab");
            assert(await observe("Shift+Tab", i));
          }
          // Native wheel can move a focused control; the next keyboard focus must recover.
          await page.mouse.wheel(0, 240);
          await page.keyboard.press("Tab");
          assert(await observe("wheel→Tab", 0));
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          );
          assert(!overflow);
          cases.push({ locale, width, height, rows });
        }
      await writeFile(
        join(output, "focus-visibility.json"),
        JSON.stringify({ result: "PASS", cases }, null, 2),
      );
      return {
        layouts: cases.length,
        tabTargetsPerLayout: 25,
        reverseTargetsPerLayout: 24,
        interiorPointCount: 5,
        outlineMargin: 8,
        fullyCovered: 0,
        partlyCovered: 0,
      };
    },
  );
  const body = wav(32000, 5, 0.89),
    fixtureSha = createHash("sha256").update(body).digest("hex");
  assert.equal(
    fixtureSha,
    "b082b79cbd6e9d8b01d975ebab2620166ee9866eda5b003b5ea93862d34f36e4",
  );
  await writeFile(join(output, "controlled-variant-fixture.wav"), body);
  async function prepareAudio() {
    await page.setViewportSize({ width: 1440, height: 900 });
    await init();
    await page.locator("#bb-demo").click();
    await ready();
    await page.evaluate(() => {
      const e = window.perkusiBeatbox.engine;
      for (const id of e.enabled.keys())
        if (!e.enabled.get(id))
          document.querySelector(`[data-role="${id}"]`).click();
    });
    await page.waitForFunction(() =>
      Object.values(window.perkusiBeatbox.engine.snapshot().stems).every(
        (s) => s.active,
      ),
    );
  }
  async function graphProbe() {
    return page.evaluate(async () => {
      const e = window.perkusiBeatbox.engine,
        probe = e.context.createScriptProcessor(1024, 1, 1),
        mute = e.context.createGain();
      mute.gain.value = 0;
      e.master.connect(probe);
      probe.connect(mute);
      mute.connect(e.context.destination);
      let peak = 0,
        blocks = 0;
      probe.onaudioprocess = (event) => {
        blocks++;
        for (const sample of event.inputBuffer.getChannelData(0))
          peak = Math.max(peak, Math.abs(sample));
      };
      try {
        await new Promise((resolve) => setTimeout(resolve, 450));
        return {
          snapshot: e.snapshot(),
          bounds: e.cacheBounds(),
          nativeGraphPeak: peak,
          blocks,
        };
      } finally {
        e.master.disconnect(probe);
        probe.disconnect();
        mute.disconnect();
      }
    });
  }
  await check(
    "P2-S4-01 cancelled B→A→late native decode→cached B and retry stay admitted; rejected candidates preserve A voice",
    async () => {
      await prepareAudio();
      const urls = await page.evaluate(() =>
          Object.fromEntries(
            [...window.perkusiBeatbox.engine.variants].map(([id, choices]) => [
              id,
              choices.get(2).stem.url,
            ]),
          ),
        ),
        rows = [];
      for (const [id, url] of Object.entries(urls)) {
        let release, held;
        const arrived = new Promise((resolve) => (release = resolve));
        let count = 0;
        await page.route("**" + url, (route) => {
          if (count++ === 0) {
            held = route;
            release();
          } else
            return route.fulfill({
              status: 200,
              contentType: "audio/wav",
              body,
            });
        });
        await page
          .locator(`[data-variant-role="${id}"][data-variant="2"]`)
          .click();
        await arrived;
        await page
          .locator(`[data-variant-role="${id}"][data-variant="1"]`)
          .click();
        await held.fulfill({ status: 200, contentType: "audio/wav", body });
        await page.waitForFunction(
          (id) =>
            ["ready", "error"].includes(
              window.perkusiBeatbox.engine.variantEntry(id, 2).state,
            ),
          id,
        );
        const row = await page.evaluate((id) => {
          const e = window.perkusiBeatbox.engine,
            entry = e.variantEntry(id, 2);
          return {
            id,
            state: entry.state,
            error: entry.error,
            retained: !!entry.buffer,
            bounds: e.cacheBounds(),
            selected: e.selectedVariant.get(id),
            applied: e.appliedVariant.get(id),
            pending: e.pending.size,
          };
        }, id);
        assert(row.bounds.peak <= 0.95);
        assert.equal(row.selected, 1);
        assert.equal(row.applied, 1);
        assert.equal(row.pending, 0);
        if (row.state === "error") {
          assert.equal(row.retained, false);
          assert.equal(row.error, "unsafe-pack-headroom");
        }
        rows.push(row);
      }
      assert(rows.some((r) => r.state === "ready"));
      assert(rows.some((r) => r.state === "error"));
      await page.locator("#bb-volume").evaluate((el) => {
        el.value = ".75";
        el.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await page.evaluate(async () => {
        const e = window.perkusiBeatbox.engine;
        await Promise.all(
          [...e.enabled.keys()].map((id) => e.setVariation(id, 2)),
        );
      });
      await page.waitForFunction(() => {
        const e = window.perkusiBeatbox.engine;
        return [...e.enabled.keys()].every(
          (id) =>
            e.variantEntry(id).state === "error" ||
            e.appliedVariant.get(id) === 2,
        );
      });
      const chosen = await graphProbe();
      assert(chosen.blocks > 0);
      assert(chosen.bounds.peak <= 0.95);
      assert(chosen.nativeGraphPeak <= 0.95);
      assert(chosen.nativeGraphPeak > 0.01);
      const rejected = Object.entries(chosen.snapshot.stems)
        .filter(([, stem]) => stem.error === "unsafe-pack-headroom")
        .map(([id]) => id);
      assert(rejected.length > 0);
      for (const id of rejected) {
        assert.equal(chosen.snapshot.stems[id].appliedVariant, 1);
        assert(chosen.snapshot.stems[id].active);
        await page.locator(`[data-retry="${id}"]`).click();
        await page.waitForFunction(
          (id) =>
            window.perkusiBeatbox.engine.variantEntry(id).state === "error",
          id,
        );
        assert(
          (
            await page.evaluate(() =>
              window.perkusiBeatbox.engine.cacheBounds(),
            )
          ).peak <= 0.95,
        );
      }
      await page.screenshot({
        path: join(output, "unsafe-candidate-rejected.png"),
        fullPage: true,
      });
      const final = await graphProbe();
      assert(final.nativeGraphPeak <= 0.95);
      const result = {
        fixtureSha,
        cancelledLoads: rows,
        chosen,
        rejected,
        afterRetries: final,
        sourcePcmModified: false,
      };
      await writeFile(
        join(output, "stale-native-cache-repair.json"),
        JSON.stringify(result, null, 2),
      );
      return result;
    },
  );
  await check(
    "P2-S4-01 positive control normal uncancelled native loads are rejected by the same admission gate",
    async () => {
      await page.unrouteAll({ behavior: "wait" });
      await prepareAudio();
      const urls = await page.evaluate(() =>
          Object.fromEntries(
            [...window.perkusiBeatbox.engine.variants].map(([id, v]) => [
              id,
              v.get(2).stem.url,
            ]),
          ),
        ),
        rows = [];
      for (const [id, url] of Object.entries(urls)) {
        await page.route("**" + url, (route) =>
          route.fulfill({ status: 200, contentType: "audio/wav", body }),
        );
        await page
          .locator(`[data-variant-role="${id}"][data-variant="2"]`)
          .click();
        await page.waitForFunction(
          (id) =>
            ["ready", "error"].includes(
              window.perkusiBeatbox.engine.variantEntry(id, 2).state,
            ),
          id,
        );
        const row = await page.evaluate(
          (id) => ({
            id,
            error: window.perkusiBeatbox.engine.variantEntry(id, 2).error,
            bounds: window.perkusiBeatbox.engine.cacheBounds(),
          }),
          id,
        );
        assert(row.bounds.peak <= 0.95);
        rows.push(row);
      }
      assert(rows.some((r) => r.error === "unsafe-pack-headroom"));
      await page.waitForFunction(
        () => window.perkusiBeatbox.engine.pending.size === 0,
      );
      const result = await graphProbe();
      assert(result.blocks > 0);
      assert(result.nativeGraphPeak <= 0.95);
      return { fixtureSha, rows, ...result };
    },
  );
  await check(
    "P2-S4-01 native retained memory is bounded across banks, unselected publications, direct cache loads and retry",
    async () => {
      const memoryBody = wav(48000, 32, 0.1);
      await writeFile(
        join(output, "controlled-memory-fixture.wav"),
        memoryBody,
      );
      const result = await page.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
          Engine = window.perkusiBeatbox.engine.constructor;
        const pack = (v) => ({
          schemaVersion: 1,
          id: "repair-memory",
          bpm: 60,
          bars: 8,
          beatsPerBar: 4,
          stems: ["a", "b", "c"].map((id) => ({
            id,
            variant: v,
            url: id + "-" + v,
            licenseId: "original-qa-only",
            gainTrim: 0.01,
          })),
        });
        const e = new Engine(pack(1), {
            variantPacks: [pack(2)],
            contextFactory: () => new AudioContext({ sampleRate: 48000 }),
            bankOptions: {
              fetcher: async () => ({
                ok: true,
                arrayBuffer: async () => bytes.buffer.slice(0),
              }),
            },
          }),
          rows = [];
        try {
          await e.play();
          const bank = e.variants.get("a").get(2).bank;
          for (const id of ["a", "b", "c"]) {
            await bank.load(id, e.context);
            rows.push({
              id,
              bounds: e.cacheBounds(),
              state: bank.get(id).state,
              error: bank.get(id).error,
              retained: !!bank.get(id).buffer,
            });
          }
          await e.setVariation("c", 2);
          await e.retry("c");
          return {
            rows,
            bounds: e.cacheBounds(),
            c: bank.snapshot().c,
            current: e.snapshot().stems.c,
            pcmChannels: 1,
            pcmFrames: 1536000,
            encodedBytes: bytes.length,
          };
        } finally {
          await e.dispose();
        }
      }, memoryBody.toString("base64"));
      assert(result.rows.every((r) => r.bounds.bytes <= 32 * 1024 * 1024));
      assert.equal(result.bounds.bytes, 30720000);
      assert.equal(result.c.error, "decoded-bank-memory-limit");
      assert.equal(result.c.state, "error");
      assert.equal(result.current.appliedVariant, 1);
      assert.equal(result.current.pendingAt, null);
      return result;
    },
  );
  await check(
    "pagehide independently closes the playing graph and active capture after repair",
    async () => {
      await page.unrouteAll({ behavior: "wait" });
      await prepareAudio();
      await page.evaluate(() => {
        window.repairCapture = window.perkusiBeatbox.engine.createCapture();
        window.dispatchEvent(new Event("pagehide"));
      });
      await page.waitForFunction(
        () => window.perkusiBeatbox.engine.context.state === "closed",
      );
      const result = await page.evaluate(() => ({
        snapshot: window.perkusiBeatbox.engine.snapshot(),
        tracks: window.repairCapture.stream
          .getTracks()
          .map((t) => t.readyState),
      }));
      assert.equal(result.snapshot.resources.voices, 0);
      assert.equal(result.snapshot.resources.captures, 0);
      assert.equal(result.snapshot.resources.timer, false);
      assert.equal(
        result.snapshot.stats.created,
        result.snapshot.stats.disposed,
      );
      assert(result.tracks.every((t) => t === "ended"));
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
  await new Promise((resolve) => server.httpServer.close(resolve));
  await writeFile(
    join(output, "repair-browser.json"),
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
