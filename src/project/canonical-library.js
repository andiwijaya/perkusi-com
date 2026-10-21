import { fail } from "./instrument-contract.js";

const validId = (id) => typeof id === "string" && /^[a-z0-9-]{1,64}$/.test(id);
const check = (signal) => {
  if (signal?.aborted) fail("cancelled");
};

// Read one metadata document at a time. The existing five stores, immutable
// history, blobs and source/provenance validation stay authoritative.
export async function listCanonicalProjects(
  storage,
  { after = null, limit = 50, signal } = {},
) {
  if (
    (after !== null && !validId(after)) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    fail("invalidCanonicalLibrary");
  check(signal);
  const held = storage.memory.reserve(
    4 * 1024 * 1024 + limit * 1024 + 16384,
    "canonical/library-metadata-page",
  );
  try {
    const db = await storage.open();
    check(signal);
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(["pointers", "documents"], "readonly"),
        pointers = tx.objectStore("pointers"),
        request = pointers.openCursor(),
        rows = [];
      let code = "canonicalStorageUnavailable",
        nextCursor = null;
      const abort = () => {
        code = "cancelled";
        try {
          tx.abort();
        } catch {
          /* Completed. */
        }
      };
      signal?.addEventListener("abort", abort, { once: true });
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const id = cursor.key,
          pointer = cursor.value;
        if (
          !validId(id) ||
          (after !== null && id <= after) ||
          !Number.isSafeInteger(pointer?.revision) ||
          pointer.revision < 1
        )
          return cursor.continue();
        const read = () => {
          if (rows.length === limit) {
            nextCursor = rows.at(-1).documentId;
            return;
          }
          const doc = tx
            .objectStore("documents")
            .get(id + ":" + pointer.revision);
          doc.onsuccess = () => {
            if (typeof doc.result?.project?.title === "string")
              rows.push(
                Object.freeze({
                  documentId: id,
                  revision: pointer.revision,
                  title: doc.result.project.title.slice(0, 120),
                  backup:
                    id.startsWith("handoff-") ||
                    id.startsWith("recovered-current-"),
                }),
              );
            cursor.continue();
          };
        };
        if (
          id === "current" &&
          validId(pointer.libraryDocumentId) &&
          pointer.libraryDocumentId !== "current"
        ) {
          const named = pointers.get(pointer.libraryDocumentId);
          named.onsuccess = () =>
            named.result?.revision === pointer.libraryRevision
              ? cursor.continue()
              : read();
        } else read();
      };
      const done = () => signal?.removeEventListener("abort", abort);
      tx.oncomplete = () => {
        done();
        resolve(Object.freeze({ rows: Object.freeze(rows), nextCursor }));
      };
      tx.onerror = () => {};
      tx.onabort = () => {
        done();
        reject(Object.assign(Error(code), { code }));
      };
    });
  } finally {
    held.release();
  }
}

// Explicit removal from the saved-project list. Historical documents, refs,
// credits and immutable blobs remain pinned; this operation never performs GC.
export async function removeCanonicalProject(
  storage,
  { documentId, expected, signal } = {},
) {
  if (!validId(documentId) || !Number.isSafeInteger(expected) || expected < 1)
    fail("invalidCanonicalLibrary");
  check(signal);
  const held = storage.memory.reserve(16384, "canonical/library-remove");
  try {
    const db = await storage.open();
    check(signal);
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(["pointers"], "readwrite"),
        pointers = tx.objectStore("pointers"),
        target = pointers.get(documentId),
        current = pointers.get("current");
      let code = "canonicalStorageWriteFailed",
        unread = 2,
        result;
      const abort = () => {
        code = "cancelled";
        try {
          tx.abort();
        } catch {
          /* Completed. */
        }
      };
      signal?.addEventListener("abort", abort, { once: true });
      const apply = () => {
        if (--unread) return;
        if (target.result?.revision !== expected) {
          code = "draftConflict";
          tx.abort();
          return;
        }
        const removedCurrent =
          documentId === "current" ||
          current.result?.libraryDocumentId === documentId;
        pointers.delete(documentId);
        if (removedCurrent && documentId !== "current")
          pointers.delete("current");
        result = Object.freeze({
          removedCurrent,
          currentRevision: removedCurrent
            ? null
            : (current.result?.revision ?? null),
        });
      };
      target.onsuccess = current.onsuccess = apply;
      const done = () => signal?.removeEventListener("abort", abort);
      tx.oncomplete = () => {
        done();
        resolve(result);
      };
      tx.onerror = () => {};
      tx.onabort = () => {
        done();
        reject(Object.assign(Error(code), { code }));
      };
    });
  } finally {
    held.release();
  }
}
