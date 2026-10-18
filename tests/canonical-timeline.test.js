import test from "node:test";
import assert from "node:assert/strict";
import {
  compileCanonicalTimeline,
  canonicalTimelineAt,
} from "../src/project/canonical-timeline.js";
import { renderCanonicalComposition } from "../src/audio/canonical-composition-render.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { parseProject } from "../src/project/schema.js";
import { compositionRegistry } from "../src/project/studio-registry.js";
import { fromStudio, fromBeatbox } from "../src/project/composition-model.js";
import { migrateLegacyMetadata } from "../src/project/canonical-metadata.js";
import {
  parseInstrumentProject,
  orderedEvents,
  eventFrame,
  PPQ,
} from "../src/project/instrument-project.js";
import { takePlan } from "../src/project/instrument-take.js";
import { arrangementEvents } from "../src/audio/sequencing.js";
import { canonicalLegacyRender } from "../src/audio/canonical-legacy.js";
import {
  timelineFixture,
  timelineSamples,
  pcmHash,
} from "./helpers/canonical-timeline-fixtures.js";

const once = { kind: "once", bars: null, cycles: 1 };
const window4 = { kind: "window", bars: 4, cycles: 1 };
const repeat = (cycles) => ({ kind: "repeat", bars: null, cycles });
const code = (name) => (e) => e.code === name;
const emptyBytes = (memory) => assert.equal(memory.snapshot().bytes, 0);
function normalized(text) {
  const old = parseProject(text, compositionRegistry);
  return old.schemaVersion === 3
    ? old
    : old.schemaVersion === 2
      ? fromStudio(old)
      : fromBeatbox(old);
}
const bare = (e) => ({
  role: e.role,
  velocity: e.velocity,
  patternId: e.patternId,
  step: e.step,
  frame: e.startFrame,
});
for (const rate of [44100, 48000]) {
  for (const id of [
    "schema0-beatbox",
    "schema1-zero-master",
    "schema2-rhythm-ab",
    "schema3-fifteen-lanes",
  ]) {
    test(`Q1c ${id} @${rate}: original planner frames + independent finite PCM`, async () => {
      const f = await timelineFixture(id, rate),
        memory = new AudioMemory();
      const inputBefore = JSON.stringify(f.project);
      const plan = await compileCanonicalTimeline(f.project, {
        registry: f.registry,
        rate,
        memory,
      });
      // Oracle starts from ORIGINAL bytes and old parser/renderer, never a
      // canonical inverse, plan-to-plan self comparison or copied expectation.
      const old = normalized(f.text);
      assert.deepEqual(
        plan.events.filter((e) => e.kind === "percussion").map(bare),
        arrangementEvents(old).map((e) => ({
          role: e.role,
          velocity: e.velocity,
          patternId: e.patternId,
          step: e.step,
          frame: Math.round(e.when * rate),
        })),
      );
      const samples = timelineSamples(rate, memory),
        before = samples.hashes();
      try {
        const expected = await canonicalLegacyRender({
          context: {},
          project: old,
          bank: samples.percussion,
          extras: {
            banks: { loop: samples.phrase, instrument: samples.bilah },
          },
          rate,
          yieldTask: async () => {},
        });
        const actual = await renderCanonicalComposition(
          plan,
          plan.placements[0].id,
          { samples, memory, yieldTask: async () => {} },
        );
        assert.equal(actual.buffer.length, expected.length);
        assert.equal(
          pcmHash(actual.buffer),
          pcmHash(expected),
          "exact Float32 bits, zero tolerance",
        );
        const again = await renderCanonicalComposition(
          plan,
          plan.placements[0].id,
          { samples, memory, yieldTask: async () => {} },
        );
        try {
          assert.equal(pcmHash(actual.buffer), pcmHash(again.buffer));
        } finally {
          again.dispose();
          actual.dispose();
        }
        assert.deepEqual(samples.hashes(), before);
        assert.equal(JSON.stringify(f.project), inputBefore);
      } finally {
        samples.dispose();
        plan.dispose();
      }
      emptyBytes(memory);
    });
  }
  for (const id of ["schema4-multibar", "schema4-independent-clocks"]) {
    test(`Q1c ${id} @${rate}: original off-grid/damp/independent duration`, async () => {
      const f = await timelineFixture(id, rate),
        memory = new AudioMemory();
      const plan = await compileCanonicalTimeline(f.project, {
        registry: f.registry,
        rate,
        memory,
      });
      const old = parseInstrumentProject(f.text, f.registry),
        oracle = takePlan(old, f.registry, rate, { includeMuted: true });
      const native = plan.placements[0].native;
      assert.deepEqual(
        native.events.map((e) => [e.localId, e.action, e.tick, e.startFrame]),
        orderedEvents(old.events).map((e) => [
          e.id,
          e.action,
          e.tick,
          eventFrame(e.tick, old.composition.timing.bpm, rate),
        ]),
      );
      assert.deepEqual(
        native.voices.map((v) => [
          v.startFrame,
          v.endFrame,
          v.dampFrame,
          v.event.mix,
        ]),
        oracle.voices.map((v) => [
          v.startFrame,
          v.endFrame,
          v.dampFrame,
          v.mix,
        ]),
      );
      assert.equal(plan.naturalEndFrame, oracle.frames);
      assert.equal(
        plan.placements[0].composition.masterVolume,
        old.composition.master.volume,
      );
      if (id.includes("independent"))
        assert.ok(plan.bodyFrames > plan.sectionSpanFrames);
      assert.equal(plan.admission.audioAdmitted, false);
      plan.dispose();
      emptyBytes(memory);
    });
  }
}

