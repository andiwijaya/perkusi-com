import test from "node:test";
import assert from "node:assert/strict";
import { gamelanPlaybackScale } from "../src/audio/gamelan-level.js";
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import catalog from "../internal/instrument-focus/registry-48000.json" with { type: "json" };
import { emptyInstrumentTake } from "../src/project/instrument-take.js";
import { emptyLoopProject, assignSource } from "../src/loop-station/model.js";
import { prepareLoopPlan, loopAdmission } from "../src/loop-station/plan.js";
const cdm = { setId: "cdm-porto-recorded-candidate" };

test("only quieter trusted CdM notes receive bounded fixed playback gain; silence and other sources do not", () => {
  for (const peak of [0, 0.01, 0.16, 0.2, 0.4, 0.8, 0.95, 1, 1.5]) {
    const scale = gamelanPlaybackScale(cdm, peak);
    assert(scale >= 1 && scale <= 4);
    assert(peak * scale <= Math.max(peak, 0.8) + 1e-12);
    assert.equal(
      gamelanPlaybackScale({ setId: "original-local-input" }, peak),
      1,
    );
    assert.equal(
      gamelanPlaybackScale({ setId: "studio-original-synthesis" }, peak),
      1,
    );
    assert.equal(
      gamelanPlaybackScale({ setId: "freepats-recorded-plucked" }, peak),
      1,
    );
  }
  assert.equal(gamelanPlaybackScale(cdm, 0.16), 4);
  assert.equal(gamelanPlaybackScale(cdm, 0.4), 2);
  assert.equal(gamelanPlaybackScale(cdm, 0.95), 1);
  for (const x of [NaN, Infinity, -1])
    assert.equal(gamelanPlaybackScale(cdm, x), 1);
});

test("prepared Gamelan loop admits the exact corrected scale and refuses an unsafe dense mix", async () => {
  const registry = new InstrumentRegistry(catalog.banks),
    bank = registry.bank("cdm-pelog", "candidate-1.0.0"),
    sample = bank.samples[0];
  const take = structuredClone(emptyInstrumentTake(registry));
  take.composition.master.volume = 0.75;
  take.banks = [{ id: bank.id, version: bank.version }];
  take.events = [
    {
      id: "one",
      tick: 0,
      action: "strike",
      velocity: 1,
      bankId: bank.id,
      sampleId: sample.id,
    },
  ];
  let p = emptyLoopProject(registry);
  p = assignSource(p, registry, p.tracks[0].id, JSON.stringify(take), {
    loop: false,
  });
  const data = new Float32Array(sample.frames).fill(0.16),
    snapshot = data.slice();
  const plan = await prepareLoopPlan(p, {
    registry,
    rate: 48000,
    cache: {
      async acquire() {
        return {
          buffer: {
            length: sample.frames,
            numberOfChannels: 2,
            sampleRate: 48000,
            duration: sample.frames / 48000,
            getChannelData: () => data,
          },
          metrics: { peak: 0.16 },
          release() {},
        };
      },
      trim() {},
    },
  });
  try {
    assert.equal(plan.tracks[0].clips[0].voices[0].scale, 3);
    assert(Math.abs(loopAdmission(plan).maxPeak - 0.12) < 1e-10);
    const dense = {
      ...plan,
      tracks: Array.from({ length: 8 }, () => plan.tracks[0]),
    };
    assert.throws(() => loopAdmission(dense), { code: "voiceHeadroom" });
    assert.deepEqual(data, snapshot);
    assert.equal(JSON.parse(p.sources[0].text).composition.master.volume, 0.75);
  } finally {
    plan.release();
  }
});
