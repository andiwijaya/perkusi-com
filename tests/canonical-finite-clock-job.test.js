import test from "node:test";
import assert from "node:assert/strict";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { prepareCanonicalScore } from "../src/audio/canonical-score.js";
import { createCanonicalNativeSession } from "../src/audio/canonical-native.js";
import { canonicalVoiceOwners } from "../src/audio/canonical-voice-budget.js";
import { reviewSequence } from "./helpers/canonical-finish-fixtures.js";
import { qaBuffer } from "./helpers/canonical-score-fixtures.js";

for (const mode of ["host-fault", "ended-fault", "stop-first"])
  test(`finite programme ${mode} preserves first error and waits for exclusive context close`, async (t) => {
    const memory = new AudioMemory(),
      foreign = memory.reserve(313, "foreign"),
      f = await reviewSequence(44100, memory);
    const score = await prepareCanonicalScore(f.canonical, {
      ...f,
      rate: 44100,
      memory,
      createBuffer: qaBuffer,
      yieldTask: async () => {},
    });
    let closeNow, notify, ended, voice;
    const closed = new Promise((r) => (closeNow = r));
    const ctx = {
      sampleRate: 44100,
      currentTime: 0,
      state: "running",
      async close() {
        await closed;
        this.state = "closed";
      },
      async suspend() {
        this.state = "suspended";
      },
      async resume() {
        this.state = "running";
      },
    };
    const node = () => ({ context: ctx, connect() {}, disconnect() {} }),
      param = () => ({
        value: 1,
        setValueAtTime() {},
        linearRampToValueAtTime() {},
        cancelScheduledValues() {},
      });
    ctx.createGain = () => ({ ...node(), gain: param() });
    ctx.createStereoPanner = () => ({ ...node(), pan: param() });
    let stops = 0;
    const session = await createCanonicalNativeSession({
      rate: 44100,
      memory,
      contextFactory: () => ctx,
      outputFactory: node,
      printFactory(_d, spec, _w, _f, budget, onEnded, onFault) {
        const held = budget.reserve(
          8192 + spec.frames * 8,
          "test/print-transfer",
        );
        notify = onFault;
        ended = onEnded;
        return (voice = {
          end: score.program.frames / 44100,
          fault: null,
          stop() {
            stops++;
          },
          dispose() {
            assert.equal(ctx.state, "closed");
            held.release();
          },
        });
      },
    });
    const job = session.start(score);
    let final = false,
      reported = null;
    const outcome = job.done.then(
      (value) => {
        final = true;
        return value;
      },
      (error) => {
        final = true;
        return error;
      },
    );
    t.after(async () => {
      closeNow();
      score.dispose();
      await session.dispose();
      await outcome;
      foreign.release();
      assert.equal(memory.snapshot().bytes, 0);
    });
    assert.ok(job.faulted instanceof Promise);
    job.faulted.then((e) => (reported = e));
    const error = Error("QAFiniteProgrammeClockFailure");
    if (mode === "stop-first") job.stop();
    if (mode === "ended-fault") {
      voice.fault = error;
      ended();
    } else notify(error);
    await Promise.resolve();
    assert.equal(reported, mode === "stop-first" ? null : error);
    assert.equal(stops, 1);
    assert.equal(final, false);
    score.dispose();
    assert.equal(score.resourcesReleased, false);
    const held = memory.snapshot().bytes,
      closing = session.dispose();
    await Promise.resolve();
    assert.equal(ctx.state, "running");
    assert.equal(final, false);
    assert.equal(memory.snapshot().bytes, held);
    closeNow();
    await closing;
    const result = await outcome;
    if (mode === "stop-first") assert.equal(result.stopped, true);
    else assert.equal(result, error);
    assert.equal(score.resourcesReleased, true);
    assert.equal(canonicalVoiceOwners(memory).count, 0);
    assert.equal(memory.snapshot().bytes, 313);
    notify(Error("lateFault"));
    await Promise.resolve();
    assert.equal(reported, mode === "stop-first" ? null : error);
  });
