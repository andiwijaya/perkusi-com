// Recovery metadata contracts retained after playback tooling retirement.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import { newComposition } from "../src/project/composition-model.js";
import {
  migrateToInstrumentProject,
  validateInstrumentProject,
  parseInstrumentProject,
  eventFrame,
  PPQ,
} from "../src/project/instrument-project.js";
const sha = (i) =>
  createHash("sha256").update(new Uint8Array(32).fill(i)).digest("hex");
const bank = {
  id: "qa",
  version: "1",
  kind: "instrument-bank",
  setId: "qa",
  tradition: "qa",
  laras: "none",
  samples: [1, 2].map((i) => ({
    id: "s" + i,
    instrumentId: "qa",
    pitchId: "p" + i,
    articulation: "strike",
    assetPath: "/sounds/s" + i + ".wav",
    sha256: sha(i),
    sourceWorkId: "qa" + i,
    licenseId: "qa",
    encodedBytes: 32,
    sampleRate: 48000,
    channels: 1,
    frames: 8,
    gainTrim: 1,
    voicePolicy: "polyphonic",
  })),
};
const registry = new InstrumentRegistry([bank]);
function specimen() {
  const composition = newComposition("Original recovery");
  composition.timing.bpm = 96;
  const p = structuredClone(
    migrateToInstrumentProject(JSON.stringify(composition), registry),
  );
  p.banks = [{ id: "qa", version: "1" }];
  return p;
}
test("recovery preserves exact origin, off-grid event/damp ticks and immutable sample geometry", () => {
  const p = specimen(),
    original = p.origin.text;
  p.events = [
    { id: "a", tick: 0, sampleId: "s1", action: "strike", velocity: 0.7 },
    { id: "b", tick: PPQ / 4, sampleId: "s1", action: "damp", velocity: 0 },
    { id: "c", tick: PPQ / 2, sampleId: "s2", action: "strike", velocity: 1 },
  ].map((e) => ({ ...e, bankId: "qa" }));
  const raw = JSON.stringify(p),
    parsed = parseInstrumentProject(raw, registry);
  assert.deepEqual(parsed, p);
  assert.equal(parsed.origin.text, original);
  assert.deepEqual(parsed.events, p.events);
  assert.equal(eventFrame(parsed.events[2].tick, 96, 48000), 15000);
  assert.equal(registry.sample("qa", "1", "s2").frames, 8);
  assert.equal(JSON.stringify(p), raw);
});
test("recovery retains distinct adjacent event ticks and rejects collisions without rewriting originals", () => {
  const p = specimen();
  p.events = [0, 1].map((tick, i) => ({
    id: "e" + i,
    tick,
    bankId: "qa",
    sampleId: "s1",
    action: "strike",
    velocity: 1,
  }));
  const raw = JSON.stringify(p);
  assert.deepEqual(
    parseInstrumentProject(raw, registry).events.map((e) => e.tick),
    [0, 1],
  );
  const invalid = structuredClone(p);
  invalid.events[1].tick = 0;
  assert.throws(() => validateInstrumentProject(invalid, registry));
  assert.equal(JSON.stringify(p), raw);
});
