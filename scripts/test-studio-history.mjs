import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { preview } from "vite";
import { newStudioProject } from "../src/project/studio-model.js";
import {
  newComposition,
  withPatternLoops,
  newCompositionClip,
  compositionDemo,
  fromBeatbox,
} from "../src/project/composition-model.js";
import { withKendhang, emptyKendhang } from "../src/project/kendhang.js";
import { withBass, emptyBassNotes } from "../src/project/bass.js";
import { withGuitar, emptyGuitarNotes } from "../src/project/guitar.js";
import { originalRegistry } from "../src/project/original-registry.js";

const require = createRequire(import.meta.url);
let pw;
try {
  pw = require("playwright");
} catch {
  pw = require(join(process.env.NODE_REPL_NODE_MODULE_DIRS, "playwright"));
}
const remote = process.env.PERKUSI_HISTORY_BASE_URL,
  probe = process.argv.includes("--probe");
const output =
  process.env.PERKUSI_HISTORY_QA_DIR || "qa-artifacts/studio-history";
await mkdir(output, { recursive: true });
const server = remote
  ? null
  : await preview({
      preview: { host: "127.0.0.1", port: 4188, strictPort: true },
    });
const base = remote || "http://127.0.0.1:4188",
  origin = new URL(base).origin;
const csp = (await readFile("public/_headers", "utf8"))
  .split("Content-Security-Policy: ")[1]
  .split(/\r?\n/)[0]
  .trim();
