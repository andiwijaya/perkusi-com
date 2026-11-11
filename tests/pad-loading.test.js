import test from "node:test";
import assert from "node:assert/strict";
import { createExtraSampler } from "../src/pads/extra-sampler.js";
import { createExtraLoading } from "../src/pads/extra-loading.js";
import { SampleBank } from "../src/audio/sample-bank.js";
import { renderExtraPads } from "../src/pads/extra-page.js";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
const pcm = () => ({
  length: 8,
  sampleRate: 8000,
  numberOfChannels: 1,
  duration: 0.001,
  getChannelData: () => new Float32Array(8).fill(0.1),
});
const pack = (id = "test") => ({
  schemaVersion: 1,
  id,
  kind: "one-shot",
  bpm: 120,
  bars: 1,
  beatsPerBar: 4,
  stems: ["a", "b"].map((id) => ({
    id,
    url: id,
    licenseId: "test",
    gainTrim: 0.5,
    durationSeconds: 0.001,
  })),
});
function setup({ fetcher, decode } = {}) {
  const counts = { fetch: 0, decode: 0, voices: 0, resume: 0 };
  const ctx = {
    state: "suspended",
    decodeAudioData: async () => {
      counts.decode++;
      return decode ? decode(counts.decode) : pcm();
    },
    resume: () => {
      counts.resume++;
      throw Error("must not resume during preparation");
    },
  };
  const engine = {
    context: ctx,
    ensureContext: () => engine.context,
    banks: new Set(),
    voices: new Set(),
    admitCandidate() {},
    removeVoice() {
      counts.voices++;
    },
  };
  let bank;
  const sampler = createExtraSampler(engine, pack(), 1, {
    bankFactory: (p, options) =>
      (bank = new SampleBank(p, {
        ...options,
        fetcher: async (...args) => {
          counts.fetch++;
          return fetcher
            ? fetcher(...args)
            : { ok: true, arrayBuffer: async () => new ArrayBuffer(1) };
        },
      })),
  });
  return {
    engine,
    ctx,
    sampler,
    counts,
    get bank() {
      return bank;
    },
  };
}

test("preparation waits for final native decode, reports valid buffers, creates no sound and never waits for resume", async () => {
  const held = deferred(),
    f = setup({ decode: (n) => (n === 2 ? held.promise : pcm()) }),
    progress = [];
  const job = f.sampler.prepare((p) => progress.push(p));
  await flush();
  assert.equal(f.sampler.isReady(), false);
  assert.deepEqual(progress.at(-1), { ready: 1, total: 2 });
  held.resolve(pcm());
  assert.deepEqual(await job, { ready: 2, total: 2 });
  assert(f.sampler.isReady());
  assert.equal(f.counts.resume, 0);
  assert.equal(f.counts.voices, 0);
  assert.equal(f.engine.voices.size, 0);
  await f.sampler.prepare();
  assert.equal(f.counts.fetch, 2);
  assert.equal(f.counts.decode, 2);
  f.sampler.dispose();
});

for (const failure of ["HTTP", "decode", "validation", "timeout"])
  test(`partial ${failure} failure cannot mark bank ready; retry reuses valid sample`, async () => {
    let fail = true;
    const f = setup({
      fetcher: async (id) => {
        if (id === "b" && fail && failure === "HTTP")
          return { ok: false, status: 503 };
        if (id === "b" && fail && failure === "timeout")
          return new Promise(() => {});
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) };
      },
      decode: (n) => {
        if (n === 2 && fail && failure === "decode")
          throw Error("decode failed");
        if (n === 2 && fail && failure === "validation")
          return { ...pcm(), getChannelData: () => new Float32Array(8) };
        return pcm();
      },
    });
    if (failure === "timeout") f.bank.budgets.headers = 10;
    await assert.rejects(f.sampler.prepare(), /incomplete/);
    assert.equal(f.sampler.isReady(), false);
    assert.equal(f.bank.get("a").state, "ready");
    assert.equal(f.bank.get("b").state, "error");
    fail = false;
    await f.sampler.prepare();
    assert(f.sampler.isReady());
    assert.equal(f.counts.fetch, 3);
    f.sampler.dispose();
  });

