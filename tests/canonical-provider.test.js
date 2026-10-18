import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import { InstrumentSampleCache } from "../src/audio/instrument-cache.js";
import { createCanonicalAssetProvider } from "../src/audio/canonical-asset-provider.js";
import { createCanonicalAssetEscrow } from "../src/audio/canonical-asset-escrow.js";
import { createCanonicalLegacyBridge } from "../src/audio/canonical-legacy-bridge.js";
import {
  reserveCanonicalVoiceOwners,
  canonicalVoiceOwners,
} from "../src/audio/canonical-voice-budget.js";
import { qaBuffer } from "./helpers/canonical-score-fixtures.js";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex"),
  deferred = () => {
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    return { promise, resolve };
  };
test("local recording scope never grants native or percussion assets a commercial-license exemption", async () => {
  const f = fixture(),
    local = {
      licenseId: "user-data-unverified",
      sourceWorkId: "user-take",
      scope: "local-project-data",
      commercialUse: null,
      rawRedistribution: null,
    };
  assert.throws(
    () =>
      createCanonicalAssetProvider({
        ...f.options,
        nativeRights: [{ request, rights: local }],
      }),
    (e) => e.code === "canonicalAssetLicense",
  );
  assert.throws(
    () =>
      createCanonicalAssetProvider({
        ...f.options,
        catalog: [
          {
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
              gainTrim: 0.3,
              contentHash: f.descriptor.sha256,
              hashKind: "encoded-asset",
            },
            rights: local,
          },
        ],
      }),
    (e) => e.code === "canonicalAssetLicense",
  );
  assert.equal(f.memory.snapshot().bytes, 0);
});
const request = {
    kind: "instrument",
    bankId: "qa",
    version: "1",
    sampleId: "s1",
  },
  right = {
    licenseId: "cc0-1",
    sourceWorkId: "qa-original",
    commercialUse: true,
    rawRedistribution: true,
  };
function fixture(
  rate = 44100,
  { memory = new AudioMemory(), holdDecode = null, badHash = false } = {},
) {
  const encoded = new Uint8Array(32).fill(7),
    sha = hash(encoded),
    stats = { fetch: 0, decode: 0 },
    descriptor = {
      id: "s1",
      instrumentId: "qa",
      pitchId: "p1",
      articulation: "strike",
      assetPath: "/sounds/qa.wav",
      sha256: sha,
      sourceWorkId: right.sourceWorkId,
      licenseId: right.licenseId,
      encodedBytes: 32,
      sampleRate: rate,
      channels: 1,
      frames: 128,
      gainTrim: 0.4,
      voicePolicy: "polyphonic",
    };
  const registry = new InstrumentRegistry([
    {
      id: "qa",
      version: "1",
      kind: "instrument-bank",
      setId: "qa",
      tradition: "synthetic",
      laras: "none",
      samples: [descriptor],
    },
  ]);
  const context = {
    sampleRate: rate,
    state: "running",
    createBuffer: qaBuffer,
    async decodeAudioData() {
      stats.decode++;
      await holdDecode?.promise;
      const b = qaBuffer(1, 128, rate);
      for (let i = 0; i < 128; i++)
        b.getChannelData(0)[i] = Math.fround(0.02 + ((i % 17) - 8) / 4096);
      return b;
    },
    async close() {
      this.state = "closed";
    },
  };
  const options = {
    context,
    memory,
    registry,
    nativeRights: [{ request, rights: right }],
    cacheOptions: {
      fetcher: async () => {
        stats.fetch++;
        return new Response(badHash ? new Uint8Array(32) : encoded);
      },
    },
  };
  return { context, memory, registry, stats, descriptor, options };
}
const until = async (f) => {
  const end = Date.now() + 3000;
  while (!f()) {
    assert.ok(Date.now() < end, "boundary did not settle");
    await wait(1);
  }
};

