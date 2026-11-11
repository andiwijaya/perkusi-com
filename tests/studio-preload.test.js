import test from "node:test";
import assert from "node:assert/strict";
import {
  createStudioPreload,
  studioPreparationBanks,
  renderPreparedAudio,
} from "../src/studio/preload.js";
import { renderStudio } from "../src/studio/page.js";
import { AudioEngine } from "../src/audio/engine.js";
import { CompositionPlayback } from "../src/audio/composition.js";
const flush = async () => {
  for (let n = 0; n < 80; n++) await Promise.resolve();
};
function setup() {
  const tasks = [],
    counts = { active: 0, max: 0 },
    engine = {
      context: { state: "suspended" },
      voices: new Set(),
      ensureContext() {
        return this.context;
      },
    };
  function bank(total) {
    const entries = new Map(
      Array.from({ length: total }, (_, n) => [
        String(n),
        { state: "idle", buffer: null },
      ]),
    );
    return {
      entries,
      verifyRetained(id) {
        return entries.get(id).buffer;
      },
      load(id) {
        const e = entries.get(id);
        if (e.buffer) return Promise.resolve(e.buffer);
        let resolve;
        const p = new Promise((r) => (resolve = r));
        const t = {
          bank: this,
          id,
          done: false,
          finish(ok = true) {
            if (t.done) return;
            t.done = true;
            counts.active--;
            e.state = ok ? "ready" : "error";
            e.buffer = ok ? {} : null;
            resolve(e.buffer);
          },
          cancel() {
            if (t.done) return;
            t.done = true;
            counts.active--;
            e.state = "idle";
            resolve(null);
          },
        };
        tasks.push(t);
        counts.active++;
        counts.max = Math.max(counts.max, counts.active);
        e.state = "loading";
        return p;
      },
      cancelLoading() {
        tasks.filter((t) => t.bank === this).forEach((t) => t.cancel());
      },
      evictCache() {
        this.cancelLoading();
        for (const e of entries.values()) {
          e.buffer = null;
          e.state = "idle";
        }
      },
    };
  }
  const kits = [bank(8), bank(8), bank(8)];
  engine.variants = new Map(
    Array.from({ length: 8 }, (_, i) => [
      String(i),
      new Map(kits.map((bank, n) => [n + 1, { bank }])),
    ]),
  );
  const playback = {
      banks: {
        instrument: bank(5),
        kendhang: bank(2),
        bass: bank(3),
        guitar: bank(3),
        loops: [bank(6), bank(6)],
      },
    },
    views = [];
  const preload = createStudioPreload(engine, playback, (v) => views.push(v));
  return { engine, playback, kits, preload, tasks, counts, views };
}
async function complete(f) {
  for (let n = 0; n < 60 && !f.preload.isReady(); n++) {
    await flush();
    for (const t of [...f.tasks]) if (!t.done) t.finish();
    await flush();
  }
}
test("registry deduplicates three kits and prepares all 49 samples, globally gates last file and uses two jobs", async () => {
  const f = setup(),
    banks = studioPreparationBanks(f.engine, f.playback);
  assert.equal(Object.keys(banks).length, 9);
  assert.equal(
    Object.values(banks).reduce((n, b) => n + b.entries.size, 0),
    49,
  );
  const job = f.preload.start();
  await flush();
  assert.equal(f.preload.isReady(), false);
  for (let n = 0; n < 50 && f.tasks.length < 49; n++) {
    for (const t of [...f.tasks]) if (!t.done) t.finish();
    await flush();
  }
  const last = f.tasks.filter((t) => !t.done);
  for (const t of last.slice(0, -1)) t.finish();
  await flush();
  assert.equal(f.preload.snapshot().ready, 48);
  assert.equal(f.preload.isReady(), false);
  last.at(-1).finish();
  await job;
  assert(f.preload.isReady());
  assert.equal(f.counts.max, 2);
  assert.equal(f.tasks.length, 49);
  await f.preload.start();
  assert.equal(f.tasks.length, 49);
  f.preload.dispose();
});
test("first failure cancels other work, retry preserves cache and recovers complete collection", async () => {
  const f = setup(),
    job = f.preload.start();
  await flush();
  f.tasks[0].finish(false);
  await assert.rejects(job, /paused/);
  await flush();
  assert.equal(f.counts.active, 0);
  assert.equal(f.preload.snapshot().state, "error");
  const n = f.tasks.length;
  await flush();
  assert.equal(f.tasks.length, n);
  const retry = f.preload.retry();
  await complete(f);
  await retry;
  assert(f.preload.isReady());
  assert(f.counts.max <= 2);
  f.preload.dispose();
});
test("multiple failed banks recover in order and a failed retry stays recoverable", async () => {
  const f = setup(),
    job = f.preload.start();
  await flush();
  f.tasks[0].finish(false);
  f.tasks[1].finish(false);
  await assert.rejects(job);
  const retry = f.preload.retry();
  await flush();
  f.tasks.find((t) => !t.done).finish(false);
  await retry;
  assert.equal(f.preload.snapshot().state, "error");
  const second = f.preload.retry();
  await complete(f);
  await second;
  assert(f.preload.isReady());
  f.preload.dispose();
});
test("context invalidation/disposal settle waiters and fence obsolete progress", async () => {
  const f = setup(),
    job = f.preload.start();
  await flush();
  f.preload.invalidate();
  await assert.rejects(job);
  assert(!f.preload.isReady());
  f.engine.context = { state: "running" };
  const next = f.preload.retry();
  await complete(f);
  await next;
  assert(f.preload.isReady());
  f.preload.releaseIdle();
  const last = f.preload.start();
  await flush();
  f.preload.dispose();
  await assert.rejects(last);
  assert.equal(f.counts.active, 0);
});
test("idle release preserves banks backing live voices and restores readiness after render budget recovery", async () => {
  const f = setup(),
    job = f.preload.start();
  await complete(f);
  await job;
  const protectedBuffer = f.kits[0].entries.get("0").buffer;
  f.engine.voices.add({ source: { buffer: protectedBuffer } });
  let attempts = 0;
  const exporter = {
    async render() {
      attempts++;
      if (attempts === 1)
        throw Object.assign(new Error("limit"), { code: "exportLimit" });
      assert.equal(f.kits[0].entries.get("0").buffer, protectedBuffer);
      assert.equal(f.kits[1].entries.get("0").buffer, null);
      return { blob: "result" };
    },
  };
  const rendered = renderPreparedAudio(f.preload, exporter, {}, () => {});
  await flush();
  await complete(f);
  assert.deepEqual(await rendered, { blob: "result" });
  assert(f.preload.isReady());
  assert.equal(attempts, 2);
  f.preload.dispose();
});
test("ordinary playback errors do not release cache or retry rendering", async () => {
  let releases = 0;
  const preload = {
    releaseIdle() {
      releases++;
    },
  };
  await assert.rejects(
    renderPreparedAudio(
      preload,
      {
        render: async () => {
          throw Object.assign(new Error("cancel"), { code: "cancelled" });
        },
      },
      {},
      () => {},
    ),
    /cancel/,
  );
  assert.equal(releases, 0);
});
test("engine pause retains loading only when explicitly configured", () => {
  const pack = {
    schemaVersion: 1,
    id: "pause-test",
    bpm: 120,
    beatsPerBar: 4,
    bars: 1,
    stems: [{ id: "kick", url: "test.wav", licenseId: "test", gainTrim: 0.1 }],
  };
  for (const enabled of [false, true]) {
    const engine = new AudioEngine(pack, { preserveLoadingOnPause: enabled });
    let cancelled = 0;
    engine.bank.cancelLoading = () => cancelled++;
    engine.pause();
    engine.rewind();
    assert.equal(cancelled, enabled ? 0 : 2);
  }
});

test("engine and composition audition paths cannot bypass preparation gate", async () => {
  const engine = Object.assign(Object.create(AudioEngine.prototype), {
    sequence: {},
    padReadiness: () => false,
    ensureContext() {
      throw Error("premature context or load");
    },
  });
  await engine.triggerPad("kick");
  await CompositionPlayback.prototype.pad.call({ engine }, "d4", "bilah");
});
test("preload indicator is between intro and laptop note, with progress and accessible ID/EN copy", () => {
  for (const locale of ["id", "en"]) {
    const html = renderStudio(locale);
    assert(html.indexOf('class="st-intro"') < html.indexOf('id="st-preload"'));
    assert(html.indexOf('id="st-preload"') < html.indexOf('id="st-desktop"'));
    assert(html.includes('max="49" value="0"'));
    assert(html.includes('id="st-preload-status"'));
    assert(html.includes('aria-atomic="true"'));
  }
});
