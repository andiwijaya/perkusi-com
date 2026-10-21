import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Execute the actual workspace expression and actual library lock closure.
// This reproduces the compiled UI failure: absent capture -> undefined -> the
// library's default argument retains its preceding busy lock forever.
function workspaceLock({ busy = 0, status = "idle", captureTools } = {}) {
  const source = readFileSync("src/studio/canonical-workspace.js", "utf8");
  const start = source.indexOf(
    "const s = panel.controller.snapshot(),",
    source.indexOf("function locks()"),
  );
  const end = source.indexOf("const dirty = isDirty();", start);
  assert(start > 0 && end > start);
  return vm.runInNewContext(
    "(()=>{" + source.slice(start, end) + "return locked;})()",
    {
      disposed: false,
      busy,
      panel: { controller: { snapshot: () => ({ status }) } },
      captureTools,
    },
  );
}
function libraryLock() {
  const source = readFileSync(
    "src/studio/canonical-project-library.js",
    "utf8",
  );
  const start = source.indexOf("const locks = (value = locked)");
  const end = source.indexOf("async function refresh", start);
  assert(start > 0 && end > start);
  const controls = Object.fromEntries(
    [
      "newButton",
      "saveCopy",
      "refreshButton",
      "previous",
      "next",
      "saveContinue",
      "discard",
      "remove",
      "cancel",
    ].map((k) => [k, { disabled: false }]),
  );
  const ids = Object.fromEntries(
    ["saved", "load", "saved-delete"].map((k) => [k, { disabled: false }]),
  );
  const context = {
    ...controls,
    locked: false,
    $: (id) => ids[id],
    selected: () => true,
    history: [],
    nextCursor: null,
  };
  const locks = vm.runInNewContext(
    "(()=>{" + source.slice(start, end) + "return locks;})()",
    context,
  );
  return { locks, controls, ids };
}
test("optional Preview without capture unlocks the actual library after save/import/download busy work", () => {
  const { locks, controls, ids } = libraryLock();
  // Validate the original counterexample is capable of detecting sticky state.
  locks(true);
  locks(undefined);
  assert.equal(controls.saveCopy.disabled, true);
  for (let i = 0; i < 3; i++) {
    locks(workspaceLock({ busy: 1 }));
    assert.equal(controls.saveCopy.disabled, true);
    const idle = workspaceLock();
    assert.equal(idle, false);
    locks(idle);
    assert.equal(controls.saveCopy.disabled, false);
    assert.equal(controls.newButton.disabled, false);
    assert.equal(ids.load.disabled, false);
    assert.equal(ids["saved-delete"].disabled, false);
  }
});
test("workspace lock preserves capture and cleanup-pending restrictions as booleans", () => {
  for (const input of [
    { busy: 1 },
    { status: "cleanup-pending" },
    { captureTools: { blocked: () => true } },
  ])
    assert.equal(workspaceLock(input), true);
  assert.equal(
    workspaceLock({ captureTools: { blocked: () => false } }),
    false,
  );
});
