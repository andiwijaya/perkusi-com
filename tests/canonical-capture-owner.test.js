import test from "node:test";
import assert from "node:assert/strict";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { createFreshCanonicalProject } from "../src/studio/canonical-fresh-project.js";
import { createCanonicalCaptureOwner } from "../src/studio/canonical-capture-owner.js";
import { canonicalFixtureRegistry as registry } from "./helpers/canonical-fixtures.js";

test("failed native context close retains capture ownership until a successful cleanup acknowledgement", async () => {
  const memory = new AudioMemory(),
    bundle = await createFreshCanonicalProject({ registry, memory });
  let failClose = true,
    calls = 0;
  const context = {
    sampleRate: 44100,
    state: "running",
    async close() {
      calls++;
      if (failClose) throw Error("isolated close refusal");
      this.state = "closed";
    },
  };
  const error = await createCanonicalCaptureOwner({
    bundle,
    registry,
    memory,
    contextFactory: () => context,
  }).catch((e) => e);
  assert.equal(error.code, "takeRateMismatch");
  assert.equal(typeof error.cleanup, "function");
  assert.equal(context.state, "running");
  assert.equal(calls, 1);
  bundle.dispose();
  assert(memory.snapshot().bytes >= 524288);
  failClose = false;
  await error.cleanup();
  assert.equal(context.state, "closed");
  assert.equal(memory.snapshot().bytes, 0);
  await error.cleanup();
  assert.equal(calls, 2);
});

test("cancelled capture construction never creates an audio context or leaks a retained document", async () => {
  const memory = new AudioMemory(),
    bundle = await createFreshCanonicalProject({ registry, memory }),
    abort = new AbortController();
  abort.abort();
  await assert.rejects(
    createCanonicalCaptureOwner({
      bundle,
      registry,
      memory,
      signal: abort.signal,
      contextFactory: () => {
        throw Error("must not construct context");
      },
    }),
    (e) => e.code === "cancelled",
  );
  bundle.dispose();
  assert.equal(memory.snapshot().bytes, 0);
});
