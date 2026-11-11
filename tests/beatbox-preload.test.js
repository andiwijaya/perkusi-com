import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AudioEngine } from "../src/audio/engine.js";
import { createPackFromCatalog } from "../src/audio/pack-catalog.js";
import { exportBudget, EXPORT_MEMORY_LIMIT } from "../src/audio/exporter.js";
import {
  captureBeatboxProject,
  applyBeatboxProject,
} from "../src/project/beatbox-model.js";
import {
  beatboxPreparationBanks,
  createBeatboxPreload,
} from "../src/beatbox/preload.js";
import { renderBeatbox } from "../src/beatbox/page.js";
const catalog = JSON.parse(
  readFileSync(
    new URL("../internal/original-groove/manifest.json", import.meta.url),
  ),
);
function engine(options = {}) {
  const pack = (variant) =>
    createPackFromCatalog(
      catalog,
      Object.fromEntries(catalog.roleOrder.map((r) => [r, variant])),
      (p) => p,
    );
  return new AudioEngine(pack(1), { variantPacks: [pack(2)], ...options });
}
const flush = async () => {
  for (let n = 0; n < 80; n++) await Promise.resolve();
};
test("Beatbox registry prepares all twelve A/B files, gates 11/12 and retries failure before remaining collection", async () => {
  const e = engine(),
    banks = beatboxPreparationBanks(e),
    tasks = [];
  let active = 0,
    max = 0;
  e.context = { state: "suspended" };
  e.ensureContext = () => e.context;
  for (const bank of Object.values(banks)) {
    bank.verifyRetained = (id) => bank.get(id).buffer;
    bank.load = (id) =>
      new Promise((resolve) => {
        const entry = bank.get(id);
        entry.state = "loading";
        active++;
        max = Math.max(max, active);
        const t = {
          done: false,
          finish(ok = true) {
            if (t.done) return;
            t.done = true;
            active--;
            entry.state = ok ? "ready" : "error";
            entry.buffer = ok ? {} : null;
            resolve(entry.buffer);
          },
          cancel() {
            if (t.done) return;
            t.done = true;
            active--;
            entry.state = "idle";
            resolve(null);
          },
        };
        tasks.push(t);
      });
    bank.cancelLoading = () =>
      tasks.filter((t) => !t.done).forEach((t) => t.cancel());
  }
  assert.equal(
    Object.values(banks).reduce((n, b) => n + b.entries.size, 0),
    12,
  );
  const preload = createBeatboxPreload(e),
    first = preload.start();
  await flush();
  tasks[0].finish(false);
  await assert.rejects(first, /paused/);
  assert.equal(active, 0);
  const retry = preload.retry();
  await flush();
  for (let i = 0; i < 20 && tasks.filter((t) => !t.done).length; i++) {
    const pending = tasks.filter((t) => !t.done);
    if (preload.snapshot().ready + pending.length === 12) {
      pending[0].finish();
      await flush();
      if (preload.snapshot().ready === 11) break;
    } else pending.forEach((t) => t.finish());
    await flush();
  }
  assert.equal(preload.snapshot().ready, 11);
  assert(!preload.isReady());
  tasks.filter((t) => !t.done).forEach((t) => t.finish());
  await retry;
  assert(preload.isReady());
  assert.equal(max, 2);
  preload.dispose();
});
test("A/B, layer state, reset and restored project preserve a managed preload without starting fetch or playback", async () => {
  for (const managed of [false, true]) {
    const e = engine({
      preserveLoadingOnPause: managed,
      preserveLoadingOnSelection: managed,
    });
    let cancelled = 0,
      loaded = 0;
    for (const bank of e.banks) {
      bank.cancel = () => cancelled++;
      bank.cancelLoading = () => cancelled++;
      bank.load = () => {
        loaded++;
        throw Error("unmanaged load");
      };
    }
    e.padReadiness = () => false;
    e.ensureContext = () => {
      throw Error("premature context");
    };
    await e.play();
    assert.equal(e.playbackRequested, false);
    e.context = { state: "suspended", currentTime: 0 };
    e.setLayer("kick", true);
    await e.setVariation("kick", 2);
    assert.equal(e.selectedVariant.get("kick"), 2);
    const p = captureBeatboxProject(e, catalog, "Restored", 8);
    await applyBeatboxProject(e, p, catalog);
    assert.equal(e.selectedVariant.get("kick"), 2);
    assert.equal(e.enabled.get("kick"), true);
    assert.equal(loaded, 0);
    if (managed) assert.equal(cancelled, 0);
    else assert(cancelled > 0);
    e.disposed = true;
    await assert.rejects(e.play(), /Engine disposed/);
  }
});
test("full collection at48k fits existing eight-bar WAV budget with every character active", () => {
  const e = engine();
  for (const role of catalog.roleOrder) e.setLayer(role, true);
  const p = captureBeatboxProject(e, catalog, "Full", 8),
    retained = 12 * 5 * 48000 * 4;
  const budget = exportBudget(p, catalog, retained);
  assert.equal(budget.frames, 960000);
  assert(budget.bytes <= EXPORT_MEMORY_LIMIT);
  assert.equal(retained, 11520000);
});
test("Beatbox indicator precedes three-step guide and includes accessible bilingual count and retry", () => {
  for (const locale of ["id", "en"]) {
    const html = renderBeatbox(locale);
    assert(html.indexOf('class="bb-intro"') < html.indexOf('id="bb-preload"'));
    assert(html.indexOf('id="bb-preload"') < html.indexOf('class="bb-guide"'));
    assert(html.includes('max="12" value="0"'));
    assert(html.includes('aria-atomic="true"'));
    assert(html.includes('id="bb-preload-retry"'));
  }
});
