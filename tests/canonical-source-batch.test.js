import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import { createCanonicalAssetProvider } from "../src/audio/canonical-asset-provider.js";
import {
  createCanonicalSourceDispatcher,
  hasCanonicalSourceBatch,
  reserveCanonicalSourceBatch,
  claimCanonicalPrivateReservation,
} from "../src/audio/canonical-source-batch.js";
import { qaBuffer } from "./helpers/canonical-score-fixtures.js";
import { InstrumentSampleCache } from "../src/audio/instrument-cache.js";
import { canonicalFixtureRegistry } from "./helpers/canonical-fixtures.js";

test("retired native policy keeps context identity and cannot transfer before actual cache/private cleanup", () => {
  const memory = new AudioMemory(),
    foreign = memory.reserve(313, "foreign"),
    context = {
      sampleRate: 48000,
      decodeAudioData: () => {
        throw Error("this retirement guard test does not decode audio");
      },
    },
    dispatcher = createCanonicalSourceDispatcher(memory, context),
    state = {
      disposed: false,
      jobs: 0,
      loans: 0,
      pendingCleanup: 0,
      cache: { activeJobs: 0, activeScopes: 0 },
    },
    descriptor = {
      encodedBytes: 32,
      frames: 128,
      channels: 1,
      sampleRate: 48000,
      gainTrim: 1,
    },
    policy = dispatcher.nativePolicy;
  dispatcher.bind({ snapshot: () => state });
  const prior = new InstrumentSampleCache(context, canonicalFixtureRegistry, {
      memoryPolicy: policy,
    }),
    held = policy.begin(descriptor);
  assert.throws(
    () => dispatcher.retireNativePolicy(),
    (e) => e.code === "canonicalSourceStillOwned",
  );
  dispatcher.close();
  state.disposed = true;
  assert.throws(
    () => dispatcher.retireNativePolicy(),
    (e) => e.code === "canonicalSourceStillOwned",
  );
  held.release();
  prior.dispose();
  for (const field of ["jobs", "loans", "pendingCleanup"]) {
    state[field] = 1;
    assert.throws(
      () => dispatcher.retireNativePolicy(),
      (e) => e.code === "canonicalSourceStillOwned",
    );
    state[field] = 0;
  }
  for (const field of ["activeJobs", "activeScopes"]) {
    state.cache[field] = 1;
    assert.throws(
      () => dispatcher.retireNativePolicy(),
      (e) => e.code === "canonicalSourceStillOwned",
    );
    state.cache[field] = 0;
  }
  assert.equal(dispatcher.retireNativePolicy(), policy);
  const next = new InstrumentSampleCache(context, canonicalFixtureRegistry, {
      memoryPolicy: policy,
    }),
    nextHeld = policy.begin(descriptor);
  assert.equal(memory.snapshot().bytes, 313 + 32 + 512);
  nextHeld.resize(512);
  assert.equal(memory.snapshot().bytes, 313 + 512);
  nextHeld.release();
  next.dispose();
  assert.throws(
    () => dispatcher.legacyBegin({ descriptor }, 512),
    (e) => e.code === "canonicalProviderClosed",
  );
  assert.equal(memory.snapshot().bytes, 313);
  foreign.release();
});

test("failed reentrant batch construction cannot roll back a cache ticket already owned by a nested consumer", () => {
  const pool = new AudioMemory(),
    foreign = pool.reserve(313, "foreign");
  let calls = 0,
    cache;
  const descriptor = {
      frames: 128,
      channels: 1,
      sampleRate: 48000,
      encodedBytes: 32,
      contentHash: "a".repeat(64),
      gainTrim: 0.4,
      hashKind: "encoded-asset",
    },
    context = {};
  let dispatch;
  const memory = {
    reserve(...args) {
      if (++calls === 3) {
        cache = dispatch.nativePolicy.begin(descriptor);
        throw Error("next source refused");
      }
      return pool.reserve(...args);
    },
    cachePolicy: (context) => pool.cachePolicy(context),
  };
  dispatch = createCanonicalSourceDispatcher(memory, context);
  const provider = { describe: () => descriptor };
  dispatch.bind(provider);
  assert.throws(
    () =>
      reserveCanonicalSourceBatch(
        provider,
        [
          { kind: "instrument", bankId: "qa", version: "1", sampleId: "a" },
          { kind: "instrument", bankId: "qa", version: "1", sampleId: "b" },
        ],
        memory,
      ),
    /next source refused/,
  );
  dispatch.close();
  assert.equal(pool.snapshot().bytes, 313 + 544);
  assert.equal(dispatch.snapshot().cacheOwners, 1);
  cache.resize(512);
  cache.release();
  assert.equal(pool.snapshot().bytes, 313);
  foreign.release();
});

