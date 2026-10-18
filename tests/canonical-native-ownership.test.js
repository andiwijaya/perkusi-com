import test from "node:test";
import assert from "node:assert/strict";
import { canonicalNativeVoice } from "../src/audio/canonical-native-voice.js";
import { createCanonicalNativeSession } from "../src/audio/canonical-native.js";
import {
  reserveCanonicalVoiceOwners,
  canonicalVoiceOwners,
  canonicalAllocationScope,
} from "../src/audio/canonical-voice-budget.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import {
  qaBuffer,
  canonicalScoreFixture,
} from "./helpers/canonical-score-fixtures.js";
import { prepareCanonicalScore } from "../src/audio/canonical-score.js";
import { FLAT_EQ } from "../src/loop-station/fx-model.js";

test("aborted native construction whose actual close fails exposes a retryable cleanup capability", async () => {
  const memory = new AudioMemory(),
    foreign = memory.reserve(313, "foreign"),
    abort = new AbortController();
  let closes = 0,
    error;
  const context = {
    sampleRate: 48000,
    state: "running",
    async close() {
      closes++;
      if (closes === 1) throw Error("close failed");
      this.state = "closed";
    },
  };
  try {
    await createCanonicalNativeSession({
      rate: 48000,
      memory,
      signal: abort.signal,
      contextFactory: () => context,
      printFactory: () => {},
      outputFactory() {
        abort.abort();
        return { context };
      },
    });
  } catch (e) {
    error = e;
  }
  assert.equal(error.code, "cancelled");
  assert.equal(typeof error.cleanup, "function");
  assert.equal(memory.snapshot().bytes, 524601);
  await error.cleanup();
  assert.equal(closes, 2);
  assert.equal(memory.snapshot().bytes, 313);
  foreign.release();
});

test("native job completion settles a source-cleanup fault and drains independent graph/context owners", async () => {
  const memory = new AudioMemory(),
    foreign = memory.reserve(313, "foreign"),
    f = await canonicalScoreFixture(48000, memory, qaBuffer, {
      profile: "single",
    }),
    context = fake().context;
  const document = structuredClone(f.canonical);
  document.master.limiter.bypass = true;
  for (const t of document.tracks) t.fx.eq = { ...FLAT_EQ };
  const provider = {
    ...f.provider,
    async load(...a) {
      const loan = await f.provider.load(...a);
      return {
        ...loan,
        release() {
          loan.release();
          throw Error("source cleanup fault");
        },
      };
    },
  };
  const score = await prepareCanonicalScore(document, {
    ...f,
    rate: 48000,
    memory,
    provider,
    createBuffer: qaBuffer,
    yieldTask: async () => {},
  });
  context.close = async () => {
    context.state = "closed";
  };
  const session = await createCanonicalNativeSession({
      rate: 48000,
      memory,
      contextFactory: () => context,
      outputFactory: () => ({ context }),
      printFactory: () => {},
    }),
    job = session.start(score),
    settled = assert.rejects(job.done, /source cleanup fault/);
  score.dispose();
  await session.dispose();
  await settled;
  assert.equal(session.snapshot.jobs, 0);
  assert.equal(score.resourcesReleased, false);
  assert.equal(memory.snapshot().bytes, 313);
  foreign.release();
});

test("native session failed close retains its actual context allowance and explicit retry drains it", async () => {
  const memory = new AudioMemory(),
    foreign = memory.reserve(313, "foreign");
  let closes = 0;
  const context = {
    sampleRate: 48000,
    state: "suspended",
    async close() {
      closes++;
      if (closes === 1) throw Error("close failed");
      this.state = "closed";
    },
  };
  const session = await createCanonicalNativeSession({
    rate: 48000,
    memory,
    contextFactory: () => context,
    printFactory: () => {},
    outputFactory: () => ({ context }),
  });
  await assert.rejects(session.dispose(), /close failed/);
  assert.equal(memory.snapshot().bytes, 524601);
  await session.dispose();
  assert.equal(closes, 2);
  assert.equal(memory.snapshot().bytes, 313);
  foreign.release();
});

