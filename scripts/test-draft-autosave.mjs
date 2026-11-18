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
const concurrentProbe = process.argv.includes("--concurrent-probe");
const copyProbe = process.argv.includes("--conflict-copy-probe");
const copyRoundtrip = process.argv.includes("--conflict-copy");
const concurrent = process.argv.includes("--concurrent");
const server = remote
  ? null
  : await preview({
      preview: { host: "127.0.0.1", port: 4189, strictPort: true },
    });
const base = remote || "http://127.0.0.1:4189";
const origin = new URL(base).origin;
const keys = { beatbox: "perkusi.draft.v1", studio: "perkusi.draft.studio.v3" };
const titles = { beatbox: "#project-title", studio: "#st-title" };
const library = {
  beatbox: {
    key: "perkusi.projects.v1",
    list: "#project-list",
    load: "#project-load",
    separate: "#project-open-separate",
    save: "#project-save",
    status: "#project-status",
  },
  studio: {
    key: "perkusi.projects.studio.v3",
    list: "#st-saved",
    load: "#st-load",
    separate: "#st-open-separate",
    save: "#st-save",
    status: "#st-project-status",
  },
};
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
      ctx,
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
      if (event.target === field) {
        const slot = Object.keys(localStorage).find((name) =>
          name.startsWith(`${key}.pending.`),
        );
        field.autosaveQA = {
          focused: document.activeElement === field,
          raw: slot
            ? JSON.parse(localStorage.getItem(slot)).raw
            : localStorage.getItem(key),
        };
      }
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

async function probeConcurrentEdit(tool) {
  await scenario(tool, "id", 1440, async ({ open, initial, key }) => {
    const older = await open();
    const newer = await open();
    await newer.locator(titles[tool]).fill("Newer draft from the other tab");
    const volume = tool === "studio" ? "#st-master" : "#bb-volume";
    await newer.locator(volume).fill("0.45");
    const latest = JSON.parse(await raw(newer, key));
    assert.equal(latest.title, "Newer draft from the other tab");
    assert.equal(latest.master.volume, 0.45);
    const beat =
      tool === "studio" ? '[data-st-step="snare:4"]' : '[data-role="kick"]';
    await older.locator(beat).click();
    const actual = JSON.parse(await raw(newer, key));
    const restored = await open();
    assert.equal(
      await restored.locator(titles[tool]).inputValue(),
      actual.title,
    );
    record(
      `${tool}-stale-edit-before-fix`,
      actual.title === latest.title &&
        actual.master.volume === latest.master.volume
        ? "MATCH"
        : "MISMATCH",
      {
        latest: { title: latest.title, volume: latest.master.volume },
        afterStaleEdit: { title: actual.title, volume: actual.master.volume },
        originalTitle: initial.title,
      },
    );
  });
}

const notice = ".draft-notice";

async function waitForTitle(page, key, title) {
  await page.waitForFunction(
    ({ key, title }) => JSON.parse(localStorage.getItem(key))?.title === title,
    { key, title },
  );
}

async function loadNamed(
  page,
  tool,
  id,
  title,
  { accept = true, button = library[tool].load } = {},
) {
  await page.locator(library[tool].list).selectOption(id);
  const waiting = page.waitForEvent("dialog", { timeout: 5000 });
  const click = page.locator(button).click();
  const dialog = await waiting;
  assert.equal(dialog.type(), "confirm");
  const text = dialog.message();
  assert(text.includes(title));
  if (accept) await dialog.accept();
  else await dialog.dismiss();
  await click;
  return text;
}