for (const action of ["stop", "unload", "dispose", "context"])
  test(`preparation ${action} fences late native decode and progress`, async () => {
    const held = deferred(),
      progress = [],
      f = setup({ decode: () => held.promise });
    const job = f.sampler.prepare((p) => progress.push(p));
    await flush();
    if (action === "context") f.engine.context = {};
    else f.sampler[action]();
    const updates = progress.length;
    held.resolve(pcm());
    assert.equal(await job, null);
    assert.equal(progress.length, updates);
    assert.equal(f.sampler.isReady(), false);
    f.sampler.dispose();
  });

test("controller fences A to B to A including stale progress and rejection", async () => {
  const tasks = [],
    views = [];
  const sampler = () => ({
    stop() {},
    isReady: () => true,
    prepare(progress) {
      const job = deferred();
      tasks.push({ ...job, progress });
      return job.promise;
    },
  });
  const controller = createExtraLoading(
    { kethuk: sampler(), b: sampler() },
    (v) => views.push(v),
  );
  const a1 = controller.prepare(),
    b = controller.prepare("b"),
    a2 = controller.prepare("kethuk");
  tasks[0].progress({ ready: 2, total: 2 });
  tasks[1].progress({ ready: 7, total: 7 });
  tasks[0].reject(Error("old A"));
  tasks[1].resolve({ ready: 7, total: 7 });
  await Promise.all([a1, b]);
  assert.equal(controller.snapshot().state, "loading");
  assert.equal(controller.snapshot().ready, 0);
  tasks[2].progress({ ready: 1, total: 2 });
  assert.equal(controller.isReady(), false);
  tasks[2].resolve({ ready: 2, total: 2 });
  await a2;
  assert(controller.isReady());
  assert.equal(views.at(-1).selected, "kethuk");
  controller.dispose();
});

test("controller Stop preserves paused status on late completion; fresh retry and error recovery work", async () => {
  const tasks = [],
    sampler = {
      stop() {},
      isReady: () => true,
      prepare() {
        const job = deferred();
        tasks.push(job);
        return job.promise;
      },
    };
  const controller = createExtraLoading({ kethuk: sampler });
  const first = controller.prepare();
  controller.pause();
  tasks[0].resolve({ ready: 2, total: 2 });
  await first;
  assert.equal(controller.snapshot().state, "paused");
  assert.equal(controller.isReady(), false);
  const retry = controller.prepare();
  tasks[1].reject(Error("network"));
  await retry;
  assert.equal(controller.snapshot().state, "error");
  const fresh = controller.prepare();
  tasks[2].resolve({ ready: 2, total: 2 });
  await fresh;
  assert(controller.isReady());
  controller.invalidate();
  assert.equal(controller.isReady(), false);
  const last = controller.prepare();
  controller.dispose();
  tasks[3].resolve({ ready: 2, total: 2 });
  await last;
  assert.equal(controller.isReady(), false);
});

test("loading indicator is between heading and selector in both languages; initial pads disabled", () => {
  for (const locale of ["id", "en"]) {
    const html = renderExtraPads(locale);
    assert(
      html.indexOf('id="ps-extra-title"') <
        html.indexOf('id="ps-extra-loading"'),
    );
    assert(
      html.indexOf('id="ps-extra-loading"') <
        html.indexOf('id="ps-extra-instrument"'),
    );
    assert(html.includes('aria-live="polite"'));
    assert(html.includes('id="ps-extra-retry" hidden'));
    assert.equal(
      (html.match(/disabled class="st-pad ps-extra-pad"/g) || []).length,
      2,
    );
  }
});