function fake(fault = null) {
  const calls = [],
    sources = [];
  let stopFault = fault === "stop";
  const param = () => ({
    value: 1,
    setValueAtTime(...a) {
      calls.push(["set", ...a]);
    },
    linearRampToValueAtTime(...a) {
      calls.push(["ramp", ...a]);
    },
    cancelScheduledValues() {},
  });
  const node = () => ({
    connect() {},
    disconnect() {
      calls.push(["disconnect"]);
    },
  });
  const context = {
    sampleRate: 48000,
    currentTime: 0,
    state: "running",
    createGain() {
      return { ...node(), gain: param() };
    },
    createStereoPanner() {
      return { ...node(), pan: param() };
    },
    createBufferSource() {
      let started = false;
      const s = {
        ...node(),
        playbackRate: param(),
        start(...a) {
          calls.push(["start", ...a]);
          if (fault === "start") throw Error("start fault");
          started = true;
        },
        stop(at) {
          calls.push(["stop", at]);
          if (!started) throw Error("stop before start");
          if (stopFault) {
            stopFault = false;
            throw Error("post-start stop fault");
          }
        },
      };
      sources.push(s);
      return s;
    },
  };
  return { context, calls, sources };
}
const spec = {
  buffer: qaBuffer(2, 2000, 48000),
  frames: 2000,
  startFrame: 100,
  endFrame: 1200,
  naturalEndFrame: 2100,
  dampFrame: 240,
  velocity: 0.6,
  scale: 0.17,
  pan: -0.2,
};
test("Q1cb stable native voice starts before stop and retains its node lease through actual ended", () => {
  const f = fake(),
    memory = new AudioMemory(),
    foreign = memory.reserve(313, "foreign");
  let ended = 0;
  const v = canonicalNativeVoice(
    f.context,
    {},
    spec,
    0.1,
    100,
    memory,
    () => ended++,
  );
  assert.ok(
    f.calls.findIndex((c) => c[0] === "start") <
      f.calls.findIndex((c) => c[0] === "stop"),
  );
  assert.throws(
    () => v.dispose(),
    (e) => e.code === "canonicalVoiceStillOwned",
  );
  assert.equal(memory.snapshot().bytes, 8505);
  f.sources[0].onended();
  assert.equal(ended, 1);
  assert.equal(memory.snapshot().bytes, 8505, "ended graph node remains owned");
  v.dispose();
  v.dispose();
  assert.equal(memory.snapshot().bytes, 313);
  foreign.release();
  assert.equal(memory.snapshot().bytes, 0);
});
test("Q1cb native start fault cleans immediately; post-start fault remains owned until actual ended", () => {
  for (const fault of ["start", "stop"]) {
    const f = fake(fault),
      memory = new AudioMemory();
    if (fault === "start") {
      assert.throws(
        () =>
          canonicalNativeVoice(f.context, {}, spec, 0.1, 100, memory, () => {}),
        /start fault/,
      );
      assert.equal(memory.snapshot().bytes, 0);
    } else {
      const v = canonicalNativeVoice(
        f.context,
        {},
        spec,
        0.1,
        100,
        memory,
        () => {},
      );
      assert.match(v.fault.message, /post-start/);
      assert.throws(
        () => v.dispose(),
        (e) => e.code === "canonicalVoiceStillOwned",
      );
      assert.equal(memory.snapshot().bytes, 8192);
      f.sources[0].onended();
      v.dispose();
      assert.equal(memory.snapshot().bytes, 0);
    }
  }
});
test("Q1cb aborted native construction waits for actual context close; pre-abort constructs nothing", async () => {
  const memory = new AudioMemory(),
    foreign = memory.reserve(313, "foreign"),
    abort = new AbortController();
  let entered,
    continueOutput,
    closeEntered,
    closeAck,
    constructs = 0;
  const enteredPromise = new Promise((r) => (entered = r)),
    outputReady = new Promise((r) => (continueOutput = r)),
    closePromise = new Promise((r) => (closeEntered = r)),
    closed = new Promise((r) => (closeAck = r));
  const context = {
    sampleRate: 48000,
    state: "suspended",
    async close() {
      closeEntered();
      await closed;
      context.state = "closed";
    },
  };
  const pending = createCanonicalNativeSession({
    rate: 48000,
    memory,
    signal: abort.signal,
    contextFactory() {
      constructs++;
      return context;
    },
    async outputFactory() {
      entered();
      await outputReady;
      return { context };
    },
  });
  await enteredPromise;
  abort.abort();
  continueOutput();
  await closePromise;
  assert.equal(memory.snapshot().bytes, 524601);
  closeAck();
  await assert.rejects(pending, (e) => e.code === "cancelled");
  assert.equal(memory.snapshot().bytes, 313);
  await assert.rejects(
    createCanonicalNativeSession({
      rate: 48000,
      memory,
      signal: abort.signal,
      contextFactory() {
        constructs++;
      },
      outputFactory() {},
    }),
    (e) => e.code === "cancelled",
  );
  assert.equal(constructs, 1);
  foreign.release();
  assert.equal(memory.snapshot().bytes, 0);
});
test("Q1cb shared native tickets/scopes refuse before allocations and preserve foreign IDs", () => {
  const memory = new AudioMemory(),
    foreign = reserveCanonicalVoiceOwners(memory, {
      count: 15,
      peak: 0.1,
      label: "foreign-live-context",
    });
  const own = reserveCanonicalVoiceOwners(memory, {
      count: 1,
      peak: 0.2,
      label: "new-context",
    }),
    before = canonicalVoiceOwners(memory);
  assert.equal(before.count, 16);
  assert.throws(
    () =>
      reserveCanonicalVoiceOwners(memory, {
        count: 1,
        peak: 0,
        label: "seventeenth",
      }),
    (e) => e.code === "voiceLimit",
  );
  assert.deepEqual(canonicalVoiceOwners(memory), before);
  own.release();
  assert.equal(canonicalVoiceOwners(memory).owners[0].id, foreign.id);
  const scope = canonicalAllocationScope(memory, 16384, "two-node-allowance"),
    a = scope.memory.reserve(8192, "a"),
    b = scope.memory.reserve(8192, "b");
  assert.throws(
    () => scope.memory.reserve(1, "overflow"),
    (e) => e.code === "combinedMemoryLimit",
  );
  assert.throws(
    () => scope.release(),
    (e) => e.code === "canonicalAllocationStillOwned",
  );
  a.release();
  b.release();
  scope.release();
  foreign.release();
  assert.equal(canonicalVoiceOwners(memory).count, 0);
  assert.equal(memory.snapshot().bytes, 0);
});
