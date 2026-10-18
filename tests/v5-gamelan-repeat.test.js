import test from "node:test";
import assert from "node:assert/strict";
import catalog from "../internal/instrument-focus/registry-48000.json" with { type: "json" };
import catalog44 from "../internal/instrument-focus/registry-44100.json" with { type: "json" };
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import { emptyInstrumentTake } from "../src/project/instrument-take.js";
import { physicalFocus } from "../src/gamelan/instrument-focus.js";
import {
  validateInstrumentProject,
  PPQ,
} from "../src/project/instrument-project.js";
import {
  gamelanRepeatPlan,
  repeatedVoice,
  repeatAdmission,
  REPEAT_LOOKAHEAD,
} from "../src/project/gamelan-repeat.js";
const registry = new InstrumentRegistry(catalog.banks),
  gong = physicalFocus(registry, "gong-ageng", "pelog")[0];
function score(events, bpm = 96) {
  const p = structuredClone(emptyInstrumentTake(registry));
  p.composition.timing.bpm = bpm;
  p.banks = [{ id: gong.bank.id, version: gong.bank.version }];
  p.events = events.map((e, i) => ({
    id: "hit-" + i,
    bankId: gong.bank.id,
    sampleId: gong.descriptor.id,
    velocity: e.action === "damp" ? 0 : 0.5,
    ...e,
  }));
  return validateInstrumentProject(p, registry);
}
test("period is score length; full gong tail crosses boundaries and next-cycle explicit damp is retained", () => {
  const p = score([
      { tick: PPQ / 4, action: "damp" },
      { tick: (15 * PPQ) / 4, action: "strike" },
    ]),
    text = JSON.stringify(p),
    plan = gamelanRepeatPlan(p, registry, 48000),
    v = plan.voices[0];
  assert.equal(plan.periodFrames, 120000);
  assert.equal(v.startFrame, 112500);
  assert.equal(v.dampFrame, 127500);
  assert.equal(v.endFrame, 128460);
  assert.ok(v.naturalEndFrame > plan.periodFrames);
  assert.equal(JSON.stringify(p), text);
  const next = repeatedVoice(plan, 220, 0);
  assert.equal(next.startFrame, v.startFrame + 220 * plan.periodFrames);
  assert.equal(next.dampFrame, v.dampFrame + 220 * plan.periodFrames);
  assert.equal(next.endFrame, v.endFrame + 220 * plan.periodFrames);
});
test("same-tick damp precedes the new strike and affects that strike only on a following cycle", () => {
  const p = score([
      { tick: 0, action: "strike" },
      { tick: 0, action: "damp" },
    ]),
    plan = gamelanRepeatPlan(p, registry, 48000);
  assert.equal(plan.voices[0].dampFrame, plan.periodFrames);
  assert.equal(plan.voices[0].endFrame, plan.periodFrames + 960);
});
test("fractional musical periods use an explicit fixed stored frame interval without source-rate changes", () => {
  const plan = gamelanRepeatPlan(
    score([{ tick: 0, action: "strike" }], 173),
    registry,
    48000,
  );
  assert.equal(plan.periodFrames, 66590);
  assert.equal(
    repeatedVoice(plan, 220, 0).startFrame -
      repeatedVoice(plan, 219, 0).startFrame,
    66590,
  );
  assert.equal(plan.voices[0].descriptor.sampleRate, 48000);
  assert.equal(
    plan.voices[0].naturalEndFrame,
    plan.voices[0].descriptor.frames,
  );
});
test("periodic owned-node/peak sweep agrees with brute-force interval occupancy including wrap and full periods", () => {
  const plan = {
      rate: 100,
      periodFrames: 100,
      voices: [
        {
          key: "a",
          startFrame: 10,
          endFrame: 20,
          velocity: 1,
          mix: { volume: 1, pan: 0 },
        },
        {
          key: "b",
          startFrame: 95,
          endFrame: 110,
          velocity: 0.5,
          mix: { volume: 0.8, pan: 0 },
        },
      ],
    },
    metrics = new Map([
      ["a", { peak: 0.2 }],
      ["b", { peak: 0.1 }],
    ]),
    volume = 0.65,
    r = repeatAdmission(plan, metrics, volume);
  let max = 0,
    peak = 0;
  for (let frame = 0; frame < 100; frame++) {
    let count = 0,
      sum = 0;
    for (const v of plan.voices)
      for (let k = -5; k <= 5; k++)
        if (
          frame >= v.startFrame + k * 100 - Math.ceil(REPEAT_LOOKAHEAD * 100) &&
          frame < v.endFrame + k * 100 + 45
        ) {
          count++;
          sum +=
            metrics.get(v.key).peak * v.velocity * 0.25 * v.mix.volume * volume;
        }
    max = Math.max(max, count);
    peak = Math.max(peak, sum);
  }
  assert.equal(r.maxOwned, max);
  assert.ok(Math.abs(r.maxPeak - peak) < 1e-12);
});
test("long overlapping tails, headroom and legacy mixtures refuse before playback without rewriting project", () => {
  const p = score([{ tick: 0, action: "strike" }], 180),
    text = JSON.stringify(p),
    plan = gamelanRepeatPlan(p, registry, 48000),
    metrics = new Map([[plan.voices[0].key, { peak: 1 }]]);
  assert.throws(
    () => repeatAdmission(plan, metrics, 0.65),
    (e) => ["voiceLimit", "voiceHeadroom"].includes(e.code),
  );
  const tooMany = {
    ...plan,
    voices: plan.voices.map((v) => ({
      ...v,
      endFrame: v.startFrame + 20 * plan.periodFrames,
    })),
  };
  assert.throws(
    () =>
      repeatAdmission(
        tooMany,
        new Map([[plan.voices[0].key, { peak: 0.0001 }]]),
        0.65,
      ),
    { code: "voiceLimit" },
  );
  assert.equal(JSON.stringify(p), text);
  const loud = {
    rate: 48000,
    periodFrames: 480000,
    voices: [
      {
        key: "a",
        startFrame: 0,
        endFrame: 10,
        velocity: 1,
        mix: { volume: 1, pan: 0 },
      },
      {
        key: "b",
        startFrame: 0,
        endFrame: 10,
        velocity: 1,
        mix: { volume: 1, pan: 0 },
      },
    ],
  };
  assert.throws(
    () =>
      repeatAdmission(
        loud,
        new Map([
          ["a", { peak: 2 }],
          ["b", { peak: 2 }],
        ]),
        1,
      ),
    { code: "voiceHeadroom" },
  );
  const hybrid = structuredClone(p);
  hybrid.composition.patterns[0].steps.kick[0] = 0.5;
  assert.throws(() => gamelanRepeatPlan(hybrid, registry, 48000), {
    code: "repeatNeedsEventOnly",
  });
  let reads = 0;
  const hostile = {
    get composition() {
      reads++;
      return {};
    },
  };
  assert.throws(() => gamelanRepeatPlan(hostile, registry, 48000));
  assert.equal(reads, 0);
});

