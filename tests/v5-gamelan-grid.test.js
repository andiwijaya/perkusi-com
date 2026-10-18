import test from "node:test";
import assert from "node:assert/strict";
import catalog from "../internal/instrument-focus/registry-48000.json" with { type: "json" };
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import { instrumentDemo } from "../src/gamelan/instrument-demos.js";
import { physicalFocus } from "../src/gamelan/instrument-focus.js";
import { InstrumentStudioBridge } from "../src/project/instrument-studio-bridge.js";
import {
  validateInstrumentProject,
  MAX_EVENT_TICK,
} from "../src/project/instrument-project.js";
import { emptyInstrumentTake } from "../src/project/instrument-take.js";
import {
  toggleGamelanStep,
  appendGamelanBar,
  gamelanBarCount,
  GAMELAN_BAR_TICKS,
} from "../src/project/gamelan-grid.js";

const registry = new InstrumentRegistry(catalog.banks);
const note = physicalFocus(registry, "saron-barung", "pelog")[0];
const spec = {
  bankId: note.bank.id,
  version: note.bank.version,
  sampleId: note.descriptor.id,
  bar: 0,
  step: 0,
};
test("grid adds a separate Pelog note without quantizing or rewriting a complete Slendro demo", () => {
  const original = instrumentDemo("slendro-space", registry),
    text = JSON.stringify(original),
    next = toggleGamelanStep(original, registry, spec);
  assert.equal(JSON.stringify(original), text);
  assert.equal(next.events.length, original.events.length + 1);
  for (const event of original.events)
    assert.deepEqual(
      next.events.find((e) => e.id === event.id),
      event,
    );
  assert.deepEqual(next.composition, original.composition);
  assert.deepEqual(next.origin, original.origin);
  assert.deepEqual(next.clock, original.clock);
  const removed = toggleGamelanStep(next, registry, spec);
  assert.deepEqual(removed.events, original.events);
  assert.ok(
    removed.banks.some((b) => b.id === note.bank.id),
    "do not strip preserved bank metadata automatically",
  );
});
test("exact cell toggles preserve a human hit one tick away and order explicit damp before strike", () => {
  let base = structuredClone(emptyInstrumentTake(registry));
  base.banks = [{ id: note.bank.id, version: note.bank.version }];
  base.events = [
    {
      id: "human",
      tick: 1,
      action: "strike",
      bankId: note.bank.id,
      sampleId: note.descriptor.id,
      velocity: 0.4,
    },
  ];
  base = validateInstrumentProject(base, registry);
  const a = toggleGamelanStep(base, registry, spec),
    b = toggleGamelanStep(a, registry, { ...spec, action: "damp" });
  assert.deepEqual(
    b.events.filter((e) => e.tick === 0).map((e) => [e.action, e.velocity]),
    [
      ["damp", 0],
      ["strike", 0.65],
    ],
  );
  const c = toggleGamelanStep(b, registry, spec);
  assert.deepEqual(
    c.events.find((e) => e.id === "human"),
    base.events[0],
  );
  assert.ok(c.events.some((e) => e.action === "damp"));
  assert.equal(c.events.filter((e) => e.action === "strike").length, 1);
});
test("bar extension and last legal cell keep imported data and enforce the unchanged length bound", () => {
  const base = instrumentDemo("pelog-space", registry),
    next = appendGamelanBar(base, registry);
  assert.equal(gamelanBarCount(next), 5);
  assert.deepEqual(next.events, base.events);
  assert.deepEqual(next.composition, base.composition);
  const last = toggleGamelanStep(base, registry, {
    ...spec,
    bar: 127,
    step: 15,
  });
  assert.equal(last.clock.lengthTicks, MAX_EVENT_TICK);
  assert.equal(gamelanBarCount(last), 128);
  assert.throws(() => appendGamelanBar(last, registry));
  assert.throws(() => toggleGamelanStep(last, registry, { ...spec, bar: 128 }));
  assert.equal(base.clock.lengthTicks, 4 * GAMELAN_BAR_TICKS);
});
test("invalid grid commands and failed session admission preserve original project and undo/redo", () => {
  const base = instrumentDemo("pelog-space", registry),
    text = JSON.stringify(base);
  let refuse = true;
  const bridge = new InstrumentStudioBridge(base, registry, () => {
    if (refuse) throw Error("admission");
  });
  for (const change of [
    { step: 16 },
    { step: 0.5 },
    { velocity: 0 },
    { velocity: NaN },
    { action: "retune" },
    { sampleId: "unknown" },
  ])
    assert.throws(() =>
      toggleGamelanStep(base, registry, { ...spec, ...change }),
    );
  assert.throws(() =>
    bridge.loadProject(toggleGamelanStep(base, registry, { ...spec, bar: 4 })),
  );
  assert.equal(bridge.canUndo, false);
  assert.equal(JSON.stringify(bridge.project), text);
  refuse = false;
  bridge.loadProject(toggleGamelanStep(base, registry, { ...spec, bar: 4 }));
  const edited = bridge.toJSON();
  assert.equal(bridge.canUndo, true);
  bridge.undo();
  assert.equal(JSON.stringify(bridge.project), text);
  bridge.redo();
  assert.equal(bridge.toJSON(), edited);
  assert.equal(JSON.stringify(base), text);
});