test("batch capabilities bind exact descriptor geometry/encoded bytes/hash recipe and deduplicate requests", async () => {
  for (const key of ["frames", "encodedBytes", "gainTrim", "hashKind"]) {
    const memory = new AudioMemory(),
      context = {},
      dispatcher = createCanonicalSourceDispatcher(memory, context),
      descriptor = {
        frames: 128,
        channels: 1,
        sampleRate: 48000,
        encodedBytes: 32,
        contentHash: "a".repeat(64),
        gainTrim: 0.4,
        hashKind: "encoded-asset",
      };
    let mutated = false;
    const provider = {
      describe: () => descriptor,
      async load(r, { sourceReservation }) {
        const d = {
          ...descriptor,
          [key]: key === "hashKind" ? "decoded-pcm" : descriptor[key] + 1,
        };
        mutated = true;
        return claimCanonicalPrivateReservation(
          sourceReservation,
          provider,
          r,
          d,
          memory,
        );
      },
    };
    dispatcher.bind(provider);
    const request = {
        kind: "percussion",
        pack: { id: "qa", version: "1" },
        role: "kick",
      },
      batch = reserveCanonicalSourceBatch(provider, [request, request], memory);
    assert.equal(memory.snapshot().owners.length, 2);
    await assert.rejects(
      batch.load(request),
      (e) => e.code === "canonicalSourceNotReserved",
    );
    assert.equal(mutated, true);
    batch.dispose();
    dispatcher.close();
    assert.equal(memory.snapshot().bytes, 0);
  }
});
const request = {
    kind: "instrument",
    bankId: "qa",
    version: "1",
    sampleId: "s1",
  },
  rights = {
    licenseId: "cc0-1",
    sourceWorkId: "qa-original",
    commercialUse: true,
    rawRedistribution: true,
  };
