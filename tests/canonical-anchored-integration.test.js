import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { createCanonicalNativeSession } from "../src/audio/canonical-native.js";
import { createCanonicalStudioOwner } from "../src/studio/canonical-owner.js";
import { createExperimentalAnchoredOwner } from "../src/audio/experimental-anchored-stream/owner.js";
import { createCanonicalStudioController } from "../src/studio/canonical-controller.js";
import { prepareCanonicalScore } from "../src/audio/canonical-score.js";
import { createPortableMixState } from "../src/loop-station/portable-mix-state.js";
import { BYPASS_LIMITER } from "../src/loop-station/fx-model.js";
import { canonicalVoiceOwners } from "../src/audio/canonical-voice-budget.js";
import {
  canonicalScoreFixture,
  qaBuffer,
  qaSample,
} from "./helpers/canonical-score-fixtures.js";
import { anchoredHost, flush } from "./helpers/anchored-stream-host.js";
const hosts = new WeakMap(),
  installed = new WeakSet();
function bindNative(t, h) {
  hosts.set(h.context, h);
  if (installed.has(t)) return;
  installed.add(t);
  const previous = Object.getOwnPropertyDescriptor(
    globalThis,
    "AudioWorkletNode",
  );
  Object.defineProperty(globalThis, "AudioWorkletNode", {
    configurable: true,
    writable: true,
    value: class {
      constructor(context, name, options) {
        return hosts.get(context).construct(context, name, options);
      }
    },
  });
  t.after(() => {
    if (previous)
      Object.defineProperty(globalThis, "AudioWorkletNode", previous);
    else delete globalThis.AudioWorkletNode;
  });
}

async function setup(
  t,
  rate = 48000,
  {
    hostOptions = {},
    generation = 1,
    profile = "repeat",
    memory = new AudioMemory(),
  } = {},
) {
  const foreign = memory.reserve(313, "foreign"),
    h = anchoredHost(rate, hostOptions);
  h.context.createBuffer = qaBuffer;
  const session = await createCanonicalNativeSession({
    rate,
    memory,
    contextFactory: () => h.context,
    outputFactory: () => ({ context: h.context }),
    printFactory: () => {},
  });
  const transport = createExperimentalAnchoredOwner({
    session,
    memory,
    options: { backend: "anchored-r2-test", runId: "integration", generation },
  });
  const f = await canonicalScoreFixture(rate, memory, qaBuffer, { profile });
  const prepare = (cycles = 1) =>
    prepareCanonicalScore(f.canonical, {
      ...f,
      // Trusted-provider I/O double for offline ownership/control tests.
      // Its decoded-PCM digests are still checked by the real compiler.
      // This does not certify the synthetic fixture as a licensed asset.
      provider: { ...f.provider, purpose: "production" },
      rate,
      memory,
      createBuffer: qaBuffer,
      command: { kind: "repeat", bars: null, cycles },
      yieldTask: async () => {},
    });
  const score = await prepare();
  bindNative(t, h);
  let job;
  const api = {
    h,
    memory,
    session,
    transport,
    f,
    score,
    prepare,
    get job() {
      return job;
    },
    begin(fromFrame = 0, signal) {
      job = transport.start(score, {
        repeat: true,
        destination: { context: h.context },
        fromFrame,
        signal,
      });
      return job;
    },
    async start(fromFrame = 0, signal) {
      await transport.prepare(score, { repeat: true });
      await transport.resume();
      api.begin(fromFrame, signal);
      await flush();
      h.step(0);
      await flush();
      return job;
    },
    async close() {
      h.context.failClose = false;
      await transport.interrupt();
      await job?.dispose();
      await job?.done.catch(() => {});
      score.dispose();
      assert.equal(canonicalVoiceOwners(memory).count, 0);
      assert.equal(
        f.stats.releases,
        f.stats.loads,
        "all original source loans actually retired",
      );
      assert.equal(memory.snapshot().bytes, 313);
      foreign.release();
      assert.equal(memory.snapshot().bytes, 0);
    },
  };
  return api;
}

