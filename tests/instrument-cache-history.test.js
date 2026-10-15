import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import { InstrumentSampleCache } from "../src/audio/instrument-cache.js";
import { ResourceBudget } from "../src/audio/resource-budget.js";

const payload = (i) => new Uint8Array(32).fill(i);
const hash = (i) => createHash("sha256").update(payload(i)).digest("hex");
const pcm = () => {
  const data = new Float32Array([
    0.125, 0.25, 0.125, 0.25, 0.125, 0.25, 0.125, 0.25,
  ]);
  return {
    length: 8,
    numberOfChannels: 1,
    sampleRate: 8000,
    duration: 0.001,
    getChannelData: () => data,
  };
};
const registry = new InstrumentRegistry([
  {
    id: "qa",
    version: "1",
    kind: "instrument-bank",
    setId: "qa",
    tradition: "synthetic",
    laras: "none",
    samples: [1, 2, 3, 4, 5, 6].map((i) => ({
      id: "s" + i,
      instrumentId: "qa",
      pitchId: "p" + i,
      articulation: "strike",
      assetPath: "/sounds/s" + i + ".wav",
      sha256: hash(i),
      sourceWorkId: "qa" + i,
      licenseId: "qa",
      encodedBytes: 32,
      sampleRate: 8000,
      channels: 1,
      frames: 8,
      gainTrim: 1,
      voicePolicy: "polyphonic",
    })),
  },
]);
const get = (cache, i = 1, options) =>
  cache.acquire("qa", "1", "s" + i, options);
const code = (expected) => (error) => error.code === expected;
async function until(check) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (check()) return;
    await pause(1);
  }
  assert.fail("worker did not settle");
}
function fixture(maxBytes = 512) {
  const modes = new Map(),
    hashes = [],
    decodes = [],
    counts = { fetch: 0, decode: 0 };
  const context = {
    sampleRate: 8000,
    decodeAudioData: async (bytes) => {
      counts.decode++;
      const i = new Uint8Array(bytes)[0];
      if (modes.get(i) === "holdDecode")
        return new Promise((resolve) =>
          decodes.push({ i, finish: () => resolve(pcm()) }),
        );
      return pcm();
    },
  };
  const options = {
    maxBytes,
    fetcher: async (url) => {
      counts.fetch++;
      const i = Number(/s(\d)\.wav/.exec(url)[1]);
      if (modes.get(i) === "fetchFailure") throw Error("fixture fetch failed");
      return new Response(payload(modes.get(i) === "badHash" ? 0 : i));
    },
    digest: async (bytes) => {
      const i = bytes[0];
      const digest = () =>
        globalThis.crypto.subtle
          .digest("SHA-256", bytes)
          .then((value) =>
            [...new Uint8Array(value)]
              .map((x) => x.toString(16).padStart(2, "0"))
              .join(""),
          );
      if (modes.get(i) === "holdHash")
        return new Promise((resolve) =>
          hashes.push({ i, finish: async () => resolve(await digest()) }),
        );
      return digest();
    },
  };
  const facade = () => new InstrumentSampleCache(context, registry, options);
  return { modes, hashes, decodes, counts, facade, context, options };
}
function bounded(cache, maxBytes = 512) {
  const snapshot = cache.snapshot();
  assert.equal(snapshot.budget.history.policy, "monotonic");
  assert.equal(snapshot.budget.history.storedIds, 0);
  assert.ok(snapshot.budget.allocations.length <= 4096);
  assert.ok(snapshot.budget.bytes <= maxBytes);
  return snapshot;
}

test("S2-CACHE-01 exact reviewer2048job reproduction recovers while foreign32byte pin stays", async () => {
  const f = fixture(),
    a = f.facade(),
    b = f.facade(),
    pinned = await get(b);
  const physical = pinned.buffer;
  f.modes.set(2, "badHash");
  for (let i = 0; i < 2047; i++) {
    await assert.rejects(get(a, 2), code("assetHash"));
    await until(() => a.snapshot().activeJobs === 0);
  }
  const before = bounded(a);
  assert.equal(before.budget.bytes, 32);
  assert.equal(before.activeJobs, 0);
  assert.equal(before.queue.nativeDecodes, 0);
  f.modes.delete(2);
  const corrected = await get(a, 2);
  corrected.release();
  assert.equal(f.counts.fetch, 2049);
  assert.equal(pinned.buffer, physical);
  assert.throws(() => a.clear(), code("cacheBusy"));
  a.dispose();
  const renewed = f.facade(),
    next = await get(renewed, 2);
  assert.equal(next.buffer.length, 8);
  assert.equal(pinned.buffer, physical);
  assert.throws(() => renewed.clear(), code("cacheBusy"));
  next.release();
  renewed.dispose();
  assert.equal(pinned.buffer, physical);
  pinned.release();
  b.dispose();
  assert.equal(b.snapshot().budget.bytes, 0);
});

