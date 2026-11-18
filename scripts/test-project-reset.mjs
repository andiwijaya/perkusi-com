import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { preview } from "vite";
import { originalRegistry } from "../src/project/original-registry.js";
import { newStudioProject } from "../src/project/studio-model.js";
import {
  newComposition,
  compositionDemo,
  withPatternLoops,
  newCompositionClip,
  fromBeatbox,
} from "../src/project/composition-model.js";
import { withKendhang, emptyKendhang } from "../src/project/kendhang.js";
import { withBass, emptyBassNotes } from "../src/project/bass.js";
import { withGuitar, emptyGuitarNotes } from "../src/project/guitar.js";

const require = createRequire(import.meta.url);
let pw;
try {
  pw = require("playwright");
} catch {
  pw = require(join(process.env.NODE_REPL_NODE_MODULE_DIRS, "playwright"));
}
const remote = process.env.PERKUSI_RESET_BASE_URL;
const probe = process.argv.includes("--probe");
const output = process.env.PERKUSI_RESET_QA_DIR || "qa-artifacts/project-reset";
await mkdir(output, { recursive: true });
const server = remote
  ? null
  : await preview({
      preview: { host: "127.0.0.1", port: 4187, strictPort: true },
    });
const base = remote || "http://127.0.0.1:4187";
const origin = new URL(base).origin;
const csp = (await readFile("public/_headers", "utf8"))
  .split("Content-Security-Policy: ")[1]
  .split(/\r?\n/)[0]
  .trim();
const evidence = {
  date: new Date().toISOString(),
  base,
  method: "UI and browser storage only; isolated synthetic projects",
  checks: [],
  errors: [],
  downloads: 0,
  fileChoosers: 0,
  result: "RUNNING",
};
const draftKey = (tool) =>
  tool === "studio" ? "perkusi.draft.studio.v3" : "perkusi.draft.v1";
const savedKey = (tool) =>
  tool === "studio" ? "perkusi.projects.studio.v3" : "perkusi.projects.v1";
const full = (p) => withGuitar(withBass(withKendhang(withPatternLoops(p))));
const ids = (tool) =>
  tool === "studio"
    ? {
        title: "st-title",
        preload: "st-preload",
        reset: "st-clear",
        save: "st-save",
      }
    : {
        title: "project-title",
        preload: "bb-preload",
        reset: "bb-reset",
        save: "project-save",
      };