async function conflictingEdit(tool, locale, width) {
  await scenario(tool, locale, width, async ({ open, seed, initial, key }) => {
    const older = await open();
    const newer = await open();
    const latest = structuredClone(initial);
    latest.title = "Shared latest draft";
    latest.master.volume = 0.45;
    if (tool === "studio") latest.playback = { mode: "pattern" };
    await newer.locator(titles[tool]).fill(latest.title);
    await newer
      .locator(tool === "studio" ? "#st-master" : "#bb-volume")
      .fill("0.45");
    await newer.waitForFunction(
      ({ key, latest }) => {
        const current = JSON.parse(localStorage.getItem(key));
        return (
          current.title === latest.title &&
          current.master.volume === latest.master.volume
        );
      },
      { key, latest },
    );
    assert.deepEqual(JSON.parse(await raw(newer, key)), latest);

    const selector =
      tool === "studio" ? '[data-st-step="snare:4"]' : '[data-role="kick"]';
    const copy = structuredClone(initial);
    copy.title = "Separate edit from older tab";
    if (tool === "studio") {
      copy.patterns[1].steps.snare[4] = 1;
      copy.playback = { mode: "pattern" };
    } else copy.tracks.find((track) => track.role === "kick").enabled = false;
    await older.locator(selector).click();
    await older.locator(notice).waitFor({ state: "visible" });
    await older.locator(titles[tool]).fill(copy.title);
    if (copyRoundtrip) {
      if (tool === "studio") {
        await older.locator("#st-bpm").fill("137");
        await older.locator("#st-swing").fill("0.18");
        const chainMode = older.locator("#st-chain-mode");
        await chainMode.evaluate((control) =>
          control.scrollIntoView({ block: "center", behavior: "instant" }),
        );
        await chainMode.check();
        copy.timing.bpm = 137;
        copy.timing.swing = 0.18;
        copy.playback.mode = "chain";
      } else {
        await older
          .locator('[data-variant-role="kick"][data-variant="2"]')
          .click();
        await older.locator("#project-bars").selectOption("4");
        copy.tracks.find((track) => track.role === "kick").variant = 2;
        copy.export.bars = 4;
      }
    }
    assert.match(
      await older.locator(notice).innerText(),
      locale === "id" ? /di tab lain/ : /in another tab/,
    );
    assert.deepEqual(JSON.parse(await raw(newer, key)), latest);
    await unchanged(newer, seed, key);

    const button = tool === "studio" ? "#st-save" : "#project-save";
    const savedKey =
      tool === "studio" ? "perkusi.projects.studio.v3" : "perkusi.projects.v1";
    await older.locator(`${notice} a`).click();
    assert.equal(
      await older
        .locator(button)
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await older.locator(button).press("Enter");
    const saved = JSON.parse(await raw(older, savedKey));
    assert.deepEqual(
      saved.items.slice(0, -1),
      JSON.parse(seed[savedKey]).items,
    );
    assert.deepEqual(saved.items.at(-1).project, copy);
    assert.deepEqual(JSON.parse(await raw(newer, key)), latest);
    if (copyProbe) {
      const reopened = await open();
      assert.equal(
        await reopened.locator(titles[tool]).inputValue(),
        latest.title,
      );
      await loadNamed(reopened, tool, saved.items.at(-1).id, copy.title);
      await reopened.waitForFunction(
        ({ key, title }) => {
          const input = document.querySelector(title);
          return (
            input?.value === "Separate edit from older tab" &&
            !Object.keys(localStorage).some((name) =>
              name.startsWith(`${key}.pending.`),
            )
          );
        },
        { key, title: titles[tool] },
      );
      const recovered = JSON.parse(await raw(reopened, key));
      const preserved = recovered.title === latest.title;
      assert.deepEqual(recovered, preserved ? latest : copy);
      record(
        `${tool}-conflict-copy-load-before-fix`,
        preserved ? "MATCH" : "MISMATCH",
        {
          conflictCopySavedExactly: true,
          before: latest.title,
          after: recovered.title,
        },
      );
      return;
    }
    if (copyRoundtrip) {
      await older.close();
      await reopenConflictCopy(tool, locale, width, {
        open,
        newer,
        seed,
        key,
        latest,
        saved,
        savedKey,
        copy,
      });
      return;
    }
    await older.reload({ waitUntil: "domcontentloaded" });
    await ready(older, tool);
    assert.equal(await older.locator(titles[tool]).inputValue(), latest.title);
    assert.equal(await older.locator(notice).isVisible(), false);
    await older.locator(titles[tool]).fill("New edit after reload");
    await waitForTitle(older, key, "New edit after reload");
    assert.deepEqual(JSON.parse(await raw(newer, key)), {
      ...latest,
      title: "New edit after reload",
    });
    const { [savedKey]: writtenCopy, ...protectedSeed } = seed;
    assert(writtenCopy);
    await unchanged(older, protectedSeed, key);
    record(`${tool}-${locale}-${width}-conflict-copy-and-reload`, "PASS", {
      newestDraftProtected: true,
      separateCopyVerified: true,
      editsResumeAfterReload: true,
    });
  });
}

async function assertCopy(page, tool, key, expected) {
  await page.locator(`${notice} button`).waitFor({ state: "visible" });
  assert.equal(new URL(page.url()).searchParams.get("draft"), "copy");
  const actual = await page.evaluate(
    (key) => JSON.parse(sessionStorage.getItem(`${key}.copy`)),
    key,
  );
  assert.deepEqual(actual, expected);
  assert.equal(await page.locator(titles[tool]).inputValue(), expected.title);
  if (tool === "studio") {
    assert.equal(
      await page.locator("#st-bpm").inputValue(),
      String(expected.timing.bpm),
    );
    assert.equal(
      await page.locator("#st-chain-mode").isChecked(),
      expected.playback.mode === "chain",
    );
    assert.equal(
      await page
        .locator('[data-st-step="snare:4"]')
        .getAttribute("aria-pressed"),
      "true",
    );
  } else {
    assert.equal(
      await page.locator("#project-bars").inputValue(),
      String(expected.export.bars),
    );
    assert.equal(
      await page.locator('[data-role="kick"]').getAttribute("aria-pressed"),
      "false",
    );
    assert.equal(
      await page
        .locator('[data-variant-role="kick"][data-variant="2"]')
        .getAttribute("aria-pressed"),
      "true",
    );
  }
}

async function reopenConflictCopy(
  tool,
  locale,
  width,
  { open, newer, seed, key, latest, saved, savedKey, copy },
) {
  const editor = await open();
  const first = saved.items.at(-1);
  assert(first.id.startsWith("separate-"));
  assert.equal(await editor.locator(titles[tool]).inputValue(), latest.title);
  const selection = editor
    .locator(library[tool].list)
    .locator(`option[value="${first.id}"]`);
  assert.match(
    await selection.textContent(),
    locale === "id" ? /Salinan terpisah/ : /Separate copy/,
  );
  const text = await loadNamed(editor, tool, first.id, copy.title, {
    accept: false,
  });
  assert.match(
    text,
    locale === "id" ? /Draft bersama/ : /shared browser draft/,
  );
  assert.equal(await editor.locator(titles[tool]).inputValue(), latest.title);
  assert.equal(new URL(editor.url()).searchParams.has("draft"), false);
  const latestRaw = await raw(newer, key);
  await loadNamed(editor, tool, first.id, copy.title);
  await assertCopy(editor, tool, key, copy);
  assert.equal(await raw(newer, key), latestRaw);

  const afterSharedEdit = { ...latest, title: "Draft terbaru dari tab lain" };
  await newer.locator(titles[tool]).fill(afterSharedEdit.title);
  await waitForTitle(newer, key, afterSharedEdit.title);
  const sharedRaw = await raw(newer, key);
  assert.deepEqual(JSON.parse(sharedRaw), afterSharedEdit);

  const afterCopyEdit = { ...copy, title: "Salinan konflik setelah edit" };
  await editor.locator(titles[tool]).fill(afterCopyEdit.title);
  await editor.reload({ waitUntil: "domcontentloaded" });
  await ready(editor, tool);
  await assertCopy(editor, tool, key, afterCopyEdit);
  assert.equal(await raw(newer, key), sharedRaw);

  await editor.locator(library[tool].save).click();
  const savedLibraryRaw = await raw(editor, savedKey);
  const updatedLibrary = JSON.parse(savedLibraryRaw);
  assert.deepEqual(updatedLibrary.items.slice(0, -1), saved.items);
  const updated = updatedLibrary.items.at(-1);
  assert(updated.id.startsWith("separate-"));
  assert.deepEqual(updated.project, afterCopyEdit);

  const unsavedCopy = structuredClone(afterCopyEdit);
  unsavedCopy.title = "Edit salinan yang belum disimpan";
  const beatSelector =
    tool === "studio" ? '[data-st-step="snare:6"]' : '[data-role="snare"]';
  const beat = editor.locator(beatSelector);
  if (tool === "studio") {
    const pattern = unsavedCopy.patterns.find(
      ({ id }) => id === unsavedCopy.activePattern,
    );
    pattern.steps.snare[6] = 1;
    await beat.evaluate((control) =>
      control.scrollIntoView({ block: "center", behavior: "instant" }),
    );
  } else {
    unsavedCopy.tracks.find(({ role }) => role === "snare").enabled = true;
  }
  assert.equal(await beat.getAttribute("aria-pressed"), "false");
  await beat.click();
  await editor.locator(titles[tool]).fill(unsavedCopy.title);
  await assertCopy(editor, tool, key, unsavedCopy);
  assert.equal(await raw(editor, savedKey), savedLibraryRaw);

  const returnButton = editor.locator(notice).getByRole("button", {
    name: locale === "id" ? "Buka draft terbaru" : "Open latest draft",
  });
  const pressReturn = () =>
    width < 600 ? returnButton.tap() : returnButton.click();
  const warningReady = editor.waitForEvent("dialog", { timeout: 5000 });
  const firstAttempt = pressReturn();
  const firstWarning = await warningReady;
  const warning = firstWarning.message();
  const dialogType = firstWarning.type();
  await firstWarning.dismiss();
  await firstAttempt;
  assert.equal(dialogType, "confirm");
  assert.match(
    warning,
    locale === "id"
      ? /belum disimpan sebagai proyek akan hilang.*batalkan lalu pilih Simpan proyek baru/
      : /haven't saved as a project will be lost.*cancel and choose Save a new project/,
  );
  await assertCopy(editor, tool, key, unsavedCopy);
  assert.equal(await beat.getAttribute("aria-pressed"), "true");
  assert.equal(await raw(editor, savedKey), savedLibraryRaw);
  assert.equal(await raw(newer, key), sharedRaw);

  await editor.evaluate((key) => {
    const set = Storage.prototype.setItem;
    window.restoreSavedProjectWrites = () => {
      Storage.prototype.setItem = set;
    };
    Storage.prototype.setItem = function (name, value) {
      if (this === window.localStorage && name === key)
        throw new DOMException("QA blocked saving the copy", "SecurityError");
      return set.call(this, name, value);
    };
  }, savedKey);
  const save = editor.locator(library[tool].save);
  const saveStatus = editor.locator(library[tool].status);
  let saveError;
  try {
    if (width < 600) await save.tap();
    else await save.click();
    assert.equal(await saveStatus.getAttribute("role"), "alert");
    saveError = await saveStatus.innerText();
    assert.match(
      saveError,
      locale === "id"
        ? /Salinan belum tersimpan.*Edit masih ada di tab ini.*coba Simpan proyek baru lagi/
        : /The copy could not be saved.*Your edits are still in this tab.*try Save a new project again/,
    );
    await editor.waitForFunction(
      ({ status, save }) => {
        const element = document.querySelector(status);
        const button = document.querySelector(save);
        const { top, bottom } = element.getBoundingClientRect();
        return (
          element.previousElementSibling?.contains(button) &&
          top >= 0 &&
          bottom <= window.innerHeight
        );
      },
      library[tool],
      { timeout: 5000 },
    );
    await assertCopy(editor, tool, key, unsavedCopy);
    assert.equal(await raw(editor, savedKey), savedLibraryRaw);
    assert.equal(await raw(newer, key), sharedRaw);
  } finally {
    await editor.evaluate(() => {
      window.restoreSavedProjectWrites();
      delete window.restoreSavedProjectWrites;
    });
  }

  // A saved-library read error on reload must not block draft recovery.
  const readDeniedKey = "__qa_saved_library_read_denied";
  await editor.evaluate(
    (flag) => sessionStorage.setItem(flag, "1"),
    readDeniedKey,
  );
  await editor.addInitScript(
    ({ key, flag }) => {
      const get = Storage.prototype.getItem;
      Storage.prototype.getItem = function (name) {
        if (
          this === window.localStorage &&
          name === key &&
          get.call(window.sessionStorage, flag)
        ) {
          window.qaSavedProjectReadRejected = true;
          throw new DOMException(
            "QA blocked reading saved projects",
            "SecurityError",
          );
        }
        return get.call(this, name);
      };
    },
    { key: savedKey, flag: readDeniedKey },
  );
  const reload = editor.waitForEvent("domcontentloaded");
  const confirm = editor.waitForEvent("dialog", { timeout: 5000 });
  const back = pressReturn();
  const secondWarning = await confirm;
  const confirmedWarning = secondWarning.message();
  await secondWarning.accept();
  await back;
  await reload;
  await ready(editor, tool);
  assert.equal(confirmedWarning, warning);
  assert.equal(
    await editor.locator(titles[tool]).inputValue(),
    afterSharedEdit.title,
  );
  assert.equal(new URL(editor.url()).searchParams.has("draft"), false);
  assert.equal(
    await editor.evaluate(() => window.qaSavedProjectReadRejected),
    true,
  );
  assert.equal(await raw(editor, key), sharedRaw);
  assert.equal(await raw(newer, savedKey), savedLibraryRaw);
  const retryList = editor.getByRole("button", {
    name: locale === "id" ? "Muat ulang daftar proyek" : "Reload project list",
    exact: true,
  });
  const savedOption = editor
    .locator(library[tool].list)
    .locator(`option[value="${updated.id}"]`);
  await retryList.waitFor({ state: "visible" });
  assert.equal(await savedOption.count(), 0);
  await editor.bringToFront();
  await editor.waitForFunction(() => document.hasFocus());
  const beforeListRetry = await editor.evaluate(() => performance.timeOrigin);
  if (width < 600) await retryList.tap();
  else await retryList.click();
  await editor.waitForFunction(
    (expected) =>
      document
        .querySelector(".saved-list-recovery [role=status]")
        .textContent.startsWith(expected),
    locale === "id"
      ? "Gagal memuat ulang daftar proyek."
      : "Couldn't reload the saved project list.",
  );
  assert.equal(await retryList.isEnabled(), true);
  assert.equal(await savedOption.count(), 0);
  assert.equal(await raw(editor, key), sharedRaw);
  assert.equal(await raw(newer, savedKey), savedLibraryRaw);
  await editor.evaluate(
    (flag) => sessionStorage.removeItem(flag),
    readDeniedKey,
  );
  if (width < 600) await retryList.tap();
  else await retryList.click();
  await savedOption.waitFor({ state: "attached" });
  assert.equal(await retryList.isVisible(), false);
  assert.equal(
    await editor.evaluate(() => performance.timeOrigin),
    beforeListRetry,
  );
  assert.equal(
    await editor.locator(titles[tool]).inputValue(),
    afterSharedEdit.title,
  );
  assert.equal(await raw(editor, key), sharedRaw);
  assert.equal(await raw(editor, savedKey), savedLibraryRaw);

  for (const page of [editor, newer]) {
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setFocusEmulationEnabled", {
      enabled: false,
    });
  }
  await newer.bringToFront();
  await editor.waitForFunction(() => !document.hasFocus());
  await editor.evaluate((flag) => {
    window.qaSavedProjectReadRejected = false;
    sessionStorage.setItem(flag, "1");
  }, readDeniedKey);
  await editor.bringToFront();
  await retryList.waitFor({ state: "visible" });
  assert.equal(
    await editor.evaluate(() => window.qaSavedProjectReadRejected),
    true,
  );
  assert.match(
    await editor.locator(".saved-list-recovery [role=status]").innerText(),
    locale === "id"
      ? /^Daftar proyek belum bisa dibaca/
      : /^The saved project list couldn't be read/,
  );
  assert.equal(await retryList.isEnabled(), true);
  assert.equal(await raw(editor, key), sharedRaw);
  assert.equal(await raw(newer, savedKey), savedLibraryRaw);

  await newer.bringToFront();
  await editor.waitForFunction(() => !document.hasFocus());
  await editor.evaluate(
    (flag) => sessionStorage.removeItem(flag),
    readDeniedKey,
  );
  await editor.bringToFront();
  await retryList.waitFor({ state: "hidden" });
  await savedOption.waitFor({ state: "attached" });
  assert.equal(
    await editor.evaluate(() => performance.timeOrigin),
    beforeListRetry,
  );
  assert.equal(await raw(editor, key), sharedRaw);
  assert.equal(await raw(editor, savedKey), savedLibraryRaw);
  await editor.close();

  const reopened = await open();
  await loadNamed(reopened, tool, updated.id, afterCopyEdit.title);
  await assertCopy(reopened, tool, key, afterCopyEdit);
  assert.equal(
    await reopened.locator(beatSelector).getAttribute("aria-pressed"),
    "false",
  );
  assert.equal(await raw(reopened, key), sharedRaw);
  assert.deepEqual(JSON.parse(await raw(reopened, savedKey)), updatedLibrary);
  const { [savedKey]: originalLibrary, ...protectedSeed } = seed;
  assert(originalLibrary);
  await unchanged(reopened, protectedSeed, key);
  record(`${tool}-${locale}-${width}-conflict-copy-roundtrip`, "PASS", {
    returnWarning: warning,
    saveFailureAfterCancel: saveError,
    rejectedSavePreservedCopyAndDraft: true,
    latestDraftOpenedWithSavedListUnavailable: true,
    blockedRetryReportedFailure: true,
    savedListRestoredWithoutReload: true,
    repeatedSavedListFailureDetectedOnTabReturn: true,
    unsavedCopyPreservedOnCancel: true,
    savedEditsRetainedAfterReturn: true,
    savedAndLoadedExactly: true,
    survivesRefreshAndReopen: true,
    latestDraftProtected: true,
  });
}

