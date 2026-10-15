import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { InstrumentSampleCache } from "../src/audio/instrument-cache.js";
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import {
  emptyInstrumentTake,
  appendInstrumentEvent,
  takePlan,
  assertEmptyLegacyLayer,
} from "../src/project/instrument-take.js";
import {
  PPQ,
  parseInstrumentProject,
} from "../src/project/instrument-project.js";
import { instrumentVoice } from "../src/audio/instrument-voice.js";
import {
  instrumentWavHeader,
  scheduleInstrumentChunk,
} from "../src/audio/instrument-renderer.js";
import { focusCopy } from "../src/gamelan/focus-copy.js";
const body = (i) => new Uint8Array(32).fill(i),
  sha = (i) => createHash("sha256").update(body(i)).digest("hex");
const bank = (rate) => ({
  id: "qa",
  version: "1",
  kind: "instrument-bank",
  setId: "qa",
  tradition: "qa",
  laras: "none",
  samples: [1, 2, 3].map((i) => ({
    id: "s" + i,
    instrumentId: "qa",
    pitchId: "p" + i,
    articulation: "strike",
    assetPath: "/sounds/s" + i + ".wav",
    sha256: sha(i),
    sourceWorkId: "qa" + i,
    licenseId: "qa",
    encodedBytes: 32,
    sampleRate: rate,
    channels: 1,
    frames: 8,
    gainTrim: 1,
    voicePolicy: "polyphonic",
  })),
});
const pcm = (rate) => {
  const values = new Float32Array(8).fill(0.25);
  return {
    length: 8,
    sampleRate: rate,
    numberOfChannels: 1,
    duration: 8 / rate,
    getChannelData: () => values,
  };
};
const until = async (fn) => {
  const end = Date.now() + 3000;
  while (!fn()) {
    assert.ok(Date.now() < end, "native adapter did not settle");
    await pause(1);
  }
};
const fixture = (memory, { pending = null } = {}) => {
  const context = {
    sampleRate: 8000,
    decodeAudioData: async () =>
      pending
        ? new Promise((resolve) => pending.push(() => resolve(pcm(8000))))
        : pcm(8000),
  };
  const cache = new InstrumentSampleCache(
    context,
    new InstrumentRegistry([bank(8000)]),
    {
      memoryPolicy: memory.cachePolicy(context),
      fetcher: async (path) =>
        new Response(body(Number(/s(\d)/.exec(path)[1]))),
    },
  );
  const untrim = memory.registerTrimmer(cache, () => cache.trim());
  return {
    cache,
    context,
    untrim,
    get: (i = 1, o) => cache.acquire("qa", "1", "s" + i, o),
  };
};