function fixture({ memory = new AudioMemory(), gate = null } = {}) {
  const bytes = new Uint8Array(32).fill(7),
    sha = createHash("sha256").update(bytes).digest("hex"),
    stats = { fetch: 0, decode: 0 };
  const context = {
    sampleRate: 48000,
    createBuffer: qaBuffer,
    decodeAudioData: async () => {
      stats.decode++;
      await gate;
      const b = qaBuffer(1, 128, 48000);
      b.getChannelData(0).fill(0.02);
      return b;
    },
  };
  const registry = new InstrumentRegistry([
    {
      id: "qa",
      version: "1",
      kind: "instrument-bank",
      setId: "qa",
      tradition: "synthetic",
      laras: "none",
      samples: [
        {
          id: "s1",
          instrumentId: "qa",
          pitchId: "p1",
          articulation: "strike",
          assetPath: "/sounds/qa.wav",
          sha256: sha,
          sourceWorkId: rights.sourceWorkId,
          licenseId: rights.licenseId,
          encodedBytes: 32,
          sampleRate: 48000,
          channels: 1,
          frames: 128,
          gainTrim: 0.4,
          voicePolicy: "polyphonic",
        },
      ],
    },
  ]);
  const dispatch = createCanonicalSourceDispatcher(memory, context),
    provider = createCanonicalAssetProvider({
      context,
      memory,
      registry,
      nativeRights: [{ request, rights }],
      nativeMemoryPolicy: dispatch.nativePolicy,
      cacheOptions: {
        fetcher: async () => {
          stats.fetch++;
          return new Response(bytes);
        },
      },
    });
  dispatch.bind(provider);
  return {
    memory,
    context,
    registry,
    dispatch,
    provider,
    stats,
    async close() {
      dispatch.close();
      await provider.dispose();
    },
  };
}
test("batch reserves before cold load, hands cache ticket to actual owner, warm copies remain distinct", async () => {
  const f = fixture(),
    foreign = f.memory.reserve(313, "foreign"),
    id = f.memory.snapshot().owners[0].id;
  assert.equal(hasCanonicalSourceBatch(f.provider, f.memory), true);
  assert.equal(hasCanonicalSourceBatch(f.provider, new AudioMemory()), false);
  const a = reserveCanonicalSourceBatch(f.provider, [request], f.memory);
  assert.equal(f.stats.fetch, 0);
  assert.equal(f.memory.snapshot().bytes, 313 + 10240 + 544);
  const first = await a.load(request),
    b = reserveCanonicalSourceBatch(f.provider, [request], f.memory),
    second = await b.load(request);
  assert.notEqual(first.buffer, second.buffer);
  assert.equal(f.stats.fetch, 1);
  assert.equal(f.stats.decode, 1);
  assert.equal(f.dispatch.snapshot().pending, 0);
  assert.equal(f.dispatch.snapshot().cacheOwners, 1);
  a.dispose();
  b.dispose();
  assert.equal(a.pendingPrivate, 1);
  first.release();
  second.release();
  assert.equal(a.pendingPrivate, 0);
  await f.close();
  assert.deepEqual(
    f.memory.snapshot().owners.map((x) => x.id),
    [id],
  );
  foreign.release();
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("concurrent batches coalesce actual cache while cancellation leaves started native decode charged", async () => {
  let complete;
  const gate = new Promise((r) => (complete = r)),
    f = fixture({ gate }),
    a = reserveCanonicalSourceBatch(f.provider, [request], f.memory),
    b = reserveCanonicalSourceBatch(f.provider, [request], f.memory),
    abort = new AbortController();
  const x = a.load(request, { signal: abort.signal }),
    y = b.load(request);
  while (!f.stats.decode) await wait(1);
  abort.abort();
  a.dispose();
  await assert.rejects(x);
  assert.ok(f.memory.snapshot().bytes > 0);
  complete();
  const loan = await y;
  assert.equal(f.stats.fetch, 1);
  assert.equal(f.stats.decode, 1);
  b.dispose();
  loan.release();
  await f.close();
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("unclaimed cancellation/refusal rolls back only batch tickets and rejects forged capabilities", async () => {
  const memory = new AudioMemory({ maxBytes: 16000 }),
    f = fixture({ memory }),
    foreign = memory.reserve(313, "foreign"),
    id = memory.snapshot().owners[0].id;
  assert.throws(() =>
    reserveCanonicalSourceBatch(
      f.provider,
      [request, { ...request, sampleId: "missing" }],
      memory,
    ),
  );
  assert.deepEqual(
    memory.snapshot().owners.map((x) => x.id),
    [id],
  );
  const batch = reserveCanonicalSourceBatch(f.provider, [request], memory);
  batch.dispose();
  await assert.rejects(batch.load(request));
  await assert.rejects(
    f.provider.load(request, { sourceReservation: {} }),
    (e) => e.code === "canonicalSourceNotReserved",
  );
  assert.throws(
    () => reserveCanonicalSourceBatch(f.provider, [request], new AudioMemory()),
    (e) => e.code === "canonicalMemoryMismatch",
  );
  assert.equal(f.stats.fetch, 0);
  assert.deepEqual(
    memory.snapshot().owners.map((x) => x.id),
    [id],
  );
  await f.close();
  foreign.release();
});
test("batch reservation and fallback cache admission cannot cross reentrant dispatcher close", async () => {
  for (const kind of ["batch", "cache"]) {
    const memory = new AudioMemory({ maxBytes: 16000 }),
      f = fixture({ memory }),
      foreign = memory.reserve(313, "foreign"),
      pressure = memory.reserve(kind === "batch" ? 8000 : 15500, "pressure");
    memory.registerTrimmer("close", () => {
      f.dispatch.close();
      pressure.release();
    });
    if (kind === "batch")
      assert.throws(
        () => reserveCanonicalSourceBatch(f.provider, [request], memory),
        (e) => e.code === "canonicalProviderClosed",
      );
    else await assert.rejects(f.provider.load(request));
    assert.equal(f.stats.fetch, 0);
    await f.provider.dispose();
    assert.equal(memory.snapshot().bytes, 313);
    foreign.release();
  }
});