for (const rate of [44100, 48000])
  for (const fromFrame of [0, 137])
    test(`opt-in real loop producer full PCM/natural tail and seek coordinates @${rate} from=${fromFrame}`, async (t) => {
      const f = await setup(t, rate),
        { h, transport, score, memory } = f;
      let reference, finite;
      try {
        const job = await f.start(fromFrame);
        await job.ready;
        assert(Number.isSafeInteger(job.originFrame));
        assert.equal(job.backend, "experimental-anchored-r2-continuous");
        const finish = job.finish();
        finite = await f.prepare(finish.bodyFrames / score.timeline.bodyFrames);
        assert.equal(finite.program.frames, finish.frames);
        reference = createPortableMixState(
          {
            ...finite.project,
            master: { ...finite.project.master, limiter: BYPASS_LIMITER },
          },
          finite.program,
          { memory },
        );
        const expected = [new Float32Array(4096), new Float32Array(4096)];
        let skipped = 0;
        while (skipped < fromFrame) {
          const n = Math.min(4096, fromFrame - skipped);
          reference.renderInto(expected.map((c) => c.subarray(0, n)));
          skipped += n;
        }
        let frame = 128;
        while (frame < job.originFrame) {
          const n = Math.min(128, job.originFrame - frame);
          const r = h.step(frame, n);
          assert(r.channels.every((c) => c.every((v) => v === 0)));
          frame += n;
          await flush();
        }
        const end = finish.frames - fromFrame;
        let at = 0;
        while (at < end) {
          const n = Math.min(128, end - at),
            r = h.step(job.originFrame + at, n),
            wanted = expected.map((c) => c.subarray(0, n));
          const q = reference.renderInto(wanted);
          assert.equal(q.frames, n);
          for (let c = 0; c < 2; c++)
            assert.deepEqual(
              r.channels[c],
              wanted[c],
              `producer PCM frame ${fromFrame + at} ch${c}`,
            );
          at += n;
          await flush();
        }
        const receipt = await job.done;
        assert.equal(receipt.renderedFrames, end);
        assert.equal(receipt.frame, job.originFrame + end);
        assert.equal(receipt.programmeEndFrame, finish.frames);
        assert.equal(h.events.length, 1);
        assert.equal(
          h.inbound.find((m) => m.type === "started").programmeOffset,
          fromFrame,
        );
        assert.equal(transport.snapshot().active, false);
        assert.equal(job.snapshot().retired, true);
      } finally {
        reference?.dispose();
        finite?.dispose();
        await f.close();
      }
    });

test("pending async ARM never publishes ready/origin; owner pause/resume uses the queue", async (t) => {
  const f = await setup(t, 48000, { hostOptions: { holdAck: true } }),
    { h, transport } = f;
  try {
    const job = await f.start();
    let ready = false;
    job.ready.then(
      () => (ready = true),
      () => {},
    );
    await flush();
    assert.equal(job.originFrame, null);
    assert.equal(ready, false);
    assert.equal(h.events.length, 0);
    const paused = transport.pause();
    await flush();
    assert.equal(h.context.state, "running");
    h.releaseAck();
    await job.ready;
    await paused;
    assert.equal(h.context.state, "suspended");
    assert.equal(job.snapshot().fault, null);
    await transport.resume();
    assert.equal(h.context.state, "running");
    h.step(job.originFrame);
    await flush();
    const rendered = h.processor.rendered;
    await transport.pause();
    assert.equal(h.processor.rendered, rendered);
    await transport.resume();
    h.step(job.originFrame + 128);
    assert.equal(h.processor.rendered, rendered + 128);
    assert.equal(h.events.length, 1);
  } finally {
    await f.close();
  }
});

test("expired async start rejects with original cause, closes context, and never falls back to R18", async (t) => {
  const f = await setup(t, 48000, { hostOptions: { holdAck: true } }),
    { h } = f;
  try {
    const job = await f.start();
    h.context.currentTime = 1;
    h.releaseAck();
    await assert.rejects(job.ready, { code: "anchoredAckLate" });
    await assert.rejects(job.done, { code: "anchoredAckLate" });
    assert.equal(job.originFrame, null);
    assert.equal(h.context.state, "closed");
    assert.equal(h.events.length, 0);
    assert(h.outbound.every((m) => m.identity.nodeId === "main-stream"));
    assert.equal(job.snapshot().fault, "anchoredAckLate");
  } finally {
    await f.close();
  }
});

