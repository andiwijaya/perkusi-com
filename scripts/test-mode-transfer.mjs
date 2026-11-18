import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { preview } from "vite";
import {
  fromBeatbox,
  withPatternLoops,
  newCompositionClip,
  toBeatbox,
  studioView,
} from "../src/project/composition-model.js";
import { newStudioProject } from "../src/project/studio-model.js";
import { withKendhang } from "../src/project/kendhang.js";
import { withBass } from "../src/project/bass.js";
import { withGuitar } from "../src/project/guitar.js";
import { originalRegistry } from "../src/project/original-registry.js";
import { pagePath } from "../src/app/routes.js";
const recoveryOnly = process.argv.includes("--recovery");
const clearOnly = process.argv.includes("--clear-backups");
const deleteOnly = process.argv.includes("--delete-projects");
const loadOnly = process.argv.includes("--load-projects");
const loadCopy = process.env.PERKUSI_LOAD_COPY !== "0";
const deleteCopy = process.env.PERKUSI_DELETE_COPY !== "0";
const clearCopy = process.env.PERKUSI_CLEAR_COPY !== "0";
const recoveryGuidance = process.env.PERKUSI_RECOVERY_GUIDANCE !== "0";
const require = createRequire(import.meta.url);
let pw;
try {
  pw = require("playwright");
} catch {
  pw = require(join(process.env.NODE_REPL_NODE_MODULE_DIRS, "playwright"));
}
const output =
  process.env.PERKUSI_TRANSFER_QA_DIR ||
  (loadOnly
    ? "qa-artifacts/load-projects"
    : deleteOnly
      ? "qa-artifacts/delete-projects"
      : clearOnly
        ? "qa-artifacts/clear-backups"
        : recoveryOnly
          ? "qa-artifacts/transfer-recovery"
          : "qa-artifacts/mode-transfer");
await mkdir(output, { recursive: true });
const remote = process.env.PERKUSI_TRANSFER_BASE_URL;
const server = remote
  ? null
  : await preview({
      preview: { host: "127.0.0.1", port: 4186, strictPort: true },
    });
const base = remote || "http://127.0.0.1:4186";
const KEY = "perkusi.mode-transfer.v3",
  MARKER = "perkusi.mode-transfer.pending.v3";
const draftKey = (tool) =>
  tool === "studio" ? "perkusi.draft.studio.v3" : "perkusi.draft.v1";
const savedKey = (tool) =>
  tool === "studio" ? "perkusi.projects.studio.v3" : "perkusi.projects.v1";
const evidence = {
  date: new Date().toISOString(),
  base,
  checks: [],
  errors: [],
  result: "RUNNING",
};
const csp = (await readFile("public/_headers", "utf8"))
  .split("Content-Security-Policy: ")[1]
  .split(/\r?\n/)[0]
  .trim();
const beatbox = (title = "Transfer — Beatbox", bars = 8) => ({
  format: "perkusi-project",
  schemaVersion: 1,
  mode: "beatbox",
  title,
  pack: { id: originalRegistry.packId, version: originalRegistry.version },
  timing: { bpm: 96, meter: [4, 4] },
  master: { volume: 0.37 },
  tracks: originalRegistry.roleOrder.map((role, i) => ({
    role,
    enabled: [0, 2, 3].includes(i),
    variant: (i % 2) + 1,
  })),
  export: { bars },
});
const composition = (p) =>
  withGuitar(withBass(withKendhang(withPatternLoops(fromBeatbox(p)))));
function advanced() {
  const p = composition(beatbox("Transfer — Studio lengkap", 4));
  p.pack.id = "fusion";
  p.timing.swing = 0.24;
  p.chain = ["p1", "p2", "p1"];
  p.patterns.push({
    ...structuredClone(p.patterns[0]),
    id: "p2",
    name: "B — isi",
  });
  p.activePattern = "p2";
  p.master.volume = 0.43;
  for (const a of p.patterns) {
    a.steps.kick[0] = 0.6;
    a.notes[2] = { pitch: "d4", velocity: 0.5 };
    a.kendhang.tak[7] = 0.5;
    a.bassNotes[8] = { pitch: "g1", velocity: 0.6 };
    a.guitarNotes[11] = { pitch: "e3", velocity: 0.5 };
  }
  p.patterns[0].clips = [{ ...newCompositionClip("kick"), enabled: true }];
  p.patterns[1].clips = [
    {
      ...newCompositionClip("kick"),
      enabled: true,
      variant: 2,
      volume: 0.6,
      pan: -0.3,
    },
    {
      ...newCompositionClip("hat"),
      enabled: true,
      variant: 2,
      volume: 0.7,
      pan: 0.4,
      solo: true,
    },
  ];
  p.playback = { mode: "pattern", programmeGain: 2 };
  return p;
}
const ids = (tool) =>
  tool === "studio"
    ? {
        file: "st-file",
        title: "st-title",
        json: "st-project-download",
        save: "st-save",
        list: "st-saved",
        load: "st-load",
        delete: "st-saved-delete",
        render: "st-render",
        result: "st-result",
        wav: "st-wav-download",
      }
    : {
        file: "project-file",
        title: "project-title",
        json: "project-json",
        save: "project-save",
        list: "project-list",
        load: "project-load",
        delete: "project-delete",
        render: "project-render",
        result: "project-result",
        wav: "project-download",
      };