function fixtures() {
  const b = {
    format: "perkusi-project",
    schemaVersion: 1,
    mode: "beatbox",
    title: "QA active Beatbox — $&",
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
  const s = full(newComposition("QA active Studio — $&"));
  s.pack.id = "fusion";
  s.timing.bpm = 96;
  s.timing.swing = 0.23;
  s.timing.quantize = false;
  s.master.volume = 0.31;
  s.patterns[0].steps.kick[0] = 0.7;
  s.patterns[0].notes[2] = { pitch: "d4", velocity: 0.5 };
  s.patterns[0].kendhang.tak[7] = 0.4;
  s.patterns[0].bassNotes[0] = { pitch: "e1", velocity: 0.6 };
  s.patterns[0].guitarNotes[5] = { pitch: "e3", velocity: 0.5 };
  s.patterns[0].clips = [
    {
      ...newCompositionClip("kick"),
      enabled: true,
      variant: 2,
      volume: 0.6,
      pan: -0.3,
    },
  ];
  s.patterns.push({
    ...structuredClone(s.patterns[0]),
    id: "p2",
    name: "B — $&",
  });
  s.activePattern = "p2";
  s.chain = ["p1", "p2", "p1"];
  s.tracks[0].pan = -0.25;
  s.playback = { mode: "pattern", programmeGain: 2 };
  const seed = {};
  for (const [tool, p] of Object.entries({ beatbox: b, studio: s })) {
    seed[draftKey(tool)] = JSON.stringify(p);
    seed[savedKey(tool)] = JSON.stringify({
      version: 1,
      items: [
        {
          id: "keep-one",
          project: { ...structuredClone(p), title: "QA keep one" },
        },
        {
          id: "keep-two",
          project: { ...structuredClone(p), title: "QA keep two" },
        },
      ],
    });
  }
  seed["perkusi.projects.studio.v2"] = JSON.stringify({
    version: 1,
    items: [{ id: "legacy-keep", project: newStudioProject("QA legacy keep") }],
  });
  seed["perkusi.draft.studio.v2"] = JSON.stringify(
    newStudioProject("QA legacy draft"),
  );
  seed["perkusi.qa.preference"] = "keep";
  const raw = seed[draftKey("studio")];
  seed["perkusi.mode-transfer.v3"] = JSON.stringify({
    version: 4,
    id: "qa-reset-archive",
    target: "studio",
    pending: false,
    original: b,
    originals: [b],
    candidate: fromBeatbox(b),
    destinationDraft: raw,
    drafts: [{ target: "studio", key: draftKey("studio"), raw }],
  });
  return seed;
}
let browser;
async function makePage(tool, locale, width) {
  const seed = fixtures();
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
    page.on("pageerror", (error) =>
      evidence.errors.push({ message: error.message, url: page.url() }),
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
      if (location.origin !== origin || localStorage.getItem("__qaResetSeed"))
        return;
      for (const [key, value] of Object.entries(seed))
        localStorage.setItem(key, value);
      localStorage.setItem("__qaResetSeed", "yes");
    },
    { seed, origin },
  );
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  await page.goto(
    `${base}/${locale === "en" ? "en/" : ""}${tool}/?lang=${locale}`,
    { waitUntil: "domcontentloaded" },
  );
  await ready(page, tool);
  return { ctx, page, seed };
}
async function ready(page, tool) {
  await page.waitForFunction(
    (id) => document.getElementById(id)?.dataset.state === "ready",
    ids(tool).preload,
    { timeout: 90000 },
  );
  await page.waitForFunction(
    (id) => !document.getElementById(id)?.disabled,
    ids(tool).reset,
  );
}
async function stored(page, seed) {
  return page.evaluate(
    (keys) => Object.fromEntries(keys.map((k) => [k, localStorage.getItem(k)])),
    Object.keys(seed),
  );
}
async function draft(page, tool) {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)),
    draftKey(tool),
  );
}
async function waitDraft(page, tool, expected) {
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
      { key: draftKey(tool), expected },
    );
  } catch {
    assert.deepEqual(await draft(page, tool), expected);
  }
}
async function ui(page, tool) {
  return page.evaluate((tool) => {
    const prefix = tool === "studio" ? "st-" : "bb-";
    const controls =
      tool === "studio"
        ? [
            "st-title",
            "st-kit",
            "st-bpm",
            "st-swing",
            "st-master",
            "st-pattern",
            "st-pattern-name",
            "st-quantize",
            "st-chain-mode",
          ]
        : ["project-title", "project-bars", "bb-volume"];
    const root = document.querySelector(
      tool === "studio" ? ".studio-page" : ".beatbox-page",
    );
    return {
      controls: controls.map((id) => {
        const e = document.getElementById(id);
        return [id, e.value, e.type === "checkbox" ? e.checked : null];
      }),
      pressed: [...root.querySelectorAll("[aria-pressed]")].map((e) => [
        e.id,
        { ...e.dataset },
        e.getAttribute("aria-pressed"),
      ]),
      chain:
        tool === "studio"
          ? [...root.querySelectorAll(".st-chain-slot")].map(
              (e) => e.textContent,
            )
          : [],
      playing: document
        .getElementById(prefix + "play")
        .getAttribute("aria-pressed"),
    };
  }, tool);
}
function check(name, details = {}) {
  evidence.checks.push({ name, result: "PASS", ...details });
  console.log("PASS " + name);
}
async function protectedData(page, seed, before, tool) {
  const after = await stored(page, seed);
  for (const key of Object.keys(seed))
    if (key !== draftKey(tool))
      assert.equal(after[key], before[key], "Protected data changed: " + key);
}
async function confirmAction(page, selector, title, accept, immediateTitle) {
  const event = page.waitForEvent("dialog", { timeout: 5000 });
  const action = immediateTitle
    ? page.evaluate(
        ({ titleId, selector, key }) => {
          const input = document.getElementById(titleId);
          input.value = "QA immediate edit — $&";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          const slot = Object.keys(localStorage).find((name) =>
            name.startsWith(`${key}.pending.`),
          );
          const raw = slot
            ? JSON.parse(localStorage.getItem(slot)).raw
            : localStorage.getItem(key);
          const persisted = JSON.parse(raw)?.title === input.value;
          document.querySelector(selector).click();
          return persisted;
        },
        {
          titleId: ids(immediateTitle).title,
          selector,
          key: draftKey(immediateTitle),
        },
      )
    : page.locator(selector).click();
  const dialog = await event;
  assert.equal(dialog.type(), "confirm");
  assert(
    dialog.message().includes(title),
    "Confirmation must name its target, including literal dollar signs",
  );
  if (accept) await dialog.accept();
  else await dialog.dismiss();
  const persisted = await action;
  if (immediateTitle)
    assert.equal(
      persisted,
      true,
      "The latest edit must already be in the draft when the prompt opens",
    );
}
async function reloadExact(page, tool, expected) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await ready(page, tool);
  assert.deepEqual(
    await draft(page, tool),
    expected,
    "Full project changed after refresh",
  );
}
async function journey(tool, locale, width) {
  const { ctx, page, seed } = await makePage(tool, locale, width);
  const label = `${tool}-${locale}-${width}`;
  try {
    // Include a real edit, then refresh: the next destructive action must not
    // depend on undo history, which is deliberately empty after draft recovery.
    await page.locator("#" + ids(tool).title).fill("QA edited active — $&");
    const active = JSON.parse(seed[draftKey(tool)]);
    active.title = "QA edited active — $&";
    await waitDraft(page, tool, active);
    await reloadExact(page, tool, active);
    const before = await stored(page, seed),
      visible = await ui(page, tool);
    const actions =
      tool === "studio"
        ? ["#st-clear", "#st-demo", "#st-delete-pattern"]
        : ["#bb-reset"];
    for (const selector of actions) {
      await confirmAction(page, selector, active.title, false);
      assert.deepEqual(await ui(page, tool), visible);
      assert.deepEqual(await draft(page, tool), active);
      await protectedData(page, seed, before, tool);
      check(`${label}-${selector.slice(1)}-cancel`, {
        fullProjectPreserved: true,
      });
    }
    await reloadExact(page, tool, active);
    assert.deepEqual(await ui(page, tool), visible);
    if (tool === "beatbox") {
      await confirmAction(page, "#bb-reset", active.title, true);
      const expected = structuredClone(active);
      expected.tracks.forEach((t) => {
        t.enabled = false;
        t.variant = 1;
      });
      await waitDraft(page, tool, expected);
      await reloadExact(page, tool, expected);
      assert.equal(
        await page.locator('[data-role][aria-pressed="true"]').count(),
        0,
      );
      assert.equal(
        await page.locator("#project-title").inputValue(),
        active.title,
      );
      assert.equal(
        await page.locator("#project-bars").inputValue(),
        String(active.export.bars),
      );
      assert.equal(
        await page.locator("#bb-volume").inputValue(),
        String(active.master.volume),
      );
      check(`${label}-reset-confirm`, {
        resetScopeCorrect: true,
        refreshPassed: true,
      });
    } else {
      let dialogs = 0;
      const rejectDialog = async (d) => {
        dialogs++;
        await d.dismiss();
      };
      page.on("dialog", rejectDialog);
      await page.locator("#st-new").click();
      page.off("dialog", rejectDialog);
      assert.equal(
        dialogs,
        0,
        "Adding a pattern must preserve existing work directly",
      );
      const withNew = await page
        .waitForFunction((key) => {
          const p = JSON.parse(localStorage.getItem(key));
          return p.patterns.length === 3 ? p : null;
        }, draftKey(tool))
        .then((h) => h.jsonValue());
      assert.deepEqual(withNew.patterns.slice(0, 2), active.patterns);
      assert.deepEqual(withNew.chain, active.chain);
      const baseline = {
        ...withNew,
        activePattern: active.activePattern,
        patterns: withNew.patterns.slice(0, 2),
      };
      delete baseline.playback;
      const activeMusic = structuredClone(active);
      delete activeMusic.playback;
      assert.deepEqual(baseline, activeMusic);
      await page.locator("#st-undo").click();
      await waitDraft(page, tool, active);
      await page.locator("#st-stop").click();
      await waitDraft(page, tool, active);
      check(`${label}-new-pattern-and-return-start`, {
        existingPatternsPreserved: true,
        settingsPreserved: true,
      });
      await confirmAction(page, "#st-clear", active.title, true);
      const cleared = structuredClone(active),
        pattern = cleared.patterns.find((p) => p.id === cleared.activePattern);
      for (const role of Object.keys(pattern.steps))
        pattern.steps[role] = Array(16).fill(0);
      pattern.notes = Array(16).fill(null);
      pattern.kendhang = emptyKendhang();
      pattern.bassNotes = emptyBassNotes();
      pattern.guitarNotes = emptyGuitarNotes();
      pattern.clips = [];
      delete cleared.playback.programmeGain;
      await waitDraft(page, tool, cleared);
      await reloadExact(page, tool, cleared);
      check(`${label}-clear-confirm`, {
        onlySelectedPatternCleared: true,
        settingsPreserved: true,
        refreshPassed: true,
      });
      await confirmAction(page, "#st-delete-pattern", active.title, true);
      const deleted = structuredClone(cleared);
      deleted.patterns = deleted.patterns.filter((p) => p.id !== "p2");
      deleted.activePattern = "p1";
      deleted.chain = deleted.chain.filter((p) => p !== "p2");
      await waitDraft(page, tool, deleted);
      await reloadExact(page, tool, deleted);
      check(`${label}-delete-pattern-confirm`, {
        otherPatternPreserved: true,
        refreshPassed: true,
      });
      await page.locator("#st-demo-kind").selectOption("ruang");
      await confirmAction(page, "#st-demo", active.title, true);
      const demo = full(compositionDemo("ruang"));
      demo.playback = { mode: "chain" };
      await waitDraft(page, tool, demo);
      await reloadExact(page, tool, demo);
      check(`${label}-demo-confirm`, {
        fullDemoLoaded: true,
        refreshPassed: true,
      });
    }
    await protectedData(page, seed, before, tool);
    check(`${label}-saved-projects-and-backups`, {
      protectedStoresUnchanged: true,
    });
  } finally {
    await ctx.close();
  }
}
async function immediate(tool, selector) {
  const { ctx, page, seed } = await makePage(tool, "id", 1440);
  try {
    const before = await stored(page, seed),
      visible = await ui(page, tool);
    await confirmAction(page, selector, "QA immediate edit — $&", false, tool);
    const expected = JSON.parse(before[draftKey(tool)]);
    expected.title = "QA immediate edit — $&";
    await reloadExact(page, tool, expected);
    visible.controls.find((x) => x[0] === ids(tool).title)[1] = expected.title;
    assert.deepEqual(await ui(page, tool), visible);
    await protectedData(page, seed, before, tool);
    check(`${tool}-${selector.slice(1)}-immediate-cancel`, {
      immediateAutosaveVerified: true,
      fullProjectPreserved: true,
      refreshPassed: true,
    });
  } finally {
    await ctx.close();
  }
}
async function productionProbe(tool, selector) {
  const { ctx, page, seed } = await makePage(tool, "id", 1440);
  try {
    const before = await draft(page, tool),
      protectedBefore = await stored(page, seed);
    let dialogs = 0;
    page.on("dialog", async (d) => {
      dialogs++;
      await d.dismiss();
    });
    await page.locator(selector).click();
    await page.waitForTimeout(600);
    const after = await draft(page, tool);
    evidence.checks.push({
      name: `${tool}-${selector.slice(1)}-before-fix`,
      dialogs,
      activeProjectChanged: JSON.stringify(before) !== JSON.stringify(after),
    });
    await protectedData(page, seed, protectedBefore, tool);
    console.log(JSON.stringify(evidence.checks.at(-1)));
  } finally {
    await ctx.close();
  }
}
async function playingCancel(tool) {
  const { ctx, page, seed } = await makePage(tool, "id", 1440);
  try {
    const before = await stored(page, seed),
      active = await draft(page, tool);
    const prefix = tool === "studio" ? "st-" : "bb-";
    const playing = tool === "studio" ? "Memutar" : "suara sedang dimainkan";
    await page.locator("#" + prefix + "play").click();
    await page.waitForFunction(
      ({ prefix, playing }) =>
        document
          .getElementById(prefix + "status")
          .textContent.includes(playing),
      { prefix, playing },
    );
    for (const selector of tool === "studio"
      ? ["#st-clear", "#st-demo", "#st-delete-pattern"]
      : ["#bb-reset"]) {
      await confirmAction(page, selector, active.title, false);
      await page.waitForFunction(
        ({ prefix, playing }) =>
          document
            .getElementById(prefix + "status")
            .textContent.includes(playing),
        { prefix, playing },
      );
      assert.deepEqual(await draft(page, tool), active);
    }
    await page.locator("#" + prefix + "pause").click();
    await reloadExact(page, tool, active);
    await protectedData(page, seed, before, tool);
    check(`${tool}-playing-cancel`, {
      playbackContinued: true,
      fullProjectPreserved: true,
      refreshPassed: true,
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
      page = await ctx.newPage();
    await page.goto(`${base}/version.json?qa=reset-${Date.now()}`, {
      waitUntil: "domcontentloaded",
    });
    evidence.version = JSON.parse(await page.locator("pre").innerText());
    assert.equal(evidence.version.branch, "main");
    if (process.env.PERKUSI_RESET_EXPECT_COMMIT)
      assert.equal(
        evidence.version.commit,
        process.env.PERKUSI_RESET_EXPECT_COMMIT,
      );
    await ctx.close();
  }
  if (probe) {
    await productionProbe("beatbox", "#bb-reset");
    for (const selector of ["#st-clear", "#st-demo", "#st-delete-pattern"])
      await productionProbe("studio", selector);
    evidence.result = "PROBED";
  } else {
    for (const [locale, width] of [
      ["id", 1440],
      ["en", 1440],
      ["id", 390],
    ])
      for (const tool of ["beatbox", "studio"])
        await journey(tool, locale, width);
    await immediate("beatbox", "#bb-reset");
    for (const selector of ["#st-clear", "#st-demo", "#st-delete-pattern"])
      await immediate("studio", selector);
    for (const tool of ["beatbox", "studio"]) await playingCancel(tool);
    evidence.result = "PASS";
  }
  assert.equal(evidence.downloads, 0);
  assert.equal(evidence.fileChoosers, 0);
  assert.deepEqual(evidence.errors, []);
} catch (error) {
  evidence.result = "FAIL";
  evidence.failure = error.stack;
  console.error(error.stack);
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
