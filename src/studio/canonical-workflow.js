import {
  importCanonicalFile,
  exportCanonicalPackage,
  retainCanonicalBundle,
  deriveCanonicalBundle,
} from "../project/canonical-package.js";
import { fail } from "../project/instrument-contract.js";
import { retainCanonicalInputBlob } from "../project/canonical-blob-owner.js";
import { combineCanonicalMaterial } from "../project/canonical-hub.js";
import { replaceCanonicalOverdub } from "./canonical-capture-material.js";
import {
  listCanonicalProjects,
  removeCanonicalProject,
} from "../project/canonical-library.js";

// Explicit file/storage transactions for an injected workspace. UI changes are
// promoted by the editor only after complete validation and generation checks.
export function createCanonicalWorkflow({
  editor,
  storage,
  registry,
  memory,
  onChange = () => {},
  library = false,
  createProjectId = () => "project-" + crypto.randomUUID(),
} = {}) {
  let closed = false,
    serial = 0,
    savedRevision = null,
    currentRevision = null,
    checkpointRevision = null,
    documentId = library ? createProjectId() : "current",
    removedActive = false,
    needsCheckpoint = false,
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
        currentRevision,
        checkpointRevision,
        documentId,
        removedActive,
        needsCheckpoint,
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
  const detach = () => {
    if (library) {
      documentId = createProjectId();
      savedRevision = null;
      needsCheckpoint = true;
    }
  };
  function save(copy = false) {
    if (closed) fail("canonicalWorkflowClosed");
    const bundle = retainCanonicalBundle(editor.snapshot().bundle),
      editorRevision = editor.snapshot().revision,
      id = copy ? createProjectId() : documentId,
      expected = copy ? null : savedRevision,
      expectedCurrent = currentRevision,
      ticket = library ? ++serial : serial;
    return run(async (signal) => {
      status = "saving";
      error = null;
      emit();
      try {
        valid(ticket);
        const latestCurrent =
          library && expected === null && storage.readCurrentRevision
            ? await storage.readCurrentRevision({ signal })
            : expectedCurrent;
        valid(ticket);
        const result = await storage.save(bundle, {
          documentId: id,
          expected,
          ...(library && id !== "current"
            ? { currentExpected: latestCurrent }
            : {}),
          signal,
        });
        valid(ticket);
        if (editor.snapshot().revision !== editorRevision)
          fail("draftConflict");
        documentId = id;
        savedRevision = typeof result === "number" ? result : result?.revision;
        currentRevision =
          id === "current" ? savedRevision : result.currentRevision;
        checkpointRevision = editorRevision;
        needsCheckpoint = false;
        removedActive = false;
        status = "saved";
        emit();
        return savedRevision;
      } finally {
        bundle.dispose();
      }
    });
  }
  return Object.freeze({
    snapshot,
    cancel() {
      serial++;
      for (const a of aborts) a.abort();
      error = null;
      status = pending.size ? "cancelling" : "cancelled";
      emit();
    },
    importFile(
      blob,
      {
        mode = "replace",
        bars = 4,
        startTick = 0,
        freezeRecordingClock = false,
        replaceRecordingTrackId = null,
      } = {},
    ) {
      if (!["replace", "add"].includes(mode)) fail("invalidImportMode");
      if (
        replaceRecordingTrackId !== null &&
        (mode !== "add" || typeof replaceRecordingTrackId !== "string")
      )
        fail("invalidImportMode");
      if (
        typeof freezeRecordingClock !== "boolean" ||
        (freezeRecordingClock && mode !== "add")
      )
        fail("invalidImportMode");
      const ticket = ++serial,
        expectedEditorRevision = editor.snapshot().revision;
      return run(async (signal) => {
        const held = retainCanonicalInputBlob(
          blob,
          memory,
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
        let candidate, combined, frozenBase;
        try {
          candidate = await importCanonicalFile(blob, {
            registry,
            memory,
            signal,
          });
          valid(ticket);
          if (editor.snapshot().revision !== expectedEditorRevision)
            fail("draftConflict");
          if (freezeRecordingClock) {
            const current = editor.snapshot().bundle,
              clock = candidate.project.timing.clock;
            if (clock.kind !== "fixed-bar") fail("captureClockNotFrozen");
            if (current.project.timing.bpm !== candidate.project.timing.bpm)
              fail("hubTempoConflict");
            if (current.project.timing.clock.kind === "musical") {
              const working = structuredClone(current.project);
              working.timing.clock = structuredClone(clock);
              // Explicit capture adoption freezes only the working grid. All
              // original files and recorded periods remain byte-identical.
              frozenBase = await deriveCanonicalBundle(working, current, {
                registry,
              });
            }
          }
          if (mode === "add")
            combined = replaceRecordingTrackId
              ? await replaceCanonicalOverdub(
                  frozenBase ?? editor.snapshot().bundle,
                  candidate,
                  replaceRecordingTrackId,
                  { registry, memory, signal },
                )
              : await combineCanonicalMaterial(
                  frozenBase ?? editor.snapshot().bundle,
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
          if (mode === "replace") detach();
          removedActive = false;
          status = "imported";
          emit();
          return editor.snapshot();
        } finally {
          combined?.dispose();
          frozenBase?.dispose();
          candidate?.dispose();
          staged.active = false;
          if (staged.retired) staged.held.release();
        }
      });
    },
    load({ documentId: requested = "current", allowMissing = false } = {}) {
      const ticket = ++serial,
        expectedEditorRevision = editor.snapshot().revision;
      return run(async (signal) => {
        status = "loading";
        error = null;
        emit();
        let found;
        try {
          found = await storage.load({ documentId: requested, signal });
          valid(ticket);
          if (!found) {
            if (allowMissing && requested === "current") {
              status = "idle";
              error = null;
              emit();
              return null;
            }
            fail("missingProject");
          }
          if (editor.snapshot().revision !== expectedEditorRevision)
            fail("draftConflict");
          await editor.replace(found.bundle, {
            guard: () => !closed && serial === ticket,
          });
          valid(ticket);
          documentId =
            library && requested === "current" && found.library
              ? found.library.documentId
              : requested;
          savedRevision =
            library && requested === "current" && found.library
              ? found.library.revision
              : found.revision;
          if (requested === "current") currentRevision = found.revision;
          needsCheckpoint = library && requested !== "current";
          checkpointRevision = editor.snapshot().revision;
          removedActive = false;
          status = "loaded";
          emit();
          return editor.snapshot();
        } finally {
          found?.bundle.dispose();
        }
      });
    },
    save: () => save(),
    saveCopy: () => save(true),
    listProjects: (options) =>
      run((signal) => listCanonicalProjects(storage, { ...options, signal })),
    removeProject(row) {
      const ticket = ++serial;
      return run(async (signal) => {
        const result = await removeCanonicalProject(storage, {
          ...row,
          signal,
        });
        valid(ticket);
        removedActive = row.documentId === documentId;
        if (removedActive) detach();
        if (result.removedCurrent) currentRevision = null;
        status = "removed";
        error = null;
        emit();
        return result;
      });
    },
    replaceProject(incoming) {
      if (closed) fail("canonicalWorkflowClosed");
      const ticket = ++serial,
        editorRevision = editor.snapshot().revision,
        owned = retainCanonicalBundle(incoming);
      return run(async () => {
        try {
          valid(ticket);
          await editor.replace(owned, {
            guard: () =>
              !closed &&
              serial === ticket &&
              editor.snapshot().revision === editorRevision,
          });
          valid(ticket);
          detach();
          removedActive = false;
          status = "replaced";
          error = null;
          emit();
          return editor.snapshot();
        } finally {
          owned.dispose();
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