test("Q1c A/B/A/B controls, continuous phrase, random seek and pause have one deterministic frame origin", async () => {
  const f = await timelineFixture("schema3-fifteen-lanes"),
    memory = new AudioMemory();
  const c = structuredClone(f.project),
    d = c.sourceDefs[0],
    a = d.programme.patterns[0],
    b = d.programme.patterns[1];
  for (const p of [a, b])
    Object.assign(p.beatbox[0], {
      enabled: true,
      variant: 1,
      phasePolicy: "continue-source",
    });
  Object.assign(a.beatbox[0], { volume: 0.2, pan: -0.3 });
  Object.assign(b.beatbox[0], { volume: 0.7, pan: 0.4, mute: true });
  const plan = await compileCanonicalTimeline(c, {
    registry: f.registry,
    rate: 48000,
    memory,
  });
  const states = plan.phrases.filter((s) => s.role === "kick");
  assert.deepEqual(
    states.map((s) => s.action),
    ["restart", "continue", "continue", "continue"],
  );
  assert.deepEqual(
    states.map((s) => s.phaseFrame),
    [0, 120000, 0, 120000],
  );
  assert.deepEqual(
    states.map((s) => s.control.pan),
    [-0.3, 0.4, -0.3, 0.4],
  );
  for (const frame of [239999, 137, 479999, 120001, 137, 0]) {
    const q = canonicalTimelineAt(plan, frame).phrases.find(
      (s) => s.role === "kick",
    );
    assert.equal(q.phaseFrame, frame % 240000);
    assert.deepEqual(
      canonicalTimelineAt(plan, frame),
      canonicalTimelineAt(plan, frame),
    );
  }
  assert.equal(a.beatbox[0].volume, 0.2);
  assert.equal(b.beatbox[0].volume, 0.7);
  plan.dispose();
  emptyBytes(memory);
});

for (const [name, changes, actions, phases] of [
  [
    "disable and re-enable",
    { enabled: false },
    ["restart", "exit", "restart", "exit"],
    [0, null, 0, null],
  ],
  [
    "variant identity",
    { variant: 2 },
    ["restart", "restart", "restart", "restart"],
    [0, 0, 0, 0],
  ],
  [
    "explicit restart",
    { phasePolicy: "restart-on-entry" },
    ["restart", "restart", "continue", "restart"],
    [0, 0, 120000, 0],
  ],
])
  test(`Q1c phase ${name} retains original period`, async () => {
    const f = await timelineFixture("schema3-fifteen-lanes"),
      memory = new AudioMemory(),
      c = structuredClone(f.project);
    for (const p of c.sourceDefs[0].programme.patterns)
      Object.assign(p.beatbox[0], { enabled: true, variant: 1 });
    Object.assign(c.sourceDefs[0].programme.patterns[1].beatbox[0], changes);
    const plan = await compileCanonicalTimeline(c, {
      registry: f.registry,
      rate: 48000,
      memory,
    });
    const states = plan.phrases.filter((s) => s.role === "kick");
    assert.deepEqual(
      states.map((s) => s.action),
      actions,
    );
    assert.deepEqual(
      states.map((s) => s.phaseFrame),
      phases,
    );
    plan.dispose();
    emptyBytes(memory);
  });

