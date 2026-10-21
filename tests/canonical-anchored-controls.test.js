import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { createCanonicalStudioOwner } from "../src/studio/canonical-owner.js";
import { createCanonicalStudioController } from "../src/studio/canonical-controller.js";
import { canonicalVoiceOwners } from "../src/audio/canonical-voice-budget.js";
import {
  canonicalScoreFixture,
  qaBuffer,
  qaSample,
} from "./helpers/canonical-score-fixtures.js";
import { anchoredHost, flush } from "./helpers/anchored-stream-host.js";
const until = async (predicate) => {
  const end = Date.now() + 5000;
  while (!predicate()) {
    assert(Date.now() < end, "control setup/retirement deadline");
    await new Promise((r) => setTimeout(r, 5));
  }
};
async function fixture(t) {
  const memory = new AudioMemory(),
    foreign = memory.reserve(313, "controls/foreign"),
    rows = [],
    hosts = new WeakMap(),
    project = await canonicalScoreFixture(48000, memory, qaBuffer, {
      profile: "repeat",
    }),
    byHash = new Map();
  const source = project.canonical.sourceDefs.find(
    (d) => d.kind === "instrument-events",
  ).programme;
  for (const e of source.events) {
    const version = source.banks.find((b) => b.id === e.bankId).version,
      d = project.registry.sample(e.bankId, version, e.sampleId);
    byHash.set(d.sha256, d);
  }
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
  const controller = createCanonicalStudioController({
    createOwner: async ({ generation, signal }) => {
      const h = anchoredHost(),
        row = {
          h,
          owner: null,
          calls: { pause: 0, resume: 0 },
          gates: new Map(),
          allGates: new Set(),
          generation,
        };
      hosts.set(h.context, h);
      rows.push(row);
      h.context.createBuffer = qaBuffer;
      for (const [method, nativeMethod] of [
        ["pause", "suspend"],
        ["resume", "resume"],
      ]) {
        const raw = h.context[nativeMethod].bind(h.context);
        h.context[nativeMethod] = async () => {
          row.calls[method]++;
          const gate = row.gates.get(method);
          if (gate) {
            row.gates.delete(method);
            gate.enter();
            await gate.promise;
          }
          if (h.context.state === "closed")
            throw Object.assign(Error("transition reached retired context"), {
              code: "qaTransitionClosed",
            });
          return raw();
        };
      }
      h.context.decodeAudioData = async (bytes) => {
        const hash = createHash("sha256")
            .update(new Uint8Array(bytes))
            .digest("hex"),
          d = byHash.get(hash);
        assert(d);
        const b = qaBuffer(d.channels, d.frames, d.sampleRate);
        for (let c = 0; c < d.channels; c++)
          for (let i = 0; i < d.frames; i++)
            b.getChannelData(c)[i] = qaSample(hash, i, c);
        return b;
      };
      row.owner = await createCanonicalStudioOwner({
        rate: 48000,
        memory,
        contextFactory: () => h.context,
        outputFactory: () => ({ context: h.context }),
        resolveUrl: (r) => r.path,
        fetcher: async (url) => new Response(await fs.readFile(url)),
        signal,
        streamExperiment: { backend: "anchored-r2-test", generation },
      });
      return row.owner;
    },
  });
  controller.setRepeat(true);
  function delay(row, method) {
    let enter, release, reject;
    const entered = new Promise((r) => (enter = r)),
      promise = new Promise((a, b) => {
        release = a;
        reject = b;
      });
    const gate = { enter, release, reject, promise, entered };
    row.gates.set(method, gate);
    row.allGates.add(gate);
    return gate;
  }
  async function play() {
    const index = rows.length,
      pending = controller.play(project.canonical);
    pending.catch(() => {});
    await until(() => rows[index]?.h.processor);
    const row = rows[index];
    row.h.step(0);
    await pending;
    await flush();
    row.h.step(row.owner.snapshot().loops[0].queue.originFrame);
    await flush();
    return row;
  }
  return {
    controller,
    rows,
    memory,
    delay,
    play,
    async close() {
      for (const row of rows) for (const gate of row.allGates) gate.release();
      await controller.dispose();
      assert.equal(canonicalVoiceOwners(memory).count, 0);
      assert.equal(memory.snapshot().bytes, 313);
      foreign.release();
      assert.equal(memory.snapshot().bytes, 0);
    },
  };
}

