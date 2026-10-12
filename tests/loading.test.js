import test from "node:test";
import assert from "node:assert/strict";
import { SampleBank } from "../src/audio/sample-bank.js";
import { contextLoadQueue } from "../src/audio/load-queue.js";
import { AudioEngine } from "../src/audio/engine.js";

const pack = (variant = 1) => ({
  schemaVersion: 1,
  id: "loading-test",
  bpm: 96,
  beatsPerBar: 4,
  bars: 2,
  stems: ["a", "b", "c"].map((id) => ({
    id,
    variant,
    url: id + "-" + variant,
    licenseId: "test",
    gainTrim: 0.2,
  })),
});
const pcm = (peak = 0.1) => {
  const samples = Float32Array.from(
    { length: 40000 },
    (_, i) => peak * Math.sin(i / 9),
  );
  return {
    length: samples.length,
    numberOfChannels: 1,
    sampleRate: 8000,
    duration: 5,
    getChannelData: () => samples,
  };
};
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
function clock() {
  let time = 0,
    serial = 0;
  const tasks = new Map();
  return {
    now: () => time,
    timers: {
      setTimeout(fn, ms) {
        const id = ++serial;
        tasks.set(id, { fn, at: time + ms });
        return id;
      },
      clearTimeout: (id) => tasks.delete(id),
    },
    advance(ms) {
      time += ms;
      for (const [id, t] of [...tasks])
        if (t.at <= time) {
          tasks.delete(id);
          t.fn();
        }
    },
    tasks,
  };
}
function stream(total = null, encoding = null) {
  const values = [];
  let pending = null,
    ended = false,
    cancelled = false;
  const next = () =>
    values.length
      ? Promise.resolve(values.shift())
      : ended
        ? Promise.resolve({ done: true })
        : new Promise((r) => {
            pending = r;
          });
  const reader = {
    read: next,
    cancel() {
      cancelled = true;
      ended = true;
      pending?.({ done: true });
      pending = null;
      return Promise.resolve();
    },
    releaseLock() {},
  };
  return {
    response: {
      ok: true,
      headers: {
        get: (k) =>
          k === "content-length"
            ? total === null
              ? null
              : String(total)
            : k === "content-encoding"
              ? encoding
              : null,
      },
      body: { getReader: () => reader },
    },
    push(value) {
      const part = { done: false, value };
      if (pending) {
        pending(part);
        pending = null;
      } else values.push(part);
    },
    end() {
      ended = true;
      pending?.({ done: true });
      pending = null;
    },
    get cancelled() {
      return cancelled;
    },
  };
}
const fast = async () => ({
  ok: true,
  arrayBuffer: async () => new ArrayBuffer(8),
});
test("streaming progress beyond ten seconds stays valid; queue does not count as transfer time", async () => {
  const t = clock(),
    body = stream(6),
    ctx = { decodeAudioData: async () => pcm() },
    bank = new SampleBank(pack(), { ...t, fetcher: async () => body.response });
  const job = bank.load("a", ctx);
  await flush();
  for (let i = 0; i < 3; i++) {
    t.advance(4000);
    body.push(Uint8Array.of(1, 2));
    await flush();
    assert.equal(bank.get("a").state, "loading");
    assert.equal(bank.get("a").progress.loaded, (i + 1) * 2);
  }
  body.end();
  await job;
  assert.equal(bank.get("a").state, "ready");
  assert.equal(bank.get("a").progress.total, 6);
  assert.equal(t.tasks.size, 0);
  bank.dispose();
});
test("body inactivity fails after last genuine byte; late data cannot publish and Retry is clean", async () => {
  const t = clock(),
    body = stream(),
    ctx = { decodeAudioData: async () => pcm() };
  let retry = false;
  const bank = new SampleBank(pack(), {
    ...t,
    fetcher: async () => (retry ? fast() : body.response),
  });
  const job = bank.load("a", ctx);
  await flush();
  t.advance(3000);
  body.push(Uint8Array.of(1));
  await flush();
  t.advance(9999);
  assert.equal(bank.get("a").state, "loading");
  t.advance(1);
  assert.equal(await job, null);
  assert.equal(bank.get("a").error, "body-stalled");
  assert(body.cancelled);
  body.push(Uint8Array.of(2));
  body.end();
  await flush();
  assert.equal(bank.get("a").buffer, null);
  retry = true;
  await bank.load("a", ctx);
  assert.equal(bank.get("a").state, "ready");
  assert.equal(t.tasks.size, 0);
  bank.dispose();
});
test("positive drip progress cannot extend the sixty-second total deadline", async () => {
  const t = clock(),
    body = stream(),
    bank = new SampleBank(pack(), { ...t, fetcher: async () => body.response });
  const job = bank.load("a", { decodeAudioData: async () => pcm() });
  await flush();
  for (let i = 0; i < 6; i++) {
    t.advance(9000);
    body.push(Uint8Array.of(1));
    await flush();
  }
  t.advance(6000);
  assert.equal(await job, null);
  assert.equal(bank.get("a").error, "total-timeout");
  assert(body.cancelled);
  assert.equal(t.tasks.size, 0);
  bank.dispose();
});
test("missing headers, unobservable bodies and hung decode have separate bounded failures", async () => {
  for (const [phase, error] of [
    ["headers", "headers-timeout"],
    ["body", "body-stalled"],
    ["decode", "decode-timeout"],
  ]) {
    const t = clock(),
      held = deferred(),
      ctx = { decodeAudioData: () => held.promise };
    const bank = new SampleBank(pack(), {
      ...t,
      fetcher: () =>
        phase === "headers"
          ? held.promise
          : Promise.resolve({
              ok: true,
              arrayBuffer: () =>
                phase === "body"
                  ? held.promise
                  : Promise.resolve(new ArrayBuffer(1)),
            }),
    });
    const job = bank.load("a", ctx);
    await flush();
    t.advance(10000);
    assert.equal(await job, null);
    assert.equal(bank.get("a").error, error);
    if (phase === "decode")
      assert.equal(contextLoadQueue(ctx).snapshot().nativeDecodes, 1);
    bank.dispose();
    held.resolve(phase === "decode" ? pcm() : new ArrayBuffer(1));
    await flush();
    assert.equal(bank.get("a").buffer, null);
    assert.equal(contextLoadQueue(ctx).snapshot().nativeDecodes, 0);
    assert.equal(t.tasks.size, 0);
  }
});
test("two context-wide logical jobs cover multiple banks; cancelled queued jobs never fetch", async () => {
  const held = [];
  let active = 0,
    max = 0;
  const fetcher = (_, { signal }) => {
    active++;
    max = Math.max(max, active);
    const d = deferred();
    held.push(d);
    signal.addEventListener(
      "abort",
      () => {
        active--;
        d.resolve({ ok: false, status: 499 });
      },
      { once: true },
    );
    return d.promise;
  };
  const ctx = { decodeAudioData: async () => pcm() },
    a = new SampleBank(pack(), { fetcher }),
    b = new SampleBank(pack(2), { fetcher });
  const jobs = [
    a.load("a", ctx),
    a.load("b", ctx),
    b.load("a", ctx),
    b.load("b", ctx),
    b.load("c", ctx),
  ];
  await flush();
  assert.equal(held.length, 2);
  assert.equal(contextLoadQueue(ctx).snapshot().queued, 3);
  b.cancel("c");
  a.cancelLoading();
  await flush();
  assert.equal(held.length, 4);
  assert.equal(max, 2);
  b.cancelLoading();
  await Promise.all(jobs);
  assert.equal(contextLoadQueue(ctx).snapshot().active, 0);
  assert.equal(contextLoadQueue(ctx).snapshot().queued, 0);
  a.dispose();
  b.dispose();
});
test("a queued load gets its own full phase budget after actual admission", async () => {
  const t = clock(),
    headers = [deferred(), deferred(), deferred()];
  let calls = 0;
  const bank = new SampleBank(pack(), {
      ...t,
      fetcher: () => headers[calls++].promise,
    }),
    ctx = { decodeAudioData: async () => pcm() };
  const jobs = [bank.load("a", ctx), bank.load("b", ctx), bank.load("c", ctx)];
  await flush();
  t.advance(9000);
  headers[0].resolve(await fast());
  await flush();
  assert.equal(calls, 3);
  assert.equal(bank.get("c").progress.phase, "headers");
  t.advance(6000);
  headers[2].resolve(await fast());
  await flush();
  assert.equal(bank.get("c").state, "ready");
  assert.equal(bank.get("b").error, "headers-timeout");
  await Promise.all(jobs);
  bank.dispose();
});
test("compressed/unknown lengths do not invent percent or reject decompressed body size", async () => {
  const body = stream(3, "gzip"),
    bank = new SampleBank(pack(), { fetcher: async () => body.response }),
    ctx = { decodeAudioData: async () => pcm() };
  const job = bank.load("a", ctx);
  await flush();
  assert.equal(bank.get("a").progress.total, null);
  body.push(new Uint8Array(6));
  body.end();
  await job;
  assert.equal(bank.get("a").state, "ready");
  assert.equal(bank.get("a").progress.loaded, 6);
  bank.dispose();
});
test("oversized streamed and incomplete declared bodies fail before decode", async () => {
  for (const oversized of [true, false]) {
    let decoded = 0;
    const body = stream(oversized ? null : 10),
      bank = new SampleBank(pack(), { fetcher: async () => body.response });
    const job = bank.load("a", {
      decodeAudioData: async () => {
        decoded++;
        return pcm();
      },
    });
    await flush();
    body.push(new Uint8Array(oversized ? 4 * 1024 * 1024 + 1 : 5));
    body.end();
    await job;
    assert.equal(decoded, 0);
    assert.equal(bank.get("a").state, "error");
    assert.match(bank.get("a").error, oversized ? /size limit/ : /Incomplete/);
    bank.dispose();
  }
});
test("repeated decode timeouts retain at most four native reservations; disposal prevents late publication", async () => {
  const t = clock(),
    decodes = [],
    ctx = {
      decodeAudioData: () => {
        const d = deferred();
        decodes.push(d);
        return d.promise;
      },
    },
    bank = new SampleBank(pack(), { ...t, fetcher: fast });
  for (let i = 0; i < 6; i++) {
    const job = bank.load("a", ctx);
    await flush();
    t.advance(10000);
    await job;
    assert(contextLoadQueue(ctx).snapshot().nativeDecodes <= 4);
  }
  assert.equal(decodes.length, 4);
  bank.dispose();
  for (const d of decodes) d.resolve(pcm());
  await flush();
  assert.equal(contextLoadQueue(ctx).snapshot().nativeDecodes, 0);
  assert.equal(bank.get("a").state, "disposed");
  assert.equal(bank.get("a").buffer, null);
  assert.equal(t.tasks.size, 0);
});