const DRAFT = "perkusi.draft.studio.v3";
const evidence = {
  date: new Date().toISOString(),
  base,
  method: "Public UI and browser data only; isolated synthetic contexts",
  checks: [],
  errors: [],
  downloads: 0,
  fileChoosers: 0,
  result: "RUNNING",
};
const full = (p) => withGuitar(withBass(withKendhang(withPatternLoops(p))));
function fixtures(mode) {
  const p = full(newComposition("QA complete history — $&"));
  p.pack.id = "fusion";
  p.timing.bpm = 96;
  p.timing.swing = 0.23;
  p.timing.quantize = false;
  p.master.volume = 0.31;
  p.tracks.forEach((t, i) => {
    t.volume = 0.35 + i * 0.05;
    t.pan = i % 2 ? 0.3 : -0.25;
  });
  p.tracks[3].mute = true;
  for (const [i, group] of [
    p.instrument,
    p.kendhang,
    p.bass,
    p.guitar,
  ].entries()) {
    group.volume = 0.4 + i * 0.1;
    group.pan = 0.15 * (i - 1);
  }
  p.patterns = ["p1", "p2", "p3"].map((id, i) => {
    const a = structuredClone(p.patterns[0]);
    a.id = id;
    a.name = ["A", "B — $&", "C"][i];
    a.steps.kick[i * 2] = 0.7;
    a.steps.snare[4 + i] = 0.6;
    a.notes[2 + i] = { pitch: "d4", velocity: 0.5 };
    a.kendhang.tak[7 + i] = 0.4;
    a.bassNotes[i] = { pitch: "e1", velocity: 0.6 };
    a.guitarNotes[5 + i] = { pitch: "e3", velocity: 0.5 };
    a.clips = [
      {
        ...newCompositionClip(i === 1 ? "hat" : "kick"),
        enabled: true,
        variant: (i % 2) + 1,
        volume: 0.4 + i * 0.1,
        pan: -0.3 + i * 0.3,
      },
    ];
    return a;
  });
  p.activePattern = "p2";
  p.chain = ["p2", "p1", "p2", "p3"];
  p.playback = { mode, programmeGain: 2.75 };
  const b = {
    format: "perkusi-project",
    schemaVersion: 1,
    mode: "beatbox",
    title: "QA protected Beatbox",
    pack: { id: originalRegistry.packId, version: originalRegistry.version },
    timing: { bpm: 96, meter: [4, 4] },
    master: { volume: 0.27 },
    export: { bars: 8 },
    tracks: originalRegistry.roleOrder.map((role, i) => ({
      role,
      enabled: i % 2 === 0,
      variant: (i % 2) + 1,
    })),
  };
  const seed = {
    [DRAFT]: JSON.stringify(p),
    "perkusi.draft.v1": JSON.stringify(b),
    "perkusi.projects.v1": JSON.stringify({
      version: 1,
      items: [{ id: "keep-bb", project: b }],
    }),
    "perkusi.projects.studio.v3": JSON.stringify({
      version: 1,
      items: [
        { id: "keep-one", project: p },
        {
          id: "keep-two",
          project: { ...structuredClone(p), title: "QA protected Studio" },
        },
      ],
    }),
    "perkusi.projects.studio.v2": JSON.stringify({
      version: 1,
      items: [{ id: "old-keep", project: newStudioProject("QA legacy") }],
    }),
    "perkusi.draft.studio.v2": JSON.stringify(
      newStudioProject("QA legacy draft"),
    ),
    "perkusi.qa.preference": "keep",
  };
  seed["perkusi.mode-transfer.v3"] = JSON.stringify({
    version: 4,
    id: "qa-history-archive",
    target: "studio",
    pending: false,
    original: b,
    originals: [b],
    candidate: fromBeatbox(b),
    destinationDraft: seed[DRAFT],
    drafts: [{ target: "studio", key: DRAFT, raw: seed[DRAFT] }],
  });
  return { p, seed };
}
let browser;
async function context(mode, locale, width) {
  const { p, seed } = fixtures(mode);
  const ctx = await browser.newContext({
    acceptDownloads: false,
    viewport: { width, height: 900 },
    hasTouch: width < 700,
    isMobile: width < 700,
    reducedMotion: "reduce",
  });
  ctx.on("page", (page) => {
    page.on("download", () => evidence.downloads++);
    page.on("filechooser", () => evidence.fileChoosers++);
    page.on("pageerror", (e) =>
      evidence.errors.push({ message: e.message, url: page.url() }),
    );
  });
  await ctx.route(/googletagmanager\.com|google-analytics\.com/, (r) =>
    r.fulfill({ status: 200, body: "" }),
  );
  if (!remote)
    await ctx.route("**/*", async (r) => {
      if (r.request().resourceType() !== "document") return r.continue();
      const response = await r.fetch();
      await r.fulfill({
        response,
        headers: { ...response.headers(), "content-security-policy": csp },
      });
    });
  await ctx.addInitScript(
    ({ seed, origin }) => {
      if (location.origin !== origin || localStorage.getItem("__qaHistorySeed"))
        return;
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
      localStorage.setItem("__qaHistorySeed", "yes");
    },
    { seed, origin },
  );
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  await page.goto(
    `${base}/${locale === "en" ? "en/" : ""}studio/?lang=${locale}`,
    { waitUntil: "domcontentloaded" },
  );
  await ready(page);
  return { ctx, page, seed, original: p };
}
async function ready(page) {
  await page.waitForFunction(
    () => document.getElementById("st-preload")?.dataset.state === "ready",
    null,
    { timeout: 90000 },
  );
}
async function stored(page, keys) {
  return page.evaluate(
    (keys) => Object.fromEntries(keys.map((k) => [k, localStorage.getItem(k)])),
    keys,
  );
}
async function draft(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), DRAFT);
}
async function waitDraft(page, expected) {
  try {
    await page.waitForFunction(
      ({ key, expected }) => {
        const sort = (v) =>
          Array.isArray(v)
            ? v.map(sort)
            : v && typeof v === "object"
              ? Object.fromEntries(
                  Object.keys(v)
                    .sort()
                    .map((k) => [k, sort(v[k])]),
                )
              : v;
        return (
          JSON.stringify(sort(JSON.parse(localStorage.getItem(key)))) ===
          JSON.stringify(sort(expected))
        );
      },
      { key: DRAFT, expected },
      { timeout: 10000 },
    );
  } catch {
    assert.deepEqual(
      await draft(page),
      expected,
      "Complete active project differs",
    );
  }
}
async function ui(page) {
  return page.evaluate(() => {
    const root = document.querySelector(".studio-page");
    return {
      fields: [
        ...root.querySelectorAll(
          "input:not([type=file]),select:not(#st-saved):not(#st-demo-kind)",
        ),
      ].map((e) => [
        e.id,
        { ...e.dataset },
        e.type === "checkbox" ? e.checked : e.value,
      ]),
      patterns: [...document.getElementById("st-pattern").options].map((e) => [
        e.value,
        e.text,
      ]),
      buttons: [...root.querySelectorAll("[aria-pressed]")].map((e) => [
        e.id,
        { ...e.dataset },
        e.getAttribute("aria-pressed"),
      ]),
      chain: [...root.querySelectorAll(".st-chain-slot")].map(
        (e) => e.textContent,
      ),
    };
  });
}
function transformed(before, action) {
  if (action === "demo") {
    const p = full(compositionDemo("ruang"));
    p.playback = { mode: "chain" };
    return p;
  }
  const p = structuredClone(before);
  delete p.playback.programmeGain;
  if (action === "clear") {
    const a = p.patterns.find((a) => a.id === p.activePattern);
    for (const k of Object.keys(a.steps)) a.steps[k] = Array(16).fill(0);
    a.notes = Array(16).fill(null);
    a.kendhang = emptyKendhang();
    a.bassNotes = emptyBassNotes();
    a.guitarNotes = emptyGuitarNotes();
    a.clips = [];
  } else {
    const id = p.activePattern;
    p.patterns = p.patterns.filter((a) => a.id !== id);
    p.activePattern = p.patterns[0].id;
    p.chain = p.chain.filter((a) => a !== id);
    if (!p.chain.length) p.chain = [p.activePattern];
  }
  return p;
}
async function perform(page, action, title, accept = true) {
  if (action === "demo")
    await page.locator("#st-demo-kind").selectOption("ruang");
  const selector = {
    clear: "#st-clear",
    delete: "#st-delete-pattern",
    demo: "#st-demo",
  }[action];
  const event = page.waitForEvent("dialog");
  const clicked = page.locator(selector).click();
  const dialog = await event;
  assert.equal(dialog.type(), "confirm");
  assert(dialog.message().includes(title));
  if (accept) await dialog.accept();
  else await dialog.dismiss();
  await clicked;
}
async function move(page, direction, keyboard) {
  if (keyboard) {
    await page.locator("#st-stop").focus();
    await page.keyboard.press(
      direction === "undo" ? "Control+z" : "Control+Shift+z",
    );
  } else await page.locator("#st-" + direction).click();
}
async function protectedData(page, before) {
  const after = await stored(page, Object.keys(before));
  for (const k of Object.keys(before))
    if (k !== DRAFT)
      assert.equal(after[k], before[k], "Protected data changed: " + k);
}
async function refresh(page, expected) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await ready(page);
  await waitDraft(page, expected);
  assert(await page.locator("#st-undo").isDisabled());
  assert(await page.locator("#st-redo").isDisabled());
}
function check(name, details = {}) {
  evidence.checks.push({ name, result: "PASS", ...details });
  console.log("PASS " + name);
}
async function operation(action, mode, locale, width) {
  const { ctx, page, seed, original } = await context(mode, locale, width),
    name = `${action}-${mode}-${locale}-${width}`;
  try {
    await waitDraft(page, original);
    const protectedBefore = await stored(page, Object.keys(seed)),
      beforeUI = await ui(page);
    await perform(page, action, original.title, false);
    assert.deepEqual(await ui(page), beforeUI);
    assert(await page.locator("#st-undo").isDisabled());
    assert(await page.locator("#st-redo").isDisabled());
    check(name + "-cancel-keeps-history");
    await perform(page, action, original.title);
    const after = transformed(original, action);
    await waitDraft(page, after);
    const afterUI = await ui(page);
    assert(!(await page.locator("#st-undo").isDisabled()));
    assert(await page.locator("#st-redo").isDisabled());
    for (let i = 1; i <= 2; i++) {
      await move(page, "undo", locale === "en");
      if (probe) {
        await page.waitForTimeout(400);
        const actual = await draft(page);
        evidence.checks.push({
          name: name + "-undo",
          result:
            JSON.stringify(actual) === JSON.stringify(original)
              ? "MATCH"
              : "MISMATCH",
          expectedPlayback: original.playback,
          actualPlayback: actual.playback,
          actual,
        });
        console.log(
          JSON.stringify({
            name,
            expectedPlayback: original.playback,
            actualPlayback: actual.playback,
          }),
        );
        return;
      }
      await waitDraft(page, original);
      assert.deepEqual(await ui(page), beforeUI);
      assert(await page.locator("#st-undo").isDisabled());
      assert(!(await page.locator("#st-redo").isDisabled()));
      check(name + `-undo-${i}`, { fullProjectRestored: true });
      await move(page, "redo", locale === "en");
      await waitDraft(page, after);
      assert.deepEqual(await ui(page), afterUI);
      check(name + `-redo-${i}`, { fullProjectRestored: true });
    }
    await move(page, "undo", locale === "en");
    await waitDraft(page, original);
    await page.locator("#st-title").fill("QA branch after undo — $&");
    const branch = structuredClone(original);
    branch.title = "QA branch after undo — $&";
    await waitDraft(page, branch);
    assert(await page.locator("#st-redo").isDisabled());
    await move(page, "undo", false);
    await waitDraft(page, original);
    await refresh(page, original);
    assert.deepEqual(await ui(page), beforeUI);
    await protectedData(page, protectedBefore);
    check(name + "-branch-refresh-protected", {
      fullProjectRestored: true,
      protectedStoresUnchanged: true,
    });
  } finally {
    await ctx.close();
  }
}
async function series(locale, width) {
  const { ctx, page, seed, original } = await context("pattern", locale, width),
    name = `series-${locale}-${width}`;
  try {
    const beforeUI = await ui(page),
      protectedBefore = await stored(page, Object.keys(seed)),
      states = [original];
    for (const action of ["clear", "delete", "demo"]) {
      await perform(page, action, states.at(-1).title);
      const next = transformed(states.at(-1), action);
      states.push(next);
      await waitDraft(page, next);
    }
    await page.locator("#st-play").click();
    await page.waitForFunction(
      () =>
        !document.getElementById("st-pause").disabled &&
        document
          .getElementById("st-status")
          .textContent.match(/Memutar|Playing/),
    );
    await page.waitForFunction(
      (key) =>
        Number.isFinite(
          JSON.parse(localStorage.getItem(key)).playback.programmeGain,
        ),
      DRAFT,
    );
    const heard = await draft(page);
    assert(Number.isFinite(heard.playback.programmeGain));
    assert.deepEqual({ ...heard, playback: states[3].playback }, states[3]);
    states[3] = heard;
    check(name + "-changed-playback-captured", {
      programmeGain: heard.playback.programmeGain,
    });
    for (let i = 2; i >= 0; i--) {
      await move(page, "undo", locale === "en");
      if (probe) {
        await page.waitForTimeout(400);
        const actual = await draft(page);
        evidence.checks.push({
          name: name + `-undo-${i}`,
          result:
            JSON.stringify(actual) === JSON.stringify(states[i])
              ? "MATCH"
              : "MISMATCH",
          expectedPlayback: states[i].playback,
          actualPlayback: actual.playback,
        });
        console.log(JSON.stringify(evidence.checks.at(-1)));
      } else {
        await waitDraft(page, states[i]);
        check(name + `-undo-${i}`, { fullProjectRestored: true });
      }
    }
    if (probe) return;
    assert.deepEqual(await ui(page), beforeUI);
    for (let i = 1; i <= 3; i++) {
      await move(page, "redo", locale === "en");
      await waitDraft(page, states[i]);
      check(name + `-redo-${i}`, { fullProjectRestored: true });
    }
    await page.locator("#st-chain-mode").uncheck();
    const preview = structuredClone(states[3]);
    preview.playback = { mode: "pattern" };
    await waitDraft(page, preview);
    await move(page, "undo", locale === "en");
    await waitDraft(page, states[3]);
    await move(page, "redo", locale === "en");
    await waitDraft(page, preview);
    await move(page, "undo", locale === "en");
    await waitDraft(page, states[3]);
    check(name + "-mode-control-undo-redo", { modeAndLevelRestored: true });
    await refresh(page, states[3]);
    await protectedData(page, protectedBefore);
    check(name + "-refresh-protected", {
      fullProjectRestored: true,
      protectedStoresUnchanged: true,
    });
  } finally {
    await ctx.close();
  }
}
try {
  browser = await pw.chromium.launch({
    channel: process.env.PERKUSI_BROWSER_CHANNEL || "chrome",
    headless: true,
  });
  evidence.browser = browser.version();
  if (remote) {
    const ctx = await browser.newContext({ acceptDownloads: false }),
      p = await ctx.newPage();
    await p.goto(`${base}/version.json?qa=history-${Date.now()}`, {
      waitUntil: "domcontentloaded",
    });
    evidence.version = JSON.parse(await p.locator("pre").innerText());
    assert.equal(evidence.version.branch, "main");
    if (process.env.PERKUSI_HISTORY_EXPECT_COMMIT)
      assert.equal(
        evidence.version.commit,
        process.env.PERKUSI_HISTORY_EXPECT_COMMIT,
      );
    await ctx.close();
  }
  if (probe) {
    for (const action of ["clear", "delete", "demo"])
      await operation(action, "pattern", "id", 1440);
    await series("id", 1440);
    evidence.result = "PROBED";
  } else {
    for (const [locale, width] of [
      ["id", 1440],
      ["en", 1440],
      ["id", 390],
    ]) {
      for (const mode of ["pattern", "chain"])
        for (const action of ["clear", "delete", "demo"])
          await operation(action, mode, locale, width);
      await series(locale, width);
    }
    evidence.result = "PASS";
  }
  assert.equal(evidence.downloads, 0);
  assert.equal(evidence.fileChoosers, 0);
  assert.deepEqual(evidence.errors, []);
} catch (e) {
  evidence.result = "FAIL";
  evidence.failure = e.stack;
  console.error(e.stack);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server?.close();
  evidence.finishedAt = new Date().toISOString();
  await writeFile(
    join(output, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    JSON.stringify({
      result: evidence.result,
      checks: evidence.checks.length,
      downloads: evidence.downloads,
      fileChoosers: evidence.fileChoosers,
      errors: evidence.errors,
      version: evidence.version,
    }),
  );
}
