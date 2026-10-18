import { MAX_CANONICAL_PACKAGE } from "./canonical-package.js";
import { hashBytes } from "./canonical-data.js";
import { fail } from "./instrument-contract.js";
const check = (signal) => {
  if (signal?.aborted) fail("cancelled");
};
const validId = (id) => typeof id === "string" && /^[a-f0-9-]{36}$/.test(id);
const metadata = (r) => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  bytes: r.bytes,
  sha256: r.sha256,
  createdAt: r.createdAt,
  prepared: r.prepared ?? null,
  accepted: r.accepted ?? null,
});

// Separate, durable handoff inbox. No legacy project database is opened or
// cleared. Rows and their exact source Blob remain available after acceptance.
export class CanonicalHandoffStore {
  constructor({
    indexedDB = globalThis.indexedDB,
    memory,
    name = "perkusi.canonical-handoff.v1",
  } = {}) {
    Object.assign(this, { indexedDB, memory, name });
    this.db = null;
    this.opening = null;
    this.closed = false;
  }
  async open() {
    if (this.closed) fail("handoffClosed");
    if (this.db) return this.db;
    if (this.opening) return this.opening;
    if (!this.indexedDB) fail("handoffUnavailable");
    this.opening = new Promise((resolve, reject) => {
      const r = this.indexedDB.open(this.name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore("transfers");
      r.onerror = r.onblocked = () => {
        reject(
          Object.assign(Error("handoffUnavailable"), {
            code: "handoffUnavailable",
          }),
        );
        r.onsuccess = () => r.result.close();
      };
      r.onsuccess = () => {
        if (this.closed) {
          r.result.close();
          reject(Error("handoffClosed"));
          return;
        }
        this.db = r.result;
        this.db.onversionchange = () => {
          this.db.close();
          this.db = null;
        };
        resolve(this.db);
      };
    });
    try {
      return await this.opening;
    } finally {
      this.opening = null;
    }
  }
  async transaction(mode, action, signal) {
    const db = await this.open();
    check(signal);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["transfers"], mode),
        store = tx.objectStore("transfers");
      let value, error;
      const abort = () => {
        error = Object.assign(Error("cancelled"), { code: "cancelled" });
        try {
          tx.abort();
        } catch {
          /* Transaction has already settled. */
        }
      };
      signal?.addEventListener("abort", abort, { once: true });
      const done = () => signal?.removeEventListener("abort", abort);
      tx.oncomplete = () => {
        done();
        resolve(value);
      };
      tx.onabort = tx.onerror = () => {
        done();
        const e = error ?? tx.error;
        reject(
          Object.assign(Error(e?.message ?? "handoffStorageFailed"), {
            code:
              e?.name === "QuotaExceededError"
                ? "handoffStorageFull"
                : typeof e?.code === "string"
                  ? e.code
                  : "handoffStorageFailed",
          }),
        );
      };
      try {
        action(
          store,
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
    });
  }
  async stage(blob, { kind, title = "", signal } = {}) {
    if (
      !(blob instanceof Blob) ||
      blob.size < 1 ||
      blob.size > MAX_CANONICAL_PACKAGE ||
      !["gamelan", "loop", "legacy"].includes(kind)
    )
      fail("invalidHandoff");
    const held = this.memory.reserve(
      blob.size * 2 + 8192,
      "canonical/handoff-stage",
    );
    try {
      check(signal);
      const sha256 = await hashBytes(new Uint8Array(await blob.arrayBuffer()));
      check(signal);
      const row = {
        version: 1,
        id: crypto.randomUUID(),
        kind,
        title: String(title).slice(0, 80),
        bytes: blob.size,
        sha256,
        createdAt: Date.now(),
        blob,
        prepared: null,
        accepted: null,
      };
      await this.transaction(
        "readwrite",
        (s, done) => {
          s.add(row, row.id);
          done(metadata(row));
        },
        signal,
      );
      return metadata(row);
    } finally {
      held.release();
    }
  }
  async read(id, { signal } = {}) {
    if (!validId(id)) fail("invalidHandoff");
    const row = await this.transaction(
      "readonly",
      (s, done) => {
        s.get(id).onsuccess = (e) => done(e.target.result);
      },
      signal,
    );
    if (!row) fail("handoffMissing");
    if (
      row.version !== 1 ||
      row.id !== id ||
      !["gamelan", "loop", "legacy"].includes(row.kind) ||
      !(row.blob instanceof Blob) ||
      row.bytes !== row.blob.size ||
      row.bytes < 1 ||
      row.bytes > MAX_CANONICAL_PACKAGE ||
      !/^[a-f0-9]{64}$/.test(row.sha256)
    )
      fail("invalidHandoff");
    if (
      typeof row.title !== "string" ||
      row.title.length > 80 ||
      !Number.isSafeInteger(row.createdAt)
    )
      fail("invalidHandoff");
    if (
      row.prepared &&
      (!/^[a-z0-9-]{1,64}$/.test(row.prepared.backupId) ||
        !/^[a-f0-9]{64}$/.test(row.prepared.baseSHA256) ||
        !["replace", "add"].includes(row.prepared.mode))
    )
      fail("invalidHandoff");
    const held = this.memory.reserve(
      row.bytes * 2 + 8192,
      "canonical/handoff-received",
    );
    let blob = row.blob,
      active = true;
    row.blob = null;
    try {
      check(signal);
      const hash = await hashBytes(new Uint8Array(await blob.arrayBuffer()));
      check(signal);
      if (hash !== row.sha256) fail("handoffHashMismatch");
      held.resize(row.bytes + 4096);
      return Object.freeze({
        info: Object.freeze(metadata(row)),
        get blob() {
          if (!active) fail("handoffReleased");
          return blob;
        },
        release() {
          if (active) {
            active = false;
            blob = null;
            held.release();
          }
        },
      });
    } catch (e) {
      held.release();
      throw e;
    }
  }
  async update(id, sha256, change, { signal } = {}) {
    if (!validId(id)) fail("invalidHandoff");
    return this.transaction(
      "readwrite",
      (s, done, no) => {
        s.get(id).onsuccess = (e) => {
          try {
            const row = e.target.result;
            if (!row || row.sha256 !== sha256) fail("handoffConflict");
            const next = change(row);
            s.put(next, id);
            done(metadata(next));
          } catch (error) {
            no(error);
          }
        };
      },
      signal,
    );
  }
  async list({ after = null, limit = 20, signal } = {}) {
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 20 ||
      (after !== null && typeof after !== "string")
    )
      fail("invalidHandoff");
    return this.transaction(
      "readonly",
      (s, done) => {
        const rows = [],
          request = s.openCursor(
            after === null ? undefined : IDBKeyRange.lowerBound(after, true),
          );
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            done({ rows, next: null });
            return;
          }
          if (rows.length >= limit) {
            done({ rows, next: rows.at(-1).id });
            return;
          }
          const row = cursor.value;
          if (row?.id === cursor.key && validId(row.id))
            rows.push(metadata(row));
          cursor.continue();
        };
      },
      signal,
    );
  }
  prepare(id, sha256, prepared, options) {
    return this.update(
      id,
      sha256,
      (r) => {
        if (r.accepted) fail("handoffAlreadyAccepted");
        if (r.prepared && r.prepared.baseSHA256 !== prepared.baseSHA256)
          fail("handoffTargetChanged");
        return {
          ...r,
          prepared: r.prepared
            ? { ...r.prepared, mode: prepared.mode }
            : prepared,
        };
      },
      options,
    );
  }
  acknowledge(id, sha256, accepted, options) {
    return this.update(
      id,
      sha256,
      (r) => ({ ...r, accepted: r.accepted ?? accepted }),
      options,
    );
  }
  close() {
    this.closed = true;
    this.db?.close();
    this.db = null;
  }
}
export function canonicalBundleHasInput(bundle, hash) {
  return (
    bundle.backupHash === hash ||
    bundle.backupRefs.some((r) => r.sha256 === hash) ||
    bundle.project.origins.some((o) => o.kind === "file" && o.sha256 === hash)
  );
}
