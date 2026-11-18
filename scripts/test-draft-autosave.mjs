import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { preview } from "vite";
import {
  newComposition,
  withPatternLoops,
} from "../src/project/composition-model.js";
import { newStudioProject } from "../src/project/studio-model.js";
import { originalRegistry } from "../src/project/original-registry.js";
import { withKendhang } from "../src/project/kendhang.js";
import { withBass } from "../src/project/bass.js";
import { withGuitar } from "../src/project/guitar.js";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(
    join(process.env.NODE_REPL_NODE_MODULE_DIRS, "playwright"),
  );
}
const remote = process.env.PERKUSI_AUTOSAVE_BASE_URL;
const out =
  process.env.PERKUSI_AUTOSAVE_QA_DIR || "qa-artifacts/draft-autosave";
const probe = process.argv.includes("--probe");
const server = remote
  ? null
  : await preview({
      preview: { host: "127.0.0.1", port: 4189, strictPort: true },
    });
const base = remote || "http://127.0.0.1:4189";
const origin = new URL(base).origin;
const keys = { beatbox: "perkusi.draft.v1", studio: "perkusi.draft.studio.v3" };
const titles = { beatbox: "#project-title", studio: "#st-title" };
const evidence = {
  base,
  probe,
  checks: [],
  errors: [],
  downloadEvents: 0,
  fileChoosers: 0,
};
await mkdir(out, { recursive: true });

function fixtures() {
  const beatbox = {
    format: "perkusi-project",
    schemaVersion: 1,
    mode: "beatbox",
    title: "Autosave Beatbox",
    pack: { id: originalRegistry.packId, version: originalRegistry.version },
    timing: { bpm: 96, meter: [4, 4] },
    master: { volume: 0.3 },
    export: { bars: 8 },
    tracks: originalRegistry.roleOrder.map((role, i) => ({
      role,
      enabled: i % 2 === 0,
      variant: (i % 2) + 1,
    })),
  };
  const studio = withGuitar(
    withBass(withKendhang(withPatternLoops(newComposition("Autosave Studio")))),
  );
  studio.pack.id = "fusion";
  studio.timing = { ...studio.timing, bpm: 112, swing: 0.23, quantize: false };
  studio.master.volume = 0.34;
  studio.tracks[0].pan = -0.25;
  const a = studio.patterns[0];
  a.steps.kick[0] = 0.75;
  a.notes[2] = { pitch: "d4", velocity: 0.5 };
  a.kendhang.tak[7] = 0.4;
  a.bassNotes[0] = { pitch: "e1", velocity: 0.6 };
  a.guitarNotes[5] = { pitch: "e3", velocity: 0.5 };
  studio.patterns.push({ ...structuredClone(a), id: "p2", name: "B" });
  studio.activePattern = "p2";
  studio.chain = ["p1", "p2", "p1"];
  studio.playback = { mode: "pattern", programmeGain: 2.75 };
  const raw = JSON.stringify(studio);
  return Object.fromEntries(
    Object.entries({
      [keys.beatbox]: beatbox,
      [keys.studio]: studio,
      "perkusi.draft.studio.v2": newStudioProject("Legacy draft"),
      "perkusi.projects.v1": {
        version: 1,
        items: [{ id: "keep-bb", project: beatbox }],
      },
      "perkusi.projects.studio.v3": {
        version: 1,
        items: [{ id: "keep-st", project: studio }],
      },
      "perkusi.projects.studio.v2": {
        version: 1,
        items: [{ id: "keep-old", project: newStudioProject("Legacy save") }],
      },
      "perkusi.qa.preference": "keep this value",
      "perkusi.mode-transfer.v3": {
        version: 4,
        id: "qa-draft-autosave",
        target: "studio",
        pending: false,
        original: beatbox,
        originals: [beatbox],
        candidate: studio,
        destinationDraft: raw,
        drafts: [{ target: "studio", key: keys.studio, raw }],
      },
    }).map(([key, value]) => [key, JSON.stringify(value)]),
  );
}

