import test from "node:test";
import assert from "node:assert/strict";
import { AudioMemory } from "../src/audio/audio-memory.js";
import {
  prepareCanonicalScore,
  prepareCanonicalPlayback,
  canonicalPlaybackView,
  canonicalScoreFrame,
  retainCanonicalScore,
} from "../src/audio/canonical-score.js";
import { canonicalPrintData } from "../src/audio/canonical-playback.js";
import {
  canonicalVoiceOwners,
  reserveCanonicalVoiceOwners,
} from "../src/audio/canonical-voice-budget.js";
import { renderPortableMix } from "../src/loop-station/portable-mix.js";
import {
  canonicalScoreFixture,
  qaBuffer,
} from "./helpers/canonical-score-fixtures.js";
import { reviewSequence } from "./helpers/canonical-finish-fixtures.js";
import { createCanonicalNativeSession } from "../src/audio/canonical-native.js";
import { scheduleCanonicalTargets } from "../src/audio/canonical-native-ramp.js";

for (const rate of [44100, 48000]) {
  for (const profile of ["single", "mixed"])
    test(`Q1cb finish exact ${profile} sequential readers @${rate}`, async () => {
      const memory = new AudioMemory(),
        f = await reviewSequence(rate, memory, qaBuffer, profile);
      const p = await prepareCanonicalScore(f.canonical, {
        ...f,
        rate,
        memory,
        createBuffer: qaBuffer,
        yieldTask: async () => {},
      });
      try {
        assert.equal(p.program.events.length, profile === "single" ? 17 : 20);
        assert.equal(p.admission.maxOwned, profile === "single" ? 1 : 6);
        const view = canonicalPlaybackView(p);
        assert.equal(view.program.events.length, 1);
        assert.equal(view.backend, "immutable-programme-print");
        const data = canonicalPrintData(view.program.events[0].spec.print);
        assert.equal(data.channels[0].length, p.program.frames);
        assert.ok(memory.snapshot().highWaterBytes <= 67108864);
        assert.equal(canonicalScoreFrame(p, p.program.frames).stage, "ended");
      } finally {
        p.dispose();
      }
      assert.equal(memory.snapshot().bytes, 0);
    });
  test(`Q1cb finish full EQ history print and seek boundaries @${rate}`, async () => {
    const memory = new AudioMemory(),
      f = await canonicalScoreFixture(rate, memory, qaBuffer, {
        profile: "single",
      });
    Object.assign(f.canonical.tracks[0].fx.eq, {
      bypass: false,
      lowDb: -3,
      midDb: 2,
      highDb: 1,
    });
    const p = await prepareCanonicalScore(f.canonical, {
      ...f,
      rate,
      memory,
      createBuffer: qaBuffer,
      yieldTask: async () => {},
    });
    try {
      assert.throws(
        () => canonicalPlaybackView(p, 1),
        (e) => e.code === "canonicalPlaybackNotPrepared",
      );
      await prepareCanonicalPlayback(p, { memory });
      const data = canonicalPrintData(
        canonicalPlaybackView(p, 1).program.events[0].spec.print,
      );
      let at = 0,
        peak = 0;
      await renderPortableMix(
        { createBuffer: qaBuffer },
        p.project,
        p.program,
        {
          analysisOnly: true,
          boundedSourceViews: true,
          yieldTask: async () => {},
          onChunk(cs) {
            for (let c = 0; c < 2; c++)
              assert.deepEqual(
                cs[c],
                data.channels[c].subarray(at, at + cs[c].length),
              );
            at += cs[0].length;
            for (const x of cs[0]) peak = Math.max(peak, Math.abs(x));
          },
        },
      );
      assert.equal(at, p.program.frames);
      assert.ok(peak > 0);
      for (const frame of [rate * 2.5 - 1, rate * 2.5, rate * 2.5 + 1].map(
        Math.round,
      ))
        assert.equal(canonicalScoreFrame(p, frame).frame, frame);
    } finally {
      p.dispose();
    }
    assert.equal(memory.snapshot().bytes, 0);
  });
}
test("Q1cb finish print cancellation releases only owned allocations", async () => {
  const memory = new AudioMemory(),
    foreign = memory.reserve(313, "foreign"),
    f = await canonicalScoreFixture(44100, memory, qaBuffer, {
      profile: "single",
    });
  const p = await prepareCanonicalScore(f.canonical, {
    ...f,
    rate: 44100,
    memory,
    createBuffer: qaBuffer,
    yieldTask: async () => {},
  });
  await assert.rejects(
    prepareCanonicalPlayback(p, {
      memory,
      yieldTask: async () => {
        p.dispose();
      },
    }),
    (e) => e.code === "cancelled",
  );
  assert.equal(memory.snapshot().bytes, 313);
  foreign.release();
});
test("Q1cb finish shared memory identity cannot be substituted", async () => {
  const memory = new AudioMemory(),
    f = await canonicalScoreFixture(44100, memory, qaBuffer, {
      profile: "single",
    });
  const p = await prepareCanonicalScore(f.canonical, {
    ...f,
    rate: 44100,
    memory,
    createBuffer: qaBuffer,
    yieldTask: async () => {},
  });
  assert.throws(
    () => retainCanonicalScore(p, new AudioMemory()),
    (e) => e.code === "canonicalMemoryMismatch",
  );
  p.dispose();
  assert.equal(memory.snapshot().bytes, 0);
});
test("Q1cb finish reentrant memory trimming cannot admit a seventeenth owner", () => {
  const memory = new AudioMemory({ maxBytes: 270000 }),
    foreign = memory.reserve(240000, "foreign");
  let nested;
  memory.registerTrimmer("nested", () => {
    foreign.release();
    nested ??= reserveCanonicalVoiceOwners(memory, {
      count: 1,
      peak: 0,
      label: "nested",
    });
  });
  assert.throws(
    () =>
      reserveCanonicalVoiceOwners(memory, {
        count: 16,
        peak: 0,
        label: "outer",
      }),
    (e) => e.code === "voiceLimit",
  );
  assert.equal(canonicalVoiceOwners(memory).owners[0].id, nested.id);
  nested.release();
  assert.equal(memory.snapshot().bytes, 0);
});
test("Q1cb finish native programme reader owns its print until actual close", async () => {
  const memory = new AudioMemory(),
    foreign = memory.reserve(313, "foreign"),
    f = await reviewSequence(44100, memory);
  const p = await prepareCanonicalScore(f.canonical, {
    ...f,
    rate: 44100,
    memory,
    createBuffer: qaBuffer,
    yieldTask: async () => {},
  });
  const ctx = {
    sampleRate: 44100,
    currentTime: 0,
    state: "running",
    async close() {
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
  let readers = 0;
  const session = await createCanonicalNativeSession({
    rate: 44100,
    memory,
    contextFactory: () => ctx,
    outputFactory: node,
    printFactory(_destination, spec, _when, _from, budget) {
      readers++;
      const held = budget.reserve(8192 + spec.frames * 16, "test/print-clones");
      return {
        end: p.program.frames / 44100,
        stop() {},
        dispose() {
          assert.equal(ctx.state, "closed");
          held.release();
        },
      };
    },
  });
  const job = session.start(p);
  assert.equal(readers, 1);
  assert.equal(canonicalVoiceOwners(memory).count, 1);
  assert.equal(job.programmeBackend, "immutable-programme-print");
  const frame = job.position;
  await session.pause();
  assert.deepEqual(job.position, frame);
  await session.resume();
  p.dispose();
  assert.equal(p.resourcesReleased, false);
  await session.dispose();
  await job.done;
  assert.equal(p.resourcesReleased, true);
  assert.equal(canonicalVoiceOwners(memory).count, 0);
  assert.equal(memory.snapshot().bytes, 313);
  foreign.release();
});
test("Q1cb finish owned target helper validates before native effects and anchors interruptions", () => {
  const calls = [],
    param = {
      setValueAtTime(...a) {
        calls.push(["set", ...a]);
      },
      setTargetAtTime(...a) {
        calls.push(["target", ...a]);
      },
    };
  const bad = {
    get frame() {
      throw Error("getter executed");
    },
    values: [1],
  };
  assert.throws(() => scheduleCanonicalTargets([param], [bad], 48000));
  assert.equal(calls.length, 0);
  scheduleCanonicalTargets(
    [param],
    [
      { frame: 0, values: [0.2] },
      { frame: 100, values: [0.8] },
      { frame: 137, values: [0.1] },
    ],
    48000,
  );
  assert.ok(calls.length >= 5);
  assert.equal(calls.at(-2)[0], "set");
  assert.equal(calls.at(-1)[0], "target");
});