for (const rate of [44100, 48000])
  test(`provider units @${rate}: sync describe, lazy native decode/cache reuse, private loans`, async () => {
    const f = fixture(rate),
      p = createCanonicalAssetProvider(f.options),
      d = p.describe(request);
    assert.equal(f.stats.fetch, 0);
    assert.equal(d.frames, 128);
    assert.ok(Object.isFrozen(d));
    const a = await p.load(request),
      b = await p.load(request);
    assert.equal(f.stats.fetch, 1);
    assert.equal(f.stats.decode, 1);
    assert.notEqual(a.buffer, b.buffer);
    assert.deepEqual(a.receipt, b.receipt);
    assert.equal(a.verifiedHash, f.descriptor.sha256);
    assert.equal(a.receipt.encodedHash, f.descriptor.sha256);
    assert.equal(a.receipt.decodedHash, a.receipt.processedHash);
    const before = b.buffer.getChannelData(0)[0];
    a.buffer.getChannelData(0)[0] = 0.9;
    assert.equal(b.buffer.getChannelData(0)[0], before);
    const c = await p.load(request);
    assert.equal(
      c.buffer.getChannelData(0)[0],
      before,
      "published loan cannot mutate private cache",
    );
    const done = p.dispose();
    assert.equal(p.snapshot().disposed, false);
    a.release();
    b.release();
    c.release();
    await done;
    assert.equal(p.snapshot().disposed, true);
    assert.equal(f.memory.snapshot().bytes, 0);
  });