let browser;
async function scenario(tool, locale, width, fn) {
  const seed = fixtures();
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
    isMobile: width < 600,
    hasTouch: width < 600,
    acceptDownloads: false,
  });
  ctx.on("page", (page) => {
    page.on("download", () => evidence.downloadEvents++);
    page.on("filechooser", () => evidence.fileChoosers++);
    page.on("pageerror", (error) =>
      evidence.errors.push({ url: page.url(), message: error.message }),
    );
  });
  try {
    await ctx.route(/googletagmanager\.com|google-analytics\.com/, (route) =>
      route.fulfill({ status: 200, body: "" }),
    );
    await ctx.addInitScript(
      ({ seed, origin }) => {
        if (
          location.origin !== origin ||
          localStorage.getItem("__qa_autosave_seed")
        )
          return;
        for (const [key, raw] of Object.entries(seed))
          localStorage.setItem(key, raw);
        localStorage.setItem("__qa_autosave_seed", "1");
      },
      { seed, origin },
    );
    const url = `${base}/${locale === "en" ? "en/" : ""}${tool}/?lang=${locale}`;
    const open = async () => {
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await ready(page, tool);
      return page;
    };
    await fn({
      open,
      seed,
      initial: JSON.parse(seed[keys[tool]]),
      key: keys[tool],
    });
  } finally {
    await ctx.close();
  }
}

async function ready(page, tool) {
  await page.waitForFunction(
    ({ title, preload }) => {
      const field = document.querySelector(title);
      return (
        field &&
        !field.disabled &&
        document.getElementById(preload).dataset.state === "ready"
      );
    },
    {
      title: titles[tool],
      preload: tool === "studio" ? "st-preload" : "bb-preload",
    },
    { timeout: 90000 },
  );
}

async function raw(page, key) {
  return page.evaluate((key) => localStorage.getItem(key), key);
}

async function unchanged(page, seed, draftKey) {
  const values = await page.evaluate(
    (keys) =>
      Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])),
    Object.keys(seed),
  );
  for (const [key, value] of Object.entries(seed)) {
    if (key !== draftKey) assert.equal(values[key], value, `${key} changed`);
  }
}

async function exitAfterInput(page, selector, value, key, exit, open, tool) {
  const input = page.locator(selector);
  await input.evaluate((field, key) => {
    document.addEventListener("input", (event) => {
      if (event.target === field)
        field.autosaveQA = {
          focused: document.activeElement === field,
          raw: localStorage.getItem(key),
        };
    });
  }, key);
  await input.fill(value);
  const observed = await input.evaluate((field) => field.autosaveQA);
  assert.equal(observed.focused, true, "No blur before checking autosave");
  const beforeExit = JSON.parse(observed.raw);
  const restored = await reopen(page, exit, open, tool);
  return { restored, beforeExit };
}

async function reopen(page, exit, open, tool) {
  if (exit === "refresh") {
    await page.reload({ waitUntil: "domcontentloaded" });
    await ready(page, tool);
    return page;
  }
  await page.close();
  return open();
}

function record(name, result, details) {
  evidence.checks.push({ name, result, ...details });
  console.log(`${result} ${name}${probe ? ` ${JSON.stringify(details)}` : ""}`);
}

async function inputRecovery(tool, locale, width, last, exit) {
  await scenario(tool, locale, width, async ({ open, seed, initial, key }) => {
    const page = await open();
    const expected = structuredClone(initial);
    if (tool === "beatbox") {
      await page
        .locator('[data-variant-role="kick"][data-variant="2"]')
        .click();
      expected.tracks.find((track) => track.role === "kick").variant = 2;
      await page.locator("#bb-volume").fill("0.41");
      expected.master.volume = 0.41;
      await page.locator("#project-bars").selectOption("4");
      expected.export.bars = 4;
    } else {
      await page.locator('[data-st-step="snare:4"]').click();
      expected.patterns[1].steps.snare[4] = 1;
      await page.locator("#st-swing").fill("0.33");
      expected.timing.swing = 0.33;
      await page.locator("#st-master").fill("0.42");
      expected.master.volume = 0.42;
      await page.locator("#st-chain-mode").check();
      expected.playback = { mode: "chain" };
    }
    const selector = last === "tempo" ? "#st-bpm" : titles[tool];
    const value = last === "tempo" ? "137" : `Edit terakhir — ${tool} ${exit}`;
    if (last === "tempo") expected.timing.bpm = Number(value);
    else expected.title = value;
    const { restored, beforeExit } = await exitAfterInput(
      page,
      selector,
      value,
      key,
      exit,
      open,
      tool,
    );
    const project = JSON.parse(await raw(restored, key));
    const visible = await restored.locator(selector).inputValue();
    const name = `${tool}-${locale}-${width}-${last}-${exit}`;
    if (probe) {
      record(name, visible === value ? "MATCH" : "MISMATCH", {
        expected: value,
        visible,
        beforeExit: last === "tempo" ? beforeExit.timing.bpm : beforeExit.title,
      });
      return;
    }
    assert.deepEqual(
      beforeExit,
      expected,
      "Autosave must already contain the last edit while focus stays in the field",
    );
    assert.deepEqual(project, expected, "Full draft after " + exit);
    assert.equal(visible, value);
    await unchanged(restored, seed, key);
    record(name, "PASS", {
      fullDraftRestored: true,
      protectedDataUnchanged: true,
    });
  });
}