test("Stop/dispose while ARM pending fences a late ACK and keeps foreign ownership", async (t) => {
  const f = await setup(t, 48000, { hostOptions: { holdAck: true } }),
    { h, transport, memory } = f;
  try {
    const job = await f.start();
    job.stop();
    await transport.interrupt();
    h.releaseAck();
    await assert.rejects(job.ready, { code: "cancelled" });
    await job.dispose();
    await assert.rejects(job.done, { code: "cancelled" });
    assert.equal(job.originFrame, null);
    assert.equal(h.events.length, 0);
    assert.equal(job.snapshot().retired, true);
    assert(memory.snapshot().bytes >= 313);
  } finally {
    await f.close();
  }
});

test("repeat-off during pending start is deferred and preserves complete finite tail", async (t) => {
  const f = await setup(t, 48000, { hostOptions: { holdAck: true } }),
    { h } = f;
  try {
    const job = await f.start();
    assert.equal(job.finish(), null);
    h.releaseAck();
    await job.ready;
    const finish = job.snapshot().finish;
    assert(finish.frames > finish.bodyFrames);
    for (let at = 0; at < finish.frames + 128; at += 128) {
      const r = h.step(job.originFrame + at);
      await flush();
      if (!r.alive) break;
    }
    const receipt = await job.done;
    assert.equal(receipt.renderedFrames, finish.frames);
    assert.equal(receipt.frame, job.originFrame + finish.frames);
  } finally {
    await f.close();
  }
});

test("real-producer queue underrun retains its fault and retires only after actual closure", async (t) => {
  const f = await setup(t),
    { h } = f;
  try {
    const job = await f.start();
    await job.ready;
    await flush();
    // Model a stalled producer/host task while native callbacks continue:
    // hold the microtask delivery turn, then deliver every genuine receipt.
    for (let at = 0; at <= 131072; at += 128) {
      const r = h.step(job.originFrame + at);
      if (!r.alive) break;
    }
    await flush();
    assert.equal(h.processor.closedMessage.fault, "canonicalStreamStarved");
    await assert.rejects(job.done, { code: "canonicalStreamStarved" });
    assert.equal(h.context.state, "closed");
    assert.equal(job.snapshot().retired, true);
  } finally {
    await f.close();
  }
});

test("scope rejects mixed programme, audition, finite playback, and owner reuse without fallback", async (t) => {
  const f = await setup(t),
    { transport, score } = f;
  try {
    assert.throws(() => transport.assertIntent({ repeat: false }), {
      code: "experimentalStreamUnsupportedCombination",
    });
    assert.throws(
      () => transport.assertIntent({ repeat: true, audition: true }),
      { code: "experimentalStreamUnsupportedCombination" },
    );
    await assert.rejects(
      transport.prepare(
        { ...score, project: { ...score.project, tracks: [1, 2, 3] } },
        { repeat: true },
      ),
      { code: "experimentalStreamProgrammeScope" },
    );
    assert.throws(
      () =>
        transport.start(score, {
          repeat: true,
          fromFrame: -1,
          destination: { context: f.h.context },
        }),
      { code: "invalidCanonicalSession" },
    );
    assert.equal(transport.snapshot().started, false);
    const job = await f.start();
    await job.ready;
    assert.throws(
      () =>
        transport.start(score, {
          repeat: true,
          destination: { context: f.h.context },
        }),
      { code: "experimentalStreamNewOwnerRequired" },
    );
  } finally {
    await f.close();
  }
});

test("real Studio factory has explicit opt-in and blocks unsupported prepare/export before asset I/O", async () => {
  const memory = new AudioMemory(),
    foreign = memory.reserve(313, "foreign");
  let fetches = 0;
  const context = {
    sampleRate: 48000,
    createBuffer: qaBuffer,
    state: "running",
    async close() {
      this.state = "closed";
    },
    async resume() {},
    async suspend() {},
  };
  const owner = await createCanonicalStudioOwner({
    rate: 48000,
    memory,
    contextFactory: () => context,
    outputFactory: () => ({ context }),
    resolveUrl: (r) => r.path,
    fetcher: () => {
      fetches++;
      throw Error("must not fetch");
    },
    streamExperiment: { backend: "anchored-r2-test", generation: 4 },
  });
  await assert.rejects(owner.prepare({}, { repeat: true, audition: true }), {
    code: "experimentalStreamUnsupportedCombination",
  });
  assert.throws(() => owner.exportWav(null, {}), {
    code: "experimentalStreamUnsupportedCombination",
  });
  assert.equal(fetches, 0);
  assert.equal(owner.snapshot().streamExperiment.identity.generation, 4);
  await owner.dispose();
  assert.equal(memory.snapshot().bytes, 313);
  foreign.release();
});

