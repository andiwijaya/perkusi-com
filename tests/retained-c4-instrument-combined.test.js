// C4 retained data/shared assertions; retired engine/UI scenarios separately archived.
import test from "node:test";
import assert from "node:assert/strict";
import c44100 from "../internal/instrument-focus/registry-44100.json" with { type: "json" };
import c48000 from "../internal/instrument-focus/registry-48000.json" with { type: "json" };
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import {
  INSTRUMENT_DEMOS,
  instrumentDemo,
} from "./helpers/archived-gamelan-data.js";
import { takePlan } from "../src/project/instrument-take.js";
import { instrumentGroups } from "../src/project/instrument-mix.js";
import {
  parseInstrumentProject,
  validateInstrumentProject,
  PPQ,
} from "../src/project/instrument-project.js";
import { legacyOutputStage } from "../src/audio/legacy-bus.js";
import { beatboxOutputSample } from "../src/beatbox/output-stage.js";

test("Combined four demos: two per laras, real immutable source notes, full deliberate damp/tail geometry and lossless JSON at both rates", () => {
  assert.equal(INSTRUMENT_DEMOS.filter((d) => d.laras === "pelog").length, 2);
  assert.equal(INSTRUMENT_DEMOS.filter((d) => d.laras === "slendro").length, 2);
  for (const catalog of [c44100, c48000]) {
    const r = new InstrumentRegistry(catalog.banks);
    for (const demo of INSTRUMENT_DEMOS) {
      const p = instrumentDemo(demo.id, r),
        plan = takePlan(p, r, catalog.profileRate);
      assert.deepEqual(parseInstrumentProject(JSON.stringify(p), r), p);
      assert.deepEqual(
        p.banks.map((b) => b.id).sort(),
        ["cdm-" + demo.laras, "cdm-shared"].sort(),
      );
      assert.equal(p.clock.lengthTicks, 16 * PPQ);
      assert.equal(p.composition.chain.length, 4);
      assert.ok(plan.voices.length >= 32);
      const gong = plan.voices.find(
        (v) => v.descriptor.instrumentId === "gong-ageng",
      );
      assert.equal(gong.dampFrame, null);
      assert.equal(gong.endFrame - gong.startFrame, gong.descriptor.frames);
      const saron = plan.voices.filter(
        (v) => v.descriptor.instrumentId === "saron-barung",
      );
      assert.equal(saron.length, 16);
      assert.ok(saron.every((v) => v.dampFrame !== null));
      assert.ok(instrumentGroups(p, r).length >= 5);
    }
  }
});
test("Combined tuning consent is explicit for audible legacy pitches; muted families and percussion need no consent, projects remain valid before playback", () => {
  const r = new InstrumentRegistry(c48000.banks),
    p = structuredClone(instrumentDemo("slendro-space", r));
  p.composition.patterns[0].notes[0] = { pitch: "d4", velocity: 0.3 };
  assert.doesNotThrow(() => validateInstrumentProject(p, r));
  assert.throws(
    () => takePlan(p, r, 48000),
    (e) => e.code === "tuningConsentRequired",
  );
  p.tuningConsent = true;
  assert.doesNotThrow(() => takePlan(p, r, 48000));
  p.tuningConsent = false;
  p.composition.instrument.mute = true;
  assert.doesNotThrow(() => takePlan(p, r, 48000));
  p.composition.patterns[0].steps.kick[0] = 0.3;
  assert.doesNotThrow(() => takePlan(p, r, 48000));
});
test("Combined optional fields have strict grammar and no silent old-schema expansion; solo/mute removes only audible planning, never event data", () => {
  const r = new InstrumentRegistry(c48000.banks),
    old = instrumentDemo("pelog-space", r);
  assert.equal(Object.hasOwn(old, "instrumentMix"), false);
  const p = structuredClone(old),
    groups = instrumentGroups(p, r);
  p.instrumentMix = [{ ...groups[0], solo: true }];
  const plan = takePlan(p, r, 48000);
  assert.ok(plan.voices.length > 0);
  assert.ok(
    plan.voices.every(
      (v) =>
        v.bankId === groups[0].bankId &&
        v.descriptor.instrumentId === groups[0].instrumentId,
    ),
  );
  assert.equal(plan.project.events.length, p.events.length);
  for (const change of [
    (p) => {
      p.tuningConsent = "yes";
    },
    (p) => {
      p.instrumentMix[0].pan = 2;
    },
    (p) => {
      p.instrumentMix.push({ ...p.instrumentMix[0] });
    },
    (p) => {
      p.instrumentMix[0].instrumentId = "unknown";
    },
    (p) => {
      p.instrumentMix[0].hidden = true;
    },
  ]) {
    const bad = structuredClone(p);
    change(bad);
    assert.throws(() => validateInstrumentProject(bad, r));
  }
});
test("Shared job-local mastering curve exactly matches preserved legacy Float32 output", () => {
  let shaper;
  const ctx = {
    createGain: () => ({ gain: {}, connect() {}, disconnect() {} }),
    createWaveShaper: () => (shaper = { connect() {}, disconnect() {} }),
  };
  const stage = legacyOutputStage(ctx, { connect() {} });
  for (let i = 0; i < 65537; i++)
    assert.equal(
      shaper.curve[i],
      Math.fround(beatboxOutputSample((i / 65536) * 2 - 1)),
    );
  assert.equal(shaper.oversample, "none");
  stage.dispose();
  assert.equal(shaper.curve, null);
});
