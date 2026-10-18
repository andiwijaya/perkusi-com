import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareCanonicalScore,
  retainCanonicalScore,
  canonicalVoiceAdmission,
} from "../src/audio/canonical-score.js";
import { exportCanonicalScoreWav } from "../src/audio/canonical-native.js";
import { canonicalRamp } from "../src/audio/canonical-dynamic-render.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import {
  canonicalScoreFixture,
  qaBuffer,
} from "./helpers/canonical-score-fixtures.js";
import { gamelanRepeatPlan } from "../src/project/gamelan-repeat.js";
import { parseInstrumentProject } from "../src/project/instrument-project.js";
import { FLAT_EQ } from "../src/loop-station/fx-model.js";

const fixtureCache = new Map();
const fixture = (rate, profile) => {
  const key = rate + profile;
  if (!fixtureCache.has(key))
    fixtureCache.set(
      key,
      canonicalScoreFixture(rate, new AudioMemory(), qaBuffer, { profile }),
    );
  return fixtureCache.get(key);
};
const prepare = (f, memory, options = {}) =>
  prepareCanonicalScore(f.canonical, {
    ...f,
    rate: f.descriptors.values().next().value.sampleRate,
    memory,
    createBuffer: qaBuffer,
    yieldTask: async () => {},
    ...options,
  });
const isCode = (name) => (e) => e.code === name;
for (const rate of [44100, 48000])
  for (const profile of ["mixed", "repeat"])
    test(`Q1cb ${profile} @${rate}: immutable prepared identity, full tail and owned disposal`, async () => {
      const f = await fixture(rate, profile),
        memory = new AudioMemory(),
        before = JSON.stringify(f.canonical),
        p = await prepare(f, memory);
      assert.ok(p.program.events.length <= 16);
      assert.ok(p.admission.maxOwned <= 16);
      assert.ok(p.admission.maxPeak <= 0.95);
      assert.ok(Object.isFrozen(p.program.events[0].spec));
      assert.equal(p.provenance, "synthetic-qa");
      assert.equal(p.playableVerified, false);
      const release = retainCanonicalScore(p);
      p.dispose();
      assert.equal(p.resourcesReleased, false);
      assert.throws(
        () => retainCanonicalScore(p),
        isCode("invalidCanonicalScore"),
      );
      release();
      release();
      assert.equal(p.resourcesReleased, true);
      assert.equal(memory.snapshot().bytes, 0);
      assert.equal(JSON.stringify(f.canonical), before);
      if (profile === "repeat") {
        const oracle = gamelanRepeatPlan(
          parseInstrumentProject(f.text, f.registry),
          f.registry,
          rate,
        );
        const voices = p.program.events.filter((e) =>
          e.id.startsWith("native/"),
        );
        for (let cycle = 0; cycle < 2; cycle++)
          for (const v of oracle.voices) {
            const actual = voices.find(
              (e) =>
                e.id.endsWith("/" + v.id) &&
                e.spec.startFrame ===
                  v.startFrame + cycle * oracle.periodFrames,
            ).spec;
            assert.equal(
              actual.endFrame,
              v.endFrame + cycle * oracle.periodFrames,
            );
            assert.equal(
              actual.dampFrame,
              v.dampFrame === null
                ? null
                : v.dampFrame + cycle * oracle.periodFrames,
            );
          }
        assert.ok(p.program.naturalEnd > p.program.bodyFrames);
      } else {
        assert.equal(p.program.tailFrames, Math.ceil(0.1 * rate));
        assert.ok(p.program.naturalEnd > p.program.bodyFrames);
      }
    });

for (const [rate, held, next] of [
  [
    44100,
    [0.310762494802475, 0.792302131652832, 0.970777094364166],
    [0.3095710873603821, 0.7900844812393188, 0.9703770279884338],
  ],
  [
    48000,
    [0.302582532167435, 0.78548538684845, 0.980320513248444],
    [0.3015301525592804, 0.7834828495979309, 0.9799032807350159],
  ],
])
  test(`Q1cb4ms @${rate}: independently captured native interruption anchors`, () => {
    // Actual native Float32 values from the separate constant-source AudioParam
    // probe. No loop reproducing the implementation manufactures this oracle.
    const r = canonicalRamp(
      [
        { frame: 0, values: [0.2, 0.7, 1.1] },
        { frame: 100, values: [0.8, 1.2, 0.4] },
        { frame: 137, values: [0.1, 0.4, 0.9] },
      ],
      rate,
    );
    for (const [frame, expected] of [
      [136, held],
      [137, held],
      [138, next],
    ])
      expected.forEach((v, c) =>
        assert.ok(Math.abs(r.at(frame)[c] - v) < 0.0000005),
      );
    assert.deepEqual(r.at(136), r.at(137));
  });