let browser;
async function context(width, seed) {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
    hasTouch: width < 700,
    isMobile: width < 700,
    acceptDownloads: true,
    reducedMotion: "reduce",
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
  await ctx.addInitScript((seed) => {
    if (!localStorage.getItem("__transferQASeed")) {
      for (const [key, value] of Object.entries(seed))
        localStorage.setItem(key, value);
      localStorage.setItem("__transferQASeed", "yes");
    }
    window.__transferStarts = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.context instanceof AudioContext) window.__transferStarts++;
      return start.apply(this, args);
    };
  }, seed);
  return ctx;
}
const watchedPages = new WeakSet();
async function watch(page) {
  if (watchedPages.has(page)) return;
  watchedPages.add(page);
  page.setDefaultTimeout(45000);
  page.on("dialog", (d) => d.accept());
  page.on("pageerror", (e) => evidence.errors.push(e.message));
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
async function open(page, tool, locale) {
  await watch(page);
  assert.equal(
    (
      await page.goto(base + pagePath(tool, locale) + "?lang=" + locale)
    ).status(),
    200,
  );
  await ready(page, tool);
}
async function imported(page, tool, p, raw) {
  const file = {
    name: "transfer.perkusi.json",
    mimeType: "application/json",
    buffer: Buffer.from(raw ?? JSON.stringify(p)),
  };
  if (recoveryOnly) {
    const chooser = page.waitForEvent("filechooser");
    await page
      .locator(tool === "studio" ? "#st-import" : "#project-import")
      .click();
    await (await chooser).setFiles(file);
  } else await page.locator("#" + ids(tool).file).setInputFiles(file);
  await page.waitForFunction(
    ({ id, title }) => document.querySelector("#" + id).value === title,
    { id: ids(tool).title, title: p.title },
  );
  await ready(page, tool);
  await page.waitForFunction(
    (id) => !document.querySelector("#" + id).disabled,
    ids(tool).file,
  );
}
async function download(page, selector, name) {
  const job = page.waitForEvent("download");
  await page.locator(selector).click();
  const d = await job,
    path = join(output, name);
  if (
    recoveryOnly &&
    recoveryGuidance &&
    ["#mode-original", "#mode-draft-backup"].includes(selector)
  )
    assert(
      /^(original|draft)-(beatbox|studio)-/.test(d.suggestedFilename()),
      "Recovery filenames must identify their tool",
    );
  await d.saveAs(path);
  return readFile(path);
}
async function project(page, tool, name) {
  return JSON.parse(
    await download(page, "#" + ids(tool).json, name + ".perkusi.json"),
  );
}
async function beatboxControls(page, data) {
  if (data.tracks.some((track) => track.enabled))
    await page.waitForFunction(() =>
      /Iramamu siap|Your groove is ready/.test(
        document.querySelector("#bb-status").textContent,
      ),
    );
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
async function wav(page, tool, name) {
  const d = ids(tool);
  await page.locator("#" + d.render).click();
  await page
    .locator("#" + d.result)
    .waitFor({ state: "visible", timeout: 90000 });
  const bytes = await download(page, "#" + d.wav, name + ".wav");
  let pcm;
  for (let p = 12; p + 8 <= bytes.length;) {
    const n = bytes.readUInt32LE(p + 4);
    if (bytes.toString("ascii", p, p + 4) === "data")
      pcm = bytes.subarray(p + 8, p + 8 + n);
    p += 8 + n + (n % 2);
  }
  return {
    channels: bytes.readUInt16LE(22),
    rate: bytes.readUInt32LE(24),
    pcm,
  };
}
function sameAudio(a, b, channel = 0) {
  assert.equal(a.rate, b.rate);
  const frames = a.pcm.length / 2 / a.channels;
  assert.equal(frames, b.pcm.length / 2 / b.channels);
  let xx = 0,
    yy = 0,
    xy = 0,
    error = 0;
  for (
    let i = Math.round(0.04 * a.rate);
    i < frames - Math.round(0.015 * a.rate);
    i++
  ) {
    const x = a.pcm.readInt16LE((i * a.channels + channel) * 2) / 32767,
      y = b.pcm.readInt16LE((i * b.channels + channel) * 2) / 32767;
    xx += x * x;
    yy += y * y;
    xy += x * y;
    error += (x - y) ** 2;
  }
  const metrics = {
    correlation: xy / Math.sqrt(xx * yy),
    normalizedError: Math.sqrt(error / yy),
    levelDifferenceDb: 10 * Math.log10(xx / yy),
  };
  assert(
    metrics.correlation > 0.999 &&
      metrics.normalizedError < 0.002 &&
      Math.abs(metrics.levelDifferenceDb) < 0.01,
    "Shared loop playback must keep its level through transfer: " +
      JSON.stringify(metrics),
  );
  return metrics;
}
async function transfer(page, target, locale, name, lossy = false) {
  await page.locator("#mode-transfer").click();
  const dialog = page.locator(".mode-dialog");
  await dialog.waitFor({ state: "visible" });
  const text = await dialog.innerText(),
    why = await dialog.locator("li").allTextContents();
  if (lossy) {
    for (const pattern of locale === "id"
      ? [
          /Kit/,
          /Tempo/,
          /Susunan/,
          /Step drum/,
          /Bilah/,
          /Kendhang/,
          /bass/,
          /gitar/,
          /Mix|Level/,
          /loop berbeda/,
        ]
      : [
          /kit/,
          /Tempo/,
          /arrangement/,
          /drum/,
          /Bilah/,
          /Kendhang/,
          /bass/,
          /guitar/,
          /mix|level/i,
          /loops across/,
        ])
      assert(new RegExp(pattern.source, "i").test(text), String(pattern));
    assert(why.length >= 10);
  } else
    assert.equal(
      why.length,
      0,
      "Compatible transfer must not claim unsupported differences",
    );
  const geometry = await dialog.evaluate((el) => ({
    left: el.getBoundingClientRect().left,
    right: el.getBoundingClientRect().right,
    viewport: innerWidth,
  }));
  assert(geometry.left >= 0 && geometry.right <= geometry.viewport + 1);
  await page.screenshot({ path: join(output, name + "-dialog.png") });
  await page.locator("#mode-confirm").click();
  await page.waitForURL((url) => url.pathname === pagePath(target, locale));
  await ready(page, target);
  assert.equal(
    await page.evaluate(() => window.__transferStarts),
    0,
    "Receiving a project must not autoplay",
  );
}
async function forwardAndBack(locale, width) {
  const name = `roundtrip-${locale}-${width}`,
    b = beatbox(),
    old = composition(beatbox("Draft Studio tujuan", 4));
  old.playback = { mode: "chain" };
  if (width === 390 || process.env.PERKUSI_TRANSFER_CASE === "quiet")
    for (const track of b.tracks) track.enabled = track.role === "kick";
  if (width === 390) b.export.bars = 4;
  const oldRaw = JSON.stringify(old, null, 3) + "\n",
    savedRaw = JSON.stringify({
      version: 1,
      items: [{ id: "protected-studio-save", project: old }],
    });
  const ctx = await context(width, {
      [draftKey("studio")]: oldRaw,
      [savedKey("studio")]: savedRaw,
    }),
    page = await ctx.newPage();
  try {
    await open(page, "beatbox", locale);
    await imported(page, "beatbox", b);
    await page.locator("#project-save").click();
    const original = await project(page, "beatbox", name + "-source"),
      audio = await wav(page, "beatbox", name + "-source");
    const savedBefore = await page.evaluate(
      (k) => localStorage.getItem(k),
      savedKey("beatbox"),
    );
    await page.locator("#mode-transfer").click();
    await page.locator("#mode-cancel").click();
    assert.equal(
      await page.evaluate((k) => localStorage.getItem(k), KEY),
      null,
    );
    assert.deepEqual(
      await project(page, "beatbox", name + "-cancelled"),
      original,
    );
    await transfer(page, "studio", locale, name + "-forward");
    const studio = await project(page, "studio", name + "-studio");
    assert.deepEqual(toBeatbox(studio, true), original);
    assert.equal(
      Number(await page.locator("#st-master").inputValue()),
      original.master.volume,
    );
    assert.equal(Number(await page.locator("#st-bpm").inputValue()), 96);
    assert.equal(
      await page.locator(".st-chain-slot").count(),
      original.export.bars,
    );
    assert.deepEqual(
      JSON.parse(
        await download(
          page,
          "#mode-original",
          name + "-original-bb.perkusi.json",
        ),
      ),
      original,
    );
    assert.equal(
      (
        await download(
          page,
          "#mode-draft-backup",
          name + "-old-studio.perkusi.json",
        )
      ).toString(),
      oldRaw,
    );
    assert(
      (await page.locator("#mode-draft-list").innerText()).includes(old.title),
    );
    assert.equal(
      await page.evaluate((k) => localStorage.getItem(k), savedKey("studio")),
      savedRaw,
    );
    assert.equal(
      await page.evaluate((k) => localStorage.getItem(k), savedKey("beatbox")),
      savedBefore,
    );
    await page.locator("#st-play").click();
    await page.waitForFunction(() =>
      /Memutar|Playing/.test(document.querySelector("#st-status").textContent),
    );
    await page.locator("#st-pause").click();
    const studioAudio = await wav(page, "studio", name + "-studio"),
      metrics = sameAudio(studioAudio, audio);
    await transfer(page, "beatbox", locale, name + "-back");
    assert.deepEqual(
      await project(page, "beatbox", name + "-returned"),
      original,
    );
    await beatboxControls(page, original);
    sameAudio(await wav(page, "beatbox", name + "-returned"), audio);
    const record = await page.evaluate(
      (k) => JSON.parse(localStorage.getItem(k)),
      KEY,
    );
    assert.equal(record.pending, false);
    assert.equal(
      await page.evaluate((k) => sessionStorage.getItem(k), MARKER),
      null,
    );
    assert(record.originals.length >= 2);
    const originalLabels = await page
      .locator("#mode-original-list")
      .innerText();
    assert(
      originalLabels.includes("Beatbox") && originalLabels.includes("Studio"),
    );
    for (let i = 0; i < record.originals.length; i++) {
      await page.locator("#mode-original-list").selectOption(String(i));
      assert.deepEqual(
        JSON.parse(
          await download(
            page,
            "#mode-original",
            `${name}-protected-${i}.perkusi.json`,
          ),
        ),
        record.originals[i],
      );
    }
    await page.locator('[data-role="snare"]').click();
    const edited = await project(page, "beatbox", name + "-new-edit");
    await page.evaluate(({ key, id }) => sessionStorage.setItem(key, id), {
      key: MARKER,
      id: record.id,
    });
    await page.reload();
    await ready(page, "beatbox");
    assert.deepEqual(
      await project(page, "beatbox", name + "-after-refresh"),
      edited,
    );
    await beatboxControls(page, edited);
    await page.screenshot({ path: join(output, name + "-result.png") });
    evidence.checks.push({
      name,
      result: "PASS",
      metrics,
      protectedOriginals: record.originals.length,
    });
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
async function derived(locale, width) {
  const name = `derived-${locale}-${width}`,
    source = advanced(),
    old = beatbox("Draft Beatbox tujuan", 4),
    raw = JSON.stringify(old, null, 2) + "\n";
  const ctx = await context(width, { [draftKey("beatbox")]: raw }),
    page = await ctx.newPage();
  try {
    await open(page, "studio", locale);
    await imported(page, "studio", source);
    const original = await project(page, "studio", name + "-source");
    await transfer(page, "beatbox", locale, name, true);
    const result = await project(page, "beatbox", name + "-copy");
    assert.equal(result.master.volume, source.master.volume);
    assert.equal(result.timing.bpm, 96);
    assert.equal(result.export.bars, 4);
    for (const t of result.tracks) {
      assert.equal(t.enabled, t.role === "hat");
      assert.equal(t.variant, ["kick", "hat"].includes(t.role) ? 2 : 1);
    }
    await beatboxControls(page, result);
    assert.deepEqual(
      JSON.parse(
        await download(page, "#mode-original", name + "-original.perkusi.json"),
      ),
      original,
    );
    assert.equal(
      (
        await download(
          page,
          "#mode-draft-backup",
          name + "-old-beatbox.perkusi.json",
        )
      ).toString(),
      raw,
    );
    assert(
      (await page.locator("#mode-draft-list").innerText()).includes(old.title),
    );
    await page.screenshot({ path: join(output, name + "-result.png") });
    evidence.checks.push({ name, result: "PASS", sourceFieldsPreserved: true });
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
async function failureCase(kind) {
  const name = "failure-" + kind,
    b = beatbox(),
    old = composition(beatbox("Draft tujuan aman", 4));
  old.playback = { mode: "chain" };
  const raw = JSON.stringify(old);
  const ctx = await context(1440, { [draftKey("studio")]: raw }),
    page = await ctx.newPage();
  try {
    await open(page, "beatbox", "id");
    await imported(page, "beatbox", b);
    const original = await project(page, "beatbox", name + "-source");
    if (kind === "quota") {
      await page.evaluate(() => {
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key === "perkusi.mode-transfer.v3")
            throw new DOMException("Synthetic quota", "QuotaExceededError");
          return set.call(this, key, value);
        };
      });
      await page.locator("#mode-transfer").click();
      await page.locator("#mode-confirm").click();
      await page.waitForFunction(
        () => !document.querySelector(".mode-dialog").open,
      );
      assert(page.url().includes("/beatbox/"));
      assert.deepEqual(
        await project(page, "beatbox", name + "-unchanged"),
        original,
      );
      assert.equal(
        await page.evaluate((k) => localStorage.getItem(k), draftKey("studio")),
        raw,
      );
      assert.equal(
        await page.evaluate((k) => sessionStorage.getItem(k), MARKER),
        null,
      );
    } else {
      const newer = structuredClone(old);
      newer.title = "Edit tujuan yang lebih baru";
      newer.patterns[0].steps.snare[7] = 0.5;
      const newerRaw = JSON.stringify(newer);
      const writer = await ctx.newPage();
      await writer.goto(base + "/privacy.html?lang=id");
      await page.route("**/studio/", async (route) => {
        if (route.request().isNavigationRequest())
          await writer.evaluate(
            ({ key, value }) => localStorage.setItem(key, value),
            { key: draftKey("studio"), value: newerRaw },
          );
        await route.continue();
      });
      await page.locator("#mode-transfer").click();
      await page.locator("#mode-confirm").click();
      await page.waitForURL("**/studio/");
      await ready(page, "studio");
      assert.deepEqual(
        await project(page, "studio", name + "-newer-kept"),
        newer,
      );
      assert.match(
        await page.locator(".mode-transfer").innerText(),
        /belum selesai/,
      );
      assert.deepEqual(
        JSON.parse(
          await download(
            page,
            "#mode-original",
            name + "-original.perkusi.json",
          ),
        ),
        original,
      );
    }
    evidence.checks.push({ name, result: "PASS" });
    console.log("PASS " + name);
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await ctx.close();
  }
}
async function recoveryControls(page, tool, data) {
  if (tool === "beatbox") return beatboxControls(page, data);
  for (const [id, expected] of Object.entries({
    "st-bpm": data.timing.bpm,
    "st-swing": data.timing.swing,
    "st-master": data.master.volume,
  }))
    assert.equal(Number(await page.locator("#" + id).inputValue()), expected);
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
  assert.equal(await page.locator(".st-chain-slot").count(), data.chain.length);
  for (const track of data.tracks) {
    for (const field of ["volume", "pan"])
      assert.equal(
        Number(
          await page.locator(`[data-st-${field}="${track.role}"]`).inputValue(),
        ),
        track[field],
      );
    for (const field of ["mute", "solo"])
      assert.equal(
        await page
          .locator(`[data-st-${field}="${track.role}"]`)
          .getAttribute("aria-pressed"),
        String(track[field]),
      );
  }
}
async function restored(page, tool, expected, raw, audio, name, damaged) {
  const changed = structuredClone(expected);
  changed.title = "Work before recovery";
  changed.master.volume = 0.12;
  await imported(page, tool, changed);
  if (damaged) {
    // A damaged current draft must not stop an explicit valid recovery from surviving reload.
    await page.waitForFunction(
      ({ key, title }) =>
        JSON.parse(localStorage.getItem(key) || "null")?.title === title,
      { key: draftKey(tool), title: changed.title },
    );
    await page.addInitScript((key) => {
      if (sessionStorage.getItem("__damageDraft") === key) {
        sessionStorage.removeItem("__damageDraft");
        localStorage.setItem(key, "{damaged current draft");
      }
    }, draftKey(tool));
    await page.evaluate(
      (key) => sessionStorage.setItem("__damageDraft", key),
      draftKey(tool),
    );
    await page.reload();
    await ready(page, tool);
    assert.equal(
      await page.evaluate((key) => localStorage.getItem(key), draftKey(tool)),
      "{damaged current draft",
    );
  }
  const starts = await page.evaluate(() => window.__transferStarts);
  await imported(page, tool, expected, raw);
  assert.equal(
    await page.evaluate(() => window.__transferStarts),
    starts,
    "Recovery must not autoplay",
  );
  assert.deepEqual(await project(page, tool, name + "-restored"), expected);
  await recoveryControls(page, tool, expected);
  // Refresh before an explicit named save: the restored draft itself must persist.
  await page.reload();
  await ready(page, tool);
  assert.deepEqual(await project(page, tool, name + "-refresh"), expected);
  await recoveryControls(page, tool, expected);
  await page.locator("#" + ids(tool).save).click();
  const saved = await page.locator("#" + ids(tool).list).inputValue();
  assert(saved);
  await imported(page, tool, changed);
  await page.locator("#" + ids(tool).list).selectOption(saved);
  await page.locator("#" + ids(tool).load).click();
  await page.waitForFunction(
    ({ id, title }) => document.querySelector("#" + id).value === title,
    { id: ids(tool).title, title: expected.title },
  );
  assert.deepEqual(await project(page, tool, name + "-saved-load"), expected);
  await recoveryControls(page, tool, expected);
  const after = await wav(page, tool, name + "-restored");
  assert.equal(after.channels, audio.channels);
  const metrics = Array.from({ length: audio.channels }, (_, channel) =>
    sameAudio(after, audio, channel),
  );
  await page.locator(tool === "studio" ? "#st-play" : "#bb-play").click();
  await page.waitForFunction(() => window.__transferStarts > 0, null, {
    timeout: 30000,
  });
  await page.locator(tool === "studio" ? "#st-pause" : "#bb-pause").click();
  return { tool, damagedDraft: damaged, metrics };
}
async function recoverJourney(source, locale, width) {
  const target = source === "beatbox" ? "studio" : "beatbox";
  const name = `recover-${source}-${locale}-${width}`;
  const studio = advanced();
  studio.title = "Restore — Studio lengkap";
  studio.timing.quantize = false;
  studio.playback.mode = locale === "en" ? "chain" : "pattern";
  studio.tracks[0].pan = -0.25;
  studio.tracks[1].mute = true;
  studio.instrument.pan = 0.35;
  studio.bass.volume = 0.41;
  studio.guitar.pan = -0.3;
  const b = beatbox("Restore — Beatbox", width === 390 ? 4 : 8);
  const data = { studio, beatbox: b };
  const raws = Object.fromEntries(
    Object.entries(data).map(([tool, value]) => [
      tool,
      JSON.stringify(value, null, 3) + "\n",
    ]),
  );
  const ctx = await context(
    width,
    Object.fromEntries(
      Object.entries(raws).map(([tool, raw]) => [draftKey(tool), raw]),
    ),
  );
  const page = await ctx.newPage();
  try {
    const baseline = {},
      audio = {};
    for (const tool of [target, source]) {
      await open(page, tool, locale);
      baseline[tool] = await project(page, tool, name + "-baseline-" + tool);
      audio[tool] = await wav(page, tool, name + "-baseline-" + tool);
    }
    const displacedRaw = await page.evaluate(
      (key) => localStorage.getItem(key),
      draftKey(target),
    );
    await transfer(page, target, locale, name, source === "studio");
    if (locale === "en" && width === 1440 && source === "beatbox") {
      await transfer(page, source, locale, name + "-back");
      await transfer(page, target, locale, name + "-again");
    }
    const record = await page.evaluate((key) => localStorage.getItem(key), KEY);
    const retained = JSON.parse(record);
    await page
      .locator("#mode-original-list")
      .selectOption(
        String(
          retained.originals.findIndex(
            (p) =>
              p.title === baseline[source].title &&
              p.schemaVersion === baseline[source].schemaVersion,
          ),
        ),
      );
    await page
      .locator("#mode-draft-list")
      .selectOption(
        String(
          retained.drafts.findIndex(
            (d) => d.target === target && d.raw === displacedRaw,
          ),
        ),
      );
    const originalFile = await download(
      page,
      "#mode-original",
      name + "-original.perkusi.json",
    );
    const draftFile = await download(
      page,
      "#mode-draft-backup",
      name + "-draft.perkusi.json",
    );
    assert.deepEqual(JSON.parse(originalFile), baseline[source]);
    assert.equal(draftFile.toString(), displacedRaw);
    if (recoveryGuidance) {
      for (const [kind, tool] of [
        ["original", source],
        ["draft", target],
      ]) {
        const link = page.locator(`#mode-${kind}-open`);
        const href = new URL(await link.getAttribute("href"), base);
        assert.equal(href.pathname, pagePath(tool, locale));
        assert.equal(
          href.hash,
          tool === "studio" ? "#st-import" : "#project-import",
        );
        assert(
          (await page.locator(`#mode-${kind}-help`).innerText()).includes(
            tool === "studio" ? "Rhythm Studio" : "Beatbox",
          ),
        );
      }
      assert(
        /Impor|Import/.test(
          await page.locator("#mode-recovery-note").innerText(),
        ),
      );
      await page.locator("#mode-recovery").scrollIntoViewIfNeeded();
      assert(
        await page
          .locator("#mode-recovery")
          .evaluate((el) => el.getBoundingClientRect().right <= innerWidth + 1),
      );
      await page.screenshot({ path: join(output, name + "-recovery.png") });
    }
    const restoredCases = [];
    // Restore the complete source in its own tool, then restore the displaced target draft.
    if (recoveryGuidance) {
      await page.locator("#mode-original-open").click();
      await page.waitForURL((url) => url.pathname === pagePath(source, locale));
      await ready(page, source);
    } else await open(page, source, locale);
    restoredCases.push(
      await restored(
        page,
        source,
        baseline[source],
        originalFile,
        audio[source],
        name + "-original",
        width === 390,
      ),
    );
    if (recoveryGuidance) {
      await page.locator("#mode-draft-open").click();
      await page.waitForURL((url) => url.pathname === pagePath(target, locale));
      await ready(page, target);
    } else await open(page, target, locale);
    restoredCases.push(
      await restored(
        page,
        target,
        baseline[target],
        draftFile,
        audio[target],
        name + "-draft",
        width === 390,
      ),
    );
    assert.equal(
      await page.evaluate((key) => localStorage.getItem(key), KEY),
      record,
      "Restoring must not modify the protected transfer archive",
    );
    evidence.checks.push({ name, result: "PASS", restored: restoredCases });
    console.log("PASS " + name);
  } catch (error) {
    await writeFile(
      join(output, name + "-failure.txt"),
      await page.locator("body").innerText(),
    );
    await page.screenshot({ path: join(output, name + "-failure.png") });
    throw error;
  } finally {
    await ctx.close();
  }
}
async function recoveryEdge(kind) {
  const name = `recover-${kind}`;
  const legacy = newStudioProject("Legacy Studio draft");
  legacy.timing = { bpm: 123, meter: [4, 4], swing: 0.31, quantize: false };
  legacy.patterns[0].steps.kick[2] = 0.6;
  legacy.tracks[0].pan = -0.4;
  legacy.master.volume = 0.28;
  legacy.chain = ["p1", "p1", "p1"];
  const raw =
    kind === "legacy"
      ? JSON.stringify(legacy, null, 2) + "\n"
      : "{unreadable retained draft\n";
  const key =
    kind === "legacy" ? "perkusi.draft.studio.v2" : draftKey("studio");
  const ctx = await context(390, { [key]: raw }),
    page = await ctx.newPage();
  try {
    await open(page, "beatbox", "id");
    await imported(page, "beatbox", beatbox("Recovery edge source", 4));
    await transfer(page, "studio", "id", name);
    const before = await project(page, "studio", name + "-before");
    const archive = await page.evaluate(
      (key) => localStorage.getItem(key),
      KEY,
    );
    const file = await download(
      page,
      "#mode-draft-backup",
      name + ".perkusi.json",
    );
    assert.equal(file.toString(), raw);
    if (kind === "legacy") {
      assert(await page.locator("#mode-draft-open").isVisible());
      await page.locator("#mode-draft-open").click();
      const chooser = page.waitForEvent("filechooser");
      await page.locator("#st-import").click();
      await (
        await chooser
      ).setFiles({
        name: "legacy.perkusi.json",
        mimeType: "application/json",
        buffer: file,
      });
      await page.waitForFunction(
        (title) => document.querySelector("#st-title").value === title,
        legacy.title,
      );
      assert.deepEqual(
        studioView(await project(page, "studio", name + "-restored")),
        legacy,
      );
      await page.reload();
      await ready(page, "studio");
      assert.deepEqual(
        studioView(await project(page, "studio", name + "-refresh")),
        legacy,
      );
      assert.equal(
        await page.evaluate((key) => localStorage.getItem(key), key),
        raw,
      );
    } else {
      assert(await page.locator("#mode-draft-open").isHidden());
      assert(
        /tidak dapat dibaca/.test(
          await page.locator("#mode-draft-help").innerText(),
        ),
      );
      const chooser = page.waitForEvent("filechooser");
      await page.locator("#st-import").click();
      await (
        await chooser
      ).setFiles({
        name: "bad.perkusi.json",
        mimeType: "application/json",
        buffer: file,
      });
      await page.waitForFunction(
        () =>
          document.querySelector("#st-project-status").getAttribute("role") ===
          "alert",
        null,
        { timeout: 10000 },
      );
      assert.deepEqual(
        await project(page, "studio", name + "-after-rejection"),
        before,
      );
      await page.reload();
      await ready(page, "studio");
      assert.deepEqual(
        await project(page, "studio", name + "-refresh"),
        before,
      );
    }
    assert.equal(
      await page.evaluate((key) => localStorage.getItem(key), KEY),
      archive,
    );
    evidence.checks.push({ name, result: "PASS", rawBytesPreserved: true });
    console.log("PASS " + name);
  } finally {
    await ctx.close();
  }
}
const protectedKeys = [
  draftKey("beatbox"),
  draftKey("studio"),
  "perkusi.draft.studio.v2",
  savedKey("beatbox"),
  savedKey("studio"),
  "perkusi.projects.studio.v2",
  "perkusi.qa.preference",
];
const receiptKeys = ["studio", "beatbox"].map(
  (tool) => `perkusi.mode-transfer.receipt.${tool}.v1`,
);
function clearSeed() {
  const b = beatbox("Saved Beatbox before clear", 4),
    s = advanced(),
    legacy = newStudioProject("Saved legacy Studio");
  s.title = "Saved full Studio before clear";
  legacy.timing.bpm = 123;
  legacy.patterns[0].steps.kick[0] = 0.65;
  return {
    [draftKey("beatbox")]: JSON.stringify(b),
    [draftKey("studio")]: JSON.stringify(s),
    "perkusi.draft.studio.v2": JSON.stringify(legacy),
    [savedKey("beatbox")]: JSON.stringify({
      version: 1,
      items: [{ id: "protected-bb", project: b }],
    }),
    [savedKey("studio")]: JSON.stringify({
      version: 1,
      items: [{ id: "protected-studio", project: s }],
    }),
    "perkusi.projects.studio.v2": JSON.stringify({
      version: 1,
      items: [{ id: "protected-legacy", project: legacy }],
    }),
    "perkusi.qa.preference": "keep-this-preference",
  };
}
async function rawValues(page, keys) {
  return page.evaluate(
    (keys) =>
      Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])),
    keys,
  );
}
async function clearSetup(tool, locale, width) {
  const seed = clearSeed(),
    ctx = await context(width, seed),
    page = await ctx.newPage();
  const source = tool === "studio" ? "beatbox" : "studio";
  await open(page, source, locale);
  const p =
    source === "beatbox"
      ? beatbox("Active project after switching", 4)
      : advanced();
  p.title = "Active project after switching";
  await imported(page, source, p);
  await transfer(
    page,
    tool,
    locale,
    `clear-${tool}-${locale}-${width}-setup`,
    source === "studio",
  );
  return { seed, ctx, page, source };
}
async function confirmClear(page, accept, whileOpen = () => {}) {
  page.removeAllListeners("dialog");
  const event = page.waitForEvent("dialog"),
    click = page.locator("#mode-clear-backups").click();
  const dialog = await event;
  assert.equal(dialog.type(), "confirm");
  if (clearCopy) {
    assert(
      /Beatbox/.test(dialog.message()) &&
        /Rhythm Studio/.test(dialog.message()),
    );
    assert(
      /aktif|current/i.test(dialog.message()) &&
        /tersimpan|saved/i.test(dialog.message()),
    );
  }
  try {
    await whileOpen();
  } finally {
    accept ? await dialog.accept() : await dialog.dismiss();
  }
  await click;
}
async function clearNormal(tool, locale, width) {
  const name = `clear-${tool}-${locale}-${width}`,
    { seed, ctx, page, source } = await clearSetup(tool, locale, width);
  try {
    const active = await project(page, tool, name + "-active-before"),
      audio = await wav(page, tool, name + "-before");
    await download(page, "#mode-original", name + "-original.perkusi.json");
    await download(page, "#mode-draft-backup", name + "-draft.perkusi.json");
    const protectedBefore = await rawValues(page, protectedKeys),
      metadata = await rawValues(page, [KEY, ...receiptKeys]);
    await page.locator("#mode-clear-backups").scrollIntoViewIfNeeded();
    assert(
      await page.locator("#mode-clear-backups").evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth + 1;
      }),
      "The clear action must fit the phone viewport",
    );
    await page.screenshot({ path: join(output, name + "-before.png") });
    await confirmClear(page, false);
    assert.deepEqual(
      await rawValues(page, [KEY, ...receiptKeys]),
      metadata,
      "Cancel must keep every transfer backup and receipt",
    );
    assert.deepEqual(await rawValues(page, protectedKeys), protectedBefore);
    await confirmClear(page, true);
    await page.waitForFunction(
      () => document.querySelector("#mode-clear-backups").hidden,
    );
    for (const raw of Object.values(
      await rawValues(page, [KEY, ...receiptKeys]),
    ))
      assert.equal(raw, null);
    assert.equal(
      await page.evaluate((key) => sessionStorage.getItem(key), MARKER),
      null,
    );
    assert(await page.locator("#mode-recovery").isHidden());
    assert(await page.locator("#mode-clear-backups").isHidden());
    assert.deepEqual(
      await rawValues(page, protectedKeys),
      protectedBefore,
      "Clear must not touch active drafts, named projects, legacy projects or preferences",
    );
    if (clearCopy) {
      assert(
        /dihapus|deleted/i.test(await page.locator("#mode-status").innerText()),
      );
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "mode-transfer",
      );
    }
    assert.deepEqual(await project(page, tool, name + "-active-after"), active);
    if (clearCopy) await page.locator("#mode-status").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, name + "-after.png") });
    await page.reload();
    await ready(page, tool);
    assert.deepEqual(
      await project(page, tool, name + "-active-refresh"),
      active,
    );
    await recoveryControls(page, tool, active);
    const after = await wav(page, tool, name + "-after");
    assert.equal(after.channels, audio.channels);
    const metrics = Array.from({ length: audio.channels }, (_, channel) =>
      sameAudio(after, audio, channel),
    );
    // Existing regular and legacy saves can still be loaded after deleting transfer archives.
    for (const owner of [tool, source]) {
      await open(page, owner, locale);
      await page
        .locator("#" + ids(owner).list)
        .selectOption(owner === "studio" ? "protected-studio" : "protected-bb");
      await page.locator("#" + ids(owner).load).click();
      const expected = JSON.parse(seed[savedKey(owner)]).items[0].project;
      await page.waitForFunction(
        ({ id, title }) => document.querySelector("#" + id).value === title,
        { id: ids(owner).title, title: expected.title },
      );
      assert.deepEqual(
        await project(page, owner, name + "-saved-" + owner),
        expected,
      );
      if (owner === "studio") {
        await page
          .locator("#st-saved")
          .selectOption("legacy0-protected-legacy");
        await page.locator("#st-load").click();
        const legacy = JSON.parse(seed["perkusi.projects.studio.v2"]).items[0]
          .project;
        await page.waitForFunction(
          (title) => document.querySelector("#st-title").value === title,
          legacy.title,
        );
        assert.deepEqual(
          studioView(await project(page, owner, name + "-saved-legacy")),
          legacy,
        );
      }
    }
    for (const key of [
      savedKey("studio"),
      savedKey("beatbox"),
      "perkusi.projects.studio.v2",
    ])
      assert.equal((await rawValues(page, [key]))[key], seed[key]);
    // Starting a new transfer after clearing must work with a new, bounded archive.
    await page.locator("#mode-transfer").click();
    await page.locator("#mode-confirm").click();
    await page.waitForURL((url) => url.pathname === pagePath(tool, locale));
    await ready(page, tool);
    const fresh = JSON.parse((await rawValues(page, [KEY]))[KEY]);
    assert.equal(fresh.originals.length, 1);
    assert.notEqual(fresh.id, JSON.parse(metadata[KEY]).id);
    evidence.checks.push({
      name,
      result: "PASS",
      metrics,
      regularAndLegacySavesPreserved: true,
    });
    console.log("PASS " + name);
  } finally {
    await ctx.close();
  }
}
async function clearFailure(tool, kind) {
  const name = `clear-${kind}-${tool}`,
    { ctx, page } = await clearSetup(tool, "id", 1440);
  try {
    const writer = kind === "changed" ? await ctx.newPage() : null;
    if (writer) {
      await writer.goto(base + "/privacy.html");
      await page.bringToFront();
    }
    const active = await project(page, tool, name + "-active-before"),
      before = await rawValues(page, protectedKeys);
    let raw = (await rawValues(page, [KEY]))[KEY];
    if (kind === "pending") {
      raw = JSON.stringify({ ...JSON.parse(raw), pending: true });
      await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
        key: KEY,
        raw,
      });
      page.removeAllListeners("dialog");
      let prompts = 0;
      page.on("dialog", (d) => {
        prompts++;
        return d.dismiss();
      });
      await page.locator("#mode-clear-backups").click();
      assert.equal(
        prompts,
        0,
        "A pending transfer must refuse clear before confirmation",
      );
    } else if (kind === "changed") {
      const record = JSON.parse(raw),
        original = { ...record.original, title: "New source from another tab" };
      raw = JSON.stringify({
        ...record,
        id: "new-transfer-while-confirming",
        pending: true,
        original,
        originals: [...record.originals, original],
        candidate: { ...record.candidate, title: original.title },
      });
      await confirmClear(page, true, () =>
        writer.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
          key: KEY,
          raw,
        }),
      );
      await writer.close();
    } else {
      await page.evaluate((key) => {
        sessionStorage.setItem(key, "stale-clear-marker");
        const remove = Storage.prototype.removeItem;
        Storage.prototype.removeItem = function (name) {
          if (this === sessionStorage && name === key)
            throw new DOMException("Removal denied", "SecurityError");
          return remove.call(this, name);
        };
      }, MARKER);
      await confirmClear(page, true);
      assert.equal(
        await page.evaluate((key) => sessionStorage.getItem(key), MARKER),
        "stale-clear-marker",
      );
    }
    if (clearCopy)
      await page.waitForFunction(
        () =>
          document.querySelector("#mode-status")?.getAttribute("role") ===
          "alert",
      );
    assert.equal(
      (await rawValues(page, [KEY]))[KEY] === raw,
      true,
      "Refused or failed clear must retain the transfer archive",
    );
    assert.deepEqual(await rawValues(page, protectedKeys), before);
    assert.deepEqual(await project(page, tool, name + "-active-after"), active);
    evidence.checks.push({
      name,
      result: "PASS",
      activeAndSavedWorkPreserved: true,
    });
    console.log("PASS " + name);
  } finally {
    await ctx.close();
  }
}
function savedDeleteSeed() {
  const seed = clearSeed();
  for (const tool of ["beatbox", "studio"]) {
    const baseProject =
      tool === "beatbox" ? beatbox("Simpanan — $&", 4) : advanced();
    baseProject.title = "Simpanan — $&";
    const items = ["target", "same-name", "other"].map((id, i) => {
      const project = structuredClone(baseProject);
      if (i === 2) project.title = "Simpanan lainnya";
      project.master.volume = 0.21 + i * 0.1;
      return { id, project };
    });
    seed[savedKey(tool)] = JSON.stringify({ version: 1, items });
    seed[draftKey(tool)] = JSON.stringify(baseProject);
  }
  const original = beatbox("Protected transfer original", 4),
    destinationDraft = seed[draftKey("studio")];
  seed[KEY] = JSON.stringify({
    version: 4,
    id: "saved-delete-history",
    target: "studio",
    pending: false,
    original,
    originals: [original],
    candidate: fromBeatbox(original),
    destinationDraft,
    drafts: [
      { target: "studio", key: draftKey("studio"), raw: destinationDraft },
    ],
  });
  return seed;
}
async function savedDeleteSetup(tool, locale, width) {
  const seed = savedDeleteSeed(),
    ctx = await context(width, seed),
    page = await ctx.newPage();
  await open(page, tool, locale);
  await page.locator("#" + ids(tool).list).selectOption("target");
  await page.locator("#" + ids(tool).load).click();
  await page.waitForFunction(
    (id) => !document.querySelector("#" + id).disabled,
    ids(tool).file,
  );
  // Keep unsaved edits to the loaded project's beat while removing only its saved copy.
  await page
    .locator(
      tool === "studio" ? '[data-st-step="kick:0"]' : '[data-role="kick"]',
    )
    .click();
  return { seed, ctx, page };
}
async function confirmSavedDelete(
  page,
  tool,
  accept,
  title,
  whileOpen = () => {},
) {
  page.removeAllListeners("dialog");
  const event = page.waitForEvent("dialog"),
    click = page.locator("#" + ids(tool).delete).click();
  const dialog = await event;
  assert.equal(dialog.type(), "confirm");
  if (deleteCopy) {
    assert(
      dialog.message().includes(title),
      "Delete confirmation must name the chosen project, including literal dollar signs",
    );
    assert(/aktif|current|active/i.test(dialog.message()));
    assert(/lain|other/i.test(dialog.message()));
  }
  try {
    await whileOpen();
  } finally {
    accept ? await dialog.accept() : await dialog.dismiss();
  }
  await click;
  page.on("dialog", (d) => d.accept());
}
async function savedDraftReady(page, tool, expected) {
  await page.waitForFunction(
    ({ key, expected }) => {
      const sorted = (value) =>
        Array.isArray(value)
          ? value.map(sorted)
          : value && typeof value === "object"
            ? Object.fromEntries(
                Object.keys(value)
                  .sort()
                  .map((key) => [key, sorted(value[key])]),
              )
            : value;
      try {
        return (
          JSON.stringify(sorted(JSON.parse(localStorage.getItem(key)))) ===
          JSON.stringify(sorted(expected))
        );
      } catch {
        return false;
      }
    },
    { key: draftKey(tool), expected },
  );
}
async function savedDeleteNormal(tool, locale, width) {
  const name = `delete-${tool}-${locale}-${width}`,
    { seed, ctx, page } = await savedDeleteSetup(tool, locale, width);
  try {
    const active = await project(page, tool, name + "-active-before"),
      audio = await wav(page, tool, name + "-before");
    await savedDraftReady(page, tool, active);
    const saved = JSON.parse(seed[savedKey(tool)]),
      unchangedKeys = [
        ...protectedKeys.filter((key) => key !== savedKey(tool)),
        KEY,
      ];
    const protectedBefore = await rawValues(page, unchangedKeys);
    if (tool === "studio" && deleteCopy) {
      for (const id of ["legacy0-protected-legacy", "legacy1-target"]) {
        await page.locator("#st-saved").selectOption(id);
        assert(await page.locator("#st-saved-delete").isDisabled());
        assert(await page.locator("#st-saved-delete-hint").isVisible());
        assert.equal(
          await page.locator("#st-saved").getAttribute("aria-describedby"),
          "st-saved-delete-hint",
        );
      }
      await page.locator("#st-saved").selectOption("target");
      assert(await page.locator("#st-saved-delete").isEnabled());
      assert.equal(
        await page.locator("#st-saved-delete").getAttribute("aria-describedby"),
        null,
      );
    }
    await confirmSavedDelete(page, tool, false, saved.items[0].project.title);
    assert.equal(
      (await rawValues(page, [savedKey(tool)]))[savedKey(tool)],
      seed[savedKey(tool)],
    );
    await confirmSavedDelete(page, tool, true, saved.items[0].project.title);
    await page.waitForFunction(
      (key) =>
        !JSON.parse(localStorage.getItem(key)).items.some(
          (item) => item.id === "target",
        ),
      savedKey(tool),
    );
    assert.deepEqual(
      JSON.parse((await rawValues(page, [savedKey(tool)]))[savedKey(tool)]),
      { ...saved, items: saved.items.slice(1) },
    );
    assert.deepEqual(
      await rawValues(page, unchangedKeys),
      protectedBefore,
      "Deleting a saved copy must preserve active drafts, other stores and transfer archives",
    );
    assert.deepEqual(await project(page, tool, name + "-active-after"), active);
    await page.reload();
    await ready(page, tool);
    assert.deepEqual(
      await project(page, tool, name + "-active-refresh"),
      active,
    );
    const after = await wav(page, tool, name + "-after");
    assert.equal(after.channels, audio.channels);
    const metrics = Array.from({ length: audio.channels }, (_, channel) =>
      sameAudio(after, audio, channel),
    );
    for (const item of saved.items.slice(1)) {
      await page.locator("#" + ids(tool).list).selectOption(item.id);
      await page.locator("#" + ids(tool).load).click();
      await page.waitForFunction(
        ({ id, title }) => document.querySelector("#" + id).value === title,
        { id: ids(tool).title, title: item.project.title },
      );
      assert.deepEqual(
        await project(page, tool, name + "-remaining-" + item.id),
        item.project,
      );
    }
    if (tool === "studio") {
      await page.locator("#st-saved").selectOption("legacy0-protected-legacy");
      await page.locator("#st-load").click();
      const legacy = JSON.parse(seed["perkusi.projects.studio.v2"]).items[0]
        .project;
      await page.waitForFunction(
        (title) => document.querySelector("#st-title").value === title,
        legacy.title,
      );
      assert.deepEqual(
        studioView(await project(page, tool, name + "-legacy")),
        legacy,
      );
    }
    await page.locator("#" + ids(tool).save).click();
    assert.equal(
      JSON.parse((await rawValues(page, [savedKey(tool)]))[savedKey(tool)])
        .items.length,
      3,
    );
    evidence.checks.push({
      name,
      result: "PASS",
      metrics,
      sameNameSiblingPreserved: true,
    });
    console.log("PASS " + name);
  } finally {
    await ctx.close();
  }
}
async function savedDeleteFailure(tool, kind) {
  const name = `delete-${kind}-${tool}`,
    { seed, ctx, page } = await savedDeleteSetup(tool, "id", 1440);
  try {
    const writer = kind === "denied" ? null : await ctx.newPage();
    if (writer) {
      await writer.goto(base + "/privacy.html");
      await page.bringToFront();
    }
    const active = await project(page, tool, name + "-active-before");
    await savedDraftReady(page, tool, active);
    const before = await rawValues(page, [
      ...protectedKeys.filter((key) => key !== savedKey(tool)),
      KEY,
    ]);
    const saved = JSON.parse(seed[savedKey(tool)]);
    let expected = structuredClone(saved);
    if (kind === "sibling") {
      expected.items.push({
        id: "new-from-tab",
        project: {
          ...saved.items[2].project,
          title: "New save from another tab",
        },
      });
      expected.items[2].project.master.volume = 0.16;
    } else if (kind === "changed") {
      expected.items[0].project.title = "Updated chosen project";
      expected.items[0].project.master.volume = 0.17;
    } else if (kind === "missing")
      expected.items = expected.items.filter((item) => item.id !== "target");
    else
      await page.evaluate((key) => {
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (name, value) {
          if (name === key)
            throw new DOMException("Write denied", "QuotaExceededError");
          return set.call(this, name, value);
        };
      }, savedKey(tool));
    await confirmSavedDelete(
      page,
      tool,
      true,
      saved.items[0].project.title,
      async () => {
        if (writer)
          await writer.evaluate(
            ({ key, raw }) => localStorage.setItem(key, raw),
            { key: savedKey(tool), raw: JSON.stringify(expected) },
          );
      },
    );
    if (kind === "sibling") {
      expected.items = expected.items.filter((item) => item.id !== "target");
      await page.waitForFunction(
        (key) =>
          !JSON.parse(localStorage.getItem(key)).items.some(
            (item) => item.id === "target",
          ),
        savedKey(tool),
      );
    } else if (deleteCopy) {
      await page.waitForFunction(
        (id) =>
          document.querySelector("#" + id).getAttribute("role") === "alert",
        tool === "studio" ? "st-project-status" : "project-status",
      );
    }
    assert.deepEqual(
      JSON.parse((await rawValues(page, [savedKey(tool)]))[savedKey(tool)]),
      expected,
      "Only the confirmed unchanged project may be removed; other tabs' saves must survive",
    );
    assert.deepEqual(await rawValues(page, Object.keys(before)), before);
    assert.deepEqual(await project(page, tool, name + "-active-after"), active);
    evidence.checks.push({
      name,
      result: "PASS",
      activeAndOtherSavesPreserved: true,
    });
    console.log("PASS " + name);
  } finally {
    await ctx.close();
  }
}
async function confirmSavedLoad(
  page,
  tool,
  accept,
  title,
  name,
  whileOpen = () => {},
  trigger = () => page.locator("#" + ids(tool).load).click(),
) {
  page.removeAllListeners("dialog");
  const event = page
      .waitForEvent("dialog", { timeout: 5000 })
      .catch(() => null),
    click = trigger();
  const dialog = await event;
  if (!dialog) {
    await click;
    await project(page, tool, name + "-without-confirmation");
    throw new Error(
      "Loading a saved project replaced active edits without confirmation",
    );
  }
  assert.equal(dialog.type(), "confirm");
  if (loadCopy) {
    assert(
      dialog.message().includes(title),
      "Load confirmation must name the chosen save",
    );
    assert(/aktif|current|active/i.test(dialog.message()));
    assert(/[Uu]nduh|[Dd]ownload/.test(dialog.message()));
  }
  try {
    await whileOpen();
  } finally {
    accept ? await dialog.accept() : await dialog.dismiss();
  }
  const result = await click;
  page.on("dialog", (d) => d.accept());
  return result;
}
async function savedLoadNormal(tool, locale, width) {
  const name = `load-${tool}-${locale}-${width}`,
    seed = savedDeleteSeed(),
    ctx = await context(width, seed),
    page = await ctx.newPage();
  try {
    await open(page, tool, locale);
    await page.locator("#" + ids(tool).list).selectOption("target");
    await page.locator("#" + ids(tool).load).click();
    await page.waitForFunction(
      ({ id, volume }) =>
        Number(document.querySelector("#" + id).value) === volume,
      {
        id: tool === "studio" ? "st-master" : "bb-volume",
        volume: JSON.parse(seed[savedKey(tool)]).items[0].project.master.volume,
      },
    );
    await page.waitForFunction(
      (id) => !document.querySelector("#" + id).disabled,
      ids(tool).file,
    );
    const chosen = await project(page, tool, name + "-chosen"),
      audio = await wav(page, tool, name + "-chosen");
    if (width === 390 && tool === "studio")
      await page.locator("#st-chain-mode").click();
    else if (width === 390)
      await page.locator("#project-bars").selectOption("8");
    else {
      await page
        .locator("#" + ids(tool).title)
        .fill("Active edits before load — $&");
      if (locale === "id")
        await page
          .locator(
            tool === "studio"
              ? '[data-st-step="kick:0"]'
              : '[data-role="kick"]',
          )
          .click();
    }
    const active = await project(page, tool, name + "-active-before");
    assert.notDeepEqual(active, chosen);
    await savedDraftReady(page, tool, active);
    await page.reload();
    await ready(page, tool);
    assert.deepEqual(
      await project(page, tool, name + "-active-restored"),
      active,
    );
    await page.locator("#" + ids(tool).list).selectOption("target");
    const protectedBefore = await rawValues(page, [...protectedKeys, KEY]);
    await confirmSavedLoad(page, tool, false, chosen.title, name);
    assert.deepEqual(await project(page, tool, name + "-cancelled"), active);
    assert.deepEqual(
      await rawValues(page, [...protectedKeys, KEY]),
      protectedBefore,
    );
    await page.reload();
    await ready(page, tool);
    assert.deepEqual(
      await project(page, tool, name + "-cancel-refresh"),
      active,
    );
    await page.locator("#" + ids(tool).list).selectOption("target");
    const starts = await page.evaluate(() => window.__transferStarts);
    await confirmSavedLoad(page, tool, true, chosen.title, name);
    await savedDraftReady(page, tool, chosen);
    await page.waitForFunction(
      ({ id, title }) => document.querySelector("#" + id).value === title,
      { id: ids(tool).title, title: chosen.title },
    );
    assert.deepEqual(await project(page, tool, name + "-loaded"), chosen);
    assert.equal(await page.evaluate(() => window.__transferStarts), starts);
    await recoveryControls(page, tool, chosen);
    const unchanged = [
      ...protectedKeys.filter((key) => key !== draftKey(tool)),
      KEY,
    ];
    assert.deepEqual(
      await rawValues(page, unchanged),
      Object.fromEntries(unchanged.map((key) => [key, protectedBefore[key]])),
    );
    await page.reload();
    await ready(page, tool);
    assert.deepEqual(
      await project(page, tool, name + "-loaded-refresh"),
      chosen,
    );
    const after = await wav(page, tool, name + "-loaded");
    assert.equal(after.channels, audio.channels);
    const metrics = Array.from({ length: audio.channels }, (_, channel) =>
      sameAudio(after, audio, channel),
    );
    if (tool === "studio") {
      await page.locator("#st-saved").selectOption("legacy0-protected-legacy");
      const legacy = JSON.parse(seed["perkusi.projects.studio.v2"]).items[0]
        .project;
      await confirmSavedLoad(page, tool, true, legacy.title, name + "-legacy");
      await page.waitForFunction(
        (title) => document.querySelector("#st-title").value === title,
        legacy.title,
      );
      assert.deepEqual(
        studioView(await project(page, tool, name + "-legacy")),
        legacy,
      );
      await page.locator("#st-saved").selectOption("legacy1-target");
      const b = JSON.parse(seed[savedKey("beatbox")]).items[0].project;
      await confirmSavedLoad(page, tool, true, b.title, name + "-bb-original");
      await page.waitForFunction(
        (title) => document.querySelector("#st-title").value === title,
        b.title,
      );
      assert.deepEqual(
        toBeatbox(await project(page, tool, name + "-bb-original")),
        b,
      );
    }
    evidence.checks.push({
      name,
      result: "PASS",
      metrics,
      restoredEditsConfirmed: true,
    });
    console.log("PASS " + name);
  } finally {
    await ctx.close();
  }
}
async function savedLoadFailure(tool, kind) {
  const name = `load-${kind}-${tool}`,
    seed = savedDeleteSeed(),
    ctx = await context(1440, seed),
    page = await ctx.newPage();
  try {
    await open(page, tool, "id");
    await page
      .locator("#" + ids(tool).title)
      .fill("Active before guarded load");
    const active = await project(page, tool, name + "-active-before");
    if (kind !== "immediate") await savedDraftReady(page, tool, active);
    await page.locator("#" + ids(tool).list).selectOption("target");
    const selected = JSON.parse(seed[savedKey(tool)]).items[0].project;
    if (kind === "immediate") {
      active.title = "Fresh edit before Load — $&";
      const persisted = await confirmSavedLoad(
        page,
        tool,
        false,
        selected.title,
        name,
        () => {},
        () =>
          page.evaluate(
            ({ titleId, loadId, key, title }) => {
              const input = document.querySelector("#" + titleId);
              input.value = title;
              input.dispatchEvent(new Event("input", { bubbles: true }));
              const slot = Object.keys(localStorage).find((name) =>
                name.startsWith(`${key}.pending.`),
              );
              const raw = slot
                ? JSON.parse(localStorage.getItem(slot)).raw
                : localStorage.getItem(key);
              const persisted = JSON.parse(raw)?.title === title;
              document.querySelector("#" + loadId).click();
              return persisted;
            },
            {
              titleId: ids(tool).title,
              loadId: ids(tool).load,
              key: draftKey(tool),
              title: active.title,
            },
          ),
      );
      assert.equal(
        persisted,
        true,
        "The fresh edit must be saved before the Load confirmation opens",
      );
      assert.deepEqual(await project(page, tool, name + "-cancelled"), active);
      await page.reload();
      await ready(page, tool);
      assert.deepEqual(await project(page, tool, name + "-refresh"), active);
    } else {
      const writer = kind === "denied" ? null : await ctx.newPage();
      if (writer) {
        await writer.goto(base + "/privacy.html");
        await page.bringToFront();
      }
      const before = await rawValues(page, [...protectedKeys, KEY]);
      const revised = JSON.parse(seed[savedKey(tool)]);
      if (kind === "changed") {
        revised.items[0].project.title = "Changed chosen save";
        revised.items[0].project.master.volume = 0.17;
      } else if (kind === "missing")
        revised.items = revised.items.filter((item) => item.id !== "target");
      else
        await page.evaluate((key) => {
          const get = Storage.prototype.getItem;
          window.__loadOriginalGet = get;
          let reads = 0;
          Storage.prototype.getItem = function (name) {
            if (name === key && ++reads > 1)
              throw new DOMException("Read denied", "SecurityError");
            return get.call(this, name);
          };
        }, savedKey(tool));
      await confirmSavedLoad(
        page,
        tool,
        true,
        selected.title,
        name,
        async () => {
          if (writer)
            await writer.evaluate(
              ({ key, raw }) => localStorage.setItem(key, raw),
              { key: savedKey(tool), raw: JSON.stringify(revised) },
            );
        },
      );
      await page.waitForFunction(
        (id) =>
          document.querySelector("#" + id).getAttribute("role") === "alert",
        tool === "studio" ? "st-project-status" : "project-status",
      );
      if (kind === "denied")
        await page.evaluate(() => {
          Storage.prototype.getItem = window.__loadOriginalGet;
        });
      const after = await rawValues(page, [...protectedKeys, KEY]);
      const expected = {
        ...before,
        [savedKey(tool)]:
          kind === "denied" ? before[savedKey(tool)] : JSON.stringify(revised),
      };
      assert.deepEqual(after, expected);
      assert.deepEqual(
        await project(page, tool, name + "-active-after"),
        active,
      );
    }
    evidence.checks.push({ name, result: "PASS", activeEditsPreserved: true });
    console.log("PASS " + name);
  } finally {
    await ctx.close();
  }
}
try {
  browser = await pw.chromium.launch({ channel: "chrome", headless: true });
  evidence.browser = browser.version();
  if (loadOnly) {
    const only = process.env.PERKUSI_LOAD_CASE;
    if (!only || only === "normal" || only === "one") {
      for (const [locale, width] of [
        ["id", 1440],
        ["en", 1440],
        ["id", 390],
      ]) {
        for (const tool of ["beatbox", "studio"])
          if (
            !process.env.PERKUSI_LOAD_TOOL ||
            process.env.PERKUSI_LOAD_TOOL === tool
          )
            await savedLoadNormal(tool, locale, width);
        if (only === "one") break;
      }
    }
    for (const kind of ["changed", "missing", "denied", "immediate"])
      if (!only || only === kind)
        for (const tool of ["beatbox", "studio"])
          if (
            !process.env.PERKUSI_LOAD_TOOL ||
            process.env.PERKUSI_LOAD_TOOL === tool
          )
            await savedLoadFailure(tool, kind);
  }
  if (deleteOnly) {
    const only = process.env.PERKUSI_DELETE_CASE;
    if (!only || only === "normal")
      for (const [locale, width] of [
        ["id", 1440],
        ["en", 1440],
        ["id", 390],
      ])
        for (const tool of ["beatbox", "studio"])
          await savedDeleteNormal(tool, locale, width);
    for (const kind of ["sibling", "changed", "missing", "denied"])
      if (!only || only === kind)
        for (const tool of ["beatbox", "studio"])
          if (
            !process.env.PERKUSI_DELETE_TOOL ||
            process.env.PERKUSI_DELETE_TOOL === tool
          )
            await savedDeleteFailure(tool, kind);
  }
  if (clearOnly) {
    const only = process.env.PERKUSI_CLEAR_CASE;
    if (!only || only === "normal")
      for (const [locale, width] of [
        ["id", 1440],
        ["en", 1440],
        ["id", 390],
      ])
        for (const tool of ["beatbox", "studio"])
          await clearNormal(tool, locale, width);
    for (const kind of ["pending", "changed", "denied"])
      if (!only || only === kind)
        for (const tool of ["beatbox", "studio"])
          if (
            !process.env.PERKUSI_CLEAR_TOOL ||
            process.env.PERKUSI_CLEAR_TOOL === tool
          )
            await clearFailure(tool, kind);
  }
  if (recoveryOnly) {
    for (const [locale, width] of [
      ["id", 1440],
      ["en", 1440],
      ["id", 390],
    ]) {
      if (process.env.PERKUSI_RECOVERY_CASE === "phone" && width !== 390)
        continue;
      for (const source of ["beatbox", "studio"]) {
        if (
          process.env.PERKUSI_RECOVERY_SOURCE &&
          source !== process.env.PERKUSI_RECOVERY_SOURCE
        )
          continue;
        await recoverJourney(source, locale, width);
        if (process.env.PERKUSI_RECOVERY_CASE === "one") break;
      }
      if (process.env.PERKUSI_RECOVERY_CASE === "one") break;
    }
    if (
      !process.env.PERKUSI_RECOVERY_CASE &&
      !process.env.PERKUSI_RECOVERY_SOURCE
    ) {
      await recoveryEdge("legacy");
      await recoveryEdge("unreadable");
    }
  }
  if (
    !recoveryOnly &&
    !clearOnly &&
    !deleteOnly &&
    !loadOnly &&
    process.env.PERKUSI_TRANSFER_CASE !== "failure"
  )
    for (const [locale, width] of [
      ["id", 1440],
      ["en", 1440],
      ["id", 390],
    ]) {
      await forwardAndBack(locale, width);
      if (["forward", "quiet"].includes(process.env.PERKUSI_TRANSFER_CASE))
        break;
      await derived(locale, width);
    }
  if (
    !recoveryOnly &&
    !clearOnly &&
    !deleteOnly &&
    !loadOnly &&
    (!process.env.PERKUSI_TRANSFER_CASE ||
      process.env.PERKUSI_TRANSFER_CASE === "failure")
  ) {
    await failureCase("quota");
    await failureCase("newer-draft");
  }
  assert.deepEqual(evidence.errors, []);
  evidence.result = "PASS";
} catch (error) {
  evidence.result = "FAIL";
  evidence.failure = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  evidence.files = (await readdir(output)).filter((n) =>
    /\.(wav|perkusi\.json)$/.test(n),
  ).length;
  await writeFile(
    join(output, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  await browser?.close();
  await server?.close();
}
