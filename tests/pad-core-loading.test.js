import test from "node:test";
import assert from "node:assert/strict";
import { createCoreLoading } from "../src/pads/core-loading.js";
import { CORE_GROUPS, renderCoreStatus } from "../src/pads/core-page.js";
import { renderPadStation } from "../src/pads/page.js";
import { renderPadGroups } from "../src/studio/live-pads.js";
import { createPadOwner } from "../src/pads/owner.js";
const flush = async () => {
  for (let n = 0; n < 50; n++) await Promise.resolve();
};
function setup() {
  const tasks = [],
    views = [],
    banks = {},
    counts = { active: 0, max: 0, ready: 0, blocked: 0 };
  const f = { context: { state: "suspended" } };
  for (const [family, total] of Object.entries({
    drum: 3,
    bilah: 2,
    kendhang: 1,
    bass: 1,
    guitar: 1,
  })) {
    const entries = new Map(
      Array.from({ length: total }, (_, n) => [
        String(n),
        { state: "idle", buffer: null },
      ]),
    );
    banks[family] = {
      entries,
      verifyRetained(id) {
        return entries.get(id).buffer;
      },
      load(id) {
        const entry = entries.get(id);
        if (entry.buffer) return Promise.resolve(entry.buffer);
        let resolve;
        const promise = new Promise((r) => (resolve = r));
        const task = {
          family,
          id,
          entry,
          done: false,
          cancelled: false,
          finish(success = true) {
            if (task.done) return;
            task.done = true;
            counts.active--;
            entry.state = success ? "ready" : "error";
            entry.buffer = success ? {} : null;
            resolve(entry.buffer);
          },
          cancel() {
            if (task.done) return;
            task.done = true;
            task.cancelled = true;
            counts.active--;
            entry.state = "idle";
            resolve(null);
          },
        };
        entry.state = "loading";
        tasks.push(task);
        counts.active++;
        counts.max = Math.max(counts.max, counts.active);
        return promise;
      },
      cancelLoading() {
        for (const task of tasks) if (task.family === family) task.cancel();
      },
    };
  }
  const loader = createCoreLoading(banks, {
    ensureContext: () => f.context,
    currentContext: () => f.context,
    onChange: (v) => views.push(v),
    onReady: () => counts.ready++,
    onBlocked: () => counts.blocked++,
  });
  return {
    ...f,
    banks,
    tasks,
    views,
    counts,
    loader,
    setContext: (ctx) => (f.context = ctx),
  };
}
async function finishAll(f) {
  for (let n = 0; n < 30 && f.loader.snapshot().phase === "loading"; n++) {
    await flush();
    for (const t of [...f.tasks]) if (!t.done) t.finish();
    await flush();
  }
}
test("five groups use two fair jobs, unlock only whole groups, and admit additional loading once all succeed", async () => {
  const f = setup();
  assert.equal(f.tasks.length, 0);
  f.loader.start();
  await flush();
  assert.deepEqual(
    f.tasks.map((t) => t.family),
    ["drum", "bilah"],
  );
  assert.equal(f.loader.isReady("drum"), false);
  f.tasks[0].finish();
  await flush();
  assert.equal(f.loader.snapshot().groups.drum.ready, 1);
  assert.equal(f.loader.isReady("drum"), false);
  assert.equal(f.counts.ready, 0);
  await finishAll(f);
  assert(f.loader.allReady());
  assert.equal(f.counts.ready, 1);
  assert.equal(f.counts.max, 2);
  assert.equal(f.tasks.length, 8);
  for (const family of Object.keys(f.banks)) assert(f.loader.isReady(family));
  f.loader.start();
  await flush();
  assert(f.loader.allReady());
  assert.equal(f.tasks.length, 8, "valid cache is reused");
  f.loader.dispose();
});
test("failure pauses all pending loads but preserves ready groups; failed group retries before other work", async () => {
  const f = setup();
  f.loader.start();
  await flush();
  // Hold the first Drum note while smaller groups get their turns.
  for (let n = 0; n < 4; n++) {
    const t = f.tasks.find((t) => !t.done && t.family !== "drum");
    if (t) t.finish();
    await flush();
  }
  assert(f.loader.isReady("kendhang"));
  f.tasks[0].finish(false);
  await flush();
  assert.equal(f.loader.snapshot().phase, "paused");
  assert.equal(f.loader.snapshot().groups.drum.state, "error");
  assert(f.loader.isReady("kendhang"));
  assert.equal(f.counts.active, 0);
  const prior = f.tasks.length;
  await flush();
  assert.equal(f.tasks.length, prior);
  assert.equal(f.counts.ready, 0);
  f.loader.retry("bilah");
  await flush();
  assert.equal(f.tasks.length, prior, "unfailed group cannot bypass failure");
  f.loader.retry("drum");
  await flush();
  assert(f.tasks.slice(prior).every((t) => t.family === "drum"));
  while (f.loader.snapshot().groups.drum.state !== "ready") {
    for (const t of [...f.tasks])
      if (!t.done && t.family === "drum") t.finish();
    await flush();
  }
  await finishAll(f);
  assert(f.loader.allReady());
  assert.equal(f.counts.ready, 1);
  assert(f.counts.max <= 2);
  f.loader.dispose();
});
test("multiple failures must all recover and repeated retry failure stays paused", async () => {
  const f = setup();
  f.loader.start();
  await flush();
  f.tasks[0].finish(false);
  f.tasks[1].finish(false);
  await flush();
  assert.deepEqual(
    new Set(f.loader.snapshot().failed),
    new Set(["drum", "bilah"]),
  );
  f.loader.retry("drum");
  await flush();
  f.tasks.find((t) => !t.done).finish(false);
  await flush();
  assert.equal(f.loader.snapshot().phase, "paused");
  f.loader.retry("drum");
  await finishAll(f);
  assert.equal(f.loader.snapshot().phase, "paused");
  assert.deepEqual(f.loader.snapshot().failed, ["bilah"]);
  assert.equal(f.counts.ready, 0);
  f.loader.retry("bilah");
  await finishAll(f);
  assert(f.loader.allReady());
  f.loader.dispose();
});
for (const action of ["invalidate", "dispose", "context"])
  test(`${action} prevents late progress, ready notification, and old jobs`, async () => {
    const f = setup();
    f.loader.start();
    await flush();
    const old = [...f.tasks];
    if (action === "context") f.setContext({ state: "running" });
    else f.loader[action]();
    const views = f.views.length;
    for (const task of old) task.finish();
    await flush();
    assert.equal(f.counts.ready, 0);
    assert.equal(f.loader.allReady(), false);
    if (action !== "context") assert.equal(f.views.length, views);
    if (action !== "dispose") {
      f.loader.retry("drum");
      await finishAll(f);
      assert(f.loader.allReady());
    }
    f.loader.dispose();
  });