test("provider units: separate contexts decode separately and one disposal preserves the other", async () => {
  const memory = new AudioMemory(),
    a = fixture(44100, { memory }),
    b = fixture(44100, { memory }),
    pa = createCanonicalAssetProvider(a.options),
    pb = createCanonicalAssetProvider(b.options),
    la = await pa.load(request),
    lb = await pb.load(request);
  assert.equal(a.stats.decode, 1);
  assert.equal(b.stats.decode, 1);
  const foreign = memory
    .snapshot()
    .owners.filter((x) => x.label === "sample-load/cache")
    .at(-1).id;
  la.release();
  await pa.dispose();
  assert.ok(memory.snapshot().owners.some((x) => x.id === foreign));
  assert.ok(lb.buffer.getChannelData(0)[0] > 0);
  lb.release();
  await pb.dispose();
  assert.equal(memory.snapshot().bytes, 0);
});
test("provider units: corrupt/missing/unlicensed/poisoned identities refuse without fallback", async () => {
  const f = fixture(44100, { badHash: true }),
    p = createCanonicalAssetProvider(f.options);
  await assert.rejects(p.load(request), (e) => e.code === "assetHash");
  assert.equal(f.stats.decode, 0);
  assert.throws(
    () => p.describe({ ...request, sampleId: "missing" }),
    (e) => e.code === "unknownInstrumentSample",
  );
  assert.throws(
    () =>
      p.describe({
        kind: "phrase",
        pack: { id: "missing", version: "1", processing: "none" },
        role: "kick",
        variant: 1,
      }),
    (e) => e.code === "canonicalAssetUnavailable",
  );
  assert.throws(
    () =>
      p.describe({
        ...request,
        get extra() {
          throw Error("getter executed");
        },
      }),
    (e) => e.code === "invalidCanonicalProject",
  );
  const denied = createCanonicalAssetProvider({
    ...f.options,
    nativeRights: [],
  });
  assert.throws(
    () => denied.describe(request),
    (e) => e.code === "canonicalAssetLicense",
  );
  await denied.dispose();
  await p.dispose();
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("provider units: complete private allowance refuses before fetch and preserves a foreign ID", async () => {
  const memory = new AudioMemory({ maxBytes: 12000 }),
    foreign = memory.reserve(10000, "foreign"),
    f = fixture(44100, { memory }),
    p = createCanonicalAssetProvider(f.options),
    id = memory.snapshot().owners[0].id;
  await assert.rejects(
    p.load(request),
    (e) => e.code === "combinedMemoryLimit",
  );
  assert.equal(f.stats.fetch, 0);
  assert.equal(memory.snapshot().owners[0].id, id);
  await p.dispose();
  assert.equal(memory.snapshot().bytes, 10000);
  foreign.release();
});
test("provider units: native decode remains charged after cancellation until actual settlement", async () => {
  const gate = deferred(),
    f = fixture(44100, { holdDecode: gate }),
    foreign = f.memory.reserve(313, "foreign"),
    p = createCanonicalAssetProvider(f.options),
    abort = new AbortController(),
    job = p.load(request, { signal: abort.signal });
  await until(() => f.stats.decode === 1);
  abort.abort();
  await assert.rejects(job, (e) => e.code === "cancelled");
  await p.dispose();
  assert.ok(f.memory.snapshot().bytes > 313, "native cache job remains owned");
  gate.resolve();
  await until(() => f.memory.snapshot().bytes === 313);
  foreign.release();
});
test("provider units: late legacy acquire cannot publish after dispose; foreign data and rights survive", async () => {
  const f = fixture(),
    gate = deferred(),
    r = { kind: "percussion", pack: { id: "qa", version: "1" }, role: "kick" },
    d = {
      frames: 128,
      channels: 1,
      sampleRate: 44100,
      encodedBytes: 32,
      gainTrim: 0.3,
      contentHash: f.descriptor.sha256,
      hashKind: "encoded-asset",
    };
  let entered = false,
    released = 0;
  const p = createCanonicalAssetProvider({
    ...f.options,
    catalog: [{ request: r, descriptor: d, rights: right }],
    legacyAcquire: async () => {
      entered = true;
      await gate.promise;
      const b = qaBuffer(1, 128, 44100);
      b.getChannelData(0).fill(0.02);
      return {
        sourceHash: d.contentHash,
        buffer: b,
        release() {
          released++;
        },
      };
    },
  });
  const job = p.load(r);
  await until(() => entered);
  const close = p.dispose();
  assert.equal(p.snapshot().disposed, false);
  gate.resolve();
  await assert.rejects(job, (e) => e.code === "cancelled");
  await close;
  assert.equal(released, 1);
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("provider units: Bumi processing is once per private copy; raw cache and period stay unchanged", async () => {
  const f = fixture(),
    raw = qaBuffer(1, 128, 44100);
  raw.getChannelData(0).fill(0.02);
  const pristine = raw.getChannelData(0).slice(),
    r = {
      kind: "phrase",
      pack: {
        id: "original-groove",
        version: "0.1.0-candidate",
        processing: "bumi-presence-v1",
      },
      role: "kick",
      variant: 1,
    },
    d = {
      frames: 128,
      channels: 1,
      sampleRate: 44100,
      encodedBytes: 32,
      gainTrim: 0.3,
      contentHash: f.descriptor.sha256,
      hashKind: "encoded-asset",
    };
  let calls = 0,
    released = 0;
  const p = createCanonicalAssetProvider({
    ...f.options,
    catalog: [
      {
        request: r,
        descriptor: d,
        rights: right,
        processing: "bumi-presence-v1",
      },
    ],
    legacyAcquire: async () => {
      calls++;
      return {
        sourceHash: d.contentHash,
        buffer: raw,
        release() {
          released++;
        },
      };
    },
  });
  const a = await p.load(r),
    b = await p.load(r);
  assert.equal(calls, 2);
  assert.deepEqual(raw.getChannelData(0), pristine);
  assert.equal(a.buffer.length, 128);
  assert.equal(a.receipt.decodedHash, b.receipt.decodedHash);
  assert.equal(a.receipt.processedHash, b.receipt.processedHash);
  assert.notEqual(a.receipt.decodedHash, a.receipt.processedHash);
  a.release();
  b.release();
  await p.dispose();
  assert.equal(released, 2);
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("provider units: reentrant trimmer disposal prevents a late fetch", async () => {
  const memory = new AudioMemory({ maxBytes: 20000 }),
    foreign = memory.reserve(19000, "foreign"),
    f = fixture(44100, { memory });
  let p;
  memory.registerTrimmer("close", () => {
    foreign.release();
    void p.dispose();
  });
  p = createCanonicalAssetProvider(f.options);
  await assert.rejects(p.load(request), (e) => e.code === "cancelled");
  await p.dispose();
  assert.equal(f.stats.fetch, 0);
  assert.equal(memory.snapshot().bytes, 0);
});
test("escrow units: deduplicate a batch, transfer cache ownership, cancel only unclaimed resources", () => {
  const f = fixture(),
    d = f.descriptor,
    batch = createCanonicalAssetEscrow(f.memory, [
      d,
      { ...d },
      { ...d, sha256: "b".repeat(64) },
    ]);
  assert.equal(batch.snapshot().rows.length, 2);
  const held = batch.policy.begin(d);
  held.resize(512);
  batch.cancel();
  assert.equal(f.memory.snapshot().bytes, 512);
  assert.throws(
    () => batch.policy.begin(d),
    (e) => e.code === "cancelled",
  );
  held.release();
  held.release();
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("escrow units: rollback a refused batch preserves foreign owners", () => {
  const memory = new AudioMemory({ maxBytes: 2000 }),
    foreign = memory.reserve(1000, "foreign"),
    d = fixture().descriptor,
    id = memory.snapshot().owners[0].id;
  assert.throws(
    () =>
      createCanonicalAssetEscrow(memory, [d, { ...d, sha256: "b".repeat(64) }]),
    (e) => e.code === "combinedMemoryLimit",
  );
  assert.equal(memory.snapshot().bytes, 1000);
  assert.equal(memory.snapshot().owners[0].id, id);
  foreign.release();
});
test("legacy bridge units: pending/active/releasing compete with new owners until ended/actual close", async () => {
  const f = fixture(),
    bridge = createCanonicalLegacyBridge(f),
    pending = bridge.pending({ peak: 0.01 }),
    source = new EventTarget();
  source.context = f.context;
  pending.started(source);
  pending.releasing();
  const others = reserveCanonicalVoiceOwners(f.memory, {
    count: 15,
    peak: 0.1,
    label: "other-context",
  });
  assert.throws(
    () => bridge.pending({ peak: 0 }),
    (e) => e.code === "voiceLimit",
  );
  assert.equal(canonicalVoiceOwners(f.memory).count, 16);
  assert.throws(
    () => pending.failedBeforeStart(),
    (e) => e.code === "canonicalVoiceStillOwned",
  );
  source.dispatchEvent(new Event("ended"));
  assert.equal(
    canonicalVoiceOwners(f.memory).count,
    16,
    "ended but connected native nodes still own their ticket",
  );
  pending.disconnected();
  assert.equal(canonicalVoiceOwners(f.memory).count, 15);
  others.release();
  await bridge.close();
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("legacy bridge units: close acknowledgement releases voices/context, not foreign or retained cache pins", async () => {
  const f = fixture(),
    gate = deferred();
  f.context.close = async () => {
    await gate.promise;
    f.context.state = "closed";
  };
  const bridge = createCanonicalLegacyBridge(f),
    voice = bridge.pending({ peak: 0 }),
    cache = bridge.reserveMemory(713, "cache"),
    context = bridge.reserveMemory(1000, "context", { until: "context-close" }),
    foreign = f.memory.reserve(313, "foreign");
  const close = bridge.close();
  assert.equal(canonicalVoiceOwners(f.memory).count, 1);
  assert.ok(f.memory.snapshot().bytes > 2026);
  gate.resolve();
  await close;
  assert.equal(voice.state, "released");
  assert.equal(f.memory.snapshot().bytes, 1026);
  context.release();
  cache.release();
  assert.equal(f.memory.snapshot().bytes, 313);
  foreign.release();
});
test("legacy bridge units: failed actual close keeps tickets; retry closes without early release", async () => {
  const f = fixture(),
    bridge = createCanonicalLegacyBridge(f);
  bridge.pending({ peak: 0 });
  let calls = 0;
  f.context.close = async () => {
    if (++calls === 1) throw Error("close refused");
    f.context.state = "closed";
  };
  await assert.rejects(bridge.close(), /close refused/);
  assert.equal(canonicalVoiceOwners(f.memory).count, 1);
  await bridge.close();
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("provider units: cancelling one concurrent cache consumer preserves the other", async () => {
  const gate = deferred(),
    f = fixture(44100, { holdDecode: gate }),
    p = createCanonicalAssetProvider(f.options),
    abort = new AbortController();
  const a = p.load(request, { signal: abort.signal }),
    b = p.load(request);
  await until(() => f.stats.decode === 1);
  abort.abort();
  await assert.rejects(a, (e) => e.code === "cancelled");
  assert.equal(p.snapshot().jobs, 1);
  gate.resolve();
  const loan = await b;
  assert.equal(f.stats.fetch, 1);
  assert.equal(f.stats.decode, 1);
  assert.ok(loan.buffer.getChannelData(0)[0] > 0);
  loan.release();
  await p.dispose();
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("provider units: forged legacy receipt, wrong geometry and nonfinite PCM release their exact loan", async () => {
  for (const mode of ["receipt", "geometry", "pcm"]) {
    const f = fixture(),
      r = {
        kind: "bilah",
        pack: { id: "bilah", version: "1.0.0" },
        pitch: "d4",
      },
      d = {
        frames: 128,
        channels: 1,
        sampleRate: 44100,
        encodedBytes: 32,
        gainTrim: 0.3,
        contentHash: f.descriptor.sha256,
        hashKind: "encoded-asset",
      };
    let released = 0;
    const p = createCanonicalAssetProvider({
      ...f.options,
      catalog: [{ request: r, descriptor: d, rights: right }],
      legacyAcquire: async () => {
        const b = qaBuffer(1, mode === "geometry" ? 127 : 128, 44100);
        b.getChannelData(0).fill(mode === "pcm" ? NaN : 0.02);
        return {
          sourceHash: mode === "receipt" ? "0".repeat(64) : d.contentHash,
          buffer: b,
          release() {
            released++;
          },
        };
      },
    });
    await assert.rejects(
      p.load(r),
      (e) =>
        e.code ===
        (mode === "receipt"
          ? "canonicalAssetIdentityMismatch"
          : "invalidCanonicalSample"),
    );
    await p.dispose();
    assert.equal(released, 1);
    assert.equal(f.memory.snapshot().bytes, 0);
  }
});
test("provider units: recording loans retain exact raw period/hash and reject alias geometry", async () => {
  const f = fixture(),
    raw = qaBuffer(1, 128, 44100);
  raw.getChannelData(0).fill(0.02);
  const bytes = new Uint8Array(128 * 4),
    view = new DataView(bytes.buffer);
  for (let i = 0; i < 128; i++)
    view.setFloat32(i * 4, raw.getChannelData(0)[i], true);
  const sha = hash(bytes),
    asset = {
      id: "owned-take",
      sha256: sha,
      frames: 128,
      channels: 1,
      sampleRate: 44100,
    },
    r = { kind: "recording", asset },
    d = {
      ...asset,
      encodedBytes: 0,
      gainTrim: 1,
      contentHash: sha,
      hashKind: "decoded-pcm",
    };
  const p = createCanonicalAssetProvider({
    ...f.options,
    catalog: [{ request: r, descriptor: d, rights: right }],
    legacyAcquire: async () => ({ sourceHash: sha, buffer: raw, release() {} }),
  });
  assert.throws(
    () => p.describe({ ...r, asset: { ...asset, frames: 127 } }),
    (e) => e.code === "canonicalAssetIdentityMismatch",
  );
  const loan = await p.load(r);
  assert.equal(loan.receipt.decodedHash, sha);
  assert.equal(loan.buffer.length, 128);
  assert.deepEqual(loan.buffer.getChannelData(0), raw.getChannelData(0));
  loan.release();
  await p.dispose();
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("escrow units: real cache claims pre-reserved decode allowance and keeps it through eviction", async () => {
  const f = fixture(),
    foreign = f.memory.reserve(313, "foreign"),
    batch = createCanonicalAssetEscrow(f.memory, [f.descriptor]),
    before = f.memory.snapshot().bytes,
    cache = new InstrumentSampleCache(f.context, f.registry, {
      ...f.options.cacheOptions,
      memoryPolicy: batch.policy,
    });
  const loan = await cache.acquire("qa", "1", "s1");
  assert.equal(f.stats.fetch, 1);
  assert.ok(f.memory.snapshot().bytes < before);
  batch.cancel();
  assert.equal(f.memory.snapshot().bytes, 313 + 512);
  loan.release();
  cache.dispose();
  await until(() => f.memory.snapshot().bytes === 313);
  foreign.release();
});
test("legacy bridge units: context mismatch keeps a pending ticket for explicit failed-start cleanup", async () => {
  const f = fixture(),
    bridge = createCanonicalLegacyBridge(f),
    p = bridge.pending({ peak: 0 }),
    voice = new EventTarget();
  voice.context = {};
  assert.throws(
    () => p.started(voice),
    (e) => e.code === "invalidCanonicalOwner",
  );
  assert.equal(canonicalVoiceOwners(f.memory).count, 1);
  p.failedBeforeStart();
  await bridge.close();
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("legacy bridge units: reentrant trim/close cannot publish a new pending owner", async () => {
  const memory = new AudioMemory({ maxBytes: 20000 }),
    foreign = memory.reserve(19000, "foreign"),
    f = fixture(44100, { memory }),
    bridge = createCanonicalLegacyBridge(f);
  memory.registerTrimmer("close", () => {
    foreign.release();
    void bridge.close();
  });
  assert.throws(
    () => bridge.pending({ peak: 0 }),
    (e) => e.code === "canonicalBridgeClosed",
  );
  await bridge.close();
  assert.equal(canonicalVoiceOwners(memory).count, 0);
  assert.equal(memory.snapshot().bytes, 0);
});
test("legacy bridge units: a late ended event after actual close cannot resurrect ownership", async () => {
  const f = fixture(),
    bridge = createCanonicalLegacyBridge(f),
    p = bridge.pending({ peak: 0 }),
    source = new EventTarget();
  source.context = f.context;
  p.started(source);
  await bridge.close();
  source.dispatchEvent(new Event("ended"));
  assert.equal(p.state, "released");
  p.failedBeforeStart();
  assert.equal(canonicalVoiceOwners(f.memory).count, 0);
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("legacy bridge units: early legacy disconnection still waits for native ended", async () => {
  const f = fixture(),
    bridge = createCanonicalLegacyBridge(f),
    p = bridge.pending({ peak: 0 }),
    source = new EventTarget();
  source.context = f.context;
  p.started(source);
  p.disconnected();
  assert.equal(canonicalVoiceOwners(f.memory).count, 1);
  source.dispatchEvent(new Event("ended"));
  assert.equal(p.state, "released");
  assert.equal(canonicalVoiceOwners(f.memory).count, 0);
  await bridge.close();
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("provider/escrow units: valid source geometry larger than the pool refuses before acquisition", async () => {
  const f = fixture(),
    foreign = f.memory.reserve(313, "foreign"),
    r = { kind: "bilah", pack: { id: "bilah", version: "1.0.0" }, pitch: "d4" },
    d = {
      frames: 8388608,
      channels: 2,
      sampleRate: 44100,
      encodedBytes: 32,
      gainTrim: 0.3,
      contentHash: f.descriptor.sha256,
      hashKind: "encoded-asset",
    };
  let acquired = 0;
  const p = createCanonicalAssetProvider({
    ...f.options,
    catalog: [{ request: r, descriptor: d, rights: right }],
    legacyAcquire: async () => {
      acquired++;
      throw Error("must not acquire");
    },
  });
  await assert.rejects(p.load(r), (e) => e.code === "combinedMemoryLimit");
  assert.equal(acquired, 0);
  assert.throws(
    () =>
      createCanonicalAssetEscrow(f.memory, [
        { ...f.descriptor, frames: 8388608, channels: 2 },
      ]),
    (e) => e.code === "combinedMemoryLimit",
  );
  await p.dispose();
  assert.equal(f.memory.snapshot().bytes, 313);
  foreign.release();
});
test("escrow regression: differently sized actual-cache claim refuses before fetch without consuming ticket", async () => {
  const memory = new AudioMemory({ maxBytes: 2048 }),
    encoded = new Uint8Array(65536).fill(7),
    d = { ...fixture().descriptor, sha256: hash(encoded), encodedBytes: 65536 },
    registry = new InstrumentRegistry([
      {
        id: "qa",
        version: "1",
        kind: "instrument-bank",
        setId: "qa",
        tradition: "synthetic",
        laras: "none",
        samples: [d],
      },
    ]),
    escrow = createCanonicalAssetEscrow(memory, [{ ...d, encodedBytes: 1 }]);
  let fetches = 0;
  const f = fixture(),
    cache = new InstrumentSampleCache(f.context, registry, {
      memoryPolicy: escrow.policy,
      fetcher: async () => {
        fetches++;
        return new Response(encoded);
      },
    });
  await assert.rejects(
    cache.acquire("qa", "1", "s1"),
    (e) => e.code === "canonicalAssetNotReserved",
  );
  assert.equal(fetches, 0);
  assert.equal(escrow.snapshot().rows[0].state, "reserved");
  assert.equal(memory.snapshot().bytes, 513);
  cache.dispose();
  escrow.cancel();
  assert.equal(memory.snapshot().bytes, 0);
});
test("recording regression: finite overrange PCM is lossless and safe attenuation is a separate admission", async () => {
  const f = fixture(),
    raw = qaBuffer(1, 128, 44100);
  raw.getChannelData(0).fill(1.25);
  const sha = hash(new Uint8Array(raw.getChannelData(0).buffer)),
    asset = {
      id: "overrange",
      sha256: sha,
      frames: 128,
      channels: 1,
      sampleRate: 44100,
    },
    r = { kind: "recording", asset },
    d = {
      frames: 128,
      channels: 1,
      sampleRate: 44100,
      encodedBytes: 0,
      gainTrim: 1,
      contentHash: sha,
      hashKind: "decoded-pcm",
    },
    p = createCanonicalAssetProvider({
      ...f.options,
      catalog: [{ request: r, descriptor: d, rights: right }],
      legacyAcquire: async () => ({
        sourceHash: sha,
        buffer: raw,
        release() {},
      }),
    });
  const loan = await p.load(r);
  assert.equal(loan.receipt.decodedHash, sha);
  assert.equal(loan.receipt.recordingDiagnostics.peak, 1.25);
  assert.equal(loan.buffer.getChannelData(0)[0], 1.25);
  assert.deepEqual(loan.buffer.getChannelData(0), raw.getChannelData(0));
  const { canonicalVoiceAdmission } =
      await import("../src/audio/canonical-score.js"),
    eq = { version: 1, bypass: true, lowDb: 0, midDb: 0, highDb: 0 },
    event = {
      trackId: "r",
      spec: {
        buffer: loan.buffer,
        startFrame: 0,
        endFrame: 128,
        peak: 1.25,
        velocity: 1,
        scale: 4,
        pan: 0,
      },
    },
    project = {
      master: { volume: 1 },
      tracks: [{ id: "r", gain: 0.1, pan: 0, mute: false, solo: false, eq }],
    };
  assert.ok(canonicalVoiceAdmission([event], project, 44100).maxPeak < 0.95);
  project.tracks[0].gain = 1;
  assert.throws(
    () => canonicalVoiceAdmission([event], project, 44100),
    (e) => e.code === "voiceHeadroom",
  );
  loan.release();
  await p.dispose();
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("recording regression: values above16 and nonfinite PCM reject without clamping", async () => {
  for (const value of [16.01, NaN]) {
    const f = fixture(),
      raw = qaBuffer(1, 128, 44100);
    raw.getChannelData(0).fill(value);
    const sha = hash(new Uint8Array(raw.getChannelData(0).buffer)),
      asset = {
        id: "bad",
        sha256: sha,
        frames: 128,
        channels: 1,
        sampleRate: 44100,
      },
      r = { kind: "recording", asset },
      d = {
        frames: 128,
        channels: 1,
        sampleRate: 44100,
        encodedBytes: 0,
        gainTrim: 1,
        contentHash: sha,
        hashKind: "decoded-pcm",
      };
    let released = 0;
    const p = createCanonicalAssetProvider({
      ...f.options,
      catalog: [{ request: r, descriptor: d, rights: right }],
      legacyAcquire: async () => ({
        sourceHash: sha,
        buffer: raw,
        release() {
          released++;
        },
      }),
    });
    await assert.rejects(p.load(r));
    await p.dispose();
    assert.equal(released, 1);
    assert.ok(Object.is(raw.getChannelData(0)[0], Math.fround(value)));
    assert.equal(f.memory.snapshot().bytes, 0);
  }
});
test("cleanup regression: failed unpublished source release rejects disposal and retains ownership for retry", async () => {
  const f = fixture(),
    foreign = f.memory.reserve(313, "foreign"),
    gate = deferred(),
    r = { kind: "percussion", pack: { id: "qa", version: "1" }, role: "kick" },
    d = {
      frames: 128,
      channels: 1,
      sampleRate: 44100,
      encodedBytes: 32,
      gainTrim: 0.3,
      contentHash: f.descriptor.sha256,
      hashKind: "encoded-asset",
    };
  let shouldFail = true,
    releases = 0;
  const p = createCanonicalAssetProvider({
    ...f.options,
    catalog: [{ request: r, descriptor: d, rights: right }],
    legacyAcquire: async () => {
      await gate.promise;
      const b = qaBuffer(1, 128, 44100);
      b.getChannelData(0).fill(0.1);
      return {
        sourceHash: d.contentHash,
        buffer: b,
        release() {
          releases++;
          if (shouldFail) throw Error("release fault");
        },
      };
    },
  });
  const job = p.load(r),
    close = p.dispose();
  gate.resolve();
  await assert.rejects(job, /release fault/);
  await assert.rejects(
    close,
    (e) => e.code === "canonicalProviderCleanupPending",
  );
  assert.equal(p.snapshot().pendingCleanup, 1);
  assert.ok(
    f.memory.snapshot().bytes > 313,
    "unacknowledged source stays charged",
  );
  await assert.rejects(
    p.dispose(),
    (e) => e.code === "canonicalProviderCleanupPending",
  );
  shouldFail = false;
  await p.dispose();
  assert.ok(releases >= 3);
  assert.equal(p.snapshot().disposed, true);
  assert.equal(f.memory.snapshot().bytes, 313);
  foreign.release();
});
