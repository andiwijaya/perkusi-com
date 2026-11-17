import test from "node:test";
import assert from "node:assert/strict";
import { ProjectHistory } from "../src/project/studio-model.js";
import {
  newComposition,
  withPatternLoops,
} from "../src/project/composition-model.js";
import { compositionRegistry } from "../src/project/studio-registry.js";
import { validateProject } from "../src/project/schema.js";
const validate = (p) => validateProject(p, compositionRegistry);
function setup(limit = 60) {
  const p = withPatternLoops(newComposition("History original"));
  p.patterns[0].steps.kick[0] = 0.7;
  p.playback = { mode: "pattern", programmeGain: 2.75 };
  return new ProjectHistory(p, validate, limit);
}
test("history captures live mode and heard gain on the edit edge", () => {
  const h = setup(),
    live = structuredClone(h.current);
  live.playback = { mode: "chain", programmeGain: 4 };
  h.edit((p) => {
    p.patterns[0].steps.kick[0] = 0;
    p.playback = { mode: "chain" };
  }, live);
  assert(h.undo());
  assert.deepEqual(h.current, live);
  assert.equal(h.past.length, 0);
});
test("undo records a later calibrated score for exact redo", () => {
  const h = setup(),
    original = structuredClone(h.current);
  h.edit((p) => {
    p.timing.bpm = 120;
    delete p.playback.programmeGain;
  });
  const heard = structuredClone(h.current);
  heard.playback.programmeGain = 3.25;
  assert(h.undo(heard));
  assert.deepEqual(h.current, original);
  assert(h.redo());
  assert.deepEqual(h.current, heard);
});
test("redo records the actual live state for the next undo", () => {
  const h = setup();
  h.edit((p) => (p.master.volume = 0.2));
  h.undo();
  const live = structuredClone(h.current);
  live.playback = { mode: "chain", programmeGain: 5 };
  h.redo(live);
  h.undo();
  assert.deepEqual(h.current, live);
});
test("three-level undo and redo preserve each score and its own playback settings", () => {
  const h = setup(),
    states = [structuredClone(h.current)];
  for (let i = 1; i <= 3; i++) {
    h.edit((p) => {
      p.master.volume = 0.1 * i;
      p.playback = { mode: i % 2 ? "chain" : "pattern", programmeGain: i + 1 };
    });
    states.push(structuredClone(h.current));
  }
  const heard = structuredClone(h.current);
  heard.playback.programmeGain = 6;
  h.undo(heard);
  assert.deepEqual(h.current, states[2]);
  h.undo();
  assert.deepEqual(h.current, states[1]);
  h.undo();
  assert.deepEqual(h.current, states[0]);
  h.redo();
  assert.deepEqual(h.current, states[1]);
  h.redo();
  assert.deepEqual(h.current, states[2]);
  h.redo();
  assert.deepEqual(h.current, heard);
});
test("invalid live snapshots and invalid edits leave both history stacks intact", () => {
  const h = setup();
  h.edit((p) => (p.title = "Changed"));
  h.undo();
  const before = structuredClone({
      current: h.current,
      past: h.past,
      future: h.future,
    }),
    invalid = { ...h.current, playback: { mode: "pattern", programmeGain: 0 } };
  for (const action of [
    () => h.edit((p) => (p.title = "Bad"), invalid),
    () => h.redo(invalid),
    () => h.edit((p) => (p.chain = ["missing"]), h.current),
  ]) {
    assert.throws(action);
    assert.deepEqual(
      { current: h.current, past: h.past, future: h.future },
      before,
    );
  }
  h.redo();
  const withPast = structuredClone({
    current: h.current,
    past: h.past,
    future: h.future,
  });
  assert.throws(() => h.undo(invalid));
  assert.deepEqual(
    { current: h.current, past: h.past, future: h.future },
    withPast,
  );
});
test("a no-op compared with the live snapshot preserves redo and adds no entry", () => {
  const h = setup();
  h.edit((p) => (p.title = "Changed"));
  h.undo();
  const live = structuredClone(h.current);
  live.playback = { mode: "chain", programmeGain: 4 };
  assert.equal(
    h.edit(() => {}, live),
    false,
  );
  assert.equal(h.past.length, 0);
  assert.equal(h.future.length, 1);
});
test("captured snapshots do not alias caller data and branching stays bounded", () => {
  const h = setup(2),
    live = structuredClone(h.current),
    expected = structuredClone(live);
  h.edit((p) => (p.title = "First"), live);
  live.playback.programmeGain = 7;
  live.patterns[0].steps.kick[0] = 0;
  h.undo();
  assert.deepEqual(h.current, expected);
  h.edit((p) => (p.title = "New branch"), h.current);
  assert.equal(h.future.length, 0);
  for (let i = 0; i < 5; i++) h.edit((p) => (p.title = "Title " + i));
  assert.equal(h.past.length, 2);
});
