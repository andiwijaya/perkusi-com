import test from "node:test";
import assert from "node:assert/strict";
import { timelineFixture } from "./helpers/canonical-timeline-fixtures.js";
import { migrateLegacyMetadata } from "../src/project/canonical-metadata.js";
import { compileCanonicalTimeline } from "../src/project/canonical-timeline.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { eventFrame } from "../src/project/instrument-project.js";

async function dense(count, late = false) {
  const f = await timelineFixture("schema4-multibar"),
    raw = JSON.parse(f.text);
  raw.composition.chain = [raw.composition.patterns[0].id];
  raw.composition.clips.forEach((c) => (c.enabled = false));
  raw.composition.patterns.forEach((p) => {
    Object.values(p.steps).forEach((a) => a.fill(0));
    p.notes.fill(null);
  });
  raw.events = Array.from({ length: count }, (_, i) => ({
    ...raw.events[0],
    id: "strike-" + i,
    tick: (late ? raw.clock.lengthTicks - count : 0) + i,
    action: "strike",
    velocity: 0.1,
  }));
  const { project } = await migrateLegacyMetadata(JSON.stringify(raw), {
      registry: f.registry,
    }),
    c = structuredClone(project);
  c.sections[0].placements = Array.from({ length: 31 }, (_, i) => ({
    ...structuredClone(c.sections[0].placements[0]),
    id: "dense-" + i,
  }));
  return { ...f, raw, project: c };
}
for (const [count, late] of [
  [4075, false],
  [4077, true],
])
  test(`Q1c dense ${count}x31 ${late ? "late tail" : "review repro"}: legal plan endpoint uses bounded iteration`, async () => {
    const f = await dense(count, late),
      memory = new AudioMemory(),
      foreign = memory.reserve(313, "foreign");
    const p = await compileCanonicalTimeline(f.project, {
      registry: f.registry,
      rate: 48000,
      memory,
    });
    try {
      assert.equal(p.admission.candidateCount, 31 * (count + 150));
      assert.equal(
        p.admission.scheduleBytes,
        1024 + (1 + 31 * (count + 150)) * 64,
      );
      assert.equal(
        p.placements.reduce((n, p) => n + p.native.voices.length, 0),
        31 * count,
      );
      const last = f.raw.events.at(-1),
        d = f.registry.sample(
          last.bankId,
          f.raw.banks[0].version,
          last.sampleId,
        );
      assert.equal(
        p.naturalEndFrame,
        Math.max(
          p.bodyFrames,
          eventFrame(last.tick, f.raw.composition.timing.bpm, 48000) + d.frames,
        ),
      );
      if (late) assert.ok(p.naturalEndFrame > p.bodyFrames);
    } finally {
      p.dispose();
    }
    assert.equal(memory.snapshot().bytes, 313);
    foreign.release();
    assert.equal(memory.snapshot().bytes, 0);
  });
test("Q1c dense4078x31: just over cap rejects before reservation or expansion", async () => {
  const f = await dense(4078),
    memory = new AudioMemory(),
    foreign = memory.reserve(313, "foreign");
  let calls = 0;
  const proxy = {
    reserve(n, label) {
      calls++;
      return memory.reserve(n, label);
    },
  };
  await assert.rejects(
    compileCanonicalTimeline(f.project, {
      registry: f.registry,
      rate: 48000,
      memory: proxy,
    }),
    (e) => e.code === "arrangementExpansionLimit",
  );
  assert.equal(calls, 0);
  assert.equal(memory.snapshot().bytes, 313);
  foreign.release();
  assert.equal(memory.snapshot().bytes, 0);
});
