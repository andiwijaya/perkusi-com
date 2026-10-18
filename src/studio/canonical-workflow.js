import {
  importCanonicalFile,
  exportCanonicalPackage,
  retainCanonicalBundle,
} from "../project/canonical-package.js";
import { fail } from "../project/instrument-contract.js";
import { combineCanonicalMaterial } from "../project/canonical-hub.js";

// Explicit file/storage transactions for an injected workspace. UI changes are
// promoted by the editor only after complete validation and generation checks.
export function createCanonicalWorkflow({
  editor,
  storage,
  registry,
  memory,
  onChange = () => {},
} = {}) {
  let closed = false,
    serial = 0,
    savedRevision = null,
    status = "idle",
    error = null,
    input = null;
  const pending = new Set(),
    aborts = new Set();
  const snapshot = () =>
      Object.freeze({
        status,
        error,
        savedRevision,
        inputBackup: input?.blob ?? null,
        pending: pending.size,
        closed,
      }),
    emit = () => {
      try {
        onChange(snapshot());
      } catch {
        /* Presentation only. */
      }
    };
  function run(fn) {
    if (closed) fail("canonicalWorkflowClosed");
    const abort = new AbortController();
    aborts.add(abort);
    const observedSerial = serial,
      task = Promise.resolve().then(() => fn(abort.signal));
    pending.add(task);
    task.then(
      () => {
        pending.delete(task);
        aborts.delete(abort);
        if (status === "cancelling" && !pending.size) status = "cancelled";
        emit();
      },
      (e) => {
        pending.delete(task);
        aborts.delete(abort);
        if (status === "cancelling" && !pending.size) status = "cancelled";
        if (serial === observedSerial) {
          error = e.code ?? e.message;
          status = "error";
        }
        emit();
      },
    );
    return task;
  }
  const valid = (t) => {
    if (closed || serial !== t) fail("cancelled");
  };
  return Object.freeze({
    snapshot,
    cancel() {
      serial++;
      for (const a of aborts) a.abort();
      error = null;
      status = pending.size ? "cancelling" : "cancelled";
      emit();
    },
    importFile(blob, { mode = "replace", bars = 4, startTick = 0 } = {}) {
      if (!["replace", "add"].includes(mode)) fail("invalidImportMode");
      const ticket = ++serial,
        expectedEditorRevision = editor.snapshot().revision;
      return run(async (signal) => {
        const held = memory.reserve(
          blob.size + 4096,
          "canonical/import-input-backup",
        );
        const old = input;
        const staged = { blob, held, active: true, retired: false };
        input = staged;
        if (old) {
          old.retired = true;
          if (!old.active) old.held.release();
        }
        status = "importing";
        error = null;
        emit();
        let candidate, combined;
        try {
          candidate = await importCanonicalFile(blob, {
            registry,
            memory,
            signal,
          });
          valid(ticket);
          if (editor.snapshot().revision !== expectedEditorRevision)
            fail("draftConflict");
          if (mode === "add")
            combined = await combineCanonicalMaterial(
              editor.snapshot().bundle,
              candidate,
              { registry, memory, bars, startTick, signal },
            );
          valid(ticket);
          if (editor.snapshot().revision !== expectedEditorRevision)
            fail("draftConflict");
          await editor.replace(combined ?? candidate, {
            guard: () =>
              !closed &&
              serial === ticket &&
              editor.snapshot().revision === expectedEditorRevision,
          });
          valid(ticket);
          status = "imported";
          emit();
          return editor.snapshot();
        } finally {
          combined?.dispose();
          candidate?.dispose();
          staged.active = false;
          if (staged.retired) staged.held.release();
        }
      });
    },
    load() {
      const ticket = ++serial,
        expectedEditorRevision = editor.snapshot().revision;
      return run(async (signal) => {
        status = "loading";
        error = null;
        emit();
        let found;
        try {
          found = await storage.load({ signal });
          valid(ticket);
          if (!found) fail("missingProject");
          if (editor.snapshot().revision !== expectedEditorRevision)
            fail("draftConflict");
          await editor.replace(found.bundle, {
            guard: () => !closed && serial === ticket,
          });
          valid(ticket);
          savedRevision = found.revision;
          status = "loaded";
          emit();
          return editor.snapshot();
        } finally {
          found?.bundle.dispose();
        }
      });
    },
    save() {
      if (closed) fail("canonicalWorkflowClosed");
      const bundle = retainCanonicalBundle(editor.snapshot().bundle);
      return run(async (signal) => {
        status = "saving";
        error = null;
        emit();
        try {
          const revision = await storage.save(bundle, {
            expected: savedRevision,
            signal,
          });
          savedRevision = revision;
          status = "saved";
          emit();
          return revision;
        } finally {
          bundle.dispose();
        }
      });
    },
    exportProject() {
      if (closed) fail("canonicalWorkflowClosed");
      const bundle = retainCanonicalBundle(editor.snapshot().bundle);
      return run(async (signal) => {
        try {
          return await exportCanonicalPackage(bundle, { memory, signal });
        } finally {
          bundle.dispose();
        }
      });
    },
    original() {
      const b = editor.snapshot().bundle,
        o = b.project.origins.find(
          (o) => o.id === b.project.compatibility.rootOriginId,
        );
      return b.originals.get(o.sha256);
    },
    async dispose() {
      closed = true;
      serial++;
      for (const a of aborts) a.abort();
      await Promise.allSettled([...pending]);
      input?.held.release();
      input = null;
      storage.close();
    },
  });
}
