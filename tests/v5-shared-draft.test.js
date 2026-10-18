import test from "node:test";
import assert from "node:assert/strict";
import { SharedLoopDraft } from "../src/loop-station/shared-draft.js";
function setup(initial = "original") {
  const values = new Map(initial === null ? [] : [["draft", initial]]),
    writes = [];
  const storage = {
    getItem: (k) => values.get(k) ?? null,
    setItem(k, v) {
      writes.push([k, v]);
      values.set(k, v);
    },
  };
  let queue = Promise.resolve();
  const locks = {
    request(key, fn) {
      assert.equal(key, "draft");
      const op = queue.then(fn);
      queue = op.catch(() => {});
      return op;
    },
  };
  return {
    values,
    writes,
    storage,
    locks,
    tab(expected = initial) {
      return new SharedLoopDraft({
        key: "draft",
        storage: () => storage,
        locks,
        expected,
      });
    },
  };
}
test("serialized stale writers preserve the newer raw document and their expected snapshot", async () => {
  const f = setup(),
    a = f.tab(),
    b = f.tab();
  await a.write("newer-a");
  await assert.rejects(b.write("stale-b"), { code: "draftConflict" });
  assert.equal(f.storage.getItem("draft"), "newer-a");
  assert.equal(b.expected, "original");
  assert.equal(b.read(), "newer-a");
  b.adopt(b.read());
  await b.write("explicit-next-edit");
  assert.equal(f.storage.getItem("draft"), "explicit-next-edit");
});
test("simultaneous same-baseline writers cannot both pass the comparison", async () => {
  const f = setup(),
    a = f.tab(),
    b = f.tab(),
    out = await Promise.allSettled([a.write("a"), b.write("b")]);
  assert.equal(out[0].status, "fulfilled");
  assert.equal(out[1].reason.code, "draftConflict");
  assert.deepEqual(f.writes, [["draft", "a"]]);
});
test("stale corrupt-draft recovery never overwrites the newer draft or its backup", async () => {
  const f = setup("{broken"),
    old = f.tab();
  f.values.set("draft", "newer-valid");
  f.values.set("draft.recovery", "existing-backup");
  await assert.rejects(old.write("empty", { backup: "{broken" }), {
    code: "draftConflict",
  });
  assert.equal(f.storage.getItem("draft"), "newer-valid");
  assert.equal(f.storage.getItem("draft.recovery"), "existing-backup");
  assert.equal(f.writes.length, 0);
});
test("quota, blocked reads and missing locks do not advance ownership or silently write", async () => {
  const f = setup(),
    a = f.tab();
  f.storage.setItem = () => {
    throw Error("quota");
  };
  await assert.rejects(a.write("new"), { code: "routeConflict" });
  assert.equal(a.expected, "original");
  assert.equal(a.read(), "original");
  const unavailable = new SharedLoopDraft({
    key: "draft",
    storage: () => f.storage,
    expected: "original",
  });
  await assert.rejects(unavailable.write("new"), {
    code: "draftLockUnavailable",
  });
  assert.equal(f.storage.getItem("draft"), "original");
  const denied = new SharedLoopDraft({
    key: "draft",
    locks: f.locks,
    storage: () => {
      throw Error("blocked");
    },
  });
  await assert.rejects(denied.write("new"), { code: "routeConflict" });
  assert.throws(() => denied.read(), { code: "routeConflict" });
});
test("an unreadable initial store can recover only while no other tab draft exists", async () => {
  const f = setup(null),
    a = f.tab(undefined);
  a.expected = undefined;
  await a.write("new");
  assert.equal(a.expected, "new");
  const b = f.tab();
  b.expected = undefined;
  await assert.rejects(b.write("blind"), { code: "draftConflict" });
  assert.equal(f.storage.getItem("draft"), "new");
});