test("Q1c repeated root occurrence continues phase without a new source/metadata clone", async () => {
  const f = await timelineFixture("schema0-beatbox"),
    memory = new AudioMemory();
  const c = structuredClone(f.project);
  c.sections[0].lengthTicks = 4 * PPQ;
  c.sections[0].placements[0].lengthTicks = 4 * PPQ;
  const plan = await compileCanonicalTimeline(c, {
    registry: f.registry,
    rate: 48000,
    memory,
    command: repeat(3),
  });
  const states = plan.phrases.filter((s) => s.control.enabled);
  assert.equal(states.filter((s) => s.action === "restart").length, 3); // Three enabled roles, once each.
  assert.equal(plan.placements[0].sourceRef, plan.placements[1].sourceRef);
  assert.equal(new Set(plan.placements.map((p) => p.id)).size, 3);
  assert.deepEqual(
    states.filter((s) => s.role === "kick").map((s) => s.phaseFrame),
    [0, 120000, 0],
  );
  assert.equal(
    canonicalTimelineAt(plan, plan.bodyFrames - 1).phrases.find(
      (s) => s.control.enabled,
    ).phaseFrame,
    (plan.bodyFrames - 1) % 240000,
  );
  plan.dispose();
  emptyBytes(memory);
});

test("Q1c same-tick lexical IDs/damp precede strike; native solos include inactive explicit rows", async () => {
  const f = await timelineFixture("schema4-multibar"),
    raw = JSON.parse(f.text),
    memory = new AudioMemory();
  const template = raw.events[0];
  const bank = f.registry.bank(template.bankId, raw.banks[0].version);
  const other = bank.samples.find((s) => s.id !== template.sampleId);
  raw.events = [
    { ...template, id: "s-2", tick: 137 },
    { ...template, id: "d-0", tick: 137, action: "damp", velocity: 0 },
    { ...template, id: "s-10", tick: 137, sampleId: other.id },
    { ...template, id: "d-1", tick: 138, action: "damp", velocity: 0 },
  ];
  const inactive = bank.samples.find(
    (s) => ![other.instrumentId, "peking"].includes(s.instrumentId),
  );
  assert.ok(inactive);
  raw.instrumentMix.push({
    bankId: bank.id,
    instrumentId: inactive.instrumentId,
    volume: 0.7,
    pan: 0,
    mute: false,
    solo: true,
  });
  const { project } = await migrateLegacyMetadata(JSON.stringify(raw), {
    registry: f.registry,
  });
  const plan = await compileCanonicalTimeline(project, {
    registry: f.registry,
    rate: 48000,
    memory,
  });
  const oracle = takePlan(raw, f.registry, 48000, { includeMuted: true });
  assert.deepEqual(
    plan.placements[0].native.events.map((e) => e.localId),
    ["d-0", "s-10", "s-2", "d-1"],
  );
  assert.deepEqual(
    plan.placements[0].native.voices.map((v) => [
      v.event.localId,
      v.dampFrame,
      v.endFrame,
    ]),
    oracle.voices.map((v) => [v.id, v.dampFrame, v.endFrame]),
  );
  assert.ok(
    plan.placements[0].native.voices.every((v) => v.event.mix.volume === 0),
  );
  plan.dispose();
  emptyBytes(memory);
});

