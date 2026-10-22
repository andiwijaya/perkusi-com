import test from "node:test";
import assert from "node:assert/strict";
import { Transport, secondsPerBeat } from "../src/audio/transport.js";
import {
  SampleBank,
  inspectBuffer,
  validatePack,
} from "../src/audio/sample-bank.js";
import { AudioEngine } from "../src/audio/engine.js";
import {
  MICROFADE,
  createLoopVoice,
  fadeOutVoice,
  cancelFade,
  gainValueAt,
} from "../src/audio/voice.js";
import { createPlaybackMilestones } from "../src/beatbox/playback-milestones.js";

const pack = () => ({
  schemaVersion: 1,
  id: "test-pack",
  bpm: 96,
  beatsPerBar: 4,
  bars: 2,
  stems: ["a", "b", "c"].map((id) => ({
    id,
    url: id + ".wav",
    licenseId: "original-test",
    gainTrim: 0.85,
  })),
});
function buffer(peak = 0.1, duration = 5) {
  const samples = Float32Array.from(
    { length: Math.round(duration * 8000) },
    (_, i) => peak * Math.sin(i / 8),
  );
  return {
    length: samples.length,
    duration,
    numberOfChannels: 1,
    sampleRate: 8000,
    getChannelData: () => samples,
  };
}
const okFetch = async () => ({
  ok: true,
  arrayBuffer: async () => new ArrayBuffer(20),
});
const alternatePack = () => ({
  ...pack(),
  stems: pack().stems.map((stem) => ({
    ...stem,
    variant: 2,
    url: stem.id + "-b.wav",
  })),
});
class Param {
  constructor() {
    this.value = 1;
    this.events = [];
  }
  setValueAtTime(value, at) {
    this.events.push({ type: "set", value, at });
  }
  linearRampToValueAtTime(value, at) {
    this.events.push({ type: "ramp", value, at });
  }
  setTargetAtTime(value, at, constant) {
    this.events.push({ type: "target", value, at, constant });
  }
  cancelScheduledValues(at) {
    this.events = this.events.filter((e) => e.at < at);
  }
}
class Node {
  constructor() {
    this.gain = new Param();
    this.playbackRate = new Param();
    this.connections = new Set();
    this.stopped = false;
  }
  connect(node) {
    this.connections.add(node);
  }
  disconnect(node) {
    if (node) this.connections.delete(node);
    else this.connections.clear();
  }
  start(when, offset) {
    this.started = { when, offset };
  }
  stop(when) {
    this.stopped = true;
    this.stopTime = when;
  }
}
class Context extends EventTarget {
  constructor() {
    super();
    this.currentTime = 0;
    this.state = "suspended";
    this.destination = new Node();
    this.nodes = [];
    this.resumes = 0;
  }
  node() {
    const node = new Node();
    this.nodes.push(node);
    return node;
  }
  createGain() {
    return this.node();
  }
  createBufferSource() {
    return this.node();
  }
  createMediaStreamDestination() {
    const node = this.node();
    node.track = {
      stopped: false,
      stop() {
        this.stopped = true;
      },
    };
    node.stream = { getTracks: () => [node.track] };
    return node;
  }
  async decodeAudioData() {
    return buffer();
  }
  async resume() {
    ++this.resumes;
    this.change("running");
  }
  async suspend() {
    this.change("suspended");
  }
  async close() {
    this.change("closed");
  }
  change(state) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}
function fixture(options = {}) {
  const context = new Context();
  const timers = new Map();
  let serial = 0;
  const engine = new AudioEngine(pack(), {
    contextFactory: () => context,
    bankOptions: { fetcher: okFetch },
    timers: {
      setInterval: (fn) => {
        const id = ++serial;
        timers.set(id, fn);
        return id;
      },
      clearInterval: (id) => timers.delete(id),
    },
    ...options,
  });
  return { engine, context, timers };
}
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
test("optional mastering is gesture-owned; captures share the final output and disposal releases the stage", async () => {
  let created = 0,
    disposed = 0;
  const { engine, context } = fixture({
    outputStageFactory(ctx, input) {
      created++;
      const output = ctx.createGain();
      input.connect(output);
      return {
        output,
        dispose() {
          disposed++;
          output.disconnect();
        },
      };
    },
  });
  assert.equal(created, 0);
  assert.equal(engine.snapshot().contextState, "absent");
  await engine.play();
  assert.equal(created, 1);
  assert.notEqual(engine.output, engine.master);
  assert.ok(engine.output.connections.has(context.destination));
  const capture = engine.createCapture();
  const destination = context.nodes.at(-1);
  assert.ok(engine.output.connections.has(destination));
  assert.ok(!engine.master.connections.has(destination));
  capture.dispose();
  capture.dispose();
  assert.ok(destination.track.stopped);
  assert.ok(!engine.output.connections.has(destination));
  assert.equal(engine.volume, 0.65);
  assert.throws(() => engine.setVolume(0.76), /Unsafe master volume/);
  await engine.dispose();
  assert.equal(disposed, 1);
  assert.equal(engine.output.connections.size, 0);
  assert.equal(engine.master.connections.size, 0);
});

test("shared engine without Beatbox mastering preserves its output; malformed configured stage fails closed", async () => {
  const normal = fixture();
  await normal.engine.play();
  assert.equal(normal.engine.output, normal.engine.master);
  await normal.engine.dispose();
  const invalid = fixture({ outputStageFactory: () => ({}) });
  await invalid.engine.play();
  assert.equal(invalid.engine.status, "error");
  assert.equal(invalid.engine.voices.size, 0);
  assert.ok(
    !invalid.engine.master.connections.has(invalid.context.destination),
  );
  await invalid.engine.dispose();
});