async function olderCopy(tool) {
  await scenario(tool, "id", 1440, async ({ open, initial, key, seed }) => {
    const page = await open();
    const option = JSON.parse(seed[library[tool].key]).items[0];
    await page.locator(titles[tool]).fill("Draft sebelum salinan lama");
    await waitForTitle(page, key, "Draft sebelum salinan lama");
    await loadNamed(page, tool, option.id, initial.title);
    await waitForTitle(page, key, initial.title);
    assert.equal(new URL(page.url()).searchParams.has("draft"), false);
    await page.locator(titles[tool]).fill("Draft yang harus tetap aman");
    await waitForTitle(page, key, "Draft yang harus tetap aman");
    const newest = await raw(page, key);

    await page.evaluate((key) => {
      const save = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (this === sessionStorage && name === `${key}.copy`)
          throw new DOMException(
            "Copy storage disabled by QA",
            "QuotaExceededError",
          );
        return save.call(this, name, value);
      };
      window.restoreCopyStorageQA = () => (Storage.prototype.setItem = save);
    }, key);
    await loadNamed(page, tool, option.id, initial.title, {
      button: library[tool].separate,
    });
    await page.waitForFunction(
      (selector) =>
        document.querySelector(selector).getAttribute("role") === "alert",
      library[tool].status,
    );
    assert.equal(
      await page.locator(titles[tool]).inputValue(),
      "Draft yang harus tetap aman",
    );
    assert.equal(await raw(page, key), newest);
    await page.evaluate(() => window.restoreCopyStorageQA());

    await loadNamed(page, tool, option.id, initial.title, {
      button: library[tool].separate,
    });
    await page.locator(`${notice} button`).waitFor({ state: "visible" });
    assert.equal(await page.locator(titles[tool]).inputValue(), initial.title);
    assert.deepEqual(
      await page.evaluate(
        (key) => JSON.parse(sessionStorage.getItem(`${key}.copy`)),
        key,
      ),
      initial,
    );
    assert.equal(await raw(page, key), newest);
    await unchanged(page, seed, key);
    record(`${tool}-untagged-copy-and-storage-failure`, "PASS", {
      ordinaryLoadStillWorks: true,
      olderCopiesSupported: true,
      failedCopyOpenPreservesDraft: true,
    });
  });
}