test("Q1c Loop window retains fixed clock, EQ, two raw layers, alignment and local/parent masters", async () => {
  const f = await timelineFixture("schema5-eq-overdub-alignment"),
    memory = new AudioMemory();
  const before = JSON.stringify(f.project);
  const plan = await compileCanonicalTimeline(f.project, {
    registry: f.registry,
    rate: 48000,
    memory,
    command: window4,
  });
  assert.equal(plan.bodyFrames, 480000);
  assert.equal(plan.eqTailFrames, 4800);
  assert.equal(plan.project.master.volume, 1);
  assert.equal(plan.project.master.limiter.bypass, false);
  assert.deepEqual(plan.project.tracks[0].fx.eq, {
    version: 1,
    bypass: false,
    lowDb: -3,
    midDb: 2,
    highDb: 1,
  });
  assert.equal(plan.project.tracks[0].layering.version, 1);
  const n = plan.placements.find((p) => p.native);
  assert.equal(n.native.events[0].masterVolume, 0.17);
  assert.equal(n.composition.masterVolume, 0.17);
  assert.equal(plan.placements.filter((p) => p.recording).length, 8);
  for (const frame of [0, 17, 119999, 120000, 479999]) {
    const q = canonicalTimelineAt(plan, frame).recordings;
    assert.deepEqual(
      q.map((r) => r.rawFrame),
      [(frame + 137) % 120000, (((frame - 211) % 120000) + 120000) % 120000],
    );
    assert.deepEqual(
      q.map((r) => r.assetId),
      ["recording-1", "recording-2"],
    );
  }
  assert.equal(JSON.stringify(f.project), before);
  plan.dispose();
  emptyBytes(memory);
});

test("Q1c unsupported nonzero offsets remain inspectable and never become a playable plan", async () => {
  const f = await timelineFixture("schema5-nonzero-offset"),
    memory = new AudioMemory();
  const plan = await compileCanonicalTimeline(f.project, {
    registry: f.registry,
    rate: 48000,
    memory,
    command: window4,
  });
  const q = canonicalTimelineAt(plan, 0).recordings[0];
  assert.equal(q.rawFrame, 137);
  assert.equal(q.playbackIssue, "recordingOffsetUnsupported");
  assert.equal(plan.admission.playableVerified, false);
  plan.dispose();
  emptyBytes(memory);
});

for (const [name, options, error] of [
  [
    "audible accompaniment repeat",
    { id: "schema4-multibar", command: repeat(2) },
    "repeatNeedsEventOnly",
  ],
  [
    "Loop implicit wrap",
    { id: "schema5-eq-overdub-alignment", command: once },
    "arrangementWindowRequired",
  ],
  [
    "fixed capture rate mismatch",
    { id: "schema5-eq-overdub-alignment", command: window4, rate: 44100 },
    "takeRateMismatch",
  ],
])
  test(`Q1c refusal ${name} releases own staging only`, async () => {
    const f = await timelineFixture(options.id),
      memory = new AudioMemory(),
      foreign = memory.reserve(1234, "foreign");
    await assert.rejects(
      compileCanonicalTimeline(f.project, {
        registry: f.registry,
        rate: options.rate ?? 48000,
        memory,
        command: options.command,
      }),
      code(error),
    );
    assert.equal(memory.snapshot().bytes, 1234);
    foreign.release();
    emptyBytes(memory);
  });

test("Q1c cumulative placement x chain admission runs before reservation/expansion", async () => {
  const f = await timelineFixture("schema3-fifteen-lanes"),
    c = structuredClone(f.project);
  const p = c.sections[0].placements[0];
  c.sections[0].placements = Array.from({ length: 32 }, (_, i) => ({
    ...structuredClone(p),
    id: "p-" + i,
  }));
  c.chain[0].repeats = 8;
  let calls = 0;
  await assert.rejects(
    compileCanonicalTimeline(c, {
      registry: f.registry,
      rate: 48000,
      memory: {
        reserve() {
          calls++;
          throw Error("late admission");
        },
      },
    }),
    code("arrangementExpansionLimit"),
  );
  assert.equal(calls, 0);
});

