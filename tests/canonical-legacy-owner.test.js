import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as wait } from "node:timers/promises";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { AudioEngine } from "../src/audio/engine.js";
import {
  createCanonicalLegacyOwner,
  canonicalLegacyNeededPitches,
} from "../src/audio/canonical-legacy-owner.js";
import { canonicalVoiceOwners } from "../src/audio/canonical-voice-budget.js";
import { qaBuffer } from "./helpers/canonical-score-fixtures.js";
const deferred = () => {
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    return { promise, resolve };
  },
  until = async (f) => {
    let end = Date.now() + 3000;
    while (!f()) {
      assert.ok(Date.now() < end);
      await wait(1);
    }
  };
function fixture({
  loadGate = null,
  closeGate = null,
  failStart = false,
  failClose = false,
  failRelease = false,
} = {}) {
  const memory = new AudioMemory(),
    stats = { sources: 0, sourceReleases: 0, closeCalls: 0 },
    context = new EventTarget();
  Object.assign(context, {
    sampleRate: 44100,
    currentTime: 0,
    state: "running",
  });
  const param = () => ({
      value: 1,
      setValueAtTime() {},
      linearRampToValueAtTime() {},
      cancelScheduledValues() {},
      setTargetAtTime() {},
    }),
    node = () => ({ context, connect() {}, disconnect() {} });
  context.destination = node();
  context.createGain = () => ({ ...node(), gain: param() });
  context.createStereoPanner = () => ({ ...node(), pan: param() });
  context.createBufferSource = () => {
    stats.sources++;
    const s = new EventTarget();
    Object.assign(s, node(), {
      playbackRate: param(),
      started: false,
      ended: false,
      start() {
        if (failStart) throw Error("start fault");
        this.started = true;
      },
      stop() {
        if (!this.started) throw Error("not started");
        if (!this.ended) {
          this.ended = true;
          queueMicrotask(() => {
            this.dispatchEvent(new Event("ended"));
            this.onended?.();
          });
        }
      },
    });
    return s;
  };
  context.close = async () => {
    stats.closeCalls++;
    if (failClose && stats.closeCalls === 1) throw Error("close fault");
    await closeGate?.promise;
    context.state = "closed";
  };
  const owner = createCanonicalLegacyOwner({
      memory,
      contextFactory: () => context,
    }),
    pack = {
      schemaVersion: 1,
      id: "qa",
      kind: "one-shot",
      version: "1",
      bpm: 120,
      beatsPerBar: 4,
      bars: 1,
      key: null,
      stems: [
        {
          id: "kick",
          url: "/qa.wav",
          gainTrim: 0.2,
          licenseId: "qa",
          durationSeconds: 128 / 44100,
        },
      ],
    },
    engine = new AudioEngine(pack, { contextFactory: () => context });
  engine.ensureContext();
  engine.mixer = {
    nodes: new Map([["kick", { gain: context.createGain() }]]),
    dispose() {},
    update() {},
  };
  let refuseRelease = failRelease;
  owner.attach(engine, {
    acquireEntry: async () => {
      await loadGate?.promise;
      const held = memory.reserve(128 * 8 + 8192, "unit/private-source"),
        buffer = qaBuffer(1, 128, 44100);
      buffer.getChannelData(0).fill(0.02);
      return {
        buffer,
        release() {
          stats.sourceReleases++;
          if (refuseRelease) throw Error("source release fault");
          held.release();
        },
      };
    },
  });
  return {
    memory,
    context,
    owner,
    engine,
    stats,
    permitRelease() {
      refuseRelease = false;
    },
  };
}
test("real legacy hook reserves before node creation; failed start cleans only owned construction", async () => {
  const f = fixture({ failStart: true }),
    foreign = f.memory.reserve(313, "foreign");
  await f.engine.bank.load("kick", f.context);
  assert.throws(() => f.engine.addShot("kick", 0.1, 0.02), /start fault/);
  assert.equal(f.stats.sources, 1);
  assert.equal(canonicalVoiceOwners(f.memory).count, 0);
  assert.equal(f.owner.snapshot().voices, 0);
  await f.engine.dispose({ immediate: true });
  assert.equal(f.memory.snapshot().bytes, 313);
  foreign.release();
});
test("real legacy hook16/17 count refuses before allocation and closes without source loss", async () => {
  const f = fixture();
  await f.engine.bank.load("kick", f.context);
  for (let i = 0; i < 16; i++) f.engine.addShot("kick", 1, 0.02);
  assert.equal(canonicalVoiceOwners(f.memory).count, 16);
  const n = f.stats.sources,
    b = f.memory.snapshot().bytes;
  assert.throws(
    () => f.engine.addShot("kick", 1, 0.02),
    (e) => e.code === "voiceLimit",
  );
  assert.equal(f.stats.sources, n);
  assert.equal(f.memory.snapshot().bytes, b);
  await f.engine.dispose({ immediate: true });
  assert.equal(f.stats.sourceReleases, 1);
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("real legacy cache pin stays owned while actual context close awaits", async () => {
  const gate = deferred(),
    f = fixture({ closeGate: gate }),
    foreign = f.memory.reserve(313, "foreign");
  await f.engine.bank.load("kick", f.context);
  f.engine.addShot("kick", 1, 0.02);
  const close = f.engine.dispose({ immediate: true });
  await until(() => f.stats.closeCalls === 1);
  assert.equal(f.stats.sourceReleases, 0);
  assert.ok(f.memory.snapshot().bytes > 313);
  gate.resolve();
  await close;
  assert.equal(f.stats.sourceReleases, 1);
  assert.equal(f.memory.snapshot().bytes, 313);
  foreign.release();
});
test("real legacy actual-close failure retains pins and supports the terminal retry path", async () => {
  const f = fixture({ failClose: true });
  await f.engine.bank.load("kick", f.context);
  f.engine.addShot("kick", 1, 0.02);
  await assert.rejects(f.engine.dispose({ immediate: true }), /close fault/);
  assert.equal(f.stats.sourceReleases, 0);
  assert.ok(f.memory.snapshot().bytes > 0);
  await f.engine.retryDisposedClose();
  assert.equal(f.stats.closeCalls, 2);
  assert.equal(f.stats.sourceReleases, 1);
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("real legacy disposal invalidates a pending load and waits for its late loan", async () => {
  const gate = deferred(),
    f = fixture({ loadGate: gate }),
    job = f.engine.bank.load("kick", f.context);
  let closed = false;
  const close = f.engine
    .dispose({ immediate: true })
    .then(() => (closed = true));
  await wait(1);
  assert.equal(closed, false);
  gate.resolve();
  await assert.rejects(job, (e) => e.code === "cancelled");
  await close;
  assert.equal(f.engine.bank.get("kick").buffer, null);
  assert.equal(f.stats.sourceReleases, 1);
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("real legacy cleanup release failure preserves the unknown source until explicit retry", async () => {
  const f = fixture({ failRelease: true }),
    foreign = f.memory.reserve(313, "foreign");
  await f.engine.bank.load("kick", f.context);
  await assert.rejects(
    f.engine.dispose({ immediate: true }),
    /canonicalLegacyCleanupPending/,
  );
  assert.equal(f.context.state, "closed");
  assert.ok(f.memory.snapshot().bytes > 313);
  f.permitRelease();
  await f.engine.dispose({ immediate: true });
  assert.equal(f.memory.snapshot().bytes, 313);
  foreign.release();
});
test("real legacy constructor validation keeps the native context charged until close acknowledgement", async () => {
  const memory = new AudioMemory(),
    gate = deferred(),
    context = {
      sampleRate: 32000,
      state: "running",
      async close() {
        await gate.promise;
        this.state = "closed";
      },
    };
  let error;
  try {
    createCanonicalLegacyOwner({ memory, contextFactory: () => context });
  } catch (e) {
    error = e;
  }
  assert.equal(error.code, "invalidCanonicalOwner");
  assert.equal(memory.snapshot().bytes, 524288);
  gate.resolve();
  await error.cleanupPromise;
  assert.equal(memory.snapshot().bytes, 0);
});
test("legacy composition hook loads only needed chain/active pitches without rewriting any pattern", () => {
  const p = {
      activePattern: "b",
      chain: ["a", "a"],
      patterns: [
        { id: "a", notes: [{ pitch: "d4" }, null, { pitch: "d4" }] },
        { id: "b", notes: [{ pitch: "f4" }] },
        { id: "unused", notes: [{ pitch: "c5" }] },
      ],
    },
    before = JSON.stringify(p);
  assert.deepEqual(canonicalLegacyNeededPitches(p, true), ["d4"]);
  assert.deepEqual(canonicalLegacyNeededPitches(p, false), ["f4"]);
  assert.equal(JSON.stringify(p), before);
});
