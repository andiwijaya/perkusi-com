// Specific, readonly access to the existing inbox. No application writer,
// package migration, audio engine or B2 generic serializer is imported.
export const HANDOFF_DATABASE = "perkusi.canonical-handoff.v1";
export const HANDOFF_MAX_BYTES = 44 * 1024 * 1024 + 48;
export const HANDOFF_PAGE_SIZE = 32;
const fail = (code) => Object.assign(new Error(code), { code });
const check = (signal) => {
  if (signal?.aborted) throw fail("cancelled");
};
async function existingStore(
  { indexedDB = globalThis.indexedDB, signal } = {},
  action,
) {
  check(signal);
  if (!indexedDB?.databases) throw fail("safeDatabaseListingUnavailable");
  if (!(await indexedDB.databases()).some((d) => d.name === HANDOFF_DATABASE))
    return null;
  check(signal);
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      let settled = false;
      const request = indexedDB.open(HANDOFF_DATABASE);
      const finish = (error, value) => {
        if (settled) {
          value?.close();
          return;
        }
        settled = true;
        signal?.removeEventListener("abort", abort);
        error ? reject(error) : resolve(value);
      };
      const abort = () => finish(fail("cancelled"));
      signal?.addEventListener("abort", abort, { once: true });
      request.onupgradeneeded = () => {
        request.transaction.abort();
        finish(fail("handoffDatabaseChanged"));
      };
      request.onerror = () => finish(fail("handoffReadFailed"));
      request.onblocked = () => finish(fail("handoffBlocked"));
      request.onsuccess = () =>
        signal?.aborted
          ? (request.result.close(), finish(fail("cancelled")))
          : finish(null, request.result);
      if (signal?.aborted) abort();
    });
    check(signal);
    if (!db.objectStoreNames.contains("transfers"))
      throw fail("handoffStoreMissing");
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(["transfers"], "readonly");
      let value, error;
      const abort = () => {
        error = fail("cancelled");
        try {
          tx.abort();
        } catch {
          /* completed */
        }
      };
      signal?.addEventListener("abort", abort, { once: true });
      tx.oncomplete = () => {
        signal?.removeEventListener("abort", abort);
        resolve(value);
      };
      tx.onerror = () => {};
      tx.onabort = () => {
        signal?.removeEventListener("abort", abort);
        reject(error ?? fail("handoffReadFailed"));
      };
      try {
        action(
          tx.objectStore("transfers"),
          (v) => {
            value = v;
          },
          (e) => {
            error = e;
            tx.abort();
          },
        );
      } catch (e) {
        error = e;
        tx.abort();
      }
      if (signal?.aborted) abort();
    });
  } finally {
    db?.close();
  }
}
export async function listHandoffOriginals({
  after = null,
  keyRange = globalThis.IDBKeyRange,
  ...options
} = {}) {
  const result = await existingStore(options, (store, done) => {
    const rows = [],
      request = store.openCursor(
        after === null ? undefined : keyRange.lowerBound(after, true),
      );
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        done({ rows, next: null });
        return;
      }
      if (rows.length === HANDOFF_PAGE_SIZE) {
        done({ rows, next: rows.at(-1).key });
        return;
      }
      const row = cursor.value;
      rows.push({
        key: cursor.primaryKey,
        title: typeof row?.title === "string" ? row.title.slice(0, 80) : "",
        bytes: row?.blob instanceof Blob ? row.blob.size : null,
      });
      cursor.continue();
    };
  });
  return result ?? { rows: [], next: null, missing: true };
}
export async function readHandoffOriginal(key, options = {}) {
  if (typeof key !== "string" || key.length > 512)
    throw fail("unsupportedHandoffKey");
  const row = await existingStore(options, (store, done) => {
    const request = store.openCursor(key);
    request.onsuccess = () => done(request.result?.value ?? null);
  });
  if (!row) throw fail("handoffMissing");
  if (
    !(row.blob instanceof Blob) ||
    row.blob.size < 1 ||
    row.blob.size > HANDOFF_MAX_BYTES
  )
    throw fail("handoffOriginalUnavailable");
  check(options.signal);
  const sha256 = [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", await row.blob.arrayBuffer()),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  check(options.signal);
  return {
    key,
    row,
    blob: row.blob,
    sha256,
    verified:
      row.version === 1 &&
      row.id === key &&
      row.bytes === row.blob.size &&
      row.sha256 === sha256 &&
      ["gamelan", "loop", "legacy"].includes(row.kind),
  };
}
export function handoffMetadataFile({ key, row, sha256 }) {
  const metadata = Object.fromEntries(
    Object.entries(row).filter(([name]) => name !== "blob"),
  );
  // Known inbox metadata is plain JSON. Unsupported future structured metadata
  // refuses explicitly; its original Blob remains independently downloadable.
  let nodes = 0;
  const ancestors = new Set();
  function visit(v, depth = 0) {
    if (++nodes > 10000 || depth > 32) throw fail("handoffMetadataUnsupported");
    if (
      v === null ||
      typeof v === "string" ||
      typeof v === "boolean" ||
      (typeof v === "number" && Number.isFinite(v) && !Object.is(v, -0))
    )
      return;
    if (
      !v ||
      typeof v !== "object" ||
      ancestors.has(v) ||
      (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype)
    )
      throw fail("handoffMetadataUnsupported");
    ancestors.add(v);
    if (Array.isArray(v)) {
      if (Object.keys(v).length !== v.length)
        throw fail("handoffMetadataUnsupported");
      for (let i = 0; i < v.length; i++) {
        if (!Object.hasOwn(v, i)) throw fail("handoffMetadataUnsupported");
        visit(v[i], depth + 1);
      }
    } else for (const value of Object.values(v)) visit(value, depth + 1);
    ancestors.delete(v);
  }
  visit(metadata);
  const sourceBlob = {
    bytes: row.blob.size,
    type: row.blob.type,
    sha256,
    ...(typeof File !== "undefined" && row.blob instanceof File
      ? { name: row.blob.name, lastModified: row.blob.lastModified }
      : {}),
  };
  const text = JSON.stringify({
      database: HANDOFF_DATABASE,
      store: "transfers",
      key,
      metadata,
      sourceBlob,
    }),
    blob = new Blob([text], { type: "application/json" });
  if (blob.size > 1024 * 1024) throw fail("handoffMetadataUnsupported");
  return blob;
}
