import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AudioEngine } from "../src/audio/engine.js";
import { Transport } from "../src/audio/transport.js";
import {
  stepBeat,
  stepIndexAtBeat,
  nextStepIndex,
  arrangementEvents,
} from "../src/audio/sequencing.js";
import { newStudioProject, studioDemo } from "../src/project/studio-model.js";
import { parseProject, serializeProject } from "../src/project/schema.js";
import { renderDocument } from "../src/app/document.js";

const catalog = {
  ...JSON.parse(
    readFileSync(
      new URL("../internal/studio-kits/manifest.json", import.meta.url),
      "utf8",
    ),
  ),
  kind: "studio",
};
test("Swung inverse selects the future odd step before its hit and never advances the playhead early", () => {
  assert.equal(nextStepIndex(0.31, 0.5), 1);
  assert.equal(stepIndexAtBeat(0.31, 0.5), 0);
  assert.equal(nextStepIndex(0.4, 0.5), 2);
  assert.equal(stepIndexAtBeat(0.4, 0.5), 1);
  for (const swing of [0, 0.5])
    for (let index = 0; index <= 128; index++) {
      const at = stepBeat(index, swing);
      assert.equal(nextStepIndex(at, swing), index);
      assert.equal(stepIndexAtBeat(at, swing), index);
      assert.equal(nextStepIndex(at + 1e-9, swing), index + 1);
      assert.equal(stepIndexAtBeat(at + 1e-9, swing), index);
      if (index) {
        assert.equal(nextStepIndex(at - 1e-9, swing), index);
        assert.equal(stepIndexAtBeat(at - 1e-9, swing), index - 1);
      }
    }
});
test("Native-time eligible-step selection respects exact lead boundaries and bar wrap at every tempo", () => {
  for (const bpm of [60, 90, 120, 180])
    for (const swing of [0, 0.5]) {
      const transport = new Transport({ bpm });
      transport.start(12.125);
      const owner = { transport, sequence: { timing: { swing } } };
      for (let index = 0; index <= 64; index++)
        for (const lead of [0.002, 0.005]) {
          const at = transport.timeAt(stepBeat(index, swing));
          const select = (time) =>
            AudioEngine.prototype.nextSequenceStep.call(owner, time, lead);
          assert.equal(select(at - lead), index);
          assert.equal(select(at - lead - 1e-7), index);
          assert.equal(select(at - lead + 1e-7), index + 1);
          assert.equal(
            AudioEngine.prototype.sequenceStepAt.call(owner, at),
            index,
          );
          assert.equal(
            AudioEngine.prototype.sequenceStepAt.call(owner, at + 1e-7),
            index,
          );
          if (index)
            assert.equal(
              AudioEngine.prototype.sequenceStepAt.call(owner, at - 1e-7),
              index - 1,
            );
        }
      assert.equal(AudioEngine.prototype.sequenceStepAt.call(owner, 12.1), -1);
    }
});
test("Paused phase cursor excludes already-passed hits, keeps future swung hits and resets only with transport reset", () => {
  for (const bpm of [60, 90, 120, 180])
    for (const swing of [0, 0.5]) {
      const transport = new Transport({ bpm });
      transport.start(1);
      const owner = {
        transport,
        sequence: { timing: { swing } },
        passedStep: -1,
        sequenceStepAt: AudioEngine.prototype.sequenceStepAt,
      };
      for (const phase of [0.2, 0.31, 0.4, 3.81, 3.9, 4, 4.1]) {
        transport.start(1);
        const clock = transport.timeAt(phase);
        AudioEngine.prototype.rememberSequencePosition.call(owner, clock);
        transport.pause(clock);
        const consumed = owner.passedStep;
        transport.start(clock + 0.05);
        const next = Math.max(
          consumed + 1,
          nextStepIndex(transport.position, swing),
        );
        assert.ok(stepBeat(next, swing) >= phase);
        assert.ok(next > consumed);
      }
    }
});
test("Pattern-chain transitions and WAV events share straight and maximum-swing geometry without pitch changes", () => {
  const p = studioDemo();
  for (const bpm of [60, 90, 120, 180])
    for (const swing of [0, 0.5]) {
      p.timing.bpm = bpm;
      p.timing.swing = swing;
      for (const e of arrangementEvents(p)) {
        const beat = stepBeat(e.index, swing);
        assert.ok(Math.abs(e.when - (beat * 60) / bpm) < 1e-10);
        assert.equal(stepIndexAtBeat(beat, swing), e.index);
        assert.equal(e.patternId, p.chain[Math.floor(e.index / 16)]);
      }
    }
});
test("Common Studio parser and serializer reject string, nested and mixed meter without coercion", () => {
  const p = newStudioProject();
  assert.deepEqual(
    parseProject(serializeProject(p, catalog), catalog).timing.meter,
    [4, 4],
  );
  for (const meter of [
    ["4", "4"],
    [[4], [4]],
    [4, "4"],
    ["4", 4],
    [4, [4]],
    [true, 4],
    [4],
    [4, 4, 4],
    [3, 4],
    [4, 8],
    [null, 4],
  ]) {
    const invalid = structuredClone(p);
    invalid.timing.meter = meter;
    assert.throws(
      () => parseProject(JSON.stringify(invalid), catalog),
      (e) => e.code === "invalidProject",
    );
    assert.throws(
      () => serializeProject(invalid, catalog),
      (e) => e.code === "invalidProject",
    );
    assert.deepEqual(p.timing.meter, [4, 4]);
  }
});
test("Playable Studio SSR metadata names the working tool honestly in ID and EN", () => {
  for (const locale of ["id", "en"]) {
    const html = renderDocument("studio", locale);
    const title = html.match(/<title>([^<]+)<\/title>/)[1];
    assert.ok(title.includes("Rhythm Studio"));
    assert.equal(/Coming Soon|Segera Hadir/i.test(title), false);
    assert.ok(html.includes('property="og:title" content="' + title + '"'));
    assert.ok(
      html.includes(
        'rel="canonical" href="https://perkusi.com' +
          (locale === "en" ? "/en" : "") +
          '/studio/"',
      ),
    );
  }
});
