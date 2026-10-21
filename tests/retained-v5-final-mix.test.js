// Retained shared/data assertions extracted before failed-feature retirement.
import test from "node:test";
import assert from "node:assert/strict";
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import catalog from "../internal/instrument-focus/registry-48000.json" with { type: "json" };
import { emptyLoopFixture } from "./helpers/retirement-data-fixtures.js";
import { validateLoopProject } from "../src/loop-station/project.js";
import {
  FLAT_EQ,
  BYPASS_LIMITER,
  eqBound,
  eqGains,
  hasEQ,
  fxTailFrames,
} from "../src/loop-station/fx-model.js";

const registry = new InstrumentRegistry(catalog.banks);

test("FX schema is additive, strict and preserves missing/default bypass parity", () => {
  const old = emptyLoopFixture();
  assert.deepEqual(validateLoopProject(old, registry), old);
  assert.equal(hasEQ(), false);
  assert.equal(eqBound(), 1);
  assert.equal(fxTailFrames(old, 48000), 0);
  const p = structuredClone(old);
  p.master.limiter = { ...BYPASS_LIMITER };
  p.tracks[0].eq = { ...FLAT_EQ, bypass: false };
  assert.deepEqual(validateLoopProject(p, registry), p);
  assert.equal(hasEQ(p.tracks[0].eq), false);
  for (const change of [
    (p) => (p.tracks[0].eq.lowDb = 7),
    (p) => (p.tracks[0].eq.version = 2),
    (p) => (p.master.limiter.kind = "lookahead"),
    (p) => (p.tracks[0].eq.feedback = 1),
  ]) {
    const n = structuredClone(p);
    change(n);
    assert.throws(() => validateLoopProject(n, registry));
  }
});

test("stable crossover impulse bound covers worst signed input and decays below threshold within declared100ms tail", () => {
  for (const rate of [44100, 48000])
    for (const lowDb of [-6, 0, 6])
      for (const midDb of [-6, 0, 6])
        for (const highDb of [-6, 0, 6]) {
          const eq = { version: 1, bypass: false, lowDb, midDb, highDb },
            g = eqGains(eq),
            bound = eqBound(eq),
            lo = Math.exp((-2 * Math.PI * 200) / rate),
            hi = Math.exp((-2 * Math.PI * 3000) / rate);
          let a = 0,
            b = 0,
            last = 0;
          for (let f = 0; f < 512 + Math.ceil(0.1 * rate); f++) {
            const x = f < 512 ? (f % 11 < 5 ? 0.2 : -0.2) : 0;
            a = (1 - lo) * x + lo * a;
            b = (1 - hi) * x + hi * b;
            last = g.high * x + g.upper * b + g.lower * a;
            assert.ok(Math.abs(last) <= bound * 0.2 + 1e-12);
          }
          assert.ok(Math.abs(last) < 1e-6);
        }
});