async function holdCommit(ctx, key) {
  const observer = await ctx.newPage();
  await observer.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await observer.evaluate(
    (key) =>
      new Promise((resolve, reject) => {
        const gate = new Promise(
          (release) => (window.releaseDraftQA = release),
        );
        void navigator.locks
          .request(`${key}.write`, () => {
            resolve();
            return gate;
          })
          .catch(reject);
      }),
    key,
  );
  return observer;
}

async function pending(page, key) {
  return page.evaluate(
    (key) =>
      Object.keys(localStorage)
        .filter((name) => name.startsWith(`${key}.pending.`))
        .map((name) => JSON.parse(localStorage.getItem(name))),
    key,
  );
}

async function simultaneous(tool) {
  await scenario(
    tool,
    "id",
    1440,
    async ({ open, seed, initial, key, ctx }) => {
      const tabA = await open();
      const tabB = await open();
      const observer = await holdCommit(ctx, key);
      await observer.evaluate((key) => {
        window.sharedDraftWrites = [];
        window.addEventListener("storage", (event) => {
          if (event.key === key) window.sharedDraftWrites.push(event.newValue);
        });
      }, key);
      await Promise.all([
        tabA.locator(titles[tool]).fill("Concurrent A"),
        tabB.locator(titles[tool]).fill("Concurrent B"),
      ]);
      const titlesQueued = (await pending(observer, key))
        .map(({ raw }) => JSON.parse(raw).title)
        .sort();
      assert.deepEqual(titlesQueued, ["Concurrent A", "Concurrent B"]);
      assert.equal(await raw(observer, key), seed[key]);
      await observer.evaluate(() => window.releaseDraftQA());
      await observer.waitForFunction(
        (key) =>
          !Object.keys(localStorage).some((name) =>
            name.startsWith(`${key}.pending.`),
          ),
        key,
      );
      const winner = JSON.parse(await raw(observer, key));
      assert(titlesQueued.includes(winner.title));
      assert.deepEqual(winner, { ...initial, title: winner.title });
      const loser = winner.title === "Concurrent A" ? tabB : tabA;
      await loser.locator(notice).waitFor({ state: "visible" });
      await observer.waitForFunction(() => window.sharedDraftWrites.length > 0);
      assert.deepEqual(
        await observer.evaluate(() =>
          window.sharedDraftWrites.map((raw) => JSON.parse(raw)),
        ),
        [winner],
      );
      await loser.locator(titles[tool]).fill("Repeated stale edit");
      await loser.close();
      const reopened = await open();
      assert.equal(
        await reopened.locator(titles[tool]).inputValue(),
        winner.title,
      );
      assert.deepEqual(JSON.parse(await raw(reopened, key)), winner);
      await unchanged(reopened, seed, key);
      record(`${tool}-two-edits-queued-together`, "PASS", {
        exactlyOneSharedWrite: true,
        secondTabProtected: true,
      });
    },
  );
}