class Param {
  setValueAtTime() {}
  linearRampToValueAtTime() {}
  setTargetAtTime() {}
  cancelScheduledValues() {}
}
class AudioNode {
  constructor() {
    this.gain = new Param();
    this.playbackRate = new Param();
    this.connections = new Set();
  }
  connect(n) {
    this.connections.add(n);
  }
  disconnect(n) {
    if (n) this.connections.delete(n);
    else this.connections.clear();
  }
  start(when, offset) {
    this.started = { when, offset };
  }
  stop(when) {
    this.stopped = when;
  }
}
class Context extends EventTarget {
  constructor() {
    super();
    this.currentTime = 0;
    this.state = "suspended";
    this.destination = new AudioNode();
    this.sourceStarts = [];
  }
  createGain() {
    return new AudioNode();
  }
  createBufferSource() {
    const node = new AudioNode(),
      start = node.start.bind(node);
    node.start = (...args) => {
      this.sourceStarts.push(args);
      return start(...args);
    };
    return node;
  }
  decodeAudioData() {
    return Promise.resolve(pcm());
  }
  resume() {
    this.state = "running";
    this.dispatchEvent(new Event("statechange"));
    return Promise.resolve();
  }
  close() {
    this.state = "closed";
    this.dispatchEvent(new Event("statechange"));
    return Promise.resolve();
  }
}
function engineFixture(fetcher) {
  const context = new Context(),
    timers = new Set();
  const engine = new AudioEngine(pack(), {
    variantPacks: [pack(2)],
    contextFactory: () => context,
    bankOptions: { fetcher },
    timers: {
      setInterval: (fn) => {
        timers.add(fn);
        return fn;
      },
      clearInterval: (fn) => timers.delete(fn),
    },
  });
  for (const id of ["a", "b", "c"]) engine.setLayer(id, false);
  return { engine, context, timers };
}
test("selected-first startup never fetches inactive voices/variations; late selected voices join common bar", async () => {
  const calls = [],
    { engine, context } = engineFixture(async (url) => {
      calls.push(url);
      return fast();
    });
  engine.setLayer("a", true);
  await engine.play();
  assert.deepEqual(calls, ["a-1"]);
  await engine.setVariation("b", 2);
  assert.deepEqual(calls, ["a-1"]);
  const original = engine.roleVoice.get("a");
  context.currentTime = 0.2;
  await engine.setLayer("b", true);
  assert.deepEqual(calls, ["a-1", "b-2"]);
  const at = engine.pending.get("b").at;
  assert.equal(engine.transport.beatsAt(at) % 4, 0);
  assert.equal(engine.roleVoice.get("a"), original);
  context.currentTime = at - 0.03;
  engine.pump();
  context.currentTime = at;
  engine.pump();
  assert.equal(engine.applied.get("b"), true);
  assert.equal(engine.stats.starts, 1);
  assert.equal(engine.roleVoice.get("a"), original);
  await engine.dispose();
});
test("fast selected voice starts while another streams; double retry neither replaces active source nor duplicates", async () => {
  const slow = stream(1),
    calls = [],
    { engine, context, timers } = engineFixture(async (url) => {
      calls.push(url);
      return url === "b-1" ? slow.response : fast();
    });
  engine.setLayer("a", true);
  engine.setLayer("b", true);
  const starting = engine.play();
  await flush();
  assert.equal(engine.status, "playing");
  assert.equal(engine.voices.size, 1);
  assert.equal(engine.stats.starts, 1);
  assert.equal(timers.size, 1);
  const original = engine.roleVoice.get("a");
  context.currentTime = 3;
  const retry1 = engine.retry("b"),
    retry2 = engine.retry("b");
  slow.push(Uint8Array.of(1));
  slow.end();
  await Promise.all([starting, retry1, retry2]);
  assert.equal(calls.filter((x) => x === "b-1").length, 1);
  const at = engine.pending.get("b").at;
  context.currentTime = at - 0.03;
  engine.pump();
  context.currentTime = at;
  engine.pump();
  assert.equal(engine.voices.size, 2);
  assert.equal(engine.roleVoice.get("a"), original);
  assert.equal(
    engine.events.filter((x) => x.type === "voice-start" && x.id === "b")
      .length,
    1,
  );
  await engine.dispose();
});
test("off/on same variation during initial load cannot let old completion cancel the latest selected job", async () => {
  const old = deferred();
  let count = 0;
  const { engine } = engineFixture(async () =>
    ++count === 1 ? old.promise : fast(),
  );
  engine.setLayer("a", true);
  const starting = engine.play();
  await flush();
  engine.setLayer("a", false);
  const newer = engine.setLayer("a", true);
  await Promise.all([starting, newer]);
  assert.equal(engine.status, "playing");
  assert.equal(engine.voices.size, 1);
  const current = engine.bank.get("a").buffer;
  old.resolve(await fast());
  await flush();
  assert.equal(engine.bank.get("a").buffer, current);
  assert.equal(engine.stats.starts, 1);
  await engine.dispose();
});
test("changing selected role while loading aborts unused work and starts only new intent", async () => {
  const old = deferred(),
    calls = [],
    { engine } = engineFixture(async (url) => {
      calls.push(url);
      return url === "a-1" ? old.promise : fast();
    });
  engine.setLayer("a", true);
  const starting = engine.play();
  await flush();
  engine.setLayer("a", false);
  const next = engine.setLayer("c", true);
  await Promise.all([starting, next]);
  old.resolve(await fast());
  await flush();
  assert.equal(engine.bank.get("a").buffer, null);
  assert.equal(engine.applied.get("a"), false);
  assert.equal(engine.applied.get("c"), true);
  assert.equal(engine.voices.size, 1);
  assert.deepEqual(calls, ["a-1", "c-1"]);
  await engine.dispose();
});
test("suspension cancels startup ownership and stale bodies cannot report playing", async () => {
  const held = deferred(),
    { engine, context, timers } = engineFixture(() => held.promise);
  engine.setLayer("a", true);
  const start = engine.play();
  await flush();
  context.state = "interrupted";
  context.dispatchEvent(new Event("statechange"));
  await start;
  assert.equal(engine.status, "interrupted");
  held.resolve(await fast());
  await flush();
  assert.equal(engine.bank.get("a").buffer, null);
  assert.equal(engine.voices.size, 0);
  assert.equal(timers.size, 0);
  await engine.dispose();
});
test("Retry never downloads a disabled Beatbox role, including an earlier failed selection", async () => {
  const calls = [],
    { engine } = engineFixture(async (url) => {
      calls.push(url);
      if (url === "a-1") throw new Error("offline");
      return fast();
    });
  engine.setLayer("a", true);
  await engine.play();
  assert.equal(engine.bank.get("a").state, "error");
  engine.setLayer("a", false);
  await engine.retry("a");
  await engine.retry("b");
  assert.deepEqual(calls, ["a-1"]);
  assert.equal(engine.voices.size, 0);
  engine.setLayer("a", true);
  await engine.retry("a");
  assert.deepEqual(calls, ["a-1", "a-1"]);
  await engine.dispose();
});
test("cached/retried retained admission rejects corrupted geometry and unsafe aggregate without download", async () => {
  let calls = 0;
  const bank = new SampleBank(pack(), {
      fetcher: () => {
        calls++;
        return fast();
      },
      validateCandidate: (_e, m) => {
        if (m.peak > 0.2) throw Error("unsafe aggregate");
      },
    }),
    ctx = { decodeAudioData: async () => pcm() };
  await bank.load("a", ctx);
  bank.get("a").metrics = { ...bank.get("a").metrics, peak: 0.4 };
  assert.equal(await bank.load("a", ctx), null);
  assert.equal(calls, 1);
  assert.equal(bank.get("a").error, "unsafe aggregate");
  await bank.load("a", ctx);
  bank.get("a").metrics.bytes = 1;
  assert.equal(await bank.load("a", ctx), null);
  assert.equal(calls, 2);
  assert.match(bank.get("a").error, /Invalid cached/);
  bank.dispose();
});

