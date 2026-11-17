import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { preview } from "vite";
import {
  newComposition,
  withPatternLoops,
  newCompositionClip,
} from "../src/project/composition-model.js";
import { withKendhang } from "../src/project/kendhang.js";
import { withBass } from "../src/project/bass.js";
import { withGuitar } from "../src/project/guitar.js";
import { pagePath } from "../src/app/routes.js";

const require = createRequire(import.meta.url);
let pw;
try {
  pw = require("playwright");
} catch {
  pw = require(join(process.env.NODE_REPL_NODE_MODULE_DIRS, "playwright"));
}
const output =
  process.env.PERKUSI_PROJECT_QA_DIR || "qa-artifacts/project-roundtrip";
await mkdir(output, { recursive: true });
const remote = process.env.PERKUSI_PROJECT_BASE_URL;
const server = remote
  ? null
  : await preview({
      preview: { host: "127.0.0.1", port: 4185, strictPort: true },
    });
const base = remote || "http://127.0.0.1:4185";
const csp = (await readFile("public/_headers", "utf8"))
  .split("Content-Security-Policy: ")[1]
  .split(/\r?\n/)[0]
  .trim();
const catalog = JSON.parse(
  await readFile("internal/original-groove/manifest.json", "utf8"),
);
const evidence = {
  date: new Date().toISOString(),
  base,
  checks: [],
  errors: [],
  result: "RUNNING",
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fixture(tool) {
  if (tool === "beatbox")
    return {
      format: "perkusi-project",
      schemaVersion: 1,
      mode: "beatbox",
      title: "Proyek Uji — Beatbox",
      pack: { id: catalog.packId, version: catalog.version },
      timing: { bpm: 96, meter: [4, 4] },
      master: { volume: 0.37 },
      tracks: catalog.roleOrder.map((role, i) => ({
        role,
        enabled: i !== 1 && i !== 5,
        variant: (i % 2) + 1,
      })),
      export: { bars: 8 },
    };
  const p = withGuitar(
    withBass(
      withKendhang(withPatternLoops(newComposition("Proyek Uji — Studio"))),
    ),
  );
  p.pack.id = "fusion";
  p.timing.bpm = 96;
  p.timing.swing = 0.24;
  p.timing.quantize = false;
  p.master.volume = 0.43;
  p.patterns.push({
    ...structuredClone(p.patterns[0]),
    id: "p2",
    name: "B — isi",
  });
  p.activePattern = "p2";
  p.chain = ["p1", "p2", "p2", "p1"];
  for (const [index, a] of p.patterns.entries()) {
    a.steps.kick[index ? 3 : 0] = 0.75;
    a.steps.snare[12] = 0.5;
    a.steps["closed-hat"][6] = 0.65;
    a.notes[2] = { pitch: index ? "a4" : "d4", velocity: 0.45 };
    a.kendhang.tak[7] = 0.6;
    a.kendhang.thung[14] = 0.4;
    a.bassNotes[0] = { pitch: index ? "g1" : "e1", velocity: 0.55 };
    a.guitarNotes[5] = { pitch: index ? "g3" : "e3", velocity: 0.7 };
    a.clips = [
      {
        ...newCompositionClip(index ? "hat" : "kick"),
        enabled: true,
        variant: index + 1,
        volume: 0.3,
        pan: index ? 0.4 : -0.4,
      },
    ];
  }
  p.tracks[0].volume = 0.45;
  p.tracks[0].pan = -0.3;
  p.tracks[1].pan = 0.5;
  p.tracks[2].mute = true;
  p.instrument.volume = 0.4;
  p.instrument.pan = -0.2;
  p.guitar.pan = 0.3;
  p.bass.volume = 0.45;
  p.playback = { mode: "chain" };
  return p;
}
function liveFixture() {
  const p = withGuitar(
    withBass(
      withKendhang(withPatternLoops(newComposition("Live mix roundtrip"))),
    ),
  );
  p.timing.bpm = 100;
  p.chain = Array(4).fill("p1");
  for (const [role, steps] of Object.entries({
    kick: [0, 4, 8, 12],
    snare: [4, 12],
    "closed-hat": [0, 2, 4, 6, 8, 10, 12, 14],
  }))
    for (const i of steps) p.patterns[0].steps[role][i] = 0.7;
  return p;
}
let browser;
async function context(width) {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
    hasTouch: width < 700,
    isMobile: width < 700,
    acceptDownloads: true,
    reducedMotion: "reduce",
  });
  await ctx.route(/googletagmanager\.com|google-analytics\.com/, (route) =>
    route.fulfill({ status: 200, body: "" }),
  );
  if (!remote)
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
    window.__projectStarts = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.context instanceof AudioContext) window.__projectStarts++;
      return start.apply(this, args);
    };
  });
  return ctx;
}
function ids(tool) {
  return tool === "studio"
    ? {
        file: "st-file",
        title: "st-title",
        json: "st-project-download",
        save: "st-save",
        list: "st-saved",
        load: "st-load",
        render: "st-render",
        result: "st-result",
        wav: "st-wav-download",
        status: "st-project-status",
      }
    : {
        file: "project-file",
        title: "project-title",
        json: "project-json",
        save: "project-save",
        list: "project-list",
        load: "project-load",
        render: "project-render",
        result: "project-result",
        wav: "project-download",
        status: "project-status",
      };
}
async function open(page, tool, locale) {
  page.on("dialog", (d) => d.accept());
  page.on("pageerror", (e) => evidence.errors.push(e.message));
  assert.equal(
    (
      await page.goto(base + pagePath(tool, locale) + "?lang=" + locale)
    ).status(),
    200,
  );
  await ready(page, tool);
}
async function ready(page, tool) {
  await page.waitForFunction(
    (st) =>
      document.querySelector(st ? "#st-preload" : "#bb-preload")?.dataset
        .state === "ready",
    tool === "studio",
    { timeout: 90000 },
  );
}
async function imported(page, tool, data) {
  const d = ids(tool);
  await page.locator("#" + d.file).setInputFiles({
    name: "roundtrip.perkusi.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await page.waitForFunction(
    ({ title, id }) => document.querySelector("#" + id).value === title,
    { title: data.title, id: d.title },
  );
  await ready(page, tool);
  await page.locator("#" + d.render).waitFor({ state: "visible" });
}
async function download(page, selector, name) {
  const job = page.waitForEvent("download");
  await page.locator(selector).click();
  const d = await job;
  const path = join(output, name);
  await d.saveAs(path);
  return readFile(path);
}
async function project(page, tool, name) {
  return JSON.parse(
    await download(page, "#" + ids(tool).json, name + ".perkusi.json"),
  );
}
async function wav(page, tool, name) {
  const d = ids(tool);
  await page.locator("#" + d.render).click();
  await page
    .locator("#" + d.result)
    .waitFor({ state: "visible", timeout: 90000 });
  const bytes = await download(page, "#" + d.wav, name + ".wav");
  const channels = bytes.readUInt16LE(22),
    rate = bytes.readUInt32LE(24);
  let data;
  for (let at = 12; at + 8 <= bytes.length;) {
    const n = bytes.readUInt32LE(at + 4);
    if (bytes.toString("ascii", at, at + 4) === "data")
      data = bytes.subarray(at + 8, at + 8 + n);
    at += 8 + n + (n % 2);
  }
  let energy = 0;
  for (let i = 0; i < data.length; i += 2)
    energy += (data.readInt16LE(i) / 32767) ** 2;
  const result = {
    sha256: hash(bytes),
    channels,
    rate,
    rms: Math.sqrt(energy / (data.length / 2)),
    bytes: bytes.length,
  };
  Object.defineProperty(result, "pcm", { value: data });
  return result;
}
function same(a, b) {
  assert.deepEqual(
    a,
    b,
    "Every project field must survive save/download/import",
  );
}
async function sameControls(page, tool, data) {
  if (tool === "studio") {
    for (const [id, value] of Object.entries({
      "st-bpm": data.timing.bpm,
      "st-swing": data.timing.swing,
      "st-master": data.master.volume,
    }))
      assert.equal(Number(await page.locator("#" + id).inputValue()), value);
    assert.equal(await page.locator("#st-kit").inputValue(), data.pack.id);
    assert.equal(
      await page.locator("#st-pattern").inputValue(),
      data.activePattern,
    );
    assert.equal(
      await page.locator("#st-quantize").isChecked(),
      data.timing.quantize,
    );
    assert.equal(
      await page.locator("#st-chain-mode").isChecked(),
      data.playback.mode === "chain",
    );
    for (const track of data.tracks)
      for (const field of ["volume", "pan"])
        assert.equal(
          Number(
            await page
              .locator(`[data-st-${field}="${track.role}"]`)
              .inputValue(),
          ),
          track[field],
        );
    for (const track of data.tracks)
      for (const field of ["mute", "solo"])
        assert.equal(
          await page
            .locator(`[data-st-${field}="${track.role}"]`)
            .getAttribute("aria-pressed"),
          String(track[field]),
        );
  } else {
    assert.equal(
      Number(await page.locator("#bb-volume").inputValue()),
      data.master.volume,
    );
    assert.equal(
      Number(await page.locator("#project-bars").inputValue()),
      data.export.bars,
    );
    for (const track of data.tracks) {
      assert.equal(
        await page
          .locator(`[data-role="${track.role}"]`)
          .getAttribute("aria-pressed"),
        String(track.enabled),
      );
      assert.equal(
        await page
          .locator(
            `[data-variant-role="${track.role}"][data-variant="${track.variant}"]`,
          )
          .getAttribute("aria-pressed"),
        "true",
      );
    }
  }
}
function sameAudio(a, b) {
  assert.equal(a.channels, b.channels);
  assert.equal(a.rate, b.rate);
  assert.equal(a.pcm.length, b.pcm.length);
  let max = 0,
    error = 0,
    energy = 0;
  for (let i = 0; i < a.pcm.length; i += 2) {
    const x = a.pcm.readInt16LE(i),
      y = b.pcm.readInt16LE(i),
      d = x - y;
    max = Math.max(max, Math.abs(d));
    error += d * d;
    energy += y * y;
  }
  const result = {
    maxInt16Difference: max,
    normalizedError: Math.sqrt(error / energy),
    levelDifferenceDb: 20 * Math.log10(a.rms / b.rms),
  };
  assert(
    max <= 2 &&
      result.normalizedError < 0.001 &&
      Math.abs(result.levelDifferenceDb) < 0.001,
    "Project audio must survive save/load/import within two 16-bit steps",
  );
  return result;
}
async function basic(tool, locale, width) {
  const ctx = await context(width),
    page = await ctx.newPage(),
    name = `${tool}-${locale}-${width}`,
    d = ids(tool);
  try {
    await open(page, tool, locale);
    const expected = fixture(tool);
    if (width === 390 && tool === "beatbox") expected.export.bars = 4;
    if (width === 390 && tool === "studio") expected.tracks[1].solo = true;
    await imported(page, tool, expected);
    if (tool === "studio" && locale === "en") {
      await page.locator("#st-chain-mode").uncheck();
      expected.playback.mode = "pattern";
    }
    assert.equal(
      await page.evaluate(() => window.__projectStarts),
      0,
      "Import must remain silent",
    );
    const original = await project(page, tool, name + "-original");
    same(original, expected);
    const audio = await wav(page, tool, name + "-original");
    await page.locator("#" + d.save).click();
    const savedId = await page.locator("#" + d.list).inputValue();
    assert(savedId);
    await page.locator("#" + d.title).fill("Changed on purpose");
    if (tool === "studio")
      await page.locator('[data-st-step="kick:1"]').click();
    else await page.locator('[data-role="snare"]').click();
    await page.locator("#" + d.list).selectOption(savedId);
    await page.locator("#" + d.load).click();
    await page.waitForFunction(
      ({ id, title }) => document.querySelector("#" + id).value === title,
      { id: d.title, title: original.title },
    );
    same(await project(page, tool, name + "-saved-load"), original);
    await sameControls(page, tool, original);
    sameAudio(await wav(page, tool, name + "-saved-load"), audio);
    await page.reload();
    await ready(page, tool);
    if (tool === "studio")
      assert.equal(
        await page.locator("#st-chain-mode").isChecked(),
        original.playback.mode === "chain",
      );
    same(await project(page, tool, name + "-draft-reload"), original);
    await sameControls(page, tool, original);
    assert.equal(
      await page.evaluate(() => window.__projectStarts),
      0,
      "Restored draft must remain silent",
    );
    await page.screenshot({ path: join(output, name + "-restored.png") });
    const fresh = await context(width),
      p = await fresh.newPage();
    try {
      await open(p, tool, locale);
      await imported(p, tool, original);
      same(await project(p, tool, name + "-fresh-import"), original);
      await sameControls(p, tool, original);
      sameAudio(await wav(p, tool, name + "-fresh-import"), audio);
      await p.locator("#" + d.file).setInputFiles({
        name: "bad.perkusi.json",
        mimeType: "application/json",
        buffer: Buffer.from('{"format":"perkusi-project","schemaVersion":999}'),
      });
      await p.waitForFunction(
        (id) =>
          document.querySelector("#" + id).getAttribute("role") === "alert",
        d.status,
      );
      same(await project(p, tool, name + "-after-invalid"), original);
    } finally {
      await fresh.close();
    }
    evidence.checks.push({ name, result: "PASS", file: audio, savedId });
    console.log("PASS " + name);
  } catch (error) {
    await writeFile(
      join(output, name + "-failure.txt"),
      await page.locator("body").innerText(),
    );
    throw error;
  } finally {
    await ctx.close();
  }
}
async function liveMix() {
  const ctx = await context(1440),
    page = await ctx.newPage();
  try {
    await open(page, "studio", "id");
    await imported(page, "studio", liveFixture());
    await page.locator("#st-play").click();
    await page.waitForFunction(() =>
      /Memutar/.test(document.querySelector("#st-status").textContent),
    );
    for (const role of ["kick", "snare", "closed-hat"])
      await page.locator(`[data-st-volume="${role}"]`).evaluate((el) => {
        el.value = "0.2";
        el.dispatchEvent(new Event("input", { bubbles: true }));
      });
    await page.locator("#st-pause").click();
    await page.locator("#st-title").fill("Live mix — named after playing");
    const before = await wav(page, "studio", "live-before"),
      data = await project(page, "studio", "live-before");
    assert(Number.isFinite(data.playback.programmeGain));
    await page.locator("#st-save").click();
    const savedId = await page.locator("#st-saved").inputValue();
    await page.locator('[data-st-step="kick:1"]').click();
    await page.locator("#st-saved").selectOption(savedId);
    await page.locator("#st-load").click();
    same(await project(page, "studio", "live-saved-load"), data);
    sameAudio(await wav(page, "studio", "live-saved-load"), before);
    await page.reload();
    await ready(page, "studio");
    same(await project(page, "studio", "live-draft-reload"), data);
    sameAudio(await wav(page, "studio", "live-draft-reload"), before);
    const fresh = await context(1440),
      p = await fresh.newPage();
    try {
      await open(p, "studio", "id");
      await imported(p, "studio", data);
      await p.locator("#st-play").click();
      await p.waitForFunction(() =>
        /Memutar/.test(document.querySelector("#st-status").textContent),
      );
      await p.locator("#st-pause").click();
      const after = await wav(p, "studio", "live-after");
      const result = {
        name: "studio-live-mix-roundtrip",
        before,
        after,
        levelDifferenceDb: 20 * Math.log10(after.rms / before.rms),
      };
      evidence.checks.push(result);
      console.log(JSON.stringify(result));
      result.comparison = sameAudio(after, before);
    } finally {
      await fresh.close();
    }
  } finally {
    await ctx.close();
  }
}
try {
  browser = await pw.chromium.launch({ channel: "chrome", headless: true });
  evidence.browser = browser.version();
  if (process.env.PERKUSI_PROJECT_CASE !== "live")
    for (const [locale, width] of [
      ["id", 1440],
      ["en", 1440],
      ["id", 390],
    ])
      for (const tool of ["beatbox", "studio"])
        await basic(tool, locale, width);
  await liveMix();
  assert.deepEqual(evidence.errors, []);
  evidence.result = "PASS";
} catch (error) {
  evidence.result = "FAIL";
  evidence.failure = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(
    join(output, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  await browser?.close();
  await server?.close();
}
