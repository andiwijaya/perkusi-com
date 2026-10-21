// C4 retained data/shared assertions; retired engine/UI scenarios separately archived.
import test from "node:test";
import assert from "node:assert/strict";
import { ResourceBudget } from "../src/audio/resource-budget.js";

test("S2 ResourceBudget native transition is atomic and counts only actual reserved native slots", () => {
  const b = new ResourceBudget({ maxBytes: 100 });
  for (let i = 0; i < 5; i++)
    b.reserve({ id: "p" + i, category: "decode", bytes: 10 });
  assert.equal(b.snapshot().native, 0);
  for (let i = 0; i < 4; i++) b.activateNative("p" + i);
  const before = b.snapshot();
  assert.throws(() => b.activateNative("p4"));
  assert.deepEqual(b.snapshot(), before);
  assert.throws(() => b.activateNative("p0"));
  b.reject("p0");
  b.activateNative("p4");
  for (let i = 1; i < 5; i++) b.reject("p" + i);
  assert.equal(b.snapshot().bytes, 0);
  assert.equal(b.snapshot().native, 0);
});