test("Q1c foreign memory pins block logical expansion; no decode or trimmer bypass", async () => {
  const f = await timelineFixture("schema3-fifteen-lanes"),
    memory = new AudioMemory({ maxBytes: 65536 });
  const foreign = memory.reserve(65000, "active-preview-foreign");
  await assert.rejects(
    compileCanonicalTimeline(f.project, {
      registry: f.registry,
      rate: 48000,
      memory,
    }),
    code("combinedMemoryLimit"),
  );
  assert.equal(memory.snapshot().bytes, 65000);
  foreign.release();
  emptyBytes(memory);
});

test("Q1c cancellation during admitted staging releases its lease", async () => {
  const f = await timelineFixture("schema3-fifteen-lanes"),
    memory = new AudioMemory(),
    abort = new AbortController();
  const foreign = memory.reserve(313, "foreign");
  const proxy = {
    reserve(n, label) {
      const lease = memory.reserve(n, label);
      abort.abort();
      return lease;
    },
  };
  await assert.rejects(
    compileCanonicalTimeline(f.project, {
      registry: f.registry,
      rate: 48000,
      memory: proxy,
      signal: abort.signal,
    }),
    code("cancelled"),
  );
  assert.equal(memory.snapshot().bytes, 313);
  foreign.release();
  emptyBytes(memory);
});

test("Q1c caller/command mutation, concurrent replacement and disposal cannot corrupt issued state", async () => {
  const f = await timelineFixture("schema4-multibar"),
    memory = new AudioMemory(),
    c = structuredClone(f.project),
    cmd = { ...once };
  const first = compileCanonicalTimeline(c, {
    registry: f.registry,
    rate: 48000,
    memory,
    command: cmd,
  });
  c.master.volume = 0.3;
  cmd.kind = "invalid";
  const second = compileCanonicalTimeline(c, {
    registry: f.registry,
    rate: 48000,
    memory,
  });
  c.master.volume = 2;
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.project.master.volume, 0.17);
  assert.equal(b.project.master.volume, 0.3);
  assert.equal(a.command.kind, "once");
  assert.ok(Object.isFrozen(a.events[0]));
  const bBytes =
    memory.snapshot().bytes -
    a.admission.scheduleBytes -
    a.admission.snapshotBytes;
  a.dispose();
  a.dispose();
  assert.equal(memory.snapshot().bytes, bBytes);
  assert.throws(
    () => canonicalTimelineAt(a, 0),
    code("invalidCanonicalTimeline"),
  );
  assert.throws(
    () => canonicalTimelineAt({ ...b }, 0),
    code("invalidCanonicalTimeline"),
  );
  canonicalTimelineAt(b, 0);
  b.dispose();
  emptyBytes(memory);
});

test("Q1c unqualified dynamic PCM and cancellation fail before publication and preserve shared samples", async () => {
  const f = await timelineFixture("schema3-fifteen-lanes"),
    memory = new AudioMemory(),
    c = structuredClone(f.project);
  c.sourceDefs[0].programme.patterns[1].beatbox[0].volume = 0.27;
  const dynamic = await compileCanonicalTimeline(c, {
    registry: f.registry,
    rate: 48000,
    memory,
  });
  await assert.rejects(
    renderCanonicalComposition(dynamic, dynamic.placements[0].id, { memory }),
    code("canonicalDynamicRenderNotQualified"),
  );
  dynamic.dispose();
  emptyBytes(memory);
  const p = await compileCanonicalTimeline(f.project, {
      registry: f.registry,
      rate: 48000,
      memory,
    }),
    samples = timelineSamples(48000, memory);
  const before = samples.hashes(),
    baseline = memory.snapshot().bytes,
    abort = new AbortController();
  await assert.rejects(
    renderCanonicalComposition(p, p.placements[0].id, {
      memory,
      samples,
      signal: abort.signal,
      yieldTask: async () => abort.abort(),
    }),
    code("cancelled"),
  );
  assert.equal(memory.snapshot().bytes, baseline);
  assert.deepEqual(samples.hashes(), before);
  p.dispose();
  samples.dispose();
  emptyBytes(memory);
});