for (const method of ["pause", "resume"])
  test(`actual controller/Studio owner ${method}/${method} coalesces pending and settled repetitions`, async (t) => {
    const f = await fixture(t);
    try {
      const row = await f.play(),
        { controller } = f;
      if (method === "resume") await controller.pause();
      const before = row.calls[method],
        generation = controller.snapshot().generation,
        origin = row.owner.snapshot().loops[0].queue.originFrame,
        gate = f.delay(row, method),
        pair = Promise.allSettled([controller[method](), controller[method]()]);
      await gate.entered;
      assert.equal(row.calls[method], before + 1);
      await flush();
      gate.release();
      const results = await pair;
      assert(results.every((r) => r.status === "fulfilled"));
      await controller[method]();
      assert.equal(row.calls[method], before + 1);
      assert.equal(
        controller.snapshot().status,
        method === "pause" ? "paused" : "playing",
      );
      assert.equal(
        row.h.context.state,
        method === "pause" ? "suspended" : "running",
      );
      assert.equal(controller.snapshot().generation, generation);
      assert.equal(controller.snapshot().error, null);
      assert.equal(row.owner.snapshot().loops[0].fault, null);
      assert.equal(row.owner.snapshot().loops[0].queue.originFrame, origin);
      assert.equal(row.h.events.length, 1);
      console.log(
        "CONTROL-REVIEW-REGRESSION " +
          JSON.stringify({
            method,
            pendingAndSettled: true,
            results: results.map((r) => r.status),
            nativeTransitions: 1,
            controller: controller.snapshot().status,
            context: row.h.context.state,
            origin,
            cleanup: "asserted in finally",
          }),
      );
    } finally {
      await f.close();
    }
  });

test("ordered pending pause/resume/pause is not collapsed across opposite intentions", async (t) => {
  const f = await fixture(t);
  try {
    const row = await f.play(),
      before = { ...row.calls },
      gate = f.delay(row, "pause");
    const results = Promise.allSettled([
      f.controller.pause(),
      f.controller.resume(),
      f.controller.pause(),
    ]);
    await gate.entered;
    gate.release();
    assert((await results).every((r) => r.status === "fulfilled"));
    assert.equal(row.calls.pause - before.pause, 2);
    assert.equal(row.calls.resume - before.resume, 1);
    assert.equal(f.controller.snapshot().status, "paused");
    assert.equal(row.h.context.state, "suspended");
    assert.equal(row.h.events.length, 1);
  } finally {
    await f.close();
  }
});

for (const method of ["pause", "resume"])
  test(`duplicate pending ${method} propagates real transition failure instead of successful no-op`, async (t) => {
    const f = await fixture(t);
    try {
      const row = await f.play();
      if (method === "resume") await f.controller.pause();
      const before = row.calls[method],
        gate = f.delay(row, method);
      const pair = Promise.allSettled([
        f.controller[method](),
        f.controller[method](),
      ]);
      await gate.entered;
      const failure = Object.assign(Error("injected " + method + " failure"), {
        code: "qa" + method + "Failure",
      });
      gate.reject(failure);
      const results = await pair;
      assert(
        results.every((r) => r.status === "rejected" && r.reason === failure),
      );
      await until(() => f.controller.snapshot().pendingOwners === 0);
      assert.equal(row.calls[method], before + 1);
      assert.equal(f.controller.snapshot().status, "error");
      assert.equal(row.h.context.state, "closed");
      assert.equal(
        f.controller.snapshot().error,
        method === "pause" ? "anchoredPauseFailed" : "anchoredResumeFailed",
      );
      await assert.rejects(row.owner[method]());
      assert.equal(row.h.events.length, 1);
    } finally {
      await f.close();
    }
  });

test("unannounced suspension/fault is never adopted as an idempotent reached state", async (t) => {
  const f = await fixture(t);
  try {
    const row = await f.play(),
      before = row.calls.resume;
    const external = row.h.context.suspend(),
      attempt = row.owner.resume();
    await assert.rejects(attempt, { code: "anchoredContextInterrupted" });
    await external;
    await until(() => f.controller.snapshot().pendingOwners === 0);
    assert.equal(row.calls.resume, before);
    assert.equal(f.controller.snapshot().status, "error");
    assert.equal(row.h.context.state, "closed");
    assert.equal(f.controller.snapshot().error, "anchoredContextInterrupted");
  } finally {
    await f.close();
  }
});

for (const method of ["pause", "resume"])
  for (const change of ["Stop", "replace"])
    test(`${change} while duplicate ${method} is pending fences its late outcome`, async (t) => {
      const f = await fixture(t);
      try {
        const row = await f.play();
        if (method === "resume") await f.controller.pause();
        const gate = f.delay(row, method);
        const pair = Promise.allSettled([
          f.controller[method](),
          f.controller[method](),
        ]);
        await gate.entered;
        let stopped, next;
        if (change === "Stop") {
          stopped = f.controller.stop();
          stopped.catch(() => {});
          await until(() => row.h.context.state === "closed");
        } else next = await f.play();
        await assert.rejects(row.owner[method]());
        gate.release();
        const results = await pair;
        assert(results.every((r) => r.status === "rejected"));
        assert(
          results.every((r) => r.reason.code === "qaTransitionClosed"),
          "late native rejection stays visible to each caller",
        );
        if (stopped) await stopped;
        if (next) {
          await until(() => f.controller.snapshot().pendingOwners === 1);
          assert.equal(f.controller.snapshot().status, "playing");
          assert.equal(next.h.context.state, "running");
          assert.equal(next.owner.snapshot().loops[0].fault, null);
          assert.notEqual(next.generation, row.generation);
        } else assert.equal(f.controller.snapshot().status, "idle");
        assert.equal(row.h.context.state, "closed");
      } finally {
        await f.close();
      }
    });
