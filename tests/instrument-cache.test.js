import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  setImmediate as yieldTurn,
  setTimeout as yieldAsyncWork,
} from "node:timers/promises";
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import { InstrumentSampleCache } from "../src/audio/instrument-cache.js";
import { ResourceBudget } from "../src/audio/resource-budget.js";
const sha = (b) => createHash("sha256").update(b).digest("hex");
const payload = (i) => new Uint8Array(256).fill(i);
const pcm = (value = 0.1, frames = 128) => {
  const data = new Float32Array(frames).fill(value);
  return {
    length: frames,
    sampleRate: 8000,
    numberOfChannels: 1,
    duration: frames / 8000,
    getChannelData: () => data,
  };
};
const registry = () =>
  new InstrumentRegistry([
    {
      id: "test",
      version: "1",
      kind: "instrument-bank",
      setId: "qa",
      tradition: "qa-synthetic",
      laras: "none",
      samples: [1, 2, 3, 4, 5, 6].map((i) => ({
        id: "n" + i,
        instrumentId: "qa",
        pitchId: "p" + i,
        articulation: "strike",
        assetPath: "/sounds/n" + i + ".wav",
        sha256: sha(payload(i)),
        sourceWorkId: "qa-" + i,
        licenseId: "qa-only",
        encodedBytes: 256,
        sampleRate: 8000,
        channels: 1,
        frames: 128,
        gainTrim: 1,
        voicePolicy: "polyphonic",
      })),
    },
  ]);
function setup(options = {}) {
  const pending = [],
    counts = { fetch: 0, decode: 0 };
  const context = {
    sampleRate: 8000,
    decodeAudioData: () => {
      counts.decode++;
      if (!options.slowDecode) return Promise.resolve(pcm());
      return new Promise((resolve, reject) =>
        pending.push({ resolve, reject }),
      );
    },
  };
  const fetcher =
    options.fetcher ??
    ((url) => {
      counts.fetch++;
      const i = Number(/n(\d)/.exec(url)[1]);
      return Promise.resolve(
        new Response(payload(i), { headers: { "content-length": "256" } }),
      );
    });
  const cache = new InstrumentSampleCache(context, registry(), {
    ...options,
    fetcher,
  });
  return { cache, context, pending, counts, fetcher };
}
async function until(fn) {
  // Native digest completion depends on real worker progress, not turn count.
  // Product deadlines below still use the controlled clock and exact values.
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    if (fn()) return;
    await yieldAsyncWork(1);
  }
  assert.fail("condition did not settle");
}
const get = (cache, id = "n1", options) =>
  cache.acquire("test", "1", id, options);