test("failed mastering construction closes its partial context and retry creates a complete output graph", async () => {
  const contexts = [];
  let fail = true;
  const { engine } = fixture({
    contextFactory() {
      const context = new Context();
      contexts.push(context);
      return context;
    },
    outputStageFactory(context, input) {
      if (fail) throw new Error("controlled mastering construction failure");
      const output = context.createGain();
      input.connect(output);
      return {
        output,
        dispose() {
          output.disconnect();
        },
      };
    },
  });
  await engine.play();
  assert.equal(engine.status, "error");
  assert.equal(contexts[0].state, "closed");
  assert.equal(engine.output, null);
  assert.equal(engine.voices.size, 0);
  fail = false;
  await engine.play();
  assert.equal(contexts.length, 2);
  assert.equal(engine.status, "playing");
  assert.ok(engine.output.connections.has(contexts[1].destination));
  await engine.dispose();
});

test("buffer preparation cannot disguise unsafe raw PCM and cannot admit unsafe prepared PCM", async () => {
  for (const rawUnsafe of [true, false]) {
    let prepared = 0;
    const ctx = new Context();
    ctx.decodeAudioData = async () => buffer(rawUnsafe ? 0.96 : 0.1);
    const bank = new SampleBank(pack(), {
      fetcher: okFetch,
      prepareBuffer() {
        prepared++;
        return buffer(rawUnsafe ? 0.1 : 0.96);
      },
    });
    await bank.load("a", ctx);
    assert.equal(bank.get("a").state, "error");
    assert.equal(bank.get("a").buffer, null);
    assert.equal(prepared, rawUnsafe ? 0 : 1);
    bank.dispose();
  }
});

test("prepared PCM is validated and cached once, with final metrics included in shared headroom admission", async () => {
  let prepared = 0;
  const { engine, context } = fixture({
    bankOptions: {
      fetcher: okFetch,
      prepareBuffer() {
        prepared++;
        return buffer(0.8);
      },
    },
  });
  await engine.play();
  assert.equal(prepared, 3);
  assert.equal(engine.bank.get("a").state, "ready");
  assert.equal(engine.bank.get("b").state, "error");
  assert.equal(engine.bank.get("c").state, "error");
  assert.ok(engine.cacheBounds().peak <= 0.95);
  await engine.bank.load("a", context);
  assert.equal(prepared, 3);
  await engine.dispose();
});
for (const failure of ["all", "selected-only", "partial-selected"]) {
  test(`playback analytics: ${failure} failure, retry boundary and pause/resume are deterministic`, async () => {
    let fail = true;
    const { engine, context } = fixture({
      bankOptions: {
        fetcher: async (url) =>
          fail && (failure === "all" || url === "a.wav")
            ? { ok: false, status: 404 }
            : okFetch(),
      },
    });
    const sent = [];
    const observe = createPlaybackMilestones((name) => sent.push(name));
    const inspect = () => observe(engine.snapshot());
    try {
      for (const id of ["a", "b", "c"]) engine.setLayer(id, false);
      engine.setLayer("a", true);
      if (failure === "partial-selected") engine.setLayer("b", true);
      await engine.play();
      inspect(); // Even the healthy source is still scheduled in the future.
      assert.deepEqual(sent, []);
      context.currentTime = 0.1;
      engine.pump();
      inspect();
      assert.equal(engine.snapshot().stems.a.state, "error");
      const partial = failure === "partial-selected";
      assert.deepEqual(
        sent,
        partial ? ["audio_started", "first_layer_enabled"] : [],
      );
      assert.equal(engine.snapshot().stems.a.active, false);
      assert.equal(engine.snapshot().resources.voices, partial ? 1 : 0);
      fail = false;
      await engine.retry("a");
      inspect(); // A ready buffer alone is not a successful first layer.
      assert.deepEqual(
        sent,
        partial ? ["audio_started", "first_layer_enabled"] : [],
      );
      if (!partial) {
        // Retry starts the selected first voice when the former startup had
        // none. Disabled healthy roles are intentionally no longer prefetched.
        assert.equal(engine.status, "playing");
        assert.equal(engine.stats.starts, 1);
        context.currentTime += 0.1;
      } else {
        const boundary = engine.pending.get("a").at;
        context.currentTime = boundary - 0.01;
        engine.pump();
        inspect(); // Lookahead-created future source must not consume success.
        assert.deepEqual(
          sent,
          partial ? ["audio_started", "first_layer_enabled"] : [],
        );
        context.currentTime = boundary;
      }
      engine.pump();
      inspect();
      assert(engine.snapshot().stems.a.active);
      assert.deepEqual(sent, ["audio_started", "first_layer_enabled"]);
      await engine.setLayer("b", true);
      await engine.setLayer("c", true);
      const thirdBoundary = engine.pending.get("c").at;
      context.currentTime = thirdBoundary - 0.01;
      engine.pump();
      inspect();
      assert.equal(sent.length, 2);
      context.currentTime = thirdBoundary;
      engine.pump();
      inspect();
      assert(
        Object.values(engine.snapshot().stems).every((stem) => stem.active),
      );
      for (let i = 0; i < 20; i++) {
        inspect();
        engine.pause();
        inspect();
        await engine.play();
        context.currentTime += 0.1;
        engine.pump();
        inspect();
      }
      assert.deepEqual(sent, [
        "audio_started",
        "first_layer_enabled",
        "three_layers_reached",
      ]);
      engine.reset();
      inspect();
      assert.equal(sent.length, 3);
    } finally {
      await engine.dispose();
    }
  });
}
function loadClock() {
  let time = 0,
    serial = 0;
  const tasks = new Map();
  return {
    now: () => time,
    timers: {
      setTimeout: (fn, ms) => {
        const id = ++serial;
        tasks.set(id, { fn, at: time + ms });
        return id;
      },
      clearTimeout: (id) => tasks.delete(id),
    },
    advance: (ms) => {
      time += ms;
      for (const [id, task] of [...tasks])
        if (task.at <= time) {
          tasks.delete(id);
          task.fn();
        }
    },
    tasks,
  };
}

