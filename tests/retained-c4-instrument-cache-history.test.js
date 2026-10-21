// C4 retained data/shared assertions; retired engine/UI scenarios separately archived.
import test from "node:test";
import assert from "node:assert/strict";
import { ResourceBudget } from "../src/audio/resource-budget.js";
const code = (expected) => (error) => error.code === expected;
test("S2 monotonic ledger bounded history rejects reuse without pruning pending native or foreign pins", () => {
  const b = new ResourceBudget({ maxBytes: 128, historyPolicy: "monotonic" });
  b.reserve({ id: "allocation-1", bytes: 32, category: "cache" });
  b.pin("allocation-1", "foreign");
  b.reserve({
    id: "allocation-2",
    bytes: 32,
    category: "decode",
    native: true,
  });
  b.cancel("allocation-2");
  for (let i = 3; i <= 10000; i++) {
    const id = "allocation-" + i;
    b.reserve({ id, bytes: 1, category: "encoder" });
    b.release(id);
  }
  assert.equal(b.snapshot().history.storedIds, 0);
  assert.equal(b.snapshot().history.sequenceFloor, 10000);
  assert.equal(b.snapshot().allocations.length, 2);
  assert.equal(b.snapshot().bytes, 64);
  assert.deepEqual(b.revalidate("allocation-1", 32).pins, ["foreign"]);
  for (const id of [
    "allocation-2",
    "allocation-3",
    "allocation-9999",
    "allocation-010001",
    "allocation-9007199254740992",
    "other",
  ])
    assert.throws(
      () => b.reserve({ id, bytes: 1, category: "encoder" }),
      code("invalidAllocation"),
    );
  let discards = 0;
  assert.equal(
    b.settle("allocation-2", 32, "cache", { discard: () => discards++ }),
    false,
  );
  assert.equal(discards, 1);
  assert.throws(() =>
    b.settle("allocation-2", 32, "cache", { discard: () => discards++ }),
  );
  assert.equal(discards, 1);
  assert.throws(() => b.release("allocation-1"), code("allocationHeld"));
  b.unpin("allocation-1", "foreign");
  b.release("allocation-1");
  assert.throws(() =>
    b.reserve({ id: "allocation-2", bytes: 1, category: "encoder" }),
  );
  b.reserve({ id: "allocation-10001", bytes: 1, category: "cache" });
  b.release("allocation-10001");
  assert.equal(b.snapshot().bytes, 0);
  const last = new ResourceBudget({ historyPolicy: "monotonic" });
  last.reserve({
    id: "allocation-9007199254740991",
    bytes: 1,
    category: "cache",
  });
  assert.throws(() =>
    last.reserve({
      id: "allocation-9007199254740992",
      bytes: 1,
      category: "cache",
    }),
  );
});
test("S1 default lifetime bound remains4096 and cannot reuse terminal allocation IDs", () => {
  const b = new ResourceBudget({ maxBytes: 16 });
  for (let i = 0; i < 4096; i++) {
    b.reserve({ id: "legacy-" + i, bytes: 1, category: "cache" });
    b.release("legacy-" + i);
  }
  assert.equal(b.snapshot().history.policy, "lifetime");
  assert.equal(b.snapshot().history.storedIds, 4096);
  assert.throws(() =>
    b.reserve({ id: "legacy-4096", bytes: 1, category: "cache" }),
  );
  assert.throws(() =>
    b.reserve({ id: "legacy-0", bytes: 1, category: "cache" }),
  );
  assert.equal(b.snapshot().bytes, 0);
});
test("S2 monotonic history also caps live records4096 without losing old pinned allocations", () => {
  const b = new ResourceBudget({ maxBytes: 8192, historyPolicy: "monotonic" });
  for (let i = 1; i <= 4096; i++)
    b.reserve({ id: "allocation-" + i, bytes: 1, category: "cache" });
  b.pin("allocation-1", "foreign");
  const before = b.snapshot();
  assert.throws(() =>
    b.reserve({ id: "allocation-4097", bytes: 1, category: "cache" }),
  );
  assert.deepEqual(b.snapshot(), before);
  b.release("allocation-2");
  b.reserve({ id: "allocation-4097", bytes: 1, category: "cache" });
  assert.deepEqual(b.revalidate("allocation-1", 1).pins, ["foreign"]);
  assert.equal(b.snapshot().allocations.length, 4096);
  b.unpin("allocation-1", "foreign");
  for (const allocation of b.snapshot().allocations) b.release(allocation.id);
  assert.equal(b.snapshot().bytes, 0);
});