const until = async (predicate) => {
  const end = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > end) throw Error("integration setup deadline");
    await new Promise((r) => setTimeout(r, 5));
  }
};
for (const change of ["Stop", "replace loop"])
  test(`controller ${change} during ARM fences old owner/late callback and new generation`, async (t) => {
    const owners = [];
    const controller = createCanonicalStudioController({
      createOwner: async ({ generation }) => {
        const f = await setup(t, 48000, {
          generation,
          hostOptions: { holdAck: owners.length === 0 },
        });
        owners.push(f);
        return {
          context: f.h.context,
          prepare: async (_doc, options) => {
            await f.transport.prepare(f.score, options);
            return f.score;
          },
          resume: () => f.transport.resume(),
          pause: () => f.transport.pause(),
          start: (_score, options) =>
            f.begin(options.fromFrame, options.signal),
          interrupt: () => f.transport.interrupt(),
          async dispose() {
            await f.transport.interrupt();
            await f.job?.dispose();
            f.score.dispose();
          },
        };
      },
    });
    controller.setRepeat(true);
    try {
      const first = controller.play({ title: "first" });
      first.catch(() => {});
      await until(() => owners[0]?.h.processor);
      owners[0].h.step(0);
      await until(() => owners[0].h.held.length === 1);
      assert.equal(controller.snapshot().status, "preparing");
      assert.equal(owners[0].job.originFrame, null);
      if (change === "Stop") await controller.stop();
      const second = controller.play({ title: "replacement" });
      second.catch(() => {});
      await until(() => owners[1]?.h.processor);
      owners[1].h.step(0);
      await second;
      await assert.rejects(first, { code: "cancelled" });
      const a = owners[0],
        b = owners[1],
        identity = a.transport.snapshot().identity;
      await until(() => b.job.snapshot().queue.pendingChunks === 32);
      await flush();
      const held = b.memory.snapshot().bytes;
      a.h.releaseAck();
      b.h.deliver({
        type: "closed",
        identity,
        renderedFrames: 0,
        acceptedChunks: 0,
        consumedChunks: 0,
        programmeEndFrame: null,
        frame: null,
      });
      await flush();
      assert.equal(controller.snapshot().status, "playing");
      assert.equal(b.memory.snapshot().bytes, held);
      assert.equal(b.job.snapshot().queue.staleReceived, 1);
      assert.equal(b.job.snapshot().fault, null);
      assert.equal(a.h.context.state, "closed");
      assert.equal(a.memory.snapshot().bytes, 313);
      assert.notEqual(
        identity.contextId,
        b.transport.snapshot().identity.contextId,
      );
      await controller.pause();
      assert.equal(b.h.context.state, "suspended");
      await controller.resume();
      b.h.step(b.job.originFrame);
      assert.equal(b.h.processor.rendered, 128);
      await controller.stop();
      assert.equal(controller.snapshot().pendingOwners, 0);
    } finally {
      await controller.dispose();
      for (const f of owners) await f.close();
    }
  });

test("failed actual context close retains loop/voice ownership until acknowledged cleanup retry", async (t) => {
  const f = await setup(t, 48000, { hostOptions: { holdAck: true } }),
    { h, memory } = f;
  try {
    const job = await f.start();
    h.context.failClose = true;
    await assert.rejects(job.dispose(), /injected close failure/);
    await flush();
    assert.equal(h.context.state, "running");
    assert.equal(job.snapshot().retired, false);
    assert(memory.snapshot().bytes > 313);
    assert(canonicalVoiceOwners(memory).count > 0);
    const released = f.f.stats.releases;
    f.score.dispose();
    assert.equal(
      f.f.stats.releases,
      released,
      "live producer retains source loans after parent disposal",
    );
    h.context.failClose = false;
    await job.dispose();
    assert.equal(h.context.state, "closed");
    assert.equal(job.snapshot().retired, true);
  } finally {
    await f.close();
  }
});