test("transport uses absolute clock across 120 seconds at multiple tempos", () => {
  for (const bpm of [60, 90, 96, 120, 180]) {
    const t = new Transport({ bpm });
    t.start(3.123);
    for (let tick = 0; tick <= 4800; tick++) {
      const now = 3.123 + tick * 0.025;
      assert(Math.abs(t.timeAt(t.beatsAt(now)) - now) < 1e-12);
    }
    assert(Math.abs(t.beatsAt(123.123) - 120 / secondsPerBeat(bpm)) < 1e-10);
  }
  assert.throws(() => new Transport({ bpm: NaN }));
  assert.throws(() => new Transport({ beatsPerBar: 0 }));
});
test("pause keeps phase while reset returns to downbeat; near-boundary safety chooses next bar", () => {
  const t = new Transport();
  t.start(1);
  t.pause(2.123);
  const position = t.position;
  assert.equal(t.beatsAt(99), position);
  t.start(100);
  assert(Math.abs(t.beatsAt(100) - position) < 1e-12);
  assert(Math.abs(t.phaseSeconds(100, 2) - 1.123) < 1e-12);
  assert.equal(t.nextBar(t.timeAt(4) - 0.01), t.timeAt(8));
  t.reset();
  assert.equal(t.position, 0);
  assert.equal(t.running, false);
});
test("manifest/buffer safety rejects ambiguous IDs, timings, empty/unsafe assets", () => {
  assert.equal(validatePack(pack()).stems.length, 3);
  for (const modify of [
    (p) => (p.stems[0].licenseId = ""),
    (p) => (p.stems[1].id = "a"),
    (p) => (p.bars = 1.5),
    (p) => (p.stems[0].gainTrim = 2),
  ]) {
    const p = pack();
    modify(p);
    assert.throws(() => validatePack(p));
  }
  assert.throws(() => inspectBuffer(buffer(0), 5));
  assert.throws(() => inspectBuffer(buffer(1), 5));
  assert.throws(() => inspectBuffer(buffer(0.1, 4), 5));
  assert.throws(() =>
    inspectBuffer({ ...buffer(), getChannelData: () => [NaN] }, 5),
  );
});
test("asset failure is per-role, retry works, cancellation ignores a late decode", async () => {
  let fail = true;
  const bank = new SampleBank(pack(), {
    fetcher: async (url) =>
      url === "b.wav" && fail ? { ok: false, status: 503 } : okFetch(),
  });
  const ctx = new Context();
  await bank.loadAll(ctx);
  assert.equal(bank.get("a").state, "ready");
  assert.equal(bank.get("b").state, "error");
  fail = false;
  await bank.load("b", ctx);
  assert.equal(bank.get("b").state, "ready");
  bank.dispose();
  assert([...bank.entries.values()].every((e) => !e.buffer));
  const late = deferred();
  const fresh = new SampleBank(pack(), { fetcher: okFetch });
  ctx.decodeAudioData = () => late.promise;
  const loading = fresh.load("a", ctx);
  await Promise.resolve();
  await Promise.resolve();
  fresh.cancelLoading();
  late.resolve(buffer());
  await loading;
  assert.equal(fresh.get("a").buffer, null);
  assert.equal(fresh.get("a").state, "idle");
  fresh.dispose();
});
test("timeout and retry are bounded without taking down sibling assets", async () => {
  let fail = true;
  const clock = loadClock();
  const bank = new SampleBank(pack(), {
    timeoutMs: 10000,
    now: clock.now,
    timers: clock.timers,
    fetcher: (_, { signal }) =>
      fail
        ? new Promise((_, reject) =>
            signal.addEventListener("abort", () => reject(new Error("abort")), {
              once: true,
            }),
          )
        : okFetch(),
  });
  const ctx = new Context();
  const timedOut = bank.load("a", ctx);
  await flush();
  clock.advance(9999);
  assert.equal(bank.get("a").state, "loading");
  clock.advance(1);
  await timedOut;
  assert.equal(bank.get("a").error, "timeout");
  fail = false;
  await bank.load("a", ctx);
  assert.equal(bank.get("a").state, "ready");
  assert.equal(clock.tasks.size, 0);
  bank.dispose();
});
test("default fetch keeps the browser global receiver", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async function () {
      assert.equal(this, globalThis);
      return okFetch();
    };
    const bank = new SampleBank(pack());
    await bank.loadAll(new Context());
    assert(
      [...bank.entries.values()].every((entry) => entry.state === "ready"),
    );
    bank.dispose();
  } finally {
    globalThis.fetch = original;
  }
});