async function transferThenEdit(tool) {
  await scenario(tool, "id", 1440, async ({ open, seed, key, ctx }) => {
    const older = await open();
    const sourceTool = tool === "studio" ? "beatbox" : "studio";
    const incoming = await ctx.newPage();
    await incoming.goto(`${base}/${sourceTool}/?lang=id`, {
      waitUntil: "domcontentloaded",
    });
    await ready(incoming, sourceTool);
    const archiveKey = "perkusi.mode-transfer.v3";
    await incoming.locator("#mode-transfer").click();
    const arrived = incoming.waitForURL((url) => url.pathname === `/${tool}/`);
    await incoming.locator("#mode-confirm").click();
    await arrived;
    await ready(incoming, tool);
    const transferred = JSON.parse(await raw(incoming, key));
    const archive = JSON.parse(await raw(incoming, archiveKey));
    assert.equal(archive.pending, false);
    assert.equal(archive.target, tool);
    assert.equal(transferred.title, JSON.parse(seed[keys[sourceTool]]).title);
    await older.locator(titles[tool]).fill("Old edit after incoming transfer");
    await older.locator(notice).waitFor({ state: "visible" });
    assert.deepEqual(JSON.parse(await raw(incoming, key)), transferred);
    const title = "Edit after accepting transfer";
    await incoming.locator(titles[tool]).fill(title);
    await waitForTitle(incoming, key, title);
    assert.equal(await incoming.locator(notice).isVisible(), false);
    const after = JSON.parse(await raw(incoming, key));
    assert.equal(after.title, title);
    assert.deepEqual(after.master, transferred.master);
    assert.equal(await raw(incoming, keys[sourceTool]), seed[keys[sourceTool]]);
    record(`${tool}-edit-after-receiving-transfer`, "PASS", {
      staleTabBlocked: true,
      receivingTabAutosaveContinues: true,
    });
  });
}

