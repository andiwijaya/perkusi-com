import test from "node:test";
import assert from "node:assert/strict";
import {
  InstrumentRegistry,
  inspectInstrumentBuffer,
  inspectUserTake,
} from "../src/audio/instrument-registry.js";
import { inspectBuffer, validatePack } from "../src/audio/sample-bank.js";
import { ResourceBudget } from "../src/audio/resource-budget.js";
const sample = () => ({
  id: "test-note",
  instrumentId: "test",
  pitchId: "p1",
  articulation: "strike",
  assetPath: "/sounds/test.wav",
  sha256: "b".repeat(64),
  sourceWorkId: "test-work",
  licenseId: "qa-only",
  encodedBytes: 256,
  sampleRate: 8000,
  channels: 1,
  frames: 8000,
  gainTrim: 1,
  voicePolicy: "protected-tail",
});
const bank = () => ({
  id: "test-bank",
  version: "1.0",
  kind: "instrument-bank",
  setId: "test-set",
  tradition: "qa-synthetic",
  laras: "none",
  samples: [sample()],
});
const buffer = (frames = 8000, rate = 8000, channels = 1, value = 0.1) => {
  const backing = Array.from({ length: channels }, () =>
    new Float32Array(frames).fill(value),
  );
  return {
    length: frames,
    sampleRate: rate,
    numberOfChannels: channels,
    duration: frames / rate,
    getChannelData: (c) => backing[c],
  };
};
test("S1 registry is immutable and resolves exact bank/version/sample identity without I/O", () => {
  const b = bank(),
    r = new InstrumentRegistry([b]);
  b.samples[0].assetPath = "/sounds/changed.wav";
  const resolved = r.sample("test-bank", "1.0", "test-note");
  assert.equal(resolved.assetPath, "/sounds/test.wav");
  assert.ok(Object.isFrozen(resolved));
  assert.throws(() => r.sample("test-bank", "2", "test-note"));
  assert.throws(() => r.sample("test-bank", "1.0", "missing"));
  assert.throws(() => new InstrumentRegistry([bank(), bank()]));
  assert.throws(() => new InstrumentRegistry(Array(1)));
  const old = bank(),
    newer = bank();
  newer.version = "2";
  const versions = new InstrumentRegistry([old, newer]);
  assert.equal(versions.bank("test-bank", "1.0").version, "1.0");
  let getterCalls = 0;
  const accessor = bank();
  Object.defineProperty(accessor.samples[0], "assetPath", {
    enumerable: true,
    get() {
      getterCalls++;
      return "/sounds/test.wav";
    },
  });
  assert.throws(() => new InstrumentRegistry([accessor]));
  assert.equal(getterCalls, 0);
});
test("S1 registry rejects unsafe paths, forged identity and impossible bounded geometry", () => {
  for (const edit of [
    (s) => (s.assetPath = "https://evil/test.wav"),
    (s) => (s.assetPath = "C:/test.wav"),
    (s) => (s.assetPath = "/sounds/../test.wav"),
    (s) => (s.assetPath = "/sounds/%2e%2e/test.wav"),
    (s) => (s.assetPath = "/sounds/a.wav?x"),
    (s) => (s.assetPath = "/sounds//a.wav"),
    (s) => (s.sha256 = "f".repeat(63)),
    (s) => (s.frames = 0),
    (s) => (s.frames = 8388609),
    (s) => (s.sampleRate = 192001),
    (s) => (s.channels = 3),
    (s) => (s.encodedBytes = 16777217),
    (s) => (s.gainTrim = Infinity),
    (s) => (s.tuningHz = 440),
    (s) => (s.voicePolicy = "steal-any"),
  ]) {
    const b = bank();
    edit(b.samples[0]);
    assert.throws(() => new InstrumentRegistry([b]));
  }
  const b = bank();
  b.samples.push({ ...b.samples[0] });
  assert.throws(() => new InstrumentRegistry([b]));
  const long = bank();
  Object.assign(long.samples[0], {
    frames: 48000 * 30,
    sampleRate: 48000,
    channels: 2,
    encodedBytes: 16 * 1024 * 1024,
  });
  assert.equal(
    new InstrumentRegistry([long]).sample("test-bank", "1.0", "test-note")
      .frames,
    1440000,
  );
  for (const rate of [44100, 48000]) {
    const full = bank(),
      frames = Math.round(44.965 * rate);
    Object.assign(full.samples[0], {
      sampleRate: rate,
      channels: 2,
      frames,
      encodedBytes: 7948076,
    });
    const resolved = new InstrumentRegistry([full]).sample(
      "test-bank",
      "1.0",
      "test-note",
    );
    assert.equal(resolved.frames, frames);
    assert.ok(resolved.frames / rate > 44.9649);
    assert.ok(frames * 2 * 4 < 32 * 1024 * 1024);
  }
  const exact = bank();
  Object.assign(exact.samples[0], {
    frames: 4194304,
    channels: 2,
    sampleRate: 48000,
  });
  assert.equal(
    new InstrumentRegistry([exact]).sample("test-bank", "1.0", "test-note")
      .frames * 8,
    33554432,
  );
  exact.samples[0].frames++;
  assert.throws(() => new InstrumentRegistry([exact]));
});
test("S1 official versus raw take PCM admission preserves silence and overrange only for takes", () => {
  assert.equal(inspectInstrumentBuffer(buffer(), sample()).bytes, 32000);
  for (const value of [0, 1.129802]) {
    const b = buffer(8000, 8000, 1, value),
      backing = b.getChannelData(0),
      before = backing.slice();
    const info = inspectUserTake(b);
    assert.equal(info.silent, value === 0);
    assert.equal(info.overrange, value > 1);
    assert.equal(b.getChannelData(0), backing);
    assert.deepEqual(backing, before);
    assert.throws(() => inspectInstrumentBuffer(b, sample()));
    assert.throws(() => inspectBuffer(b, 1));
    assert.deepEqual(backing, before);
  }
  assert.equal(inspectUserTake(buffer(1, 8000, 1, 16)).peak, 16);
  for (const value of [NaN, Infinity, 16 + 2 ** -19]) {
    const b = buffer(1, 8000, 1, value),
      backing = b.getChannelData(0),
      before = backing.slice();
    assert.throws(
      () => inspectUserTake(b),
      (e) =>
        e.code ===
        (Number.isFinite(value) ? "takeLevelLimit" : "malformedTakePCM"),
    );
    assert.equal(b.getChannelData(0), backing);
    assert.deepEqual(backing, before);
  }
  for (const b of [
    buffer(0),
    buffer(256001),
    buffer(1, 7999),
    buffer(1, 8000, 3),
    { ...buffer(), getChannelData: () => new Float32Array(3) },
  ])
    assert.throws(() => inspectUserTake(b));
  assert.throws(() => inspectInstrumentBuffer(buffer(8001), sample()));
  const legacy = {
    schemaVersion: 1,
    id: "old",
    bpm: 96,
    beatsPerBar: 4,
    bars: 1,
    kind: "one-shot",
    stems: [
      {
        id: "x",
        url: "/sounds/x.wav",
        licenseId: "x",
        gainTrim: 1,
        durationSeconds: 3,
      },
    ],
  };
  assert.throws(() => validatePack(legacy));
});
test("S1 aggregate allocations count shared pins once and reject atomic budget/geometry growth", () => {
  const b = new ResourceBudget({ maxBytes: 100 });
  b.reserve({ id: "a", bytes: 80, category: "cache" });
  b.pin("a", "undo");
  b.pin("a", "pending");
  assert.equal(b.snapshot().bytes, 80);
  assert.throws(() => b.release("a"));
  const before = b.snapshot();
  assert.throws(() => b.reserve({ id: "b", bytes: 21, category: "render" }));
  assert.deepEqual(b.snapshot(), before);
  assert.throws(() => b.resize("a", 101));
  assert.deepEqual(b.snapshot(), before);
  assert.throws(() => b.revalidate("a", 81));
  assert.deepEqual(b.snapshot(), before);
  assert.equal(b.revalidate("a", 80).bytes, 80);
  b.unpin("a", "undo");
  b.unpin("a", "pending");
  b.release("a");
  assert.equal(b.snapshot().bytes, 0);
  assert.throws(() => new ResourceBudget({ maxBytes: 67108865 }));
  assert.throws(() => new ResourceBudget({ maxBytes: -1 }));
});
test("S1 native completion admits actual bytes or discards terminally; cancellation/rejection release slots", () => {
  const b = new ResourceBudget({ maxBytes: 1000 });
  b.reserve({
    id: "a",
    bytes: 100,
    category: "decode",
    logical: true,
    native: true,
  });
  b.reserve({
    id: "b",
    bytes: 100,
    category: "decode",
    logical: true,
    native: true,
  });
  assert.throws(() =>
    b.reserve({
      id: "c",
      bytes: 100,
      category: "decode",
      logical: true,
      native: true,
    }),
  );
  b.cancel("a");
  assert.equal(b.snapshot().native, 2);
  assert.equal(b.snapshot().logical, 1);
  assert.equal(b.snapshot().bytes, 200);
  b.reserve({
    id: "c",
    bytes: 100,
    category: "decode",
    logical: true,
    native: true,
  });
  b.cancel("b");
  b.cancel("c");
  b.reserve({
    id: "d",
    bytes: 100,
    category: "decode",
    logical: true,
    native: true,
  });
  b.cancel("d");
  assert.equal(b.snapshot().native, 4);
  assert.throws(() =>
    b.reserve({ id: "e", bytes: 1, category: "decode", native: true }),
  );
  assert.throws(() => b.release("a"));
  let discarded = 0;
  const discard = () => discarded++;
  assert.equal(b.settle("a", 100, "cache", { discard }), false);
  assert.equal(b.snapshot().bytes, 300);
  assert.equal(b.snapshot().native, 3);
  b.reserve({
    id: "e",
    bytes: 100,
    category: "decode",
    logical: true,
    native: true,
  });
  const unrelated = b.snapshot().allocations.filter((e) => e.id !== "e");
  let actualOutput = { byteLength: 901 };
  assert.throws(
    () =>
      b.settle("e", actualOutput.byteLength, "cache", {
        discard: () => {
          actualOutput = null;
          discarded++;
        },
      }),
    (e) => e.code === "budgetExceeded",
  );
  assert.equal(actualOutput, null);
  assert.deepEqual(b.snapshot().allocations, unrelated);
  assert.equal(b.snapshot().native, 3);
  assert.throws(() => b.settle("e", 200, "cache", { discard }));
  assert.throws(() =>
    b.reserve({ id: "e", bytes: 100, category: "decode", native: true }),
  );
  b.reserve({
    id: "fresh",
    bytes: 100,
    category: "decode",
    logical: true,
    native: true,
  });
  assert.equal(b.settle("fresh", 200, "cache", { discard }), true);
  assert.equal(b.snapshot().bytes, 500);
  assert.equal(b.snapshot().logical, 0);
  for (const id of ["b", "c", "d"])
    assert.equal(b.settle(id, 100, "cache", { discard }), false);
  assert.equal(b.snapshot().bytes, 200);
  assert.equal(discarded, 5);
  b.release("fresh");
  assert.equal(b.snapshot().bytes, 0);
  b.reserve({
    id: "rejected",
    bytes: 100,
    category: "decode",
    logical: true,
    native: true,
  });
  b.reject("rejected");
  assert.throws(() => b.reject("rejected"));
  assert.throws(() => b.settle("unknown", 1, "cache", { discard }));
  assert.equal(b.snapshot().native, 0);
  assert.equal(b.snapshot().logical, 0);
  assert.equal(b.snapshot().bytes, 0);
  b.reserve({ id: "bad-output", bytes: 100, category: "decode", native: true });
  assert.throws(() =>
    b.settle("bad-output", 1001, "cache", {
      discard: () => {
        throw Error("discard callback failed");
      },
    }),
  );
  assert.equal(b.snapshot().native, 0);
  const pinned = new ResourceBudget({ maxBytes: 1000 });
  pinned.reserve({ id: "original", bytes: 800, category: "cache" });
  pinned.pin("original", "undo");
  pinned.reserve({
    id: "result",
    bytes: 100,
    category: "decode",
    native: true,
    logical: true,
  });
  let discardedActual = 0;
  assert.throws(
    () =>
      pinned.settle("result", 901, "cache", {
        discard: () => {
          discardedActual++;
          assert.equal(pinned.snapshot().native, 0);
          pinned.reserve({ id: "after-cleanup", bytes: 1, category: "cache" });
        },
      }),
    (e) => e.code === "budgetExceeded",
  );
  assert.equal(discardedActual, 1);
  assert.deepEqual(pinned.revalidate("original", 800).pins, ["undo"]);
  assert.equal(pinned.snapshot().bytes, 801);
  assert.throws(() => pinned.release("original"));
});