test("gesture start initializes one graph, synchronous resume, and three equal-phase stems", async () => {
  const { engine, context, timers } = fixture();
  assert.equal(engine.context, null);
  const first = engine.play();
  const duplicate = engine.play();
  assert.equal(first, duplicate);
  assert.equal(context.resumes, 1);
  await first;
  assert.equal(engine.status, "playing");
  assert.equal(timers.size, 1);
  const voices = [...engine.voices];
  assert.equal(voices.length, 3);
  assert(
    voices.every(
      (v) => v.when === 0.05 && v.phase === 0 && v.source.loop && v.ratio === 1,
    ),
  );
  assert(
    voices.every((v) =>
      v.gain.gain.events.some(
        (e) => e.type === "ramp" && e.at === 0.05 + MICROFADE,
      ),
    ),
  );
  await engine.dispose();
  assert.equal(timers.size, 0);
  assert.equal(engine.voices.size, 0);
});
test("20 pause/play cycles preserve phase, one timer and dispose every voice", async () => {
  const { engine, context, timers } = fixture();
  await engine.play();
  for (let i = 0; i < 20; i++) {
    context.currentTime += 0.201;
    engine.pause();
    const position = engine.transport.position;
    assert.equal(timers.size, 0);
    context.currentTime += 2;
    await engine.play();
    assert(
      Math.abs(
        engine.transport.beatsAt(context.currentTime + 0.05) - position,
      ) < 1e-12,
    );
    assert.equal(timers.size, 1);
    // Simulate native onended for the old, micro-faded voices.
    for (const voice of [...engine.voices])
      if (voice.endTime !== null) voice.source.onended?.();
    assert.equal(engine.voices.size, 3);
  }
  engine.reset();
  assert.equal(engine.transport.position, 0);
  assert([...engine.enabled.values()].every((v) => !v));
  await engine.dispose();
  assert.equal(engine.stats.created, engine.stats.disposed);
});
test("boundary disable, rapid cancel and last-intent-wins restore gain without irreversible stop", async () => {
  const { engine, context } = fixture();
  await engine.play();
  context.currentTime = 2.46;
  engine.setLayer("a", false);
  let pending = engine.pending.get("a");
  assert.equal(pending.at, 2.55);
  assert(pending.scheduled);
  const voice = pending.voice;
  assert.equal(voice.source.stopped, false);
  for (let i = 0; i < 40; i++) engine.setLayer("a", i % 2 === 0);
  engine.setLayer("a", true);
  assert.equal(engine.pending.has("a"), false);
  assert.equal(voice.endTime, null);
  assert.equal(voice.gain.gain.events.at(-1).value, 0.85);
  engine.setLayer("a", false);
  context.currentTime = 2.552;
  engine.pump();
  assert.equal(engine.applied.get("a"), false);
  context.currentTime = 2.56;
  engine.pump();
  assert.equal(engine.voices.size, 2);
  engine.setLayer("a", true);
  const at = engine.pending.get("a").at;
  context.currentTime = at - 0.1;
  engine.pump();
  pending = engine.pending.get("a");
  assert(pending.scheduled);
  assert(Math.abs(pending.voice.phase) < 1e-12);
  engine.setLayer("a", false);
  assert.equal(engine.voices.size, 2);
  assert(!engine.pending.has("a"));
  await engine.dispose();
});
test("late timer defers a change to a future boundary instead of playing late; loops remain on clock", async () => {
  const { engine, context } = fixture();
  await engine.play();
  context.currentTime = 0.5;
  engine.setLayer("a", false);
  context.currentTime = 3;
  engine.pump();
  assert.equal(engine.pending.get("a").at, 5.05);
  assert.equal(engine.stats.deferredChanges, 1);
  assert.equal(engine.stats.created, 3);
  context.currentTime = 120.05;
  assert.equal(engine.transport.beatsAt(context.currentTime), 192);
  await engine.dispose();
});
test("native suspended/interrupted states freeze phase and require explicit play; external close recovers", async () => {
  const { engine, context, timers } = fixture();
  await engine.play();
  for (const state of ["suspended", "interrupted"]) {
    context.currentTime += 1;
    const position = engine.transport.beatsAt(context.currentTime);
    context.change(state);
    assert.equal(engine.status, state);
    assert.equal(timers.size, 0);
    assert.equal(engine.voices.size, 0);
    context.currentTime += 3;
    assert.equal(engine.transport.position, position);
    await engine.play();
    assert.equal(engine.status, "playing");
  }
  context.change("closed");
  assert.equal(engine.status, "error");
  const replacement = new Context();
  engine.contextFactory = () => replacement;
  await engine.play();
  assert.equal(engine.context, replacement);
  assert.equal(engine.status, "playing");
  await engine.dispose();
});
test("pause cancels in-flight start; retry gesture can win before old decode returns", async () => {
  const { engine, context } = fixture();
  const old = deferred();
  context.decodeAudioData = () => old.promise;
  const pending = engine.play();
  await Promise.resolve();
  await Promise.resolve();
  engine.pause();
  context.decodeAudioData = async () => buffer();
  await engine.play();
  old.resolve(buffer());
  await pending;
  assert.equal(engine.status, "playing");
  assert.equal(engine.voices.size, 3);
  await engine.dispose();
});
test("resume failure is retryable and all-asset failure never starts timer", async () => {
  const { engine, context, timers } = fixture();
  context.resume = async () => {
    throw new Error("blocked");
  };
  await engine.play();
  assert.equal(engine.status, "error");
  assert.equal(timers.size, 0);
  context.resume = Context.prototype.resume.bind(context);
  await engine.play();
  assert.equal(engine.status, "playing");
  assert.throws(() => engine.setVolume(1));
  await engine.dispose();
  const failed = fixture({
    bankOptions: { fetcher: async () => ({ ok: false, status: 404 }) },
  });
  await failed.engine.play();
  assert.equal(failed.engine.status, "error");
  assert.equal(failed.timers.size, 0);
  await failed.engine.dispose();
});