test("repeat boundary/damp mapping retains canonical tails at both rates, four tempos and four bar lengths", () => {
  for (const [rate, catalogData] of [
    [44100, catalog44],
    [48000, catalog],
  ]) {
    const r = new InstrumentRegistry(catalogData.banks),
      note = physicalFocus(r, "gong-ageng", "pelog")[0];
    for (const bpm of [60, 96, 173, 180])
      for (const bars of [1, 2, 4, 8]) {
        const p = structuredClone(emptyInstrumentTake(r)),
          ticks = bars * 4 * PPQ;
        p.composition.timing.bpm = bpm;
        p.clock.lengthTicks = ticks;
        p.banks = [{ id: note.bank.id, version: note.bank.version }];
        p.events = [
          {
            id: "damp",
            tick: PPQ / 4,
            action: "damp",
            velocity: 0,
            bankId: note.bank.id,
            sampleId: note.descriptor.id,
          },
          {
            id: "strike",
            tick: ticks - PPQ / 4,
            action: "strike",
            velocity: 0.2,
            bankId: note.bank.id,
            sampleId: note.descriptor.id,
          },
        ];
        const text = JSON.stringify(p),
          plan = gamelanRepeatPlan(p, r, rate),
          v = plan.voices[0],
          period = Math.round((bars * 4 * 60 * rate) / bpm);
        assert.equal(plan.periodFrames, period);
        assert.equal(v.naturalEndFrame - v.startFrame, note.descriptor.frames);
        const damp = period + Math.round((60 * rate) / (bpm * 4));
        assert.equal(v.dampFrame, damp < v.naturalEndFrame ? damp : null);
        assert.equal(
          v.endFrame,
          Math.min(v.naturalEndFrame, damp + Math.round(0.02 * rate)),
        );
        const cycles = Math.floor((303 * rate) / period),
          ideal = Math.round((cycles * bars * 4 * 60 * rate) / bpm);
        assert.ok((Math.abs(cycles * period - ideal) / rate) * 1000 < 10);
        assert.equal(JSON.stringify(p), text);
      }
  }
});
