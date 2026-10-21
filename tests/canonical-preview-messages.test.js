import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("src/studio/canonical-workspace.js", "utf8");
function fixture() {
  const statusElement = { textContent: "old refusal" };
  const context = vm.createContext({
    root: { dataset: { canonicalError: "clipTempo" } },
    $: () => statusElement,
    c: { idle: "Ready" },
    errorRevision: 1,
    transaction: (fn) => Promise.resolve().then(fn),
    status: (s) => {
      statusElement.textContent = s;
    },
  });
  context.showError = (e) => {
    context.errorRevision++;
    context.root.dataset.canonicalError = e.code;
    statusElement.textContent = e.code;
  };
  const start = source.indexOf("const mutate = (fn) =>"),
    end = source.indexOf("const deliverBlob =", start);
  assert(start > 0 && end > start);
  const mutate = vm.runInContext(
    "(()=>{" + source.slice(start, end) + "return mutate;})()",
    context,
  );
  return { context, mutate, statusElement };
}
test("accepted edit clears the stale refusal marker and text", async () => {
  const f = fixture();
  await f.mutate(() => {});
  assert.equal(f.context.root.dataset.canonicalError, undefined);
  assert.equal(f.statusElement.textContent, "Ready");
});
test("accepted operation keeps its newer workflow success message", async () => {
  const f = fixture();
  await f.mutate(() => {
    f.statusElement.textContent = "Imported";
  });
  assert.equal(f.context.root.dataset.canonicalError, undefined);
  assert.equal(f.statusElement.textContent, "Imported");
});
test("a rejected edit retains its actual refusal", async () => {
  const f = fixture();
  await f.mutate(() => {
    throw { code: "recordedTempoLocked" };
  });
  assert.equal(f.context.root.dataset.canonicalError, "recordedTempoLocked");
  assert.equal(f.statusElement.textContent, "recordedTempoLocked");
});
test("a concurrent newer failure is never cleared by an earlier accepted edit", async () => {
  const f = fixture();
  await f.mutate(() => f.context.showError({ code: "clipTempo" }));
  assert.equal(f.context.root.dataset.canonicalError, "clipTempo");
  assert.equal(f.statusElement.textContent, "clipTempo");
});
for (const locale of ["id", "en"])
  test(
    "actual " + locale + " Beatbox-tempo refusal explains the 96 BPM condition",
    () => {
      const root = { dataset: {} };
      let message;
      const start = source.indexOf("const showError = (e) =>"),
        end = source.indexOf("const transaction =", start);
      const context = vm.createContext({
        locale,
        root,
        c: { error: "generic" },
        errorRevision: 0,
        status: (s) => {
          message = s;
        },
      });
      vm.runInContext(
        source.slice(start, end) + 'showError({code:"clipTempo"});',
        context,
      );
      assert.match(message, /96/);
      assert.match(message, /Beatbox/);
      assert.equal(root.dataset.canonicalError, "clipTempo");
      assert.equal(context.errorRevision, 1);
    },
  );
