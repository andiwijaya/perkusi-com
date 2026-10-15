import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as wait } from "node:timers/promises";
import { prepareLegacyBus } from "../src/audio/legacy-bus.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { newComposition } from "../src/project/composition-model.js";
import { compositionRegistry } from "../src/project/studio-registry.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const until = async (fn) => {
  const end = Date.now() + 3000;
  while (!fn()) {
    assert.ok(Date.now() < end, "boundary not reached");
    await wait(1);
  }
};
function fixture(t) {
  const prior = globalThis.fetch,
    state = {
      fetches: 0,
      decodes: 0,
      renders: 0,
      decodeGate: null,
      renderGate: null,
    };
  const pcm = (frames, rate, channels = 1) => ({
    length: frames,
    duration: frames / rate,
    sampleRate: rate,
    numberOfChannels: channels,
    getChannelData: () => new Float32Array(frames).fill(0.01),
  });
  const assets = compositionRegistry.kits[0].assets;
  globalThis.fetch = async (url) => {
    state.fetches++;
    const a = assets.find((a) => url.endsWith(a.assetPath));
    assert.ok(a);
    return new Response(JSON.stringify({ seconds: a.durationSeconds }));
  };
  const param = () => ({
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    setTargetAtTime() {},
    cancelScheduledValues() {},
  });
  const node = () => ({
    gain: param(),
    pan: param(),
    connect() {},
    disconnect() {},
  });
  const contextFactory = (frames, rate) => ({
    sampleRate: rate,
    currentTime: 0,
    destination: {},
    createGain: node,
    createStereoPanner: node,
    createWaveShaper: node,
    createChannelMerger: node,
    createBufferSource: () => ({
      ...node(),
      playbackRate: { value: 1 },
      start() {},
      stop() {},
    }),
    async decodeAudioData(data) {
      state.decodes++;
      await state.decodeGate?.promise;
      return pcm(
        Math.round(JSON.parse(new TextDecoder().decode(data)).seconds * rate),
        rate,
      );
    },
    async startRendering() {
      state.renders++;
      await state.renderGate?.promise;
      return pcm(frames, rate, 2);
    },
  });
  t.after(() => {
    globalThis.fetch = prior;
    state.decodeGate?.resolve();
    state.renderGate?.resolve();
  });
  const composition = newComposition();
  composition.patterns[0].steps.kick[0] = 0.2;
  composition.timing.bpm = 96;
  return {
    state,
    contextFactory,
    project: { composition },
    yieldTask: async () => {
      state.renders++;
      await state.renderGate?.promise;
    },
  };
}
test("Combined legacy admission refuses before fetch/native allocation when the shared pool is full", async (t) => {
  const f = fixture(t),
    memory = new AudioMemory(),
    occupied = memory.reserve(63 * 1024 * 1024, "foreign preserved owner");
  await assert.rejects(
    prepareLegacyBus(f.project, {
      memory,
      rate: 48000,
      contextFactory: f.contextFactory,
      yieldTask: f.yieldTask,
    }),
    (e) => e.code === "combinedMemoryLimit",
  );
  assert.equal(f.state.fetches, 0);
  assert.equal(f.state.decodes, 0);
  assert.equal(memory.snapshot().bytes, 63 * 1024 * 1024);
  occupied.release();
  assert.equal(memory.snapshot().bytes, 0);
});
test("Combined cancelled actual legacy decodes retain all admission until native promises really settle, sharing the global decode ceiling", async (t) => {
  const f = fixture(t),
    memory = new AudioMemory(),
    controller = new AbortController();
  f.state.decodeGate = deferred();
  let done = false;
  const job = prepareLegacyBus(f.project, {
    memory,
    rate: 48000,
    signal: controller.signal,
    contextFactory: f.contextFactory,
    yieldTask: f.yieldTask,
  });
  const rejected = assert
    .rejects(job, (e) => e.code === "cancelled")
    .then(() => {
      done = true;
    });
  await until(() => f.state.decodes >= 2);
  controller.abort();
  await wait(20);
  assert.equal(done, false);
  assert.ok(memory.snapshot().bytes > 0);
  assert.ok(
    memory.snapshot().globalDecodes.nativeDecodes > 0 &&
      memory.snapshot().globalDecodes.nativeDecodes <= 4,
  );
  f.state.decodeGate.resolve();
  await rejected;
  assert.equal(memory.snapshot().bytes, 0);
  assert.equal(memory.snapshot().globalDecodes.nativeDecodes, 0);
});
test("Combined cancelled canonical legacy render retains its scalar bus admission until the yield boundary settles", async (t) => {
  const f = fixture(t),
    memory = new AudioMemory(),
    controller = new AbortController();
  f.state.renderGate = deferred();
  let done = false;
  const job = prepareLegacyBus(f.project, {
    memory,
    rate: 44100,
    signal: controller.signal,
    contextFactory: f.contextFactory,
    yieldTask: f.yieldTask,
  });
  const rejected = assert
    .rejects(job, (e) => e.code === "cancelled")
    .then(() => {
      done = true;
    });
  await until(() => f.state.renders > 0);
  controller.abort();
  await wait(20);
  assert.equal(done, false);
  assert.ok(memory.snapshot().bytes > 0);
  f.state.renderGate.resolve();
  await rejected;
  assert.equal(memory.snapshot().bytes, 0);
  assert.equal(memory.snapshot().globalDecodes.nativeDecodes, 0);
});
test("Combined successful legacy preparation shrinks to one borrowed Float32 bus and releases exactly once", async (t) => {
  const f = fixture(t),
    memory = new AudioMemory();
  const bus = await prepareLegacyBus(f.project, {
    memory,
    rate: 44100,
    contextFactory: f.contextFactory,
    yieldTask: f.yieldTask,
  });
  assert.equal(bus.buffer.sampleRate, 44100);
  assert.equal(bus.frames, Math.round(2.5 * 44100));
  assert.equal(memory.snapshot().bytes, bus.frames * 8 + 4096);
  assert.ok(bus.peak > 0);
  bus.release();
  bus.release();
  assert.equal(memory.snapshot().bytes, 0);
  assert.throws(
    () => bus.buffer,
    (e) => e.code === "memoryReleased",
  );
});