const code = (c) => (e) => e.code === c;
function clock() {
  let now = 0,
    n = 0;
  const timers = new Map();
  return {
    setTimeout(fn, ms) {
      const id = ++n;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      now += ms;
      for (const [id, t] of [...timers])
        if (t.at <= now && timers.delete(id)) t.fn();
    },
    count: () => timers.size,
  };
}
test("S2 cache constructor inert, profile/identity strict, real digest and shared physical cache", async () => {
  const s = setup();
  assert.equal(s.counts.fetch, 0);
  assert.equal(s.cache.snapshot().budget.bytes, 0);
  await assert.rejects(get(s.cache, "missing"));
  const wrong = { ...s.context, sampleRate: 48000 };
  const mismatch = new InstrumentSampleCache(wrong, registry());
  await assert.rejects(get(mismatch), code("unsupportedDecodeProfile"));
  mismatch.dispose();
  const first = await get(s.cache),
    second = new InstrumentSampleCache(s.context, registry(), {
      fetcher: s.fetcher,
    });
  const other = await get(second);
  assert.equal(s.counts.fetch, 1);
  assert.equal(s.counts.decode, 1);
  assert.equal(first.buffer, other.buffer);
  assert.equal(s.cache.snapshot().budget.bytes, 512);
  s.cache.dispose();
  assert.equal(other.buffer.length, 128);
  assert.equal(second.snapshot().budget.bytes, 512);
  other.release();
  second.dispose();
  assert.equal(second.snapshot().budget.bytes, 0);
  assert.throws(() => first.buffer);
});
test("S2 shared pending consumer cancellation preserves another subscriber", async () => {
  const s = setup({ slowDecode: true }),
    a = new AbortController();
  const one = get(s.cache, "n1", { signal: a.signal });
  const refused = assert.rejects(one, code("cancelled"));
  const two = get(s.cache);
  await until(() => s.pending.length === 1);
  a.abort();
  await refused;
  assert.equal(s.cache.snapshot().budget.native, 1);
  s.pending[0].resolve(pcm());
  const valid = await two;
  assert.equal(s.counts.decode, 1);
  valid.release();
  s.cache.dispose();
  assert.equal(s.cache.snapshot().budget.bytes, 0);
});
test("S2 native abort/timeout keeps encoded+decoded reservations until physical settlement", async () => {
  const s = setup({ slowDecode: true }),
    a = new AbortController();
  const p = get(s.cache, "n1", { signal: a.signal }),
    rejected = assert.rejects(p, code("cancelled"));
  await until(() => s.pending.length === 1);
  a.abort();
  await rejected;
  let snap = s.cache.snapshot();
  assert.equal(snap.queue.active, 0);
  assert.equal(snap.queue.nativeDecodes, 1);
  assert.equal(snap.budget.bytes, 768);
  assert.equal(snap.budget.native, 1);
  s.pending[0].resolve(pcm());
  await until(() => s.cache.snapshot().activeJobs === 0);
  snap = s.cache.snapshot();
  assert.equal(snap.budget.bytes, 0);
  assert.equal(snap.queue.nativeDecodes, 0);
  s.cache.dispose();
});
test("S2 repeated cancelled decodes cannot exceed shared physical four-slot guard", async () => {
  const s = setup({ slowDecode: true });
  for (let i = 0; i < 4; i++) {
    const a = new AbortController(),
      p = get(s.cache, "n1", { signal: a.signal }),
      rejected = assert.rejects(p);
    await until(() => s.pending.length === i + 1);
    a.abort();
    await rejected;
  }
  const a = new AbortController(),
    fifth = get(s.cache, "n1", { signal: a.signal }),
    rejected = assert.rejects(fifth);
  await until(() => s.cache.snapshot().queue.decodeWaiters === 1);
  assert.equal(s.pending.length, 4);
  assert.equal(s.cache.snapshot().queue.nativeDecodes, 4);
  a.abort();
  await rejected;
  for (const p of s.pending) p.resolve(pcm());
  await until(() => s.cache.snapshot().activeJobs === 0);
  assert.equal(s.cache.snapshot().budget.bytes, 0);
  assert.equal(s.cache.snapshot().queue.nativeDecodes, 0);
  s.cache.dispose();
});
test("S2 budget eviction only unpinned; pin/legacy growth cannot silently exceed capacity", async () => {
  let legacy = 0;
  const s = setup({ maxBytes: 1024, legacyRetainedBytes: () => legacy });
  const first = await get(s.cache);
  await assert.rejects(get(s.cache, "n2"), code("cacheMemoryLimit"));
  assert.equal(first.buffer.length, 128);
  assert.equal(s.cache.snapshot().budget.bytes, 512);
  first.release();
  const second = await get(s.cache, "n2");
  assert.equal(s.cache.snapshot().stats.evictions, 1);
  legacy = 600;
  await assert.rejects(get(s.cache, "n2"), code("cacheMemoryLimit"));
  assert.equal(second.buffer.length, 128);
  legacy = 0;
  second.release();
  s.cache.clear();
  assert.equal(s.cache.snapshot().budget.bytes, 0);
  s.cache.dispose();
});
test("S2 finite/geometry/headroom/encoded integrity reject without publication and clean up", async () => {
  for (const value of [0, 1, NaN]) {
    const s = setup();
    s.context.decodeAudioData = () => Promise.resolve(pcm(value));
    await assert.rejects(get(s.cache));
    await until(() => s.cache.snapshot().activeJobs === 0);
    assert.equal(s.cache.snapshot().budget.bytes, 0);
    s.cache.dispose();
  }
  for (const kind of ["hash", "oversize", "short", "header", "stream"]) {
    const s = setup({
      fetcher: () => {
        if (kind === "stream")
          return Promise.resolve({
            ok: true,
            headers: new Headers(),
            arrayBuffer: () => Promise.resolve(payload(1).buffer),
          });
        const bytes =
          kind === "oversize"
            ? new Uint8Array(257)
            : kind === "short"
              ? new Uint8Array(255)
              : payload(2);
        return Promise.resolve(
          new Response(bytes, {
            headers: kind === "header" ? { "content-length": "999" } : {},
          }),
        );
      },
    });
    await assert.rejects(get(s.cache));
    await until(() => s.cache.snapshot().activeJobs === 0);
    assert.equal(s.counts.decode, 0);
    assert.equal(s.cache.snapshot().budget.bytes, 0);
    s.cache.dispose();
  }
});
test("S2 cache hit reinspects mutated PCM, quarantines with existing pin and reloads after release", async () => {
  const s = setup(),
    one = await get(s.cache);
  one.buffer.getChannelData(0)[0] = 1;
  await assert.rejects(get(s.cache));
  assert.equal(s.cache.snapshot().budget.bytes, 512);
  one.release();
  assert.equal(s.cache.snapshot().budget.bytes, 0);
  const restored = await get(s.cache);
  assert.equal(s.counts.fetch, 2);
  assert.ok(restored.metrics.peak < 0.95);
  restored.release();
  s.cache.dispose();
});
test("S2 progress sinks and queued/decode reentrant disposal never publish or strand jobs", async () => {
  for (const phase of ["queued", "body", "decode"]) {
    const s = setup();
    const p = get(s.cache, "n1", {
      onProgress: (event) => {
        if (event.phase === phase) s.cache.dispose();
      },
    });
    await assert.rejects(p);
    await until(() => s.cache.snapshot().activeJobs === 0);
    assert.equal(s.cache.snapshot().budget.bytes, 0);
    assert.equal(s.cache.snapshot().queue.nativeDecodes, 0);
  }
  const s = setup(),
    lease = await get(s.cache, "n1", {
      onProgress: () => {
        throw Error("UI sink");
      },
    });
  lease.release();
  s.cache.dispose();
});
test("S2 controlled header/body/decode/queue deadlines cancel ownership, not pending native work", async () => {
  const header = clock(),
    h = setup({
      timers: header,
      deadlines: { headers: 23 },
      fetcher: () => new Promise(() => {}),
    });
  const hp = get(h.cache),
    hr = assert.rejects(hp, code("headerTimedOut"));
  await until(() => h.cache.snapshot().stats.fetches === 1);
  header.advance(23);
  await hr;
  await until(() => h.cache.snapshot().activeJobs === 0);
  assert.equal(h.cache.snapshot().budget.bytes, 0);
  h.cache.dispose();
  const body = clock(),
    b = setup({
      timers: body,
      deadlines: { idle: 37 },
      fetcher: () =>
        Promise.resolve(new Response(new ReadableStream({ start() {} }))),
    });
  const bp = get(b.cache),
    br = assert.rejects(bp, code("bodyTimedOut"));
  await yieldTurn();
  body.advance(37);
  await br;
  await until(() => b.cache.snapshot().activeJobs === 0);
  b.cache.dispose();
  const timer = clock(),
    d = setup({ slowDecode: true, timers: timer, deadlines: { decode: 41 } });
  const dp = get(d.cache),
    dr = assert.rejects(dp, code("decodeTimedOut"));
  await until(() => d.pending.length === 1);
  timer.advance(41);
  await dr;
  assert.equal(d.cache.snapshot().budget.native, 1);
  d.pending[0].resolve(pcm());
  await until(() => d.cache.snapshot().activeJobs === 0);
  assert.equal(d.cache.snapshot().budget.bytes, 0);
  d.cache.dispose();
  assert.equal(timer.count(), 0);
  const qclock = clock(),
    q = setup({ slowDecode: true, timers: qclock, deadlines: { queued: 53 } });
  const a = get(q.cache, "n1"),
    c = get(q.cache, "n2"),
    third = get(q.cache, "n3"),
    rejected = assert.rejects(third, code("queueTimedOut"));
  await until(() => q.pending.length === 2);
  qclock.advance(53);
  await rejected;
  for (const p of q.pending) p.resolve(pcm());
  const leases = await Promise.all([a, c]);
  leases.forEach((l) => l.release());
  q.cache.dispose();
  assert.equal(q.cache.snapshot().budget.bytes, 0);
});
test("S2 ResourceBudget native transition is atomic and counts only actual reserved native slots", () => {
  const b = new ResourceBudget({ maxBytes: 100 });
  for (let i = 0; i < 5; i++)
    b.reserve({ id: "p" + i, category: "decode", bytes: 10 });
  assert.equal(b.snapshot().native, 0);
  for (let i = 0; i < 4; i++) b.activateNative("p" + i);
  const before = b.snapshot();
  assert.throws(() => b.activateNative("p4"));
  assert.deepEqual(b.snapshot(), before);
  assert.throws(() => b.activateNative("p0"));
  b.reject("p0");
  b.activateNative("p4");
  for (let i = 1; i < 5; i++) b.reject("p" + i);
  assert.equal(b.snapshot().bytes, 0);
  assert.equal(b.snapshot().native, 0);
});
test("S2 rejected constructor options cannot install a shared context policy", () => {
  const context = { sampleRate: 8000, decodeAudioData: async () => pcm() };
  assert.throws(
    () =>
      new InstrumentSampleCache(context, registry(), {
        maxBytes: 1024,
        fetcher: null,
        deadlines: { total: 0 },
      }),
    code("invalidCacheDeadline"),
  );
  const cache = new InstrumentSampleCache(context, registry());
  assert.equal(cache.snapshot().budget.maxBytes, 64 * 1024 * 1024);
  assert.equal(cache.snapshot().activeScopes, 0);
  cache.dispose();
});
test("S2 cancellation holds encoded and hash scratch until uncancellable digest settles", async () => {
  let finish;
  const d = setup({
    digest: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const controller = new AbortController();
  const pending = get(d.cache, "n1", { signal: controller.signal });
  const rejected = assert.rejects(pending, code("cancelled"));
  await until(() => !!finish);
  controller.abort();
  await rejected;
  assert.equal(d.cache.snapshot().budget.bytes, 768);
  assert.equal(d.cache.snapshot().queue.active, 0);
  assert.equal(d.counts.decode, 0);
  finish(sha(payload(1)));
  await until(() => d.cache.snapshot().activeJobs === 0);
  assert.equal(d.cache.snapshot().budget.bytes, 0);
  assert.equal(d.counts.decode, 0);
  d.cache.dispose();
});