const mix = {
  master: { volume: 1 },
  tracks: [{ id: "t", gain: 1, pan: 0, mute: false, solo: false, eq: FLAT_EQ }],
};
const event = (peak = 0) => ({
  trackId: "t",
  spec: {
    buffer: { numberOfChannels: 2 },
    startFrame: 100,
    endFrame: 200,
    peak,
    velocity: 1,
    scale: 4,
    pan: 0,
  },
});
for (const count of [15, 16, 17])
  test(`Q1cb admission${count}: count pending/playing/release owners before nodes`, () => {
    const events = Array.from({ length: count }, () => event(0.001));
    if (count > 16)
      assert.throws(
        () => canonicalVoiceAdmission(events, mix, 48000),
        isCode("voiceLimit"),
      );
    else
      assert.equal(canonicalVoiceAdmission(events, mix, 48000).maxOwned, count);
  });
for (const peak of [0.95 - 1e-8, 0.95, 0.95 + 1e-8])
  test(`Q1cb unchanged0.95 boundary ${peak}`, () => {
    if (peak > 0.95)
      assert.throws(
        () => canonicalVoiceAdmission([event(peak)], mix, 48000),
        isCode("voiceHeadroom"),
      );
    else
      assert.equal(
        canonicalVoiceAdmission([event(peak)], mix, 48000).maxPeak,
        peak,
      );
  });
test("Q1cb foreign pending/release owners participate in admission", () => {
  const foreign = Array.from({ length: 16 }, () => ({
    startFrame: -100,
    endFrame: 1000,
    peak: 0,
  }));
  assert.throws(
    () => canonicalVoiceAdmission([event()], mix, 48000, foreign),
    isCode("voiceLimit"),
  );
});
test("Q1cb17 voices structurally refuse before provider load/AudioBuffer allocation", async () => {
  const f = await fixture(48000, "single"),
    c = structuredClone(f.canonical),
    d = c.sourceDefs.find((d) => d.kind === "instrument-events");
  d.programme.events = Array.from({ length: 17 }, (_, i) => ({
    ...d.programme.events[0],
    id: "dense-" + i,
    tick: 137 + i,
  }));
  const memory = new AudioMemory(),
    loads = f.stats.loads;
  await assert.rejects(
    prepareCanonicalScore(c, {
      ...f,
      rate: 48000,
      memory,
      createBuffer: qaBuffer,
    }),
    isCode("voiceLimit"),
  );
  assert.equal(f.stats.loads, loads);
  assert.equal(memory.snapshot().bytes, 0);
});
test("Q1cb one shared64MiB pool preserves a61MiB foreign pin and refuses before load", async () => {
  const f = await fixture(48000, "single"),
    memory = new AudioMemory(),
    foreign = memory.reserve(61 * 1024 * 1024, "foreign-live");
  const loads = f.stats.loads;
  await assert.rejects(prepare(f, memory), isCode("combinedMemoryLimit"));
  assert.equal(f.stats.loads, loads);
  assert.equal(memory.snapshot().bytes, 61 * 1024 * 1024);
  foreign.release();
  assert.equal(memory.snapshot().bytes, 0);
});
test("Q1cb malformed geometry refuses before load; finite/identity failures clean owned loans", async () => {
  const f = await fixture(48000, "single"),
    memory = new AudioMemory();
  await assert.rejects(
    prepare(f, memory, {
      provider: {
        ...f.provider,
        describe: (r) => ({ ...f.provider.describe(r), frames: 1 }),
      },
    }),
    isCode("instrumentBufferMismatch"),
  );
  for (const fault of ["finite", "identity"]) {
    const provider = {
      ...f.provider,
      describe: (r) => ({
        ...f.provider.describe(r),
        ...(fault === "identity" ? { contentHash: "0".repeat(64) } : {}),
      }),
      async load(r, o) {
        const loan = await f.provider.load(r, o);
        if (fault === "finite") loan.buffer.getChannelData(0)[0] = NaN;
        return loan;
      },
    };
    await assert.rejects(
      prepare(f, memory, { provider }),
      isCode(
        fault === "finite"
          ? "invalidCanonicalSample"
          : "recordingIdentityMismatch",
      ),
    );
    assert.equal(memory.snapshot().bytes, 0);
  }
});
test("Q1cb cancellation awaits an in-flight owned load before releasing; foreign owner stays pinned", async () => {
  const f = await fixture(48000, "single"),
    memory = new AudioMemory(),
    foreign = memory.reserve(313, "foreign"),
    abort = new AbortController();
  let enter, complete;
  const entered = new Promise((r) => (enter = r)),
    finished = new Promise((r) => (complete = r));
  const provider = {
    ...f.provider,
    async load(r, o) {
      const loan = await f.provider.load(r, o);
      enter();
      await finished;
      return loan;
    },
  };
  const pending = prepare(f, memory, { provider, signal: abort.signal });
  await entered;
  abort.abort();
  assert.ok(memory.snapshot().bytes > 313);
  complete();
  await assert.rejects(pending, isCode("cancelled"));
  assert.equal(memory.snapshot().bytes, 313);
  foreign.release();
  assert.equal(memory.snapshot().bytes, 0);
});
test("Q1cb concurrent preparation/disposal preserves the other plan and caller snapshot", async () => {
  const f = await fixture(48000, "single"),
    memory = new AudioMemory(),
    c = structuredClone(f.canonical);
  const first = prepareCanonicalScore(c, {
    ...f,
    rate: 48000,
    memory,
    createBuffer: qaBuffer,
  });
  c.master.volume = 0.3;
  const second = prepareCanonicalScore(c, {
    ...f,
    rate: 48000,
    memory,
    createBuffer: qaBuffer,
  });
  c.master.volume = 2;
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.timeline.project.master.volume, 0.17);
  assert.equal(b.timeline.project.master.volume, 0.3);
  assert.throws(
    () => retainCanonicalScore({ ...a }),
    isCode("invalidCanonicalScore"),
  );
  a.dispose();
  assert.equal(b.resourcesReleased, false);
  const release = retainCanonicalScore(b);
  b.dispose();
  assert.ok(memory.snapshot().bytes > 0);
  release();
  assert.equal(memory.snapshot().bytes, 0);
});
test("Q1cb encoded WAV preserves rate/channels/full tail/length and deterministic concurrent output", async () => {
  const f = await fixture(48000, "single"),
    memory = new AudioMemory(),
    p = await prepare(f, memory);
  const frames = p.program.frames,
    context = { createBuffer: qaBuffer };
  const a = exportCanonicalScoreWav(p, { memory, context }),
    b = exportCanonicalScoreWav(p, { memory, context });
  p.dispose();
  assert.equal(p.resourcesReleased, false);
  const [x, y] = await Promise.all([a, b]);
  const bx = await x.output.blob.arrayBuffer(),
    by = await y.output.blob.arrayBuffer(),
    view = new DataView(bx);
  assert.deepEqual(new Uint8Array(bx), new Uint8Array(by));
  assert.equal(view.getUint32(4, true) + 8, bx.byteLength);
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(46, true), frames);
  assert.equal(view.getUint32(54, true), frames * 8);
  assert.ok(frames > 120000);
  assert.ok(x.calibration.gain >= 1);
  const commentAt = 58 + frames * 8,
    commentBytes = view.getUint32(commentAt + 16, true),
    metadata = JSON.parse(
      new TextDecoder().decode(
        new Uint8Array(bx, commentAt + 20, commentBytes - 1),
      ),
    );
  assert.equal(metadata.format, "perkusi-canonical-score");
  assert.equal(metadata.title, f.canonical.title);
  assert.equal(metadata.provenance, "synthetic-qa");
  assert.deepEqual(metadata.sources, p.sourceCredits);
  assert.ok(metadata.sources.length > 0);
  assert.ok(metadata.sources.every((s) => s.receipt === null));
  assert.ok(Object.isFrozen(p.sourceCredits));
  assert.ok(
    p.sourceCredits.every(
      (s) => Object.isFrozen(s) && Object.isFrozen(s.descriptor),
    ),
  );
  assert.equal(p.resourcesReleased, true);
  x.output.release();
  y.output.release();
  assert.equal(memory.snapshot().bytes, 0);
});
test("Q1cb failed/cancelled export preserves a caller-owned prepared score", async () => {
  const f = await fixture(48000, "single"),
    memory = new AudioMemory(),
    p = await prepare(f, memory),
    bytes = memory.snapshot().bytes,
    abort = new AbortController();
  await assert.rejects(
    exportCanonicalScoreWav(p, {
      memory,
      context: { createBuffer: qaBuffer },
      signal: abort.signal,
      onProgress: () => abort.abort(),
    }),
    isCode("cancelled"),
  );
  assert.equal(memory.snapshot().bytes, bytes);
  assert.equal(p.resourcesReleased, false);
  p.dispose();
  assert.equal(memory.snapshot().bytes, 0);
});