async function staleTab(tool) {
  await scenario(tool, "id", 1440, async ({ open, seed, initial, key }) => {
    const older = await open();
    const newer = await open();
    const expected = { ...initial, title: `Newer ${tool} tab` };
    await newer.locator(titles[tool]).fill(expected.title);
    await newer.waitForFunction(
      ({ key, title }) =>
        JSON.parse(localStorage.getItem(key))?.title === title,
      { key, title: expected.title },
    );
    const closed = older.waitForEvent("close");
    await older.close({ runBeforeUnload: true });
    await closed;
    const after = await open();
    const actual = JSON.parse(await raw(after, key));
    const name = `${tool}-closing-stale-tab`;
    if (probe) {
      record(name, actual.title === expected.title ? "MATCH" : "MISMATCH", {
        expected: expected.title,
        recovered: actual.title,
      });
      return;
    }
    assert.deepEqual(actual, expected);
    assert.equal(
      await after.locator(titles[tool]).inputValue(),
      expected.title,
    );
    await unchanged(after, seed, key);
    record(name, "PASS", {
      fullDraftRestored: true,
      protectedDataUnchanged: true,
    });
  });
}

async function controlRecovery(tool, exit) {
  await scenario(tool, "id", 390, async ({ open, seed, initial, key }) => {
    const page = await open();
    const expected = structuredClone(initial);
    const selector =
      tool === "beatbox" ? '[data-role="kick"]' : '[data-st-step="snare:4"]';
    if (tool === "beatbox") {
      await page.locator(selector).click();
      expected.tracks.find((track) => track.role === "kick").enabled = false;
    } else {
      await page.locator(selector).click();
      assert.equal(
        await page.locator(selector).getAttribute("aria-pressed"),
        "true",
      );
      await page.locator("#st-undo").click();
    }
    assert.deepEqual(JSON.parse(await raw(page, key)), expected);
    const restored = await reopen(page, exit, open, tool);
    assert.deepEqual(JSON.parse(await raw(restored, key)), expected);
    assert.equal(
      await restored.locator(selector).getAttribute("aria-pressed"),
      "false",
    );
    await unchanged(restored, seed, key);
    record(`${tool}-${tool === "beatbox" ? "layer" : "undo"}-${exit}`, "PASS", {
      fullDraftRestored: true,
      protectedDataUnchanged: true,
    });
  });
}

try {
  browser = await playwright.chromium.launch({
    channel: process.env.PERKUSI_BROWSER_CHANNEL || "chrome",
    headless: true,
  });
  evidence.browser = browser.version();
  if (remote) {
    const ctx = await browser.newContext({ acceptDownloads: false });
    const page = await ctx.newPage();
    await page.goto(`${base}/version.json?qa=autosave-${Date.now()}`);
    evidence.version = JSON.parse(await page.locator("pre").innerText());
    assert.equal(evidence.version.branch, "main");
    if (process.env.PERKUSI_AUTOSAVE_EXPECT_COMMIT)
      assert.equal(
        evidence.version.commit,
        process.env.PERKUSI_AUTOSAVE_EXPECT_COMMIT,
      );
    await ctx.close();
  }
  for (const [locale, width] of probe
    ? [["id", 1440]]
    : [
        ["id", 1440],
        ["en", 1440],
        ["id", 390],
      ]) {
    for (const exit of ["refresh", "close"]) {
      await inputRecovery("beatbox", locale, width, "title", exit);
      await inputRecovery("studio", locale, width, "title", exit);
      await inputRecovery("studio", locale, width, "tempo", exit);
    }
  }
  if (!probe)
    for (const exit of ["refresh", "close"])
      for (const tool of Object.keys(keys)) await controlRecovery(tool, exit);
  for (const tool of Object.keys(keys)) await staleTab(tool);
  assert.equal(evidence.downloadEvents, 0);
  assert.equal(evidence.fileChoosers, 0);
  assert.deepEqual(evidence.errors, []);
  evidence.result = probe ? "PROBED" : "PASS";
} catch (error) {
  evidence.result = "FAIL";
  evidence.failure = error.stack;
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server?.close();
  await writeFile(
    join(out, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    JSON.stringify({
      result: evidence.result,
      checks: evidence.checks.length,
      downloads: evidence.downloadEvents,
      fileChoosers: evidence.fileChoosers,
      errors: evidence.errors,
      version: evidence.version,
    }),
  );
}