function assertPaused({ engine, context, timers }, starts, transports = 1) {
  assert.equal(engine.status, "paused");
  assert.equal(engine.playbackRequested, false);
  assert.equal(engine.transport.running, false);
  assert.equal(engine.voices.size, 0);
  assert.equal(engine.pending.size, 0);
  assert.equal(timers.size, 0);
  assert.equal(context.sourceStarts.length, starts);
  assert.equal(engine.stats.starts, transports);
}
test("Pause remains authoritative across uncached/cached selected variations and cached Retry until explicit Play", async () => {
  const calls = [],
    f = engineFixture(async (url) => {
      calls.push(url);
      return fast();
    });
  for (const id of ["a", "b", "c"]) f.engine.setLayer(id, true);
  await f.engine.play();
  f.engine.pause();
  assertPaused(f, 3);
  await f.engine.setVariation("b", 2);
  assert.equal(f.engine.variantEntry("b").state, "ready");
  assertPaused(f, 3);
  await f.engine.setVariation("b", 1);
  await f.engine.setVariation("b", 2);
  await f.engine.retry("b");
  assertPaused(f, 3);
  assert.equal(calls.filter((url) => url === "b-2").length, 1);
  await f.engine.play();
  assert.equal(f.engine.voices.size, 3);
  assert.equal(f.context.sourceStarts.length, 6);
  assert.equal(f.engine.stats.starts, 2);
  assert.equal(f.engine.appliedVariant.get("b"), 2);
  await f.engine.dispose();
});
test("paused failed-variation Retry warms the buffer silently and does not reopen playback intent", async () => {
  let alternate = 0;
  const f = engineFixture(async (url) => {
    if (url === "a-2" && ++alternate === 1) throw Error("offline");
    return fast();
  });
  f.engine.setLayer("a", true);
  await f.engine.play();
  f.engine.pause();
  await f.engine.setVariation("a", 2);
  assert.equal(f.engine.variantEntry("a").state, "error");
  assertPaused(f, 1);
  await f.engine.retry("a");
  assert.equal(f.engine.variantEntry("a").state, "ready");
  assertPaused(f, 1);
  await f.engine.play();
  assert.equal(f.context.sourceStarts.length, 2);
  assert.equal(f.engine.appliedVariant.get("a"), 2);
  await f.engine.dispose();
});
test("an uncancellable native decode completing after a newer Pause cannot publish or activate its variation", async () => {
  const held = deferred(),
    f = engineFixture(() => fast());
  f.engine.setLayer("a", true);
  await f.engine.play();
  f.context.decodeAudioData = () => held.promise;
  const variation = f.engine.setVariation("a", 2);
  await flush();
  f.engine.pause();
  held.resolve(pcm());
  await variation;
  assertPaused(f, 1);
  assert.equal(f.engine.variantEntry("a", 2).buffer, null);
  assert.equal(f.engine.variantEntry("a", 2).state, "idle");
  f.context.decodeAudioData = async () => pcm();
  await f.engine.play();
  assert.equal(f.context.sourceStarts.length, 2);
  assert.equal(f.engine.appliedVariant.get("a"), 2);
  await f.engine.dispose();
});
test("initial Play then Pause beats a late selected body; post-Pause variation completion stays silent", async () => {
  const original = deferred(),
    alternate = deferred(),
    f = engineFixture((url) => url === "a-1" ? original.promise : alternate.promise);
  f.engine.setLayer("a", true);
  const playing = f.engine.play();
  await flush();
  f.engine.pause();
  const variation = f.engine.setVariation("a", 2);
  await flush();
  original.resolve(await fast());
  alternate.resolve(await fast());
  await Promise.all([playing, variation]);
  assertPaused(f, 0, 0);
  assert.equal(f.engine.variantEntry("a", 1).buffer, null);
  assert.equal(f.engine.variantEntry("a", 2).state, "ready");
  await f.engine.play();
  assert.equal(f.context.sourceStarts.length, 1);
  await f.engine.dispose();
});
test("Retry of an outstanding failed Play cannot override Pause while its replacement body completes", async () => {
  const held = deferred();
  let calls = 0;
  const f = engineFixture(() => {
    if (++calls === 1) throw Error("offline");
    return held.promise;
  });
  f.engine.setLayer("a", true);
  await f.engine.play();
  assert.equal(f.engine.playbackRequested, true);
  const retry = f.engine.retry("a");
  await flush();
  f.engine.pause();
  held.resolve(await fast());
  await retry;
  assertPaused(f, 0, 0);
  assert.equal(f.engine.variantEntry("a").buffer, null);
  await f.engine.dispose();
});
test("cached variation microtasks and Play-Pause-Play-Pause races cannot revive superseded intent", async () => {
  const resume = deferred(),
    f = engineFixture(() => fast());
  f.engine.setLayer("a", true);
  await f.engine.play();
  await f.engine.setVariation("a", 2);
  f.engine.pause();
  const cached = f.engine.setVariation("a", 1);
  const play = f.engine.play();
  f.engine.pause();
  await Promise.all([cached, play]);
  assertPaused(f, 1);
  f.context.resume = () => resume.promise;
  const resumed = f.engine.play();
  f.engine.pause();
  resume.resolve();
  await resumed;
  assertPaused(f, 1);
  f.context.resume = () => Promise.resolve();
  await f.engine.play();
  assert.equal(f.context.sourceStarts.length, 2);
  assert.equal(f.engine.stats.starts, 2);
  await f.engine.dispose();
});
test("paused Retry cannot resume a suspended context or let a superseded initial resume revive playback", async () => {
  const resume = deferred(),
    f = engineFixture(() => fast());
  let resumeCalls = 0;
  f.context.resume = () => {
    ++resumeCalls;
    return resume.promise;
  };
  f.engine.setLayer("a", true);
  const initial = f.engine.play();
  await flush();
  f.engine.pause();
  await f.engine.retry("a");
  assert.equal(resumeCalls, 1);
  assert.equal(f.context.state, "suspended");
  assert.equal(f.engine.variantEntry("a").state, "ready");
  assertPaused(f, 0, 0);
  f.context.state = "running";
  f.context.dispatchEvent(new Event("statechange"));
  resume.resolve();
  await initial;
  assertPaused(f, 0, 0);
  f.context.resume = () => Promise.resolve();
  await f.engine.play();
  assert.equal(f.context.sourceStarts.length, 1);
  await f.engine.dispose();
});
test("new Play can adopt a paused preload, while another Pause-Play supersedes its stale body", async () => {
  const held = deferred();
  let alternates = 0;
  const f = engineFixture((url) =>
    url === "a-2" && ++alternates === 1 ? held.promise : fast(),
  );
  f.engine.setLayer("a", true);
  await f.engine.play();
  f.engine.pause();
  const preload = f.engine.setVariation("a", 2);
  await flush();
  const adopting = f.engine.play();
  await flush();
  assert.equal(alternates, 1);
  f.engine.pause();
  assertPaused(f, 1);
  const latest = f.engine.play();
  await latest;
  assert.equal(alternates, 2);
  const owner = f.engine.roleVoice.get("a");
  held.resolve(await fast());
  await Promise.all([preload, adopting]);
  await flush();
  assert.equal(f.engine.roleVoice.get("a"), owner);
  assert.equal(f.engine.appliedVariant.get("a"), 2);
  assert.equal(f.context.sourceStarts.length, 2);
  assert.equal(f.engine.stats.starts, 2);
  await f.engine.dispose();
});