async function pendingExit(tool, exit) {
  await scenario(
    tool,
    "id",
    1440,
    async ({ open, seed, initial, key, ctx }) => {
      const editor = await open();
      const observer = await holdCommit(ctx, key);
      const latest = {
        ...initial,
        title: `Recover while waiting to save (${exit})`,
      };
      await editor.locator(titles[tool]).fill(latest.title);
      assert.equal(await raw(observer, key), seed[key]);
      const staged = await pending(observer, key);
      assert.equal(staged.length, 1);
      assert.deepEqual(JSON.parse(staged[0].raw), latest);
      if (exit === "refresh")
        await editor.reload({ waitUntil: "domcontentloaded" });
      else await editor.close();
      await observer.evaluate(() => window.releaseDraftQA());
      const restored = exit === "refresh" ? editor : await open();
      await ready(restored, tool);
      assert.equal(
        await restored.locator(titles[tool]).inputValue(),
        latest.title,
      );
      assert.deepEqual(JSON.parse(await raw(restored, key)), latest);
      assert.deepEqual(await pending(restored, key), []);
      await unchanged(restored, seed, key);
      record(`${tool}-pending-${exit}`, "PASS", {
        pendingEditRecovered: true,
        protectedDataUnchanged: true,
      });
    },
  );
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
  if (concurrentProbe) {
    for (const tool of Object.keys(keys)) await probeConcurrentEdit(tool);
  } else if (copyProbe) {
    for (const tool of Object.keys(keys))
      await conflictingEdit(tool, "id", 1440);
  } else if (copyRoundtrip) {
    for (const tool of Object.keys(keys)) {
      for (const [locale, width] of [
        ["id", 1440],
        ["en", 1440],
        ["id", 390],
      ])
        await conflictingEdit(tool, locale, width);
      await olderCopy(tool);
    }
  } else if (concurrent) {
    for (const tool of Object.keys(keys)) {
      for (const [locale, width] of [
        ["id", 1440],
        ["en", 1440],
        ["id", 390],
      ])
        await conflictingEdit(tool, locale, width);
      await simultaneous(tool);
      for (const exit of ["refresh", "close"]) await pendingExit(tool, exit);
      await transferThenEdit(tool);
    }
  } else {
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
  }
  assert.equal(evidence.downloadEvents, 0);
  assert.equal(evidence.fileChoosers, 0);
  assert.deepEqual(evidence.errors, []);
  evidence.result = probe || concurrentProbe || copyProbe ? "PROBED" : "PASS";
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