test("Q1c invalid sample/render failure cleans its output lease and never disposes foreign PCM", async () => {
  const f = await timelineFixture("schema3-fifteen-lanes"),
    memory = new AudioMemory();
  const p = await compileCanonicalTimeline(f.project, {
      registry: f.registry,
      rate: 48000,
      memory,
    }),
    samples = timelineSamples(48000, memory);
  const before = memory.snapshot().bytes;
  samples.percussion.get("kick").stem.gainTrim = NaN;
  await assert.rejects(
    renderCanonicalComposition(p, p.placements[0].id, { samples, memory }),
    code("invalidCanonicalSample"),
  );
  assert.equal(memory.snapshot().bytes, before);
  p.dispose();
  samples.dispose();
  emptyBytes(memory);
});

test("Q1c disposal while a renderer yields releases only that renderer's output", async () => {
  const f = await timelineFixture("schema3-fifteen-lanes"),
    memory = new AudioMemory();
  const samples = timelineSamples(48000, memory),
    foreignBytes = memory.snapshot().bytes;
  const p = await compileCanonicalTimeline(f.project, {
    registry: f.registry,
    rate: 48000,
    memory,
  });
  const hashes = samples.hashes();
  await assert.rejects(
    renderCanonicalComposition(p, p.placements[0].id, {
      samples,
      memory,
      yieldTask: async () => p.dispose(),
    }),
    code("invalidCanonicalTimeline"),
  );
  assert.equal(memory.snapshot().bytes, foreignBytes);
  assert.deepEqual(samples.hashes(), hashes);
  samples.dispose();
  emptyBytes(memory);
});

for (const variant of [1, 2])
  test(`Q1c original variant ${variant}, pan, mixed solos and omitted roles: finite PCM`, async () => {
    const f = await timelineFixture("schema3-fifteen-lanes"),
      memory = new AudioMemory();
    const raw = JSON.parse(f.text);
    raw.clips = raw.clips.filter((_, i) => i % 2 === 0);
    for (const [i, clip] of raw.clips.entries())
      Object.assign(clip, {
        enabled: true,
        variant,
        volume: 0.29 + i * 0.19,
        pan: i % 2 ? 1 : -0.8,
        solo: i === 1,
        mute: false,
      });
    raw.master.volume = 0.42;
    const text = JSON.stringify(raw),
      { project } = await migrateLegacyMetadata(text, { registry: f.registry });
    const p = await compileCanonicalTimeline(project, {
      registry: f.registry,
      rate: 48000,
      memory,
    });
    const samples = timelineSamples(48000, memory);
    let actual;
    try {
      const expected = await canonicalLegacyRender({
        context: {},
        project: normalized(text),
        bank: samples.percussion,
        extras: { banks: { loop: samples.phrase, instrument: samples.bilah } },
        rate: 48000,
        yieldTask: async () => {},
      });
      actual = await renderCanonicalComposition(p, p.placements[0].id, {
        samples,
        memory,
        yieldTask: async () => {},
      });
      assert.equal(pcmHash(actual.buffer), pcmHash(expected));
      assert.ok(actual.buffer.getChannelData(1).some((v) => v !== 0));
    } finally {
      actual?.dispose();
      p.dispose();
      samples.dispose();
    }
    emptyBytes(memory);
  });

test("Q1c disabled solo keeps the legacy group gate while its phase stays disabled", async () => {
  const f = await timelineFixture("schema3-fifteen-lanes"),
    memory = new AudioMemory();
  const raw = JSON.parse(f.text);
  Object.assign(raw.clips[0], { enabled: false, solo: true });
  const text = JSON.stringify(raw),
    { project } = await migrateLegacyMetadata(text, { registry: f.registry });
  const p = await compileCanonicalTimeline(project, {
    registry: f.registry,
    rate: 48000,
    memory,
  });
  const samples = timelineSamples(48000, memory);
  const actual = await renderCanonicalComposition(p, p.placements[0].id, {
    samples,
    memory,
    yieldTask: async () => {},
  });
  assert.ok(actual.buffer.getChannelData(0).every((x) => x === 0));
  assert.ok(
    p.phrases
      .filter((s) => s.role === raw.clips[0].role)
      .every((s) => s.phaseFrame === null),
  );
  actual.dispose();
  p.dispose();
  samples.dispose();
  emptyBytes(memory);
});
