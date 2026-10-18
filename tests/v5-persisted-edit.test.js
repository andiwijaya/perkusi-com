import test from "node:test";
import assert from "node:assert/strict";
import { commitLoopEdit } from "../src/loop-station/persisted-edit.js";
import { LoopHistory, emptyLoopProject } from "../src/loop-station/model.js";
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
const fixture = () => {
  const registry = new InstrumentRegistry(),
    history = new LoopHistory(emptyLoopProject(registry), registry),
    previous = history.project,
    candidate = structuredClone(previous);
  candidate.tracks[0].gain = 0.5;
  return { history, previous, candidate };
};
test("durable history waits for storage acknowledgement, keeping undo/redo unchanged while pending", async () => {
  const f = fixture();
  let ack;
  const gate = new Promise((r) => (ack = r)),
    run = commitLoopEdit({ ...f, save: () => gate });
  assert.equal(f.history.project, f.previous);
  assert.equal(f.history.undoStack.length, 0);
  ack();
  await run;
  assert.equal(f.history.project.tracks[0].gain, 0.5);
  assert.deepEqual(f.history.undoStack, [f.previous]);
});
test("storage refusal leaves the current project, undo and redo exactly intact", async () => {
  const f = fixture(),
    error = Object.assign(Error("native abort"), {
      code: "audioStorageWriteFailed",
    });
  f.history.redoStack.push(f.candidate);
  const redo = [...f.history.redoStack];
  await assert.rejects(
    commitLoopEdit({
      ...f,
      save: async () => {
        throw error;
      },
    }),
    (e) => e === error,
  );
  assert.equal(f.history.project, f.previous);
  assert.equal(f.history.undoStack.length, 0);
  assert.deepEqual(f.history.redoStack, redo);
});
test("failed save restores an applied live mix preview before rejecting history publication", async () => {
  const f = fixture(),
    values = [],
    error = Error("storage refused");
  let audible = f.previous;
  await assert.rejects(
    commitLoopEdit({
      ...f,
      save: async () => {
        throw error;
      },
      preview: (p) => {
        values.push(p.tracks[0].gain);
        audible = p;
      },
      onRollbackFailure: () => assert.fail("rollback should succeed"),
    }),
    (e) => e === error,
  );
  assert.deepEqual(values, [0.5, f.previous.tracks[0].gain]);
  assert.equal(audible, f.previous);
  assert.equal(f.history.project, f.previous);
});
test("rollback refusal enters the caller capture-first fault boundary and preserves the original storage failure", async () => {
  const f = fixture(),
    storage = Error("storage failed"),
    rollback = Error("mix deadline"),
    faults = [];
  let calls = 0;
  await assert.rejects(
    commitLoopEdit({
      ...f,
      save: async () => {
        throw storage;
      },
      preview: () => {
        if (++calls === 2) throw rollback;
      },
      onRollbackFailure: (e) => faults.push(e),
    }),
    (e) => e === storage,
  );
  assert.deepEqual(faults, [rollback]);
  assert.equal(f.history.project, f.previous);
  assert.equal(f.history.undoStack.length, 0);
});
test("mix admission refusal occurs before storage or history mutation", async () => {
  const f = fixture();
  let saves = 0;
  await assert.rejects(
    commitLoopEdit({
      ...f,
      preview: () => {
        throw Error("voiceHeadroom");
      },
      save: async () => saves++,
    }),
    /voiceHeadroom/,
  );
  assert.equal(saves, 0);
  assert.equal(f.history.project, f.previous);
});
test("legacy unsaved-only policy must be explicit and remains separate from durable refusal", async () => {
  const f = fixture(),
    error = Object.assign(Error("local draft refused"), {
      code: "routeConflict",
    });
  let unsaved = null;
  await commitLoopEdit({
    ...f,
    save: async () => {
      throw error;
    },
    allowUnsaved: (e) => e.code === "routeConflict",
    onUnsaved: (e) => (unsaved = e),
  });
  assert.equal(unsaved, error);
  assert.equal(f.history.project.tracks[0].gain, 0.5);
});
