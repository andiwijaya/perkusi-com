import test from "node:test";
import assert from "node:assert/strict";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { renderCanonicalRun } from "../src/audio/canonical-dynamic-render.js";
import { prepareCanonicalRunWindows } from "../src/audio/canonical-run-windows.js";
import { newComposition } from "../src/project/composition-model.js";
import { migrateLegacyMetadata } from "../src/project/canonical-metadata.js";
import { compileCanonicalTimeline } from "../src/project/canonical-timeline.js";
import { canonicalFixtureRegistry as registry } from "./helpers/canonical-fixtures.js";
import { qaBuffer } from "./helpers/canonical-score-fixtures.js";
async function fixture(rate, continuous = true, crowded = false) {
  const memory = new AudioMemory(),
    foreign = memory.reserve(313, "foreign"),
    p = newComposition("Bounded source-window QA");
  p.timing.bpm = 96;
  p.master.volume = 0.3;
  p.patterns[0].steps.kick[0] = 0.5;
  p.patterns[0].steps.kick[8] = 0.6;
  p.patterns.push({ ...structuredClone(p.patterns[0]), id: "p2", name: "B" });
  p.chain = ["p1", "p2"];
  const m = await migrateLegacyMetadata(JSON.stringify(p), { registry }),
    c = structuredClone(m.project),
    source = c.sourceDefs.find((d) => d.kind === "composition");
  for (const [index, pattern] of source.programme.patterns.entries()) {
    for (const [i, b] of pattern.beatbox.entries())
      Object.assign(b, {
        enabled: crowded || i === 0 || i === 2,
        volume: 0.2,
        variant: index ? 2 : 1,
        pan: index ? -0.31 : 0.27,
        phasePolicy: i === 2 ? "restart-on-entry" : "continue-source",
      });
    if (crowded) for (const row of Object.values(pattern.steps)) row[0] = 0.5;
  }
  const timeline = await compileCanonicalTimeline(c, {
      registry,
      rate,
      memory,
      command: {
        kind: continuous ? "repeat" : "once",
        bars: null,
        cycles: continuous ? 3 : 1,
      },
    }),
    pieces = timeline.placements.filter((p) => p.composition),
    run = {
      source: timeline.project.sourceDefs.find((d) => d.id === source.id),
      timeline,
      pieces,
      trackId: pieces[0].trackId,
      originalId: pieces[0].originalId,
      continuous,
    },
    sourceLease = memory.reserve(
      (5 * rate * 2 + 4096) * 4 + 4096,
      "qa/owned-source-buffers",
    ),
    phrase = qaBuffer(2, 5 * rate, rate),
    shot = qaBuffer(1, 4096, rate);
  for (let ch = 0; ch < 2; ch++)
    phrase
      .getChannelData(ch)
      .set(
        Float32Array.from(
          { length: phrase.length },
          (_, i) => 0.04 * Math.sin(i / (ch ? 31 : 47)),
        ),
      );
  shot
    .getChannelData(0)
    .set(
      Float32Array.from(
        { length: shot.length },
        (_, i) => 0.02 * Math.cos(i / 23),
      ),
    );
  const entry = (_, item) => ({
    buffer: ["percussion", "bilah"].includes(item.kind) ? shot : phrase,
    stem: { gainTrim: 0.2 },
    peak: 0.04,
  });
  return {
    memory,
    foreign,
    timeline,
    run,
    entry,
    sourceLease,
    close() {
      timeline.dispose();
      sourceLease.release();
      assert.equal(memory.snapshot().bytes, 313);
      foreign.release();
      assert.equal(memory.snapshot().bytes, 0);
    },
  };
}
for (const rate of [44100, 48000])
  for (const continuous of [false, true])
    test(`bounded run ${rate}, continuous=${continuous}: random and sequential reads equal established dynamic renderer`, async () => {
      const f = await fixture(rate, continuous),
        outputLease = f.memory.reserve(
          (f.timeline.bodyFrames + 6 * rate) * 8 + 65537 * 4,
          "qa/finite-reference-output",
        ),
        expected = await renderCanonicalRun(f.run, {
          rate,
          entry: f.entry,
          createBuffer: qaBuffer,
          check: () => {},
          yieldTask: async () => {},
        });
      let view;
      try {
        view = await prepareCanonicalRunWindows(f.run, {
          rate,
          entry: f.entry,
          memory: f.memory,
          yieldTask: async () => {},
        });
        assert.equal(view.startFrame, expected.startFrame);
        assert.equal(view.endFrame, expected.endFrame);
        assert.equal(view.peak, expected.peak);
        assert.equal(view.maxLogicalVoices, expected.maxLogicalVoices);
        assert.deepEqual(view.phaseStates, expected.phaseStates);
        assert.throws(
          () => view.buffer.getChannelData(0),
          (e) => e.code === "boundedRunViewRequired",
        );
        const target = new Float32Array(2048);
        for (const offset of [
          0,
          127,
          Math.floor(view.buffer.length / 2) - 1,
          view.buffer.length - 1,
          0,
        ])
          for (let ch = 0; ch < 2; ch++) {
            view.buffer.copyFromChannel(target, ch, offset);
            const n = Math.min(2048, view.buffer.length - offset);
            assert.deepEqual(
              target.subarray(0, n),
              expected.buffer.getChannelData(ch).subarray(offset, offset + n),
            );
            assert(target.subarray(n).every((v) => v === 0));
          }
        for (let offset = 0; offset < view.buffer.length; offset += 2048)
          for (let ch = 0; ch < 2; ch++) {
            view.buffer.copyFromChannel(target, ch, offset);
            const n = Math.min(2048, view.buffer.length - offset);
            assert.deepEqual(
              target.subarray(0, n),
              expected.buffer.getChannelData(ch).subarray(offset, offset + n),
            );
          }
        const held = f.memory.snapshot().bytes;
        assert.throws(
          () => view.buffer.copyFromChannel(new Float32Array(2049), 0),
          (e) => e.code === "invalidRunWindow",
        );
        assert.equal(f.memory.snapshot().bytes, held);
        view.release();
        view.release();
        assert.throws(
          () => view.buffer.copyFromChannel(target, 0),
          (e) => e.code === "memoryReleased",
        );
      } finally {
        view?.release();
        outputLease.release();
        f.close();
      }
    });