test("S2 history5000successful evictions preserve foreign pin across facade reconstruction", async () => {
  const f = fixture(128),
    b = f.facade(),
    pinned = await get(b),
    physical = pinned.buffer;
  let a = f.facade();
  for (let i = 0; i < 5000; i++) {
    const lease = await get(a, 2 + (i % 3));
    lease.release();
    await until(() => a.snapshot().activeJobs === 0);
    bounded(a, 128);
    assert.equal(pinned.buffer, physical);
    if (i % 1000 === 999) {
      a.dispose();
      a = f.facade();
    }
  }
  assert.equal(f.counts.fetch, 5001);
  assert.ok(a.snapshot().stats.evictions > 4900);
  assert.ok(a.snapshot().budget.history.sequenceFloor > 10000);
  a.dispose();
  pinned.release();
  b.dispose();
  assert.equal(b.snapshot().budget.bytes, 0);
});

test("S2 long failure history leaves canceled digest/native reservations intact and late results stale", async () => {
  const f = fixture(),
    b = f.facade(),
    pinned = await get(b),
    physical = pinned.buffer,
    a = f.facade();
  const controllers = [new AbortController(), new AbortController()];
  f.modes.set(2, "holdHash");
  const one = get(a, 2, { signal: controllers[0].signal }),
    rejectedOne = assert.rejects(one, code("cancelled"));
  await until(() => f.hashes.length === 1);
  controllers[0].abort();
  await rejectedOne;
  f.modes.set(3, "holdDecode");
  const two = get(a, 3, { signal: controllers[1].signal }),
    rejectedTwo = assert.rejects(two, code("cancelled"));
  await until(() => f.decodes.length === 1);
  controllers[1].abort();
  await rejectedTwo;
  for (let i = 0; i < 4100; i++) {
    f.modes.set(4, i % 2 ? "badHash" : "fetchFailure");
    await assert.rejects(get(a, 4), code(i % 2 ? "assetHash" : "assetFailed"));
    await until(() => a.snapshot().activeJobs === 2);
    const s = bounded(a);
    assert.equal(s.budget.bytes, 160);
    assert.equal(s.budget.native, 1);
    assert.equal(s.queue.nativeDecodes, 1);
    assert.equal(pinned.buffer, physical);
  }
  a.dispose();
  const c = f.facade();
  f.modes.delete(2);
  f.modes.delete(3);
  f.modes.delete(4);
  const freshHash = await get(c, 2),
    hashBuffer = freshHash.buffer;
  const freshDecode = await get(c, 3),
    decodeBuffer = freshDecode.buffer;
  assert.equal(c.snapshot().budget.bytes, 224);
  await f.hashes[0].finish();
  f.decodes[0].finish();
  await until(() => c.snapshot().activeJobs === 0);
  const final = bounded(c);
  assert.equal(final.budget.bytes, 96);
  assert.equal(final.budget.native, 0);
  assert.equal(final.queue.nativeDecodes, 0);
  assert.equal(freshHash.buffer, hashBuffer);
  assert.equal(freshDecode.buffer, decodeBuffer);
  assert.equal(pinned.buffer, physical);
  assert.equal(f.counts.decode, 4); // pin, canceled native, two current deliveries
  freshHash.release();
  freshDecode.release();
  c.dispose();
  pinned.release();
  b.dispose();
  assert.equal(b.snapshot().budget.bytes, 0);
});

test("S2 history4200hash/native cancellations keep reservations until settle then corrected retries work", async () => {
  const f = fixture(),
    b = f.facade(),
    pinned = await get(b),
    physical = pinned.buffer;
  let a = f.facade();
  for (let i = 0; i < 4200; i++) {
    const native = i % 2 === 1,
      sample = native ? 3 : 2,
      controller = new AbortController();
    f.modes.set(sample, native ? "holdDecode" : "holdHash");
    const pending = get(a, sample, { signal: controller.signal }),
      rejected = assert.rejects(pending, code("cancelled"));
    const queue = native ? f.decodes : f.hashes;
    await until(() => queue.length === 1);
    controller.abort();
    await rejected;
    const held = bounded(a);
    assert.equal(held.budget.bytes, 96);
    assert.equal(held.budget.native, Number(native));
    assert.equal(held.queue.nativeDecodes, Number(native));
    assert.equal(pinned.buffer, physical);
    await queue.shift().finish();
    await until(() => a.snapshot().activeJobs === 0);
    assert.equal(a.snapshot().budget.bytes, 32);
    if (i % 1000 === 999) {
      a.dispose();
      a = f.facade();
    }
  }
  f.modes.clear();
  const current = await get(a, 2);
  assert.equal(current.buffer.length, 8);
  assert.ok(a.snapshot().budget.history.sequenceFloor > 8400);
  current.release();
  a.dispose();
  assert.equal(pinned.buffer, physical);
  pinned.release();
  b.dispose();
  assert.equal(b.snapshot().budget.bytes, 0);
});

