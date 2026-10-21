import test from "node:test";
import assert from "node:assert/strict";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { retainCanonicalBundle } from "../src/project/canonical-package.js";
import { createFreshCanonicalProject } from "../src/studio/canonical-fresh-project.js";
import { createCanonicalEditor } from "../src/studio/canonical-editor.js";
import { createCanonicalWorkflow } from "../src/studio/canonical-workflow.js";
import { canonicalFixtureRegistry as registry } from "./helpers/canonical-fixtures.js";

async function fixture() {
  const memory = new AudioMemory(),
    bundle = await createFreshCanonicalProject({
      registry,
      memory,
      title: "A",
    }),
    editor = await createCanonicalEditor(bundle, { registry, memory }),
    snapshots = new Map(),
    calls = [];
  let id = 0,
    failure = null;
  const storage = {
    async save(b, options) {
      calls.push({ ...options });
      if (failure) throw failure;
      const prior = snapshots.get(options.documentId);
      if ((prior?.revision ?? null) !== options.expected)
        throw Object.assign(Error("draftConflict"), { code: "draftConflict" });
      const revision = (options.expected ?? 0) + 1,
        current = snapshots.get("current");
      if (
        options.currentExpected !== undefined &&
        (current?.revision ?? null) !== options.currentExpected
      )
        throw Object.assign(Error("draftConflict"), { code: "draftConflict" });
      prior?.bundle.dispose();
      snapshots.set(options.documentId, {
        bundle: retainCanonicalBundle(b),
        revision,
      });
      if (options.currentExpected !== undefined) {
        current?.bundle.dispose();
        snapshots.set("current", {
          bundle: retainCanonicalBundle(b),
          revision: (options.currentExpected ?? 0) + 1,
          library: { documentId: options.documentId, revision },
        });
        return {
          revision,
          currentRevision: (options.currentExpected ?? 0) + 1,
        };
      }
      return revision;
    },
    async load({ documentId }) {
      const row = snapshots.get(documentId);
      return row ? { ...row, bundle: retainCanonicalBundle(row.bundle) } : null;
    },
    async readCurrentRevision() {
      return snapshots.get("current")?.revision ?? null;
    },
    close() {
      for (const row of snapshots.values()) row.bundle.dispose();
      snapshots.clear();
    },
  };
  const workflow = createCanonicalWorkflow({
    editor,
    storage,
    registry,
    memory,
    library: true,
    createProjectId: () => "project-" + ++id,
  });
  return {
    memory,
    bundle,
    editor,
    workflow,
    snapshots,
    calls,
    fail(error) {
      failure = error;
    },
    async dispose() {
      await workflow.dispose();
      await editor.dispose();
      bundle.dispose();
      assert.equal(memory.snapshot().bytes, 0);
    },
  };
}

test("New project and save-copy use independent named identities while maintaining compatible current recovery", async () => {
  const f = await fixture();
  await f.workflow.save();
  const a = f.workflow.snapshot().documentId;
  const next = await createFreshCanonicalProject({
    registry,
    memory: f.memory,
    title: "B",
  });
  try {
    await f.workflow.replaceProject(next);
  } finally {
    next.dispose();
  }
  assert.notEqual(f.workflow.snapshot().documentId, a);
  assert.equal(f.workflow.snapshot().savedRevision, null);
  assert.equal(f.workflow.snapshot().needsCheckpoint, true);
  await f.workflow.save();
  const b = f.workflow.snapshot().documentId;
  assert.equal(f.snapshots.get(a).bundle.project.title, "A");
  assert.equal(f.snapshots.get(b).bundle.project.title, "B");
  await f.workflow.saveCopy();
  assert.notEqual(f.workflow.snapshot().documentId, b);
  assert.equal(f.snapshots.get(b).bundle.project.title, "B");
  await f.workflow.load({ documentId: a });
  assert.equal(f.editor.snapshot().project.title, "A");
  assert(f.workflow.snapshot().needsCheckpoint);
  await f.workflow.save();
  await f.workflow.load();
  assert.equal(f.workflow.snapshot().documentId, a);
  assert.equal(f.workflow.snapshot().needsCheckpoint, false);
  assert.equal(f.calls.at(-1).expected, 1);
  await f.dispose();
});
test("failed copy save preserves the selected identity, revisions and all prior projects", async () => {
  const f = await fixture();
  await f.workflow.save();
  const before = f.workflow.snapshot();
  f.fail(
    Object.assign(Error("canonicalStorageFull"), {
      code: "canonicalStorageFull",
    }),
  );
  await assert.rejects(
    f.workflow.saveCopy(),
    (e) => e.code === "canonicalStorageFull",
  );
  assert.equal(f.workflow.snapshot().documentId, before.documentId);
  assert.equal(f.workflow.snapshot().savedRevision, before.savedRevision);
  assert.equal(f.snapshots.size, 2);
  assert.equal(f.editor.snapshot().project.title, "A");
  await f.dispose();
});
test("file delivery or other observers cannot mark later editor changes as saved", async () => {
  const f = await fixture();
  await f.workflow.save();
  const saved = f.workflow.snapshot().checkpointRevision;
  await f.editor.edit((p) => {
    p.title = "unsaved change";
  });
  const out = await f.workflow.exportProject();
  out.release();
  assert.equal(f.workflow.snapshot().checkpointRevision, saved);
  assert.notEqual(f.editor.snapshot().revision, saved);
  await f.dispose();
});
test("a stale named save refuses, while explicit Save a copy preserves the other tab and checkpoints a new identity", async () => {
  const f = await fixture();
  await f.workflow.save();
  const original = f.workflow.snapshot().documentId;
  f.snapshots.get(original).revision = 2;
  f.snapshots.get("current").revision = 2;
  await f.editor.edit((p) => {
    p.title = "stale working draft";
  });
  await assert.rejects(f.workflow.save(), (e) => e.code === "draftConflict");
  await f.workflow.saveCopy();
  assert.notEqual(f.workflow.snapshot().documentId, original);
  assert.equal(f.snapshots.get(original).bundle.project.title, "A");
  assert.equal(
    f.snapshots.get(f.workflow.snapshot().documentId).bundle.project.title,
    "stale working draft",
  );
  assert.equal(f.workflow.snapshot().currentRevision, 3);
  await f.dispose();
});
test("replacement requested after disposal cannot retain a candidate or leak its source archive", async () => {
  const f = await fixture();
  await f.workflow.dispose();
  assert.throws(
    () => f.workflow.replaceProject(f.bundle),
    (e) => e.code === "canonicalWorkflowClosed",
  );
  await f.editor.dispose();
  f.bundle.dispose();
  assert.equal(f.memory.snapshot().bytes, 0);
});
