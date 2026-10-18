import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { createCanonicalLegacyAssets } from "../src/audio/canonical-legacy-assets.js";
import { canonicalRegisteredAssets } from "../src/audio/canonical-registered-assets.js";
import { createCanonicalProductionAdapter } from "../src/audio/canonical-production-adapter.js";
import { qaBuffer } from "./helpers/canonical-score-fixtures.js";

test("production legacy resolver accepts exact loop assetId/variant and refuses forged identity before acquisition", async () => {
  const memory = new AudioMemory(),
    adapter = createCanonicalProductionAdapter({
      context: { sampleRate: 48000, createBuffer: qaBuffer },
      memory,
      resolveUrl: (d) => "/" + d.path,
    }),
    entry = adapter.assets.catalog.find(
      (e) =>
        e.request.kind === "phrase" &&
        e.request.role === "kick" &&
        e.request.variant === 1,
    ),
    stem = {
      id: "kick",
      variant: 1,
      assetId: entry.rights.sourceWorkId.replace(
        "perkusi-original-groove-",
        "",
      ),
      gainTrim: entry.descriptor.gainTrim,
    },
    bank = { pack: { id: "original-groove", version: "0.1.0-candidate" } },
    abort = new AbortController();
  abort.abort();
  await assert.rejects(
    adapter.acquireLegacyEntry(stem, { bank, signal: abort.signal }),
    (e) => e.code === "cancelled",
  );
  for (const altered of [
    { ...stem, assetId: "forged" },
    { ...stem, variant: 2 },
    { ...stem, sha256: "f".repeat(64) },
    { ...stem, gainTrim: 1 },
  ])
    assert.throws(
      () => adapter.acquireLegacyEntry(altered, { bank }),
      (e) => e.code === "canonicalAssetIdentityMismatch",
    );
  assert.throws(
    () =>
      adapter.acquireLegacyEntry(stem, {
        bank: { pack: { id: "other", version: "1" } },
      }),
    (e) => e.code === "canonicalAssetIdentityMismatch",
  );
  await adapter.dispose();
  assert.equal(memory.snapshot().bytes, 0);
});
const sha = (b) => createHash("sha256").update(b).digest("hex"),
  deferred = () => {
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
function fixture({ mode = "ok", gate = null } = {}) {
  const memory = new AudioMemory(),
    data = new Uint8Array(32).fill(7),
    hash = sha(data),
    stats = { fetches: 0, decodes: 0 },
    context = {
      sampleRate: 44100,
      async decodeAudioData() {
        stats.decodes++;
        await gate?.promise;
        if (mode === "decode") throw Error("decode failure");
        const b = qaBuffer(1, 128, 44100);
        b.getChannelData(0).fill(0.02);
        return b;
      },
    },
    entry = {
      request: {
        kind: "percussion",
        pack: { id: "qa", version: "1" },
        role: "kick",
      },
      descriptor: {
        frames: 128,
        channels: 1,
        sampleRate: 44100,
        encodedBytes: 32,
        contentHash: hash,
        gainTrim: 0.2,
        hashKind: "encoded-asset",
      },
    };
  const cache = createCanonicalLegacyAssets({
    context,
    memory,
    urlFor: () => "/fixture.wav",
    fetcher: async () => {
      stats.fetches++;
      if (mode === "fetch") throw Error("fetch failure");
      if (mode === "missing") return new Response(null, { status: 404 });
      if (mode === "short") return new Response(data.subarray(0, 31));
      return new Response(mode === "hash" ? new Uint8Array(32) : data);
    },
  });
  return { memory, context, stats, entry, cache };
}
test("registered adapter metadata resolves exact trusted catalogs without eager fetch or URL substitution", () => {
  for (const rate of [44100, 48000]) {
    const paths = [],
      catalog = canonicalRegisteredAssets(rate, (d) => {
        paths.push(d.path);
        return "/assets/" + d.path;
      });
    assert.equal(catalog.catalog.length, 41);
    assert.equal(catalog.nativeRights.length, 108);
    assert.ok(paths.every((p) => p.startsWith("internal/")));
    assert.throws(
      () => catalog.nativeURL("/arbitrary.wav"),
      (e) => e.code === "canonicalAssetUnavailable",
    );
    assert.throws(
      () => catalog.legacyURL("0".repeat(64)),
      (e) => e.code === "canonicalAssetUnavailable",
    );
  }
});
test("registered decode profile is explicit and cannot change encoded hash, trim or other profiles", () => {
  const key =
      "e1329cb03a568b5c2790a626f0e89c3af1d8a1304a954e45f4f8997aa8199298",
    a = canonicalRegisteredAssets(44100, (d) => d.path),
    b = canonicalRegisteredAssets(44100, (d) => d.path, {
      [key + "@44100"]: 28664,
    }),
    get = (x) => x.catalog.find((e) => e.descriptor.contentHash === key);
  assert.equal(get(a).descriptor.frames, 28665);
  assert.equal(get(b).descriptor.frames, 28664);
  assert.equal(get(a).descriptor.gainTrim, get(b).descriptor.gainTrim);
  assert.equal(get(a).descriptor.contentHash, get(b).descriptor.contentHash);
  assert.equal(
    get(
      canonicalRegisteredAssets(48000, (d) => d.path, {
        [key + "@44100"]: 28664,
      }),
    ).descriptor.frames,
    31200,
  );
});
test("legacy raw cache coalesces concurrent hit/miss loans without a second fetch/decode", async () => {
  const f = fixture(),
    [a, b] = await Promise.all([
      f.cache.acquire(f.entry),
      f.cache.acquire(f.entry),
    ]);
  assert.equal(f.stats.fetches, 1);
  assert.equal(f.stats.decodes, 1);
  assert.equal(a.buffer, b.buffer);
  a.release();
  const c = await f.cache.acquire(f.entry);
  assert.equal(f.stats.fetches, 1);
  b.release();
  c.release();
  await f.cache.dispose();
  assert.equal(f.memory.snapshot().bytes, 0);
});
for (const mode of ["fetch", "missing", "short", "hash", "decode"])
  test(`legacy raw cache ${mode} refusal releases owned resources, preserves foreign ID`, async () => {
    const f = fixture({ mode }),
      foreign = f.memory.reserve(313, "foreign"),
      id = f.memory.snapshot().owners[0].id;
    await assert.rejects(f.cache.acquire(f.entry));
    await f.cache.dispose();
    assert.equal(f.cache.snapshot().jobs, 0);
    assert.equal(f.memory.snapshot().bytes, 313);
    assert.equal(f.memory.snapshot().owners[0].id, id);
    foreign.release();
  });
test("legacy raw cache cancellation does not release an in-flight decode or another subscriber", async () => {
  const gate = deferred(),
    f = fixture({ gate }),
    aAbort = new AbortController(),
    a = f.cache.acquire(f.entry, { signal: aAbort.signal }),
    b = f.cache.acquire(f.entry);
  await until(() => f.stats.decodes === 1);
  aAbort.abort();
  await assert.rejects(a, (e) => e.code === "cancelled");
  assert.ok(f.memory.snapshot().bytes > 0);
  gate.resolve();
  const loan = await b;
  assert.ok(loan.buffer.getChannelData(0)[0] > 0);
  loan.release();
  await f.cache.dispose();
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("legacy raw cache dispose waits for actual decode settlement before releasing the owner", async () => {
  const gate = deferred(),
    f = fixture({ gate }),
    abort = new AbortController(),
    job = f.cache.acquire(f.entry, { signal: abort.signal });
  await until(() => f.stats.decodes === 1);
  abort.abort();
  await assert.rejects(job, (e) => e.code === "cancelled");
  let closed = false;
  const close = f.cache.dispose().then(() => (closed = true));
  await wait(1);
  assert.equal(closed, false);
  assert.ok(f.memory.snapshot().bytes > 0);
  gate.resolve();
  await close;
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("raw-cache disposal during reserve cannot acknowledge before newly admitted fetch/decode", async () => {
  const memory = new AudioMemory({ maxBytes: 16000 }),
    unrelated = memory.reserve(313, "unrelated"),
    pressure = memory.reserve(8000, "pressure"),
    bytes = new Uint8Array(32).fill(7),
    stats = { fetch: 0, decode: 0 };
  let cache, close;
  const context = {
      sampleRate: 44100,
      decodeAudioData: async () => {
        stats.decode++;
        return qaBuffer(1, 128, 44100);
      },
    },
    entry = {
      request: {
        kind: "percussion",
        pack: { id: "qa", version: "1" },
        role: "kick",
      },
      descriptor: {
        frames: 128,
        channels: 1,
        sampleRate: 44100,
        encodedBytes: 32,
        contentHash: sha(bytes),
        gainTrim: 0.2,
        hashKind: "encoded-asset",
      },
    };
  cache = createCanonicalLegacyAssets({
    context,
    memory,
    urlFor: () => "/qa.wav",
    fetcher: async () => {
      stats.fetch++;
      return new Response(bytes);
    },
  });
  memory.registerTrimmer("close", () => {
    close = cache.dispose();
    pressure.release();
  });
  await assert.rejects(
    cache.acquire(entry),
    (e) => e.code === "canonicalProviderClosed",
  );
  await close;
  assert.deepEqual(stats, { fetch: 0, decode: 0 });
  assert.deepEqual(cache.snapshot(), {
    closed: true,
    jobs: 0,
    entries: 0,
    pins: 0,
  });
  assert.equal(memory.snapshot().bytes, 313);
  unrelated.release();
});
test("production adapter reentrant disposal aborts raw-cache admission before fetch/decode", async () => {
  const memory = new AudioMemory({ maxBytes: 900000 }),
    unrelated = memory.reserve(313, "unrelated"),
    pressure = memory.reserve(300000, "pressure");
  let adapter,
    close,
    fetches = 0,
    decodes = 0;
  const context = {
    sampleRate: 48000,
    createBuffer: qaBuffer,
    decodeAudioData: async () => {
      decodes++;
      return qaBuffer(1, 31200, 48000);
    },
  };
  adapter = createCanonicalProductionAdapter({
    context,
    memory,
    resolveUrl: (d) => "/assets/" + d.path,
    fetcher: async () => {
      fetches++;
      throw Error("must not fetch");
    },
  });
  memory.registerTrimmer("close", () => {
    close = adapter.dispose();
    pressure.release();
  });
  await assert.rejects(
    adapter.provider.load({
      kind: "percussion",
      pack: { id: "ruang", version: "1.0.0" },
      role: "kick",
    }),
    (e) => ["cancelled", "canonicalProviderClosed"].includes(e.code),
  );
  await close;
  assert.equal(fetches, 0);
  assert.equal(decodes, 0);
  assert.equal(adapter.snapshot().legacy.jobs, 0);
  assert.equal(adapter.snapshot().legacy.entries, 0);
  assert.equal(memory.snapshot().bytes, 313);
  unrelated.release();
});
