import test from "node:test";
import assert from "node:assert/strict";
import { createExtraSampler } from "../src/pads/extra-sampler.js";
import { createPadOwner } from "../src/pads/owner.js";
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
function setup(warm = true, releaseBudget = 0) {
  const counts = { load: 0, mix: 0, cancel: 0, dispose: 0 },
    resume = deferred(),
    load = deferred();
  const param = () => ({
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    cancelScheduledValues() {},
  });
  const ctx = Object.assign(new EventTarget(), {
    state: "running",
    currentTime: 1,
    resume: () => resume.promise,
    createGain() {
      counts.mix++;
      return { gain: param(), connect() {}, disconnect() {} };
    },
    createBufferSource() {
      return {
        playbackRate: { value: 1 },
        connect() {},
        disconnect() {},
        start() {},
        stop() {},
      };
    },
  });
  const entries = new Map(
    ["a", "b"].map((id) => [
      id,
      { stem: { id, gainTrim: 0.55 }, buffer: warm ? { duration: 1.5 } : null },
    ]),
  );
  const bank = {
    get(id) {
      if (!entries.has(id)) throw Error("Unknown");
      return entries.get(id);
    },
    verifyRetained(id) {
      return this.get(id).buffer ? this.get(id) : null;
    },
    async load(id) {
      counts.load++;
      await load.promise;
      this.get(id).buffer = { duration: 1.5 };
    },
    cancelLoading() {
      counts.cancel++;
    },
    dispose() {
      counts.dispose++;
    },
    snapshot() {
      return {};
    },
  };
  const engine = {
    context: ctx,
    master: {},
    operation: 0,
    banks: new Set(),
    voices: new Set(),
    stats: { created: 0, disposed: 0 },
    ensureContext: () => ctx,
    admitCandidate() {},
    record() {},
    removeVoice(v) {
      if (!this.voices.delete(v)) return;
      v.source.onended = null;
      v.source.stop();
      v.source.disconnect();
      v.gain.disconnect();
      this.stats.disposed++;
    },
    rewind() {
      this.operation++;
      for (const v of this.voices) this.removeVoice(v);
    },
    setVolume() {},
    dispose() {
      this.disposed = true;
      this.rewind();
      return Promise.resolve();
    },
  };
  const extra = createExtraSampler(engine, { id: "test" }, 2, {
    bankFactory: () => bank,
    releaseBudget,
  });
  return { engine, ctx, counts, resume, load, extra, entries };
}
for (const warm of [false, true])
  for (const action of ["Stop", "replace", "dispose", "context replacement"])
    for (const reject of [false, true])
      test(`extra deferred resume ${action} ${warm ? "warm" : "cold"} ${reject ? "reject" : "resolve"} admits no obsolete work`, async () => {
        const f = setup(warm);
        f.ctx.state = "suspended";
        const p = f.extra.play("a");
        if (action === "Stop") f.extra.stop();
        if (action === "replace") f.engine.operation++;
        if (action === "dispose") f.extra.dispose();
        if (action === "context replacement") f.engine.context = {};
        f.ctx.state = "running";
        if (reject) f.resume.reject(Error("old"));
        else f.resume.resolve();
        await p;
        assert.equal(f.counts.load, 0);
        assert.equal(f.counts.mix, 0);
        assert.equal(f.engine.voices.size, 0);
      });
test("cold pending load Stop/settlement remains silent; fresh retry works", async () => {
  const f = setup(false),
    p = f.extra.play("a");
  assert.equal(f.counts.load, 1);
  f.extra.stop();
  f.load.resolve();
  await p;
  assert.equal(f.engine.voices.size, 0);
  assert.equal(f.counts.mix, 0);
  await f.extra.play("a");
  assert.equal(f.engine.voices.size, 1);
  assert.equal(f.counts.load, 1);
});
test("shared bank, master route, same-note release, bounded overlap, natural end and idempotent cleanup", async () => {
  const f = setup();
  assert.equal(f.engine.banks.size, 1);
  for (let i = 0; i < 25; i++) {
    await f.extra.play(i % 2 ? "a" : "b");
    assert(f.engine.voices.size <= 4);
  }
  assert.equal(
    f.counts.mix,
    26,
    "one shared bus and one envelope gain per voice",
  );
  assert([...f.engine.voices].some((v) => v.extraReleasing));
  for (const v of [...f.engine.voices]) v.source.onended();
  assert.equal(f.engine.voices.size, 0);
  assert.equal(f.extra.snapshot().voices, 0);
  await f.extra.play("a");
  f.extra.dispose();
  f.extra.dispose();
  await f.extra.play("b");
  assert.equal(f.engine.voices.size, 0);
  assert.equal(f.counts.dispose, 1);
  assert.equal(f.engine.stats.created, f.engine.stats.disposed);
});
test("global voice cap respected and malformed notes/levels fail explicitly", async () => {
  const f = setup();
  for (let i = 0; i < 64; i++) f.engine.voices.add({});
  await f.extra.play("a");
  assert.equal(f.engine.stats.created, 0);
  await assert.rejects(f.extra.play("unknown"));
  for (const n of [0, -1, NaN, 7])
    assert.throws(() => createExtraSampler(f.engine, {}, n));
});
test("extra owner interruption and Stop/dispose fence only standalone work; no arrangement pad routing", async () => {
  const f = setup(),
    calls = [];
  const playback = {
    configure() {},
    pad() {
      throw Error("wrong route");
    },
  };
  const extra = {
    play: (p) => calls.push(p),
    stop: () => calls.push("stop"),
    dispose: () => calls.push("dispose"),
  };
  const owner = createPadOwner({ engine: f.engine, playback, extra });
  await owner.play("extra", "a");
  owner.stop();
  f.ctx.state = "suspended";
  f.ctx.dispatchEvent(new Event("statechange"));
  await owner.dispose();
  assert.deepEqual(calls, ["a", "stop", "stop", "dispose"]);
});

test("Kenong smooth stealing retains release ownership and bounds bursts without abrupt removal", async () => {
  const f = setup(true, 4);
  for (const id of ["c", "d", "e", "f"])
    f.entries.set(id, {
      stem: { id, gainTrim: 0.55 },
      buffer: { duration: 1.5 },
    });
  for (const id of ["a", "b", "c", "d"]) await f.extra.play(id);
  f.ctx.currentTime = 2;
  await f.extra.play("e");
  await f.extra.play("f");
  assert.equal(
    f.engine.stats.disposed,
    0,
    "stealing must not disconnect nonzero voices immediately",
  );
  assert.equal(f.engine.voices.size, 6);
  const release = [...f.engine.voices].filter((v) => v.extraReleasing);
  assert.equal(release.length, 2);
  for (const v of release) {
    assert.equal(v.envelope.at(-1).value, 0);
    assert(v.endTime > f.ctx.currentTime + 0.01);
    assert.equal(typeof v.source.onended, "function");
  }
  for (let i = 0; i < 30; i++)
    await f.extra.play(["a", "b", "c", "d", "e", "f"][i % 6]);
  assert(f.engine.voices.size <= 8);
  assert([...f.engine.voices].filter((v) => !v.extraReleasing).length <= 4);
  assert.equal(f.engine.stats.disposed, 0);
  for (const v of [...f.engine.voices]) v.source.onended();
  assert.equal(f.engine.voices.size, 0);
  await f.extra.play("a");
  assert.equal(f.engine.voices.size, 1);
  f.extra.stop();
  assert.equal(f.engine.voices.size, 0);
  assert.equal(f.engine.stats.created, f.engine.stats.disposed);
});
