import test from "node:test";
import assert from "node:assert/strict";
import { RecordInputs } from "../src/loop-station/record-inputs.js";
import { HeldPadInputs } from "../src/gamelan/held-pad-inputs.js";
import { recordCopy } from "../src/loop-station/record-copy.js";
function source() {
  const events = [],
    held = new HeldPadInputs({
      activate: (id) => events.push(["start", id]),
      deactivate: (id) => events.push(["damp", id]),
    });
  return {
    events,
    press: (token, id) => held.press(token, id),
    release: (token) => held.release(token),
  };
}
test("physical key retains its source and pad across selected source/focus/locale replacement", () => {
  const inputs = new RecordInputs(),
    old = source(),
    next = source();
  assert.equal(inputs.press("key:KeyA", old, "note-a"), true);
  assert.equal(inputs.press("key:KeyA", next, "note-b"), false);
  inputs.release("key:KeyA");
  assert.deepEqual(old.events, [
    ["start", "note-a"],
    ["damp", "note-a"],
  ]);
  assert.deepEqual(next.events, []);
  inputs.press("key:KeyA", next, "note-b");
  inputs.clear();
  assert.deepEqual(next.events, [
    ["start", "note-b"],
    ["damp", "note-b"],
  ]);
});
test("keyboard/pointer same-pad owners release independently and cancellation clears all pads", () => {
  const inputs = new RecordInputs(),
    s = source();
  inputs.press("key:KeyA", s, "note-a");
  inputs.press("pointer:4", s, "note-a");
  inputs.press("pointer:5", s, "note-b");
  inputs.release("pointer:4");
  assert.deepEqual(s.events, [
    ["start", "note-a"],
    ["start", "note-b"],
  ]);
  inputs.clear();
  assert.deepEqual(s.events, [
    ["start", "note-a"],
    ["start", "note-b"],
    ["damp", "note-a"],
    ["damp", "note-b"],
  ]);
  assert.equal(inputs.held.size, 0);
});
test("failed release still attempts every other input and silences its failed producer", () => {
  const inputs = new RecordInputs(),
    s = source();
  let silenced = 0;
  const broken = {
    press: () => true,
    release: () => {
      throw Error("failed release");
    },
    silence: async () => {
      silenced++;
    },
  };
  inputs.press("pointer:1", broken, "a");
  inputs.press("pointer:2", s, "b");
  assert.throws(() => inputs.clear(), /failed release/);
  assert.equal(inputs.held.size, 0);
  assert.equal(silenced, 1);
  assert.deepEqual(s.events, [
    ["start", "b"],
    ["damp", "b"],
  ]);
});
test("record controls, states and action errors have complete ID/EN keys", () => {
  assert.deepEqual(Object.keys(recordCopy.id), Object.keys(recordCopy.en));
  for (const name of ["states", "errors"])
    assert.deepEqual(
      Object.keys(recordCopy.id[name]),
      Object.keys(recordCopy.en[name]),
    );
  for (const text of Object.values(recordCopy))
    for (const value of Object.values(text))
      if (typeof value === "string") assert.ok(value.trim());
});
