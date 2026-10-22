// Recovery schema assertions; retired playback/mix planning is no longer tested.
import test from "node:test";
import assert from "node:assert/strict";
import c44100 from "../internal/instrument-focus/registry-44100.json" with { type: "json" };
import c48000 from "../internal/instrument-focus/registry-48000.json" with { type: "json" };
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import {
  INSTRUMENT_DEMOS,
  instrumentDemo,
} from "./helpers/archived-gamelan-data.js";
import {
  parseInstrumentProject,
  validateInstrumentProject,
  PPQ,
} from "../src/project/instrument-project.js";
test("recovery retains all four demo originals, native banks, explicit damp events and complete JSON at both profiles", () => {
  assert.equal(INSTRUMENT_DEMOS.filter((d) => d.laras === "pelog").length, 2);
  assert.equal(INSTRUMENT_DEMOS.filter((d) => d.laras === "slendro").length, 2);
  for (const catalog of [c44100, c48000]) {
    const r = new InstrumentRegistry(catalog.banks);
    for (const d of INSTRUMENT_DEMOS) {
      const p = instrumentDemo(d.id, r),
        raw = JSON.stringify(p);
      assert.deepEqual(parseInstrumentProject(raw, r), p);
      assert.deepEqual(
        p.banks.map((b) => b.id).sort(),
        ["cdm-" + d.laras, "cdm-shared"].sort(),
      );
      assert.equal(p.clock.lengthTicks, 16 * PPQ);
      assert.equal(p.composition.chain.length, 4);
      assert(p.events.some((e) => e.action === "damp"));
      assert.equal(JSON.stringify(p), raw);
    }
  }
});
test("recovery consent and optional mix grammar are strict and never silently expand old documents", () => {
  const r = new InstrumentRegistry(c48000.banks),
    old = instrumentDemo("pelog-space", r);
  assert.equal(Object.hasOwn(old, "instrumentMix"), false);
  const p = structuredClone(old);
  p.instrumentMix = [
    {
      bankId: "cdm-pelog",
      instrumentId: "saron-barung",
      volume: 1,
      pan: 0,
      mute: false,
      solo: true,
    },
  ];
  p.tuningConsent = false;
  assert.deepEqual(validateInstrumentProject(p, r), p);
  const before = JSON.stringify(p);
  for (const change of [
    (v) => (v.tuningConsent = "yes"),
    (v) => (v.instrumentMix[0].pan = 2),
    (v) => v.instrumentMix.push({ ...v.instrumentMix[0] }),
    (v) => (v.instrumentMix[0].instrumentId = "unknown"),
    (v) => (v.instrumentMix[0].hidden = true),
  ]) {
    const bad = structuredClone(p);
    change(bad);
    assert.throws(() => validateInstrumentProject(bad, r));
    assert.equal(JSON.stringify(p), before);
  }
});