test("opt-in scope retains unverified-score refusal and ordinary factory keeps R18 default selection", async (t) => {
  const f = await setup(t);
  try {
    const unverified = await prepareCanonicalScore(f.f.canonical, {
      ...f.f,
      rate: 48000,
      memory: f.memory,
      createBuffer: qaBuffer,
      command: { kind: "repeat", bars: null, cycles: 1 },
      yieldTask: async () => {},
    });
    try {
      assert.equal(unverified.playableVerified, false);
      await assert.rejects(f.transport.prepare(unverified, { repeat: true }), {
        code: "experimentalStreamProgrammeScope",
      });
    } finally {
      unverified.dispose();
    }
  } finally {
    await f.close();
  }
  const memory = new AudioMemory(),
    context = {
      sampleRate: 48000,
      state: "running",
      createBuffer: qaBuffer,
      async close() {
        this.state = "closed";
      },
    };
  const owner = await createCanonicalStudioOwner({
    rate: 48000,
    memory,
    contextFactory: () => context,
    outputFactory: () => ({ context }),
    resolveUrl: (r) => r.path,
  });
  assert.equal(Object.hasOwn(owner.snapshot(), "streamExperiment"), false);
  await owner.dispose();
  assert.equal(memory.snapshot().bytes, 0);
});

test("actual Studio factory runs production asset/cache admission, shared bus and anchored owner lifecycle offline", async (t) => {
  const memory = new AudioMemory(),
    foreign = memory.reserve(313, "foreign"),
    h = anchoredHost(),
    fixture = await canonicalScoreFixture(48000, memory, qaBuffer, {
      profile: "repeat",
    }),
    byHash = new Map();
  const source = fixture.canonical.sourceDefs.find(
    (d) => d.kind === "instrument-events",
  ).programme;
  for (const e of source.events) {
    const version = source.banks.find((b) => b.id === e.bankId).version,
      d = fixture.registry.sample(e.bankId, version, e.sampleId);
    byHash.set(d.sha256, d);
  }
  let decodes = 0,
    fetches = 0,
    owner,
    score;
  h.context.createBuffer = qaBuffer;
  bindNative(t, h);
  h.context.decodeAudioData = async (bytes) => {
    // AudioContext decode is a synthetic I/O double; real encoded files,
    // catalog rights, SHA checks, cache/loans and application DSP still run.
    const hash = createHash("sha256")
        .update(new Uint8Array(bytes))
        .digest("hex"),
      d = byHash.get(hash);
    assert(d);
    decodes++;
    const b = qaBuffer(d.channels, d.frames, d.sampleRate);
    for (let c = 0; c < d.channels; c++)
      for (let i = 0; i < d.frames; i++)
        b.getChannelData(c)[i] = qaSample(hash, i, c);
    return b;
  };
  try {
    owner = await createCanonicalStudioOwner({
      rate: 48000,
      memory,
      contextFactory: () => h.context,
      outputFactory: () => ({ context: h.context }),
      resolveUrl: (r) => r.path,
      fetcher: async (url) => {
        fetches++;
        return new Response(await fs.readFile(url));
      },
      streamExperiment: { backend: "anchored-r2-test", generation: 9 },
    });
    score = await owner.prepare(fixture.canonical, { repeat: true });
    assert.equal(score.playableVerified, true);
    assert.equal(decodes, 2);
    assert.equal(fetches, 2);
    await owner.resume();
    const job = owner.start(score, { repeat: true });
    await flush();
    h.step(0);
    await job.ready;
    assert.equal(job.backend, "experimental-anchored-r2-continuous");
    assert.equal(owner.snapshot().output.activeJobs, 1);
    h.step(job.originFrame);
    await flush();
    await owner.pause();
    assert.equal(h.context.state, "suspended");
    await owner.resume();
    assert.equal(h.context.state, "running");
    assert.equal(job.snapshot().fault, null);
    const finish = job.finish();
    for (let at = 128; at < finish.frames + 128; at += 128) {
      const r = h.step(job.originFrame + at);
      await flush();
      if (!r.alive) break;
    }
    const receipt = await job.done;
    assert.equal(receipt.renderedFrames, finish.frames);
    assert.equal(owner.snapshot().output.activeJobs, 0);
    assert.equal(owner.snapshot().streamExperiment.identity.generation, 9);
  } finally {
    await owner?.interrupt();
    score?.dispose();
    await owner?.dispose();
    assert.equal(canonicalVoiceOwners(memory).count, 0);
    assert.equal(memory.snapshot().bytes, 313);
    foreign.release();
  }
});
