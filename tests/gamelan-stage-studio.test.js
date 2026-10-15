import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import {
  CORPUS_INSTRUMENTS,
  physicalFocus,
  focusSelection,
  padLabel,
} from "../src/gamelan/instrument-focus.js";
import { InstrumentStudioBridge } from "../src/project/instrument-studio-bridge.js";
import {
  emptyInstrumentTake,
  appendInstrumentEvent,
  takePlan,
} from "../src/project/instrument-take.js";
import {
  parseInstrumentProject,
  PPQ,
} from "../src/project/instrument-project.js";
import { instrumentStudioMessages } from "../src/studio/instrument-messages.js";

const registry = (rate) =>
  new InstrumentRegistry(
    JSON.parse(
      readFileSync(
        new URL(
          `../internal/instrument-focus/registry-${rate}.json`,
          import.meta.url,
        ),
        "utf8",
      ),
    ).banks,
  );
function take(r) {
  let p = emptyInstrumentTake(r);
  for (const [id, bank, sample, tick, action, velocity] of [
    ["a", "cdm-pelog", "fs-261801", 0, "strike", 0.31],
    ["b", "cdm-pelog", "fs-261801", PPQ / 3, "damp", 0],
    ["c", "cdm-slendro", "fs-261894", PPQ, "strike", 0.51],
    ["d", "cdm-shared", "fs-261992", PPQ * 2, "strike", 0.41],
  ])
    p = appendInstrumentEvent(p, r, {
      id,
      bankId: bank,
      version: "candidate-1.0.0",
      sampleId: sample,
      tick,
      action,
      velocity,
    });
  return p;
}
test("S3 stage has 12 named physical focuses in both laras/profiles, all101 sources represented without transposition", () => {
  assert.equal(CORPUS_INSTRUMENTS.length, 12);
  for (const rate of [44100, 48000]) {
    const r = registry(rate),
      ids = new Set();
    for (const instrument of CORPUS_INSTRUMENTS)
      for (const laras of ["pelog", "slendro"]) {
        const notes = physicalFocus(r, instrument, laras);
        assert.ok(notes.length);
        for (const { bank, descriptor } of notes) {
          ids.add(descriptor.sourceWorkId);
          assert.equal(descriptor.sampleRate, rate);
          assert.equal(descriptor.instrumentId, instrument);
          assert.equal(
            bank.laras,
            ["gong-ageng", "kendhang-ciblon"].includes(instrument)
              ? "shared"
              : laras,
          );
        }
      }
    assert.equal(ids.size, 101);
    assert.deepEqual(
      physicalFocus(r, "bonang-barung", "slendro").map(
        (n) => n.descriptor.pitchId,
      ),
      ["degree-1", "degree-2", "degree-3", "degree-5", "degree-6"],
    );
    for (const name of ["kempul", "kenong"])
      assert.equal(
        physicalFocus(r, name, "pelog").some(
          (n) => n.descriptor.pitchId === "degree-4",
        ),
        false,
      );
    assert.deepEqual(
      physicalFocus(r, "gong-ageng", "pelog"),
      physicalFocus(r, "gong-ageng", "slendro"),
    );
    assert.equal(
      new Set(
        physicalFocus(r, "kendhang-ciblon", "pelog").map(
          (n) => n.descriptor.articulation,
        ),
      ).size,
      2,
    );
  }
});
test("S3 focus selection deduplicates ensemble sources and complete cold admission fits accepted64MiB", () => {
  for (const rate of [44100, 48000])
    for (const instrument of CORPUS_INSTRUMENTS)
      for (const laras of ["pelog", "slendro"]) {
        const notes = focusSelection(registry(rate), {
          instrument,
          laras,
          ensemble: true,
        });
        assert.equal(
          new Set(notes.map((n) => n.bank.id + "/" + n.descriptor.id)).size,
          notes.length,
        );
        let resident = 524288;
        for (const { descriptor: d } of notes) {
          const decoded = d.frames * d.channels * 4;
          assert.ok(
            resident + d.encodedBytes + Math.max(d.encodedBytes, decoded) <=
              67108864,
            `${rate}/${instrument}/${laras}`,
          );
          resident += decoded;
        }
        assert.ok(resident <= 67108864);
      }
});
test("S3 untuned stroke labels expose Tak/Thung/Gong rather than invented degrees", () => {
  assert.equal(
    padLabel({
      instrument: "kendhang-ciblon",
      pitch: "untuned",
      articulation: "recorded-tak",
    }),
    "Tak",
  );
  assert.equal(
    padLabel({
      instrument: "gong-ageng",
      pitch: "untuned",
      articulation: "recorded-strike",
    }),
    "Gong",
  );
  assert.equal(
    padLabel({
      instrument: "bonang-barung",
      pitch: "degree-5",
      articulation: "recorded-strike",
    }),
    "5",
  );
});
test("S3 recorded multi-laras events enter Studio and return losslessly including origin/banks/tails/file roundtrip", () => {
  for (const rate of [44100, 48000]) {
    const r = registry(rate),
      p = take(r),
      bridge = new InstrumentStudioBridge(p, r, () => {});
    assert.deepEqual(bridge.toFocus(), p);
    assert.deepEqual(parseInstrumentProject(bridge.toJSON(), r), p);
    assert.equal(bridge.project.origin.text, p.origin.text);
    assert.deepEqual(takePlan(bridge.toFocus(), r, rate), takePlan(p, r, rate));
  }
});
test("S3 Studio position/velocity edit, delete, undo/redo preserve every other event and reject collisions atomically", () => {
  const r = registry(48000),
    p = take(r);
  let committed = p;
  const bridge = new InstrumentStudioBridge(p, r, (next) => (committed = next));
  bridge.editEvent("a", { tick: PPQ / 4, velocity: 0.7 });
  assert.equal(committed.events.find((e) => e.id === "a").velocity, 0.7);
  assert.deepEqual(
    committed.events.filter((e) => e.id !== "a"),
    p.events.filter((e) => e.id !== "a"),
  );
  assert.equal(bridge.undo(), true);
  assert.deepEqual(committed, p);
  assert.equal(bridge.redo(), true);
  bridge.deleteEvent("b");
  assert.equal(
    committed.events.some((e) => e.id === "b"),
    false,
  );
  bridge.undo();
  assert.ok(committed.events.some((e) => e.id === "b"));
  const before = bridge.toJSON();
  assert.throws(
    () => bridge.editEvent("b", { tick: PPQ / 4, velocity: 0.3 }),
    (e) => e.code === "invalidStudioEdit",
  );
  assert.equal(bridge.toJSON(), before);
  assert.throws(() => bridge.editEvent("a", { tick: -1, velocity: 0.3 }));
  assert.equal(bridge.toJSON(), before);
});
test("S3 Studio failed session commit leaves project and undo state untouched", () => {
  const r = registry(48000),
    p = take(r),
    bridge = new InstrumentStudioBridge(p, r, () => {
      throw Error("QA refused");
    });
  assert.throws(() => bridge.editEvent("a", { tick: PPQ / 4, velocity: 0.7 }));
  assert.deepEqual(bridge.project, p);
  assert.equal(bridge.canUndo, false);
});
test("S3 Studio extension has full ID/EN key parity", () => {
  assert.deepEqual(
    Object.keys(instrumentStudioMessages.id).sort(),
    Object.keys(instrumentStudioMessages.en).sort(),
  );
});
test("S3 Studio collision fails atomically and combined legacy layers retain the score", () => {
  const r = registry(48000),
    p = structuredClone(take(r));
  p.events.push({ ...p.events[0], id: "collision", tick: PPQ / 2 });
  let commits = 0;
  const bridge = new InstrumentStudioBridge(p, r, () => commits++),
    before = bridge.toJSON();
  assert.throws(
    () => bridge.editEvent("a", { tick: PPQ / 2, velocity: 0.3 }),
    (e) => e.code === "invalidInstrumentProject",
  );
  assert.equal(bridge.toJSON(), before);
  assert.equal(commits, 0);
  assert.equal(bridge.canUndo, false);
  const nonempty = structuredClone(take(r));
  nonempty.composition.patterns[0].steps.kick[0] = 0.5;
  const combined = new InstrumentStudioBridge(nonempty, r, () => {});
  assert.deepEqual(combined.project.composition, nonempty.composition);
  assert.deepEqual(combined.project.events, nonempty.events);
});
test("S3 Studio history obeys encoded2MiB admission without deleting the last accepted edit", () => {
  const r = registry(48000),
    p = structuredClone(emptyInstrumentTake(r));
  p.banks = [{ id: "cdm-pelog", version: "candidate-1.0.0" }];
  p.events = Array.from({ length: 4000 }, (_, i) => ({
    id: "large-" + i,
    tick: i * 2,
    bankId: "cdm-pelog",
    sampleId: "fs-261801",
    action: i % 2 ? "damp" : "strike",
    velocity: i % 2 ? 0 : 0.2,
  }));
  let committed;
  const bridge = new InstrumentStudioBridge(p, r, (next) => (committed = next));
  let refused = false;
  for (let i = 0; i < 16; i++) {
    const before = bridge.toJSON(),
      published = committed;
    try {
      bridge.editEvent("large-0", { tick: 0, velocity: 0.3 + i * 0.01 });
    } catch (e) {
      assert.equal(e.code, "studioHistoryLimit");
      assert.equal(bridge.toJSON(), before);
      assert.equal(committed, published);
      refused = true;
      break;
    }
  }
  assert.equal(refused, true);
  assert.equal(bridge.canUndo, true);
});