test("concurrent dispose shares cleanup; later controls cannot revive a disposed transport", async () => {
  const { engine, context } = fixture();
  await engine.play();
  context.currentTime = 1;
  const first = engine.dispose();
  const second = engine.dispose();
  assert.equal(first, second);
  await second;
  engine.pause();
  engine.reset();
  await engine.suspend();
  engine.setVolume(0.5);
  assert.equal(engine.status, "disposed");
  assert.equal(context.state, "closed");
  assert.equal(engine.snapshot().resources.voices, 0);
  assert.equal(engine.bank.snapshot().a.state, "disposed");
  await assert.rejects(engine.play(), /disposed/);
});

test("explicit suspend cleans faded nodes even before a delayed native statechange event", async () => {
  const { engine, context } = fixture();
  await engine.play();
  context.currentTime = 1;
  context.suspend = async () => {
    context.state = "suspended";
  };
  await engine.suspend();
  assert.equal(engine.status, "suspended");
  assert.equal(engine.voices.size, 0);
  assert.equal(engine.stats.created, engine.stats.disposed);
  await engine.dispose();
});

test("R1 attack/repeated fade and overlapping cancel hold the actual linear gain", () => {
  const ctx = new Context();
  const entry = { stem: { id: "constant", gainTrim: 1 }, buffer: buffer(0.25) };
  const voice = createLoopVoice(
    ctx,
    ctx.destination,
    entry,
    { duration: 5 },
    0,
  );
  ctx.currentTime = 0.002;
  fadeOutVoice(voice, 0.002);
  assert.equal(gainValueAt(voice, 0.002), 0.5);
  assert(Math.abs(gainValueAt(voice, 0.003) - 0.375) < 1e-12);
  ctx.currentTime = 0.003;
  fadeOutVoice(voice, 0.003);
  assert(Math.abs(gainValueAt(voice, 0.003) - 0.375) < 1e-12);
  ctx.currentTime = 0.004;
  const held = gainValueAt(voice, 0.004);
  cancelFade(voice, 0.001); // Older requested time clamps to the actual clock.
  assert.equal(gainValueAt(voice, 0.004), held);
  assert.equal(gainValueAt(voice, 0.008), 1);
  assert.equal(voice.endTime, null);
  assert(voice.envelope.length <= 4);
});

test("R2 each fetch/body/decode deadline settles even when the awaited phase never returns", async () => {
  for (const phase of ["fetch", "body", "decode"]) {
    const clock = loadClock(),
      waiting = deferred();
    let signal;
    const bank = new SampleBank(pack(), {
      ...clock,
      timeoutMs: 20,
      fetcher: (_, options) => {
        signal = options.signal;
        return phase === "fetch"
          ? waiting.promise
          : Promise.resolve({
              ok: true,
              arrayBuffer: () =>
                phase === "body"
                  ? waiting.promise
                  : Promise.resolve(new ArrayBuffer(20)),
            });
      },
    });
    const ctx = { decodeAudioData: () => waiting.promise };
    const pending = bank.load("a", ctx);
    await flush();
    clock.advance(20);
    assert.equal(await pending, null);
    assert.equal(bank.get("a").state, "error");
    assert.equal(bank.get("a").error, "timeout");
    assert(signal.aborted);
    assert.equal(bank.get("a").promise, null);
    assert.equal(bank.get("a").controller, null);
    assert.equal(clock.tasks.size, 0);
    bank.dispose(); // Native/uncooperative phase is still unresolved.
    assert.equal(bank.get("a").state, "disposed");
  }
});