test("Q1cb0/custom/max root master applies once, with no implicit0.5 replacement", async () => {
  const f = await fixture(48000, "single"),
    memory = new AudioMemory();
  for (const volume of [0, 0.17, 0.75]) {
    const c = structuredClone(f.canonical);
    c.master.volume = volume;
    const p = await prepareCanonicalScore(c, {
      ...f,
      rate: 48000,
      memory,
      createBuffer: qaBuffer,
    });
    assert.equal(p.project.master.volume, 1);
    assert.equal(p.program.events[0].spec.scale, volume * 0.4 * 4);
    p.dispose();
    assert.equal(memory.snapshot().bytes, 0);
  }
});

test("Q1cb pitched mixture requires retained source/root consent before sample load", async () => {
  const f = await fixture(48000, "mixed"),
    c = structuredClone(f.canonical),
    memory = new AudioMemory();
  const placed = c.sections[0].placements.find(
    (p) => p.sourceRef.kind === "working",
  );
  c.sourceDefs.find(
    (d) => d.id === placed.sourceRef.id,
  ).programme.tuningConsent = false;
  const before = f.stats.loads;
  await assert.rejects(
    prepareCanonicalScore(c, {
      ...f,
      rate: 48000,
      memory,
      createBuffer: qaBuffer,
    }),
    isCode("tuningConsentRequired"),
  );
  assert.equal(f.stats.loads, before);
  assert.equal(memory.snapshot().bytes, 0);
});