test("standalone readiness markup sits directly under each heading without adding it to Studio", () => {
  assert.deepEqual(
    CORE_GROUPS.map((g) => g.pitches.length),
    [8, 5, 2, 3, 3],
  );
  for (const locale of ["id", "en"]) {
    const html = renderPadStation(locale);
    assert.equal((html.match(/data-core-loading=/g) || []).length, 5);
    for (const g of CORE_GROUPS) {
      const status = renderCoreStatus(locale, g.family);
      assert(status.includes('aria-live="polite"'));
      assert(html.includes("</h3>" + status.split("<button")[0]));
    }
    assert(!renderPadGroups(locale).includes("data-core-loading"));
    assert(html.includes('id="ps-extra-loading" data-state="waiting"'));
  }
});
test("standalone Stop fences pending hits while preserving loader work and readiness guard", async () => {
  const calls = [],
    context = new EventTarget();
  context.state = "running";
  let ready = false,
    resolve;
  const engine = {
    context,
    operation: 0,
    triggerPad() {
      calls.push("hit");
      return new Promise((r) => (resolve = r));
    },
    rewind() {
      throw Error("must not cancel banks");
    },
    setVolume() {},
  };
  const owner = createPadOwner({
    engine,
    playback: { configure() {} },
    canPlay: () => ready,
    stopSounds: () => {
      engine.operation++;
      calls.push("silence");
    },
  });
  await owner.play("drum", "kick");
  assert.deepEqual(calls, []);
  ready = true;
  const hit = owner.play("drum", "kick");
  owner.stop();
  resolve();
  await hit;
  assert.deepEqual(calls, ["hit", "silence"]);
});