test("S3 aggregate admission counts two contexts plus render/legacy/output and cannot evict foreign pins", async () => {
  const memory = new AudioMemory({ maxBytes: 128 }),
    a = fixture(memory),
    b = fixture(memory),
    one = await a.get(),
    two = await b.get();
  assert.equal(memory.snapshot().bytes, 64);
  assert.throws(
    () => memory.reserve(65, "render"),
    (e) => e.code === "combinedMemoryLimit",
  );
  assert.equal(one.buffer.length, 8);
  assert.equal(two.buffer.length, 8);
  one.release();
  const render = memory.reserve(96, "render/legacy/output");
  assert.equal(memory.snapshot().bytes, 128);
  assert.equal(two.buffer.length, 8);
  render.release();
  two.release();
  a.cache.dispose();
  b.cache.dispose();
  a.untrim();
  b.untrim();
  assert.equal(memory.snapshot().bytes, 0);
  assert.equal(memory.snapshot().history.storedIds, 0);
});
test("S3 retained render/voice lease survives abort of loading scope and belongs to its own facade", async () => {
  const memory = new AudioMemory(),
    f = fixture(memory),
    abort = new AbortController(),
    raw = await f.get(1, { signal: abort.signal }),
    held = raw.retain();
  abort.abort();
  assert.throws(() => raw.buffer);
  assert.equal(held.buffer.length, 8);
  f.cache.trim();
  assert.equal(memory.snapshot().bytes, 32);
  held.release();
  f.cache.trim();
  assert.equal(memory.snapshot().bytes, 0);
  f.cache.dispose();
  f.untrim();
});
test("S3 global native gate across three cache contexts holds four canceled native operations until actual settle", async () => {
  const memory = new AudioMemory({ maxBytes: 4096 }),
    pending = [],
    a = fixture(memory, { pending }),
    b = fixture(memory, { pending }),
    c = fixture(memory, { pending }),
    controllers = Array.from({ length: 5 }, () => new AbortController());
  const requests = [
    a.get(1, { signal: controllers[0].signal }),
    a.get(2, { signal: controllers[1].signal }),
    b.get(1, { signal: controllers[2].signal }),
    b.get(2, { signal: controllers[3].signal }),
    c.get(1, { signal: controllers[4].signal }),
  ];
  const rejected = requests.map((p) =>
    assert.rejects(p, (e) => e.code === "cancelled"),
  );
  await until(
    () =>
      pending.length === 4 &&
      memory.snapshot().globalDecodes.decodeWaiters === 1,
  );
  controllers.forEach((s) => s.abort());
  await Promise.all(rejected);
  assert.equal(pending.length, 4);
  assert.equal(memory.snapshot().globalDecodes.nativeDecodes, 4);
  assert.ok(memory.snapshot().bytes >= 256);
  pending.forEach((finish) => finish());
  await until(() =>
    [a, b, c].every((f) => f.cache.snapshot().activeJobs === 0),
  );
  for (const f of [a, b, c]) {
    f.cache.dispose();
    f.untrim();
  }
  assert.equal(memory.snapshot().bytes, 0);
  assert.equal(memory.snapshot().globalDecodes.nativeDecodes, 0);
});
test("S3 complete event project preserves original and full tail, explicit damp and sample-frame clock", () => {
  const r = new InstrumentRegistry([bank(48000)]);
  let p = emptyInstrumentTake(r);
  const original = p.origin.text;
  for (const e of [
    { id: "a", tick: 0, sampleId: "s1", action: "strike", velocity: 0.7 },
    { id: "b", tick: PPQ / 4, sampleId: "s1", action: "damp", velocity: 0 },
    { id: "c", tick: PPQ / 2, sampleId: "s2", action: "strike", velocity: 1 },
  ])
    p = appendInstrumentEvent(p, r, { ...e, bankId: "qa", version: "1" });
  const plan = takePlan(p, r, 48000);
  assert.equal(plan.voices[0].startFrame, 0);
  assert.equal(plan.voices[0].naturalEndFrame, 8);
  assert.equal(plan.voices[1].startFrame, 15000);
  assert.equal(plan.voices[1].endFrame, 15008);
  assert.equal(plan.frames, 120000);
  assert.equal(p.origin.text, original);
  assert.deepEqual(parseInstrumentProject(JSON.stringify(p), r), p);
  const nonempty = structuredClone(p);
  nonempty.composition.patterns[0].steps.kick[0] = true;
  assert.throws(
    () => assertEmptyLegacyLayer(nonempty),
    (e) => e.code === "legacyLayerUnsupported",
  );
  assert.equal(p.origin.text, original);
});
test("S3 close recording tick collisions are preserved as distinct events instead of silently discarded", () => {
  const r = new InstrumentRegistry([bank(48000)]);
  let p = emptyInstrumentTake(r);
  for (const id of ["one", "two"])
    p = appendInstrumentEvent(p, r, {
      id,
      tick: 0,
      bankId: "qa",
      version: "1",
      sampleId: "s1",
      action: "strike",
      velocity: 1,
    });
  assert.deepEqual(
    p.events.map((e) => e.tick),
    [0, 1],
  );
  assert.equal(p.events.length, 2);
});
function contextFake(rate = 48000) {
  const operations = [];
  const param = {
    setValueAtTime: (...a) => operations.push(["set", ...a]),
    cancelScheduledValues: (...a) => operations.push(["cancel", ...a]),
    linearRampToValueAtTime: (...a) => operations.push(["ramp", ...a]),
  };
  const source = {
    playbackRate: { value: 0 },
    connect() {},
    disconnect() {},
    start: (...a) => operations.push(["start", ...a]),
    stop: (...a) => operations.push(["stop", ...a]),
  };
  return {
    sampleRate: rate,
    currentTime: 0,
    state: "running",
    operations,
    source,
    createBufferSource: () => source,
    createGain: () => ({ gain: param, connect() {}, disconnect() {} }),
  };
}
test("S3 live source keeps natural full duration and release ownership until actual onended", () => {
  const ctx = contextFake(),
    buffer = { duration: 45 },
    released = { n: 0 },
    voice = instrumentVoice(ctx, {}, buffer, 0.1, 0.5, {
      release: () => released.n++,
    });
  assert.equal(voice.source.buffer, buffer);
  assert.equal(voice.source.loop, false);
  assert.equal(voice.source.playbackRate.value, 1);
  assert.equal(voice.gain.gain.value, 0.125);
  assert.deepEqual(
    ctx.operations.find((o) => o[0] === "start"),
    ["start", 0.1, 0],
  );
  ctx.currentTime = 0.2;
  voice.stop();
  assert.equal(released.n, 0);
  voice.source.onended();
  assert.equal(released.n, 1);
  voice.stop();
  voice.disconnect();
  assert.equal(released.n, 1);
});
test("S3 chunk source offset and partial damp ramp remain continuous across chunk boundary", () => {
  const ctx = contextFake(),
    v = { startFrame: 0, endFrame: 97000, dampFrame: 96000, velocity: 1 };
  const voice = scheduleInstrumentChunk(
    ctx,
    {},
    { duration: 5 },
    v,
    96500,
    48000,
  );
  assert.ok(voice);
  assert.equal(ctx.operations.find((o) => o[0] === "start")[2], 96500 / 48000);
  assert.equal(
    ctx.operations.find((o) => o[0] === "set")[1],
    0.25 * (1 - 500 / 960),
  );
  assert.equal(ctx.operations.find((o) => o[0] === "ramp")[2], 460 / 48000);
  const wav = instrumentWavHeader(48000, 48000);
  assert.equal(wav.bytes.byteLength, 192044);
  assert.equal(wav.view.getUint16(22, true), 2);
  assert.throws(
    () => instrumentWavHeader(48000 * 91, 48000),
    (e) => e.code === "exportDurationLimit",
  );
});
test("S3 ID-default and EN copy cover every status/control/error identically", () => {
  assert.deepEqual(
    Object.keys(focusCopy.id).sort(),
    Object.keys(focusCopy.en).sort(),
  );
  assert.deepEqual(
    Object.keys(focusCopy.id.errors).sort(),
    Object.keys(focusCopy.en.errors).sort(),
  );
  assert.ok(focusCopy.id.enable.includes("Aktifkan"));
  assert.ok(focusCopy.en.enable.includes("Enable"));
});