test("R2 retry before old decode completion owns cache; old result/rejection cannot mutate it", async () => {
  for (const lateFailure of [false, true]) {
    const clock = loadClock();
    let finish, fail;
    const oldDecode = new Promise((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    const bank = new SampleBank(pack(), {
      ...clock,
      timeoutMs: 20,
      fetcher: okFetch,
    });
    const old = bank.load("a", { decodeAudioData: () => oldDecode });
    await flush();
    clock.advance(20);
    assert.equal(await old, null);
    const freshBuffer = buffer(0.2);
    const retry = bank.load("a", { decodeAudioData: async () => freshBuffer });
    assert.equal(await retry, freshBuffer);
    if (lateFailure) fail(new Error("late rejected decode"));
    else finish(buffer(0.1));
    await flush();
    assert.equal(bank.get("a").buffer, freshBuffer);
    assert.equal(bank.get("a").state, "ready");
    assert.equal(bank.get("a").error, null);
    assert.equal(clock.tasks.size, 0);
    bank.dispose();
  }
});

test("R2 cancel and dispose settle logical work immediately and invalidate late phase results", async () => {
  for (const dispose of [false, true]) {
    const clock = loadClock(),
      late = deferred();
    const bank = new SampleBank(pack(), {
      ...clock,
      timeoutMs: 1000,
      fetcher: okFetch,
    });
    const pending = bank.load("a", { decodeAudioData: () => late.promise });
    await flush();
    if (dispose) bank.dispose();
    else bank.cancelLoading();
    assert.equal(await pending, null);
    assert.equal(clock.tasks.size, 0);
    late.resolve(buffer());
    await flush();
    assert.equal(bank.get("a").state, dispose ? "disposed" : "idle");
    assert.equal(bank.get("a").buffer, null);
    bank.dispose();
  }
});

test("R2 expired-clock continuation cannot publish before a delayed timer callback", async () => {
  let time = 0;
  const tasks = new Map();
  const late = deferred();
  const bank = new SampleBank(pack(), {
    now: () => time,
    timeoutMs: 20,
    fetcher: okFetch,
    timers: {
      setTimeout: (fn) => {
        tasks.set(1, fn);
        return 1;
      },
      clearTimeout: (id) => tasks.delete(id),
    },
  });
  const pending = bank.load("a", { decodeAudioData: () => late.promise });
  await flush();
  time = 30;
  late.resolve(buffer());
  assert.equal(await pending, null);
  assert.equal(bank.get("a").error, "timeout");
  assert.equal(tasks.size, 0);
  bank.dispose();
});

test("R2 engine start bounds hung decodes and per-role retry preserves available siblings", async () => {
  const clock = loadClock(),
    late = deferred();
  const { engine, context, timers } = fixture({
    bankOptions: { ...clock, timeoutMs: 20, fetcher: okFetch },
  });
  let decodeCount = 0;
  context.decodeAudioData = () =>
    ++decodeCount === 2 ? late.promise : Promise.resolve(buffer());
  const starting = engine.play();
  await flush();
  clock.advance(20);
  await starting;
  assert.equal(engine.status, "playing");
  assert.equal(engine.voices.size, 2);
  assert.equal(engine.bank.get("b").error, "timeout");
  assert.equal(timers.size, 1);
  await engine.retry("b");
  late.resolve(buffer(0.2));
  await flush();
  assert.equal(engine.bank.get("b").state, "ready");
  assert(engine.pending.has("b"));
  await engine.dispose();
  const stalled = fixture({
    bankOptions: { ...loadClock(), timeoutMs: 20, fetcher: okFetch },
  });
  // Disposal also settles every never-returning decode, allowing play to finish.
  stalled.context.decodeAudioData = () => new Promise(() => {});
  const blocked = stalled.engine.play();
  await flush();
  await stalled.engine.dispose();
  await blocked;
  assert.equal(stalled.engine.status, "disposed");
  assert.equal(stalled.timers.size, 0);
});

test("late suspend completion cannot erase a newer play operation", async () => {
  const { engine, context } = fixture();
  await engine.play();
  const late = deferred();
  context.suspend = () => {
    context.change("suspended");
    return late.promise;
  };
  const old = engine.suspend();
  await engine.play();
  late.resolve();
  await old;
  assert.equal(engine.status, "playing");
  assert.equal(engine.voices.size, 3);
  assert.equal(engine.transport.running, true);
  await engine.dispose();
});

test("R2 all hung decodes terminate engine start at the deadline, then the next gesture retries", async () => {
  const clock = loadClock();
  const { engine, context, timers } = fixture({
    bankOptions: { ...clock, timeoutMs: 20, fetcher: okFetch },
  });
  context.decodeAudioData = () => new Promise(() => {});
  const pending = engine.play();
  await flush();
  clock.advance(20);
  await pending;
  assert.equal(engine.status, "error");
  assert.equal(engine.voices.size, 0);
  assert.equal(timers.size, 0);
  assert(
    Object.values(engine.bank.snapshot()).every(
      (entry) => entry.error === "timeout",
    ),
  );
  context.decodeAudioData = async () => buffer();
  await engine.play();
  assert.equal(engine.status, "playing");
  assert.equal(engine.voices.size, 3);
  await engine.dispose();
});

test("S4 variant replacement shares bar/phase, holds current voices until ready and cancels future crossfade", async () => {
  const { engine, context } = fixture({ variantPacks: [alternatePack()] });
  await engine.play();
  const origin = engine.transport.origin,
    original = engine.roleVoice.get("a");
  await engine.setVariation("a", 2);
  const at = engine.pending.get("a").at;
  assert.equal(engine.snapshot().stems.a.appliedVariant, 1);
  context.currentTime = at - 0.05;
  engine.pump();
  const replacement = engine.roleVoice.get("a");
  assert.equal(replacement.variant, 2);
  assert.equal(replacement.when, at);
  assert.equal(replacement.phase, 2.5);
  assert.equal(original.endTime, at + MICROFADE);
  assert.equal(engine.voices.size, 4);
  await engine.setVariation("a", 1);
  assert.equal(engine.roleVoice.get("a"), original);
  assert.equal(original.endTime, null);
  assert.equal(engine.voices.size, 3);
  assert.equal(engine.pending.size, 0);
  await engine.setVariation("a", 2);
  const next = engine.pending.get("a").at;
  context.currentTime = next - 0.05;
  engine.pump();
  context.currentTime = next + 0.01;
  engine.pump();
  assert.equal(engine.snapshot().stems.a.appliedVariant, 2);
  assert.equal(engine.voices.size, 3);
  assert.equal(engine.transport.origin, origin);
  await engine.dispose();
  assert.equal(engine.snapshot().resources.decodedBytes, 0);
});

test("S4 mute and variation intents compose; pause/reset invalidate pending variants and preserve one context", async () => {
  const { engine, context } = fixture({ variantPacks: [alternatePack()] });
  await engine.play();
  await engine.setVariation("a", 2);
  engine.setLayer("a", false);
  const at = engine.pending.get("a").at;
  context.currentTime = at - 0.03;
  engine.pump();
  engine.pause();
  assert.equal(engine.pending.size, 0);
  assert.equal(engine.selectedVariant.get("a"), 2);
  await engine.play();
  assert.equal(engine.applied.get("a"), false);
  assert.equal(engine.context, context);
  engine.setLayer("a", true);
  const on = engine.pending.get("a").at;
  context.currentTime = on - 0.05;
  engine.pump();
  context.currentTime = on + 0.01;
  engine.pump();
  assert.equal(engine.appliedVariant.get("a"), 2);
  engine.reset();
  assert.equal(engine.selectedVariant.get("a"), 1);
  assert([...engine.enabled.values()].every((value) => !value));
  await assert.rejects(engine.setVariation("a", 99));
  await engine.dispose();
});

test("S4 late candidate decode cannot override a newer variant intent or disposed graph", async () => {
  const held = deferred();
  const { engine, context } = fixture({
    variantPacks: [alternatePack()],
    bankOptions: {
      fetcher: async (url) => ({
        ok: true,
        arrayBuffer: async () =>
          Uint8Array.of(url.includes("-b") ? 1 : 0).buffer,
      }),
    },
  });
  context.decodeAudioData = async (bytes) =>
    new Uint8Array(bytes)[0] === 1 ? await held.promise : buffer();
  await engine.play();
  const stale = engine.setVariation("a", 2);
  await flush();
  assert.equal(engine.snapshot().stems.a.state, "loading");
  await engine.setVariation("a", 1);
  held.resolve(buffer());
  await stale;
  assert.equal(engine.selectedVariant.get("a"), 1);
  assert.equal(engine.appliedVariant.get("a"), 1);
  assert.equal(engine.pending.size, 0);
  const second = deferred();
  context.decodeAudioData = async () => await second.promise;
  const work = engine.setVariation("b", 2);
  await flush();
  await engine.dispose();
  await work;
  second.resolve(buffer());
  await flush();
  assert.equal(engine.status, "disposed");
  assert.equal(engine.snapshot().resources.decodedBytes, 0);
  assert.equal(engine.voices.size, 0);
});

test("S4 candidate deadline exposes role error while old variant plays; retry is quantized", async () => {
  const clock = loadClock();
  const { engine, context } = fixture({
    variantPacks: [alternatePack()],
    bankOptions: {
      ...clock,
      timeoutMs: 20,
      fetcher: async (url) => ({
        ok: true,
        arrayBuffer: async () =>
          Uint8Array.of(url.includes("-b") ? 1 : 0).buffer,
      }),
    },
  });
  context.decodeAudioData = async (bytes) =>
    new Uint8Array(bytes)[0] === 1 ? await new Promise(() => {}) : buffer();
  await engine.play();
  const work = engine.setVariation("a", 2);
  await flush();
  clock.advance(20);
  await work;
  assert.equal(engine.snapshot().stems.a.error, "timeout");
  assert.equal(engine.snapshot().stems.a.active, true);
  assert.equal(engine.appliedVariant.get("a"), 1);
  assert.equal(engine.voices.size, 3);
  context.decodeAudioData = async () => buffer();
  await engine.retry("a");
  assert.equal(engine.pending.get("a").variant, 2);
  await engine.dispose();
});

test("S4 unsafe candidate is rejected without muting the currently valid variant", async () => {
  const { engine, context } = fixture({
    variantPacks: [alternatePack()],
    bankOptions: {
      fetcher: async (url) => ({
        ok: true,
        arrayBuffer: async () =>
          Uint8Array.of(url.includes("-b") ? 1 : 0).buffer,
      }),
    },
  });
  context.decodeAudioData = async (bytes) =>
    buffer(new Uint8Array(bytes)[0] === 1 ? 0.9 : 0.1);
  await engine.play();
  await engine.setVariation("a", 2);
  await engine.setVariation("b", 2);
  assert.equal(engine.snapshot().stems.b.state, "error");
  assert.equal(engine.snapshot().stems.b.error, "unsafe-pack-headroom");
  assert.equal(engine.roleVoice.get("b").variant, 1);
  assert.equal(engine.snapshot().stems.b.active, true);
  await engine.dispose();
});

test("P2-S4-01 obsolete B→A decodes cannot publish; explicit cache and retry still require aggregate admission", async () => {
  const held = new Map();
  const { engine, context } = fixture({
    variantPacks: [alternatePack()],
    bankOptions: {
      fetcher: async (url) => ({
        ok: true,
        arrayBuffer: async () =>
          Uint8Array.of(url.includes("-b") ? 1 : 0).buffer,
      }),
    },
  });
  context.decodeAudioData = (bytes) =>
    new Uint8Array(bytes)[0] === 1
      ? new Promise((resolve) => held.set(held.size, resolve))
      : Promise.resolve(buffer());
  await engine.play();
  const voices = new Map(engine.roleVoice),
    origin = engine.transport.origin;
  for (const [index, id] of ["a", "b", "c"].entries()) {
    const pending = engine.setVariation(id, 2);
    await flush();
    await engine.setVariation(id, 1);
    held.get(index)(buffer(0.9));
    await pending;
    assert(engine.cacheBounds().peak <= 0.95);
    assert.equal(engine.roleVoice.get(id), voices.get(id));
    assert.equal(engine.selectedVariant.get(id), 1);
    assert.equal(engine.pending.size, 0);
  }
  for (const id of ["a", "b", "c"]) {
    assert.equal(engine.variantEntry(id, 2).state, "idle");
    assert.equal(engine.variantEntry(id, 2).buffer, null);
  }
  // An intentional internal cache load remains guarded independently of the
  // UI choice; cancelled/obsolete results themselves can never become cache.
  const bank = engine.variants.get("a").get(2).bank;
  for (const [index, id] of ["a", "b", "c"].entries()) {
    const loading = bank.load(id, context);
    await flush();
    held.get(index + 3)(buffer(0.9));
    await loading;
  }
  assert.equal(engine.variantEntry("a", 2).state, "ready");
  for (const id of ["b", "c"]) {
    assert.equal(engine.variantEntry(id, 2).state, "error");
    assert.equal(engine.variantEntry(id, 2).error, "unsafe-pack-headroom");
    assert.equal(engine.variantEntry(id, 2).buffer, null);
  }
  await engine.setVariation("a", 2); // The accepted cached choice still works.
  const rejected = engine.setVariation("b", 2);
  await flush();
  held.get(6)(buffer(0.9));
  await rejected;
  assert(!engine.pending.has("b"));
  assert.equal(engine.appliedVariant.get("b"), 1);
  const retried = engine.retry("b");
  await flush();
  held.get(7)(buffer(0.9));
  await retried;
  assert.equal(engine.variantEntry("b", 2).error, "unsafe-pack-headroom");
  assert(!engine.pending.has("b"));
  assert(engine.cacheBounds().peak <= 0.95);
  const at = engine.pending.get("a").at;
  context.currentTime = at - 0.05;
  engine.pump();
  context.currentTime = at + 0.01;
  engine.pump();
  assert.equal(engine.appliedVariant.get("a"), 2);
  assert.equal(engine.roleVoice.get("b"), voices.get("b"));
  assert.equal(engine.transport.origin, origin);
  await engine.dispose();
});

test("P2-S4-01 concurrent and direct bank publications share one aggregate reservation independent of selected intent", async () => {
  const { engine, context } = fixture({ variantPacks: [alternatePack()] });
  await engine.play();
  context.decodeAudioData = async () => buffer(0.9);
  const bank = engine.variants.get("a").get(2).bank;
  await Promise.all(["a", "b", "c"].map((id) => bank.load(id, context)));
  assert.equal([...bank.entries.values()].filter((e) => e.buffer).length, 1);
  assert(
    [...bank.entries.values()]
      .filter((e) => e.state === "error")
      .every((e) => e.error === "unsafe-pack-headroom"),
  );
  assert(engine.cacheBounds().peak <= 0.95);
  assert([...engine.appliedVariant.values()].every((v) => v === 1));
  await engine.dispose();
});

test("P2-S4-01 legacy unsafe cached candidates cannot queue, pump or create a source before admission", async () => {
  const { engine, context } = fixture({ variantPacks: [alternatePack()] });
  await engine.play();
  const bank = engine.variants.get("a").get(2).bank;
  for (const id of ["a", "b"]) {
    const b = buffer(0.9);
    Object.assign(bank.get(id), {
      buffer: b,
      metrics: inspectBuffer(b, 5),
      state: "ready",
    });
  }
  assert(engine.cacheBounds().peak > 0.95);
  const created = engine.stats.created;
  assert.throws(() => engine.addVoice("b", 2.55, 2), /not admitted/);
  assert.equal(engine.stats.created, created);
  assert.equal(bank.get("b").error, "unsafe-pack-headroom");
  await engine.setVariation("a", 2);
  const at = engine.pending.get("a").at;
  // Test the scheduling boundary separately with an injected invalid old cache.
  const b = buffer(0.9);
  Object.assign(bank.get("b"), {
    buffer: b,
    metrics: inspectBuffer(b, 5),
    state: "ready",
  });
  context.currentTime = at - 0.05;
  engine.pump();
  assert(!engine.pending.has("a"));
  assert.equal(engine.roleVoice.get("a").variant, 1);
  assert.equal(engine.stats.created, created);
  await engine.dispose();
});

test("P2-S4-01 retained PCM budget spans banks, including unselected cache loads and retry", async () => {
  const make = (variant) => ({
    ...pack(),
    bpm: 60,
    bars: 8,
    stems: pack().stems.map((s) => ({
      ...s,
      variant,
      url: s.id + "-" + variant,
      gainTrim: 0.01,
    })),
  });
  const context = new Context();
  const samples = new Float32Array(1536000);
  samples.fill(0.1);
  context.decodeAudioData = async () => ({
    duration: 32,
    length: samples.length,
    sampleRate: 48000,
    numberOfChannels: 1,
    getChannelData: () => samples,
  });
  const engine = new AudioEngine(make(1), {
    variantPacks: [make(2)],
    contextFactory: () => context,
    bankOptions: { fetcher: okFetch },
    timers: { setInterval: () => 1, clearInterval: () => {} },
  });
  await engine.play();
  const bank = engine.variants.get("a").get(2).bank;
  await bank.load("a", context);
  await bank.load("b", context);
  await bank.load("c", context);
  assert.equal(engine.cacheBounds().bytes, 30720000);
  assert(engine.cacheBounds().peak < 0.95);
  assert.equal(bank.get("c").buffer, null);
  assert.equal(bank.get("c").error, "decoded-bank-memory-limit");
  await engine.setVariation("c", 2);
  await engine.retry("c");
  assert.equal(bank.get("c").error, "decoded-bank-memory-limit");
  assert(!engine.pending.has("c"));
  assert.equal(engine.appliedVariant.get("c"), 1);
  await engine.dispose();
});
