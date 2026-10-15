import test from "node:test";
import assert from "node:assert/strict";
import c44100 from "../internal/instrument-focus/registry-44100.json" with { type: "json" };
import c48000 from "../internal/instrument-focus/registry-48000.json" with { type: "json" };
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import {
  INSTRUMENT_DEMOS,
  instrumentDemo,
} from "../src/gamelan/instrument-demos.js";
import { InstrumentStudioBridge } from "../src/project/instrument-studio-bridge.js";
import { takePlan } from "../src/project/instrument-take.js";
import { groupMix, instrumentGroups } from "../src/project/instrument-mix.js";
import {
  parseInstrumentProject,
  validateInstrumentProject,
  PPQ,
} from "../src/project/instrument-project.js";
import { combinedMessages } from "../src/studio/instrument-composition-panel.js";
import { legacyOutputStage } from "../src/audio/legacy-bus.js";
import { beatboxOutputSample } from "../src/beatbox/output-stage.js";
import { editCompositionClip } from "../src/project/composition-model.js";

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
test("Combined score/event/group atomic history, exact origin retention and sample bank versions survive undo/redo and save/open", () => {
  const r = new InstrumentRegistry(c48000.banks),
    p = instrumentDemo("pelog-space", r);
  let saved;
  const bridge = new InstrumentStudioBridge(p, r, (v) => {
    saved = v;
  });
  bridge.editComposition((p) => {
    p.patterns[0].steps.kick[0] = 0.4;
    p.tracks[0].pan = -0.5;
    p.master.volume = 0.3;
  });
  bridge.editEvent(p.events[0].id, { tick: p.events[0].tick, velocity: 0.2 });
  const g = instrumentGroups(bridge.project, r)[0];
  bridge.editGroup({ ...g, mute: true, pan: 0.5 });
  const mixed = bridge.project;
  assert.deepEqual(saved, mixed);
  assert.equal(mixed.origin.text, p.origin.text);
  assert.equal(groupMix(mixed, r, g.bankId, g.instrumentId).volume, 0);
  assert.deepEqual(parseInstrumentProject(bridge.toJSON(), r), mixed);
  bridge.undo();
  bridge.undo();
  bridge.undo();
  assert.deepEqual(bridge.project, p);
  bridge.redo();
  bridge.redo();
  bridge.redo();
  assert.deepEqual(bridge.project, mixed);
  const before = bridge.toJSON();
  assert.throws(() =>
    bridge.editComposition((p) => {
      p.timing.bpm = 500;
    }),
  );
  assert.equal(bridge.toJSON(), before);
  bridge.loadProject(instrumentDemo("slendro-response", r));
  bridge.undo();
  assert.deepEqual(bridge.project, mixed);
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
test("Combined job-local mastering curve exactly matches the preserved legacy Float32 curve and ID/EN UI keys match", () => {
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
  assert.deepEqual(
    Object.keys(combinedMessages.id).sort(),
    Object.keys(combinedMessages.en).sort(),
  );
});

test("Combined Bilah strengths use the existing positive finite domain and invalid edits preserve source/history", () => {
  const r = new InstrumentRegistry(c48000.banks),
    p = instrumentDemo("pelog-space", r);
  const bridge = new InstrumentStudioBridge(p, r, () => {});
  for (const velocity of [
    0.5,
    0.75,
    1,
    0.51,
    0.01,
    0.001,
    0.33333333,
    Number.MIN_VALUE,
  ]) {
    bridge.editComposition((p) => {
      p.patterns[0].notes[0] = { pitch: "f4", velocity };
    });
    assert.equal(
      bridge.project.composition.patterns[0].notes[0].velocity,
      velocity,
    );
    assert.equal(
      parseInstrumentProject(bridge.toJSON(), r).composition.patterns[0]
        .notes[0].velocity,
      velocity,
    );
  }
  const before = bridge.toJSON(),
    undo = bridge.canUndo,
    redo = bridge.canRedo;
  for (const velocity of [
    0,
    -0,
    -0.01,
    1.001,
    NaN,
    Infinity,
    -Infinity,
    "",
    "0.5",
    null,
  ]) {
    assert.throws(() =>
      bridge.editComposition((p) => {
        p.patterns[0].notes[0].velocity = velocity;
      }),
    );
    assert.equal(bridge.toJSON(), before);
    assert.equal(bridge.canUndo, undo);
    assert.equal(bridge.canRedo, redo);
  }
  bridge.undo();
  assert.equal(
    bridge.project.composition.patterns[0].notes[0].velocity,
    0.33333333,
  );
  bridge.redo();
  assert.equal(bridge.toJSON(), before);
});

test("Combined adjacent number domains accept finite off-lattice values without widening schema bounds", () => {
  const r = new InstrumentRegistry(c48000.banks),
    bridge = new InstrumentStudioBridge(
      instrumentDemo("pelog-space", r),
      r,
      () => {},
    );
  bridge.editComposition((p) => {
    p.master.volume = 0.28;
    p.timing.bpm = 124.5;
    p.timing.swing = 0.16;
    p.tracks[0].volume = 0.731;
    p.tracks[0].pan = -0.123;
    p.instrument.volume = 0.271;
    p.instrument.pan = 0.337;
    editCompositionClip(p, "hat", "volume", 0.283);
    editCompositionClip(p, "hat", "pan", -0.317);
  });
  const g = instrumentGroups(bridge.project, r)[0];
  bridge.editGroup({ ...g, volume: 0.733, pan: 0.319 });
  const before = bridge.toJSON();
  assert.deepEqual(parseInstrumentProject(before, r), bridge.project);
  for (const change of [
    (p) => {
      p.master.volume = 0.751;
    },
    (p) => {
      p.timing.bpm = 180.001;
    },
    (p) => {
      p.timing.swing = 0.501;
    },
    (p) => {
      p.tracks[0].volume = -0.001;
    },
    (p) => {
      p.instrument.pan = 1.001;
    },
  ]) {
    assert.throws(() => bridge.editComposition(change));
    assert.equal(bridge.toJSON(), before);
  }
});