test("cached bounded source window still checks cancellation and keeps ownership until explicit close", async () => {
  const f = await fixture(48000, false);
  let cancelled = false,
    view;
  try {
    view = await prepareCanonicalRunWindows(f.run, {
      rate: 48000,
      entry: f.entry,
      memory: f.memory,
      check: () => {
        if (cancelled)
          throw Object.assign(Error("cancelled"), { code: "cancelled" });
      },
      yieldTask: async () => {},
    });
    const target = new Float32Array(128),
      held = f.memory.snapshot().bytes,
      offset = Math.floor((view.buffer.length - 1) / 2048) * 2048;
    view.buffer.copyFromChannel(target, 0, offset);
    cancelled = true;
    for (let i = 0; i < 2; i++)
      assert.throws(
        () => view.buffer.copyFromChannel(target, 0, offset),
        (e) => e.code === "cancelled",
      );
    assert.equal(f.memory.snapshot().bytes, held);
  } finally {
    view?.release();
    f.close();
  }
});
test("bounded source preparation cannot hide an over16-voice internal programme behind a rendered bus", async () => {
  const f = await fixture(48000, true, true),
    before = f.memory.snapshot().bytes;
  try {
    await assert.rejects(
      prepareCanonicalRunWindows(f.run, {
        rate: 48000,
        entry: f.entry,
        memory: f.memory,
        yieldTask: async () => {},
      }),
      (e) => e.code === "voiceLimit",
    );
    assert.equal(f.memory.snapshot().bytes, before);
  } finally {
    f.close();
  }
});
