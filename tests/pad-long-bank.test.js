import test from "node:test";
import assert from "node:assert/strict";
import { SampleBank, validatePack } from "../src/audio/sample-bank.js";
import { contextLoadQueue } from "../src/audio/load-queue.js";
const pack = (seconds = 6) => ({
  schemaVersion: 1,
  id: "standalone-sustain-test",
  kind: "one-shot",
  bpm: 120,
  bars: 1,
  beatsPerBar: 4,
  stems: [
    {
      id: "a",
      url: "synthetic-a",
      licenseId: "test-fixture",
      gainTrim: 0.2,
      durationSeconds: seconds,
    },
  ],
});
const pcm = (seconds = 6, rate = 8000, channels = 1) => {
  const data = Array.from({ length: channels }, () =>
    Float32Array.from(
      { length: seconds * rate },
      (_, i) => 0.1 * Math.sin(i / 9),
    ),
  );
  return {
    duration: seconds,
    sampleRate: rate,
    numberOfChannels: channels,
    length: seconds * rate,
    getChannelData: (n) => data[n],
  };
};
const fetcher = async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  }),
  flush = async () => {
    for (let i = 0; i < 40; i++) await Promise.resolve();
  };
test("long delivery profile is explicit and bounded; ordinary Studio contract remains two seconds", () => {
  assert.throws(() => validatePack(pack()));
  assert.throws(() => new SampleBank(pack()));
  assert.doesNotThrow(() => validatePack(pack(), { maxOneShotSeconds: 8 }));
  assert.throws(() => validatePack(pack(8.001), { maxOneShotSeconds: 8 }));
  for (const n of [0, 1, 31, Infinity, NaN, "8", 8.5])
    assert.throws(() => new SampleBank(pack(), { maxOneShotSeconds: n }));
  assert.doesNotThrow(() => new SampleBank(pack(2)));
});
test("retained cache eviction reloads without resurrecting disposed banks", async () => {
  let decodes = 0;
  const ctx = {
      decodeAudioData: async () => {
        decodes++;
        return pcm();
      },
    },
    bank = new SampleBank(pack(), { fetcher, maxOneShotSeconds: 8 });
  await bank.load("a", ctx);
  assert(bank.verifyRetained("a"));
  assert.equal(bank.get("a").metrics.bytes, 192000);
  bank.evictCache();
  assert.equal(bank.get("a").buffer, null);
  assert.equal(bank.get("a").metrics, null);
  assert.equal(bank.get("a").state, "idle");
  await bank.load("a", ctx);
  assert.equal(decodes, 2);
  assert(bank.verifyRetained("a"));
  bank.dispose();
  bank.evictCache();
  assert.equal(bank.get("a").state, "disposed");
  await assert.rejects(bank.load("a", ctx));
});
for (const reject of [false, true])
  test(
    "eviction preserves real native lease until " +
      (reject ? "rejection" : "resolution") +
      " and refuses late admission",
    async () => {
      let resolve, rejectNative;
      const held = new Promise((a, b) => {
        resolve = a;
        rejectNative = b;
      });
      let phase = 0,
        admitted = 0;
      const ctx = {
          decodeAudioData: () =>
            phase++ === 0 ? held : Promise.resolve(pcm()),
        },
        bank = new SampleBank(pack(), {
          fetcher,
          maxOneShotSeconds: 8,
          validateCandidate: () => admitted++,
        });
      const old = bank.load("a", ctx);
      await flush();
      assert.equal(contextLoadQueue(ctx).snapshot().nativeDecodes, 1);
      bank.evictCache();
      assert.equal(await old, null);
      assert.equal(contextLoadQueue(ctx).snapshot().nativeDecodes, 1);
      assert.equal(admitted, 0);
      if (reject) rejectNative(Error("native old"));
      else resolve(pcm());
      await flush();
      assert.equal(contextLoadQueue(ctx).snapshot().nativeDecodes, 0);
      assert.equal(bank.get("a").buffer, null);
      assert.equal(admitted, 0);
      await bank.load("a", ctx);
      assert.equal(admitted, 1);
      assert(bank.verifyRetained("a"));
      assert.equal(
        admitted,
        2,
        "retained verification rechecks admission budget",
      );
      bank.dispose();
    },
  );
test("extended duration never changes encoded four MiB limit", async () => {
  let bodies = 0;
  const bank = new SampleBank(pack(), {
    maxOneShotSeconds: 8,
    fetcher: async () => ({
      ok: true,
      headers: {
        get: (k) =>
          k === "content-length" ? String(4 * 1024 * 1024 + 1) : null,
      },
      arrayBuffer: async () => {
        bodies++;
        return new ArrayBuffer(1);
      },
    }),
  });
  await bank.load("a", {
    decodeAudioData: () => {
      throw Error("must not decode");
    },
  });
  assert.equal(bodies, 0);
  assert.match(bank.get("a").error, /size limit/);
  bank.dispose();
});
test("extended profile keeps the thirty-two MiB decoded bank cap", async () => {
  const p = pack(8);
  p.stems = ["a", "b", "c"].map((id) => ({ ...p.stems[0], id, url: id }));
  const ctx = { decodeAudioData: async () => pcm(8, 192000, 2) },
    bank = new SampleBank(p, { maxOneShotSeconds: 8, fetcher });
  await bank.load("a", ctx);
  await bank.load("b", ctx);
  await bank.load("c", ctx);
  assert(bank.get("a").buffer && bank.get("b").buffer);
  assert.equal(bank.get("c").buffer, null);
  assert.match(bank.get("c").error, /memory limit/);
  assert.equal(
    [...bank.entries.values()].reduce((n, e) => n + (e.metrics?.bytes || 0), 0),
    24576000,
  );
  bank.dispose();
});