test("S2 monotonic ledger bounded history rejects reuse without pruning pending native or foreign pins", () => {
  const b = new ResourceBudget({ maxBytes: 128, historyPolicy: "monotonic" });
  b.reserve({ id: "allocation-1", bytes: 32, category: "cache" });
  b.pin("allocation-1", "foreign");
  b.reserve({
    id: "allocation-2",
    bytes: 32,
    category: "decode",
    native: true,
  });
  b.cancel("allocation-2");
  for (let i = 3; i <= 10000; i++) {
    const id = "allocation-" + i;
    b.reserve({ id, bytes: 1, category: "encoder" });
    b.release(id);
  }
  assert.equal(b.snapshot().history.storedIds, 0);
  assert.equal(b.snapshot().history.sequenceFloor, 10000);
  assert.equal(b.snapshot().allocations.length, 2);
  assert.equal(b.snapshot().bytes, 64);
  assert.deepEqual(b.revalidate("allocation-1", 32).pins, ["foreign"]);
  for (const id of [
    "allocation-2",
    "allocation-3",
    "allocation-9999",
    "allocation-010001",
    "allocation-9007199254740992",
    "other",
  ])
    assert.throws(
      () => b.reserve({ id, bytes: 1, category: "encoder" }),
      code("invalidAllocation"),
    );
  let discards = 0;
  assert.equal(
    b.settle("allocation-2", 32, "cache", { discard: () => discards++ }),
    false,
  );
  assert.equal(discards, 1);
  assert.throws(() =>
    b.settle("allocation-2", 32, "cache", { discard: () => discards++ }),
  );
  assert.equal(discards, 1);
  assert.throws(() => b.release("allocation-1"), code("allocationHeld"));
  b.unpin("allocation-1", "foreign");
  b.release("allocation-1");
  assert.throws(() =>
    b.reserve({ id: "allocation-2", bytes: 1, category: "encoder" }),
  );
  b.reserve({ id: "allocation-10001", bytes: 1, category: "cache" });
  b.release("allocation-10001");
  assert.equal(b.snapshot().bytes, 0);
  const last = new ResourceBudget({ historyPolicy: "monotonic" });
  last.reserve({
    id: "allocation-9007199254740991",
    bytes: 1,
    category: "cache",
  });
  assert.throws(() =>
    last.reserve({
      id: "allocation-9007199254740992",
      bytes: 1,
      category: "cache",
    }),
  );
});

test("S1 default lifetime bound remains4096 and cannot reuse terminal allocation IDs", () => {
  const b = new ResourceBudget({ maxBytes: 16 });
  for (let i = 0; i < 4096; i++) {
    b.reserve({ id: "legacy-" + i, bytes: 1, category: "cache" });
    b.release("legacy-" + i);
  }
  assert.equal(b.snapshot().history.policy, "lifetime");
  assert.equal(b.snapshot().history.storedIds, 4096);
  assert.throws(() =>
    b.reserve({ id: "legacy-4096", bytes: 1, category: "cache" }),
  );
  assert.throws(() =>
    b.reserve({ id: "legacy-0", bytes: 1, category: "cache" }),
  );
  assert.equal(b.snapshot().bytes, 0);
});
test("S2 monotonic history also caps live records4096 without losing old pinned allocations", () => {
  const b = new ResourceBudget({ maxBytes: 8192, historyPolicy: "monotonic" });
  for (let i = 1; i <= 4096; i++)
    b.reserve({ id: "allocation-" + i, bytes: 1, category: "cache" });
  b.pin("allocation-1", "foreign");
  const before = b.snapshot();
  assert.throws(() =>
    b.reserve({ id: "allocation-4097", bytes: 1, category: "cache" }),
  );
  assert.deepEqual(b.snapshot(), before);
  b.release("allocation-2");
  b.reserve({ id: "allocation-4097", bytes: 1, category: "cache" });
  assert.deepEqual(b.revalidate("allocation-1", 1).pins, ["foreign"]);
  assert.equal(b.snapshot().allocations.length, 4096);
  b.unpin("allocation-1", "foreign");
  for (const allocation of b.snapshot().allocations) b.release(allocation.id);
  assert.equal(b.snapshot().bytes, 0);
});
