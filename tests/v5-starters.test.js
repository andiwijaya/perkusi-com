import test from "node:test";
import assert from "node:assert/strict";
import c48 from "../internal/instrument-focus/registry-48000.json" with { type: "json" };
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import { drumBanks } from "../src/loop-station/drum-sources.js";
import {
  melodicBanks,
  melodicManifest,
} from "../src/loop-station/melodic-sources.js";
import { starterContent, createStarter } from "../src/loop-station/starters.js";
import { prepareLoopPlan, loopAdmission } from "../src/loop-station/plan.js";
import { validateLoopProject } from "../src/loop-station/project.js";
import { gamelanWavAttribution } from "../src/gamelan/attribution.js";
const registry = new InstrumentRegistry([
  ...c48.banks,
  ...drumBanks,
  ...melodicBanks(),
]);
for (const recipe of starterContent)
  test(`${recipe.id}: real distinct score, immutable sources, complete credits and guarded voice margin`, async () => {
    const p = createStarter(recipe.id, registry);
    assert.equal(p.tracks.length, 8);
    assert.equal(
      p.tracks.filter((t) => t.clips.length).length,
      recipe.lanes.length,
    );
    assert.deepEqual(
      validateLoopProject(JSON.parse(JSON.stringify(p)), registry),
      p,
    );
    assert.equal(p.timing.bpm, recipe.bpm);
    assert.equal(p.assetRefs.length, 0);
    const cache = {
      async acquire(bank, version, id) {
        const s = registry.sample(bank, version, id),
          m = melodicManifest.assets.find(
            (r) => r.sampleId === id && r.profileRate === 48000,
          );
        return {
          buffer: {
            length: s.frames,
            sampleRate: s.sampleRate,
            numberOfChannels: s.channels,
            duration: s.frames / s.sampleRate,
          },
          metrics: { peak: m?.derivative.peak ?? 1 },
          release() {},
        };
      },
      trim() {},
    };
    const plan = await prepareLoopPlan(p, { registry, rate: 48000, cache });
    try {
      const admission = loopAdmission(plan);
      assert.equal(admission.maxOwned, 10);
      // Bound every source at its declared worst peak, including the corrected
      // playback trims, without relying on the previous inaudibly low master.
      assert(admission.maxPeak < 0.9);
      assert.equal(p.master.volume, 1);
      assert(
        p.sources.every(
          (s) => JSON.parse(s.text).composition.master.volume === 0.75,
        ),
      );
      for (const src of p.sources) {
        const doc = JSON.parse(src.text),
          credits = gamelanWavAttribution(doc);
        if (doc.events.some((e) => e.bankId.startsWith("freepats-")))
          assert.match(credits, /FreePats/);
        assert(!doc.events.some((e) => e.sampleId.includes("suling")));
      }
    } finally {
      plan.release();
    }
    assert.throws(() => createStarter("not-a-starter", registry));
    assert.equal(new Set(starterContent.map((r) => r.genre)).size, 3);
  });
