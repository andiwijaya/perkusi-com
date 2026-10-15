import test from "node:test";
import assert from "node:assert/strict";
import { AudioEngine } from "../src/audio/engine.js";
import { originalRegistry } from "../src/project/original-registry.js";
import { createPackFromCatalog } from "../src/audio/pack-catalog.js";
const originalGroovePack = () =>
  createPackFromCatalog(
    originalRegistry,
    undefined,
    (path) => "/sounds/" + path,
  );
test("Terminal AudioEngine resumes only failed native close, serializes retry and never revives Play", async () => {
  let calls = 0,
    settle;
  const gate = new Promise((r) => (settle = r)),
    context = {
      state: "running",
      currentTime: 0,
      removeEventListener() {},
      async close() {
        calls++;
        if (calls === 1) throw Error("native close failed");
        await gate;
        this.state = "closed";
      },
    };
  const engine = new AudioEngine(originalGroovePack());
  engine.context = context;
  const first = engine.dispose({ immediate: true });
  await assert.rejects(first, /native close failed/);
  assert.equal(engine.disposed, true);
  assert.equal(engine.disposalClosePending, true);
  assert.equal(engine.dispose(), first);
  await assert.rejects(engine.play(), /disposed/);
  const retry = engine.retryDisposedClose();
  assert.equal(engine.retryDisposedClose(), retry);
  assert.equal(calls, 2);
  settle();
  await retry;
  assert.equal(engine.disposalClosePending, false);
  assert.equal(engine.status, "disposed");
  assert.equal(engine.context.state, "closed");
  assert.equal(engine.events.filter((e) => e.type === "dispose").length, 1);
  await assert.rejects(engine.retryDisposedClose(), /No pending/);
  await assert.rejects(engine.play(), /disposed/);
});
test("Unrelated earlier cleanup failure cannot be disguised by native-close retry", async () => {
  const engine = new AudioEngine(originalGroovePack());
  let calls = 0;
  engine.context = {
    state: "running",
    currentTime: 0,
    removeEventListener() {},
    close: async () => calls++,
  };
  [...engine.banks][0].dispose = () => {
    throw Error("bank cleanup failed");
  };
  await assert.rejects(engine.dispose(), /bank cleanup failed/);
  assert.equal(engine.disposalClosePending, false);
  await assert.rejects(engine.retryDisposedClose(), /No pending/);
  assert.equal(calls, 0);
});
