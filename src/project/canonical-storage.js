import {
  createCanonicalBundle,
  retainCanonicalBundle,
} from "./canonical-package.js";
import { fail } from "./instrument-contract.js";
const stores = ["documents", "blobs", "credits", "refs", "pointers"],
  check = (s) => {
    if (s?.aborted) fail("cancelled");
  };

// The separately approved canonical database. No legacy database or localStorage
// key is opened/upgraded/written. Revisions and immutable blobs have no auto-GC.
export class CanonicalStorage {
  constructor({
    indexedDB = globalThis.indexedDB,
    name = "perkusi.composition.v6",
    registry,
    memory,
  } = {}) {
    Object.assign(this, { indexedDB, name, registry, memory });
    this.db = null;
    this.opening = null;
    this.closed = false;
  }
  async open() {
    if (this.closed) fail("canonicalStorageClosed");
    if (this.db) return this.db;
    if (this.opening) return this.opening;
    if (!this.indexedDB) fail("canonicalStorageUnavailable");
    this.opening = new Promise((resolve, reject) => {
      const r = this.indexedDB.open(this.name, 1);
      r.onupgradeneeded = () => {
        for (const key of stores) r.result.createObjectStore(key);
      };
      r.onerror = r.onblocked = () => {
        reject(
          Object.assign(Error("canonicalStorageUnavailable"), {
            code: "canonicalStorageUnavailable",
          }),
        );
        r.onsuccess = () => r.result.close();
      };
      r.onsuccess = () => {
        if (this.closed) {
          r.result.close();
          reject(Error("canonicalStorageClosed"));
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
  async save(bundle, { documentId = "current", expected = null, signal } = {}) {
    const owned = retainCanonicalBundle(bundle);
    let held;
    try {
      if (!/^[a-z0-9-]{1,64}$/.test(documentId)) fail("invalidDocumentId");
      check(signal);
      held = this.memory.reserve(
        new TextEncoder().encode(JSON.stringify(owned.project)).length * 2 +
          8192,
        "canonical/storage-document-transaction",
      );
      const db = await this.open();
      check(signal);
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(stores, "readwrite"),
          get = (name) => tx.objectStore(name),
          pointers = get("pointers"),
          documents = get("documents"),
          blobs = get("blobs"),
          credits = get("credits");
        let code = "canonicalStorageWriteFailed",
          revision;
        const abort = () => {
          code = "cancelled";
          try {
            tx.abort();
          } catch {
            /* Completed. */
          }
        };
        signal?.addEventListener("abort", abort, { once: true });
        const prior = pointers.get(documentId);
        prior.onsuccess = () => {
          try {
            check(signal);
            if ((prior.result?.revision ?? null) !== expected) {
              code = "draftConflict";
              tx.abort();
              return;
            }
            revision = (expected ?? 0) + 1;
            for (const o of owned.project.origins.filter(
              (o) => o.kind === "file",
            ))
              blobs.put(owned.originals.get(o.sha256), o.sha256);
            for (const a of owned.project.assets) {
              const e = owned.entries.get(a.id);
              blobs.put(e.blob, a.sha256);
              const key = documentId + ":" + a.id + ":" + a.sha256,
                old = credits.get(key);
              old.onsuccess = () => {
                try {
                  const versions = old.result?.versions ?? [];
                  credits.put(
                    {
                      versions: [
                        ...versions,
                        { revision, provenance: e.provenance },
                      ],
                    },
                    key,
                  );
                } catch (e) {
                  code = signal?.aborted
                    ? "cancelled"
                    : e.name === "QuotaExceededError"
                      ? "canonicalStorageFull"
                      : "canonicalStorageWriteFailed";
                  tx.abort();
                }
              };
            }
            if (owned.backup) blobs.put(owned.backup, owned.backupHash);
            for (const b of owned.backupRefs)
              blobs.put(owned.backups.get(b.sha256).blob, b.sha256);
            documents.put(
              {
                project: owned.project,
                revision,
                backupHash: owned.backupHash,
                backups: owned.backupRefs,
              },
              documentId + ":" + revision,
            );
            get("refs").put(
              {
                documentId,
                revision,
                kind: "document-history",
                hashes: [
                  ...owned.project.origins
                    .filter((o) => o.kind === "file")
                    .map((o) => o.sha256),
                  ...owned.project.assets.map((a) => a.sha256),
                  ...(owned.backupHash ? [owned.backupHash] : []),
                  ...owned.backupRefs.map((b) => b.sha256),
                ],
              },
              documentId + ":" + revision,
            );
            pointers.put({ revision }, documentId);
          } catch (e) {
            code = signal?.aborted
              ? "cancelled"
              : e.name === "QuotaExceededError"
                ? "canonicalStorageFull"
                : typeof e.code === "string"
                  ? e.code
                  : "canonicalStorageWriteFailed";
            try {
              tx.abort();
            } catch {
              /* Completed. */
            }
          }
        };
        const done = () => signal?.removeEventListener("abort", abort);
        tx.oncomplete = () => {
          done();
          resolve(revision);
        };
        tx.onerror = () => {
          if (tx.error?.name === "QuotaExceededError")
            code = "canonicalStorageFull";
        };
        tx.onabort = () => {
          done();
          reject(
            Object.assign(Error(code), {
              code:
                tx.error?.name === "QuotaExceededError"
                  ? "canonicalStorageFull"
                  : code,
            }),
          );
        };
      });
    } finally {
      held?.release();
      owned.dispose();
    }
  }
  async load({ documentId = "current", revision = null, signal } = {}) {
    check(signal);
    const db = await this.open();
    check(signal);
    const raw = await new Promise((resolve, reject) => {
      const tx = db.transaction(stores, "readonly"),
        get = (n) => tx.objectStore(n),
        entries = new Map(),
        originals = new Map();
      let value = null,
        code = "canonicalStorageUnavailable";
      const abort = () => {
        code = "cancelled";
        try {
          tx.abort();
        } catch {
          /* Completed. */
        }
      };
      signal?.addEventListener("abort", abort, { once: true });
      const read = (r) => {
        const key = documentId + ":" + r,
          request = get("documents").get(key);
        request.onsuccess = () => {
          try {
            if (!request.result) return;
            const p = request.result.project;
            if (
              !Array.isArray(p?.assets) ||
              p.assets.length > 128 ||
              !Array.isArray(p.origins) ||
              p.origins.length > 33
            )
              fail("invalidCanonicalProject");
            value = {
              project: p,
              revision: r,
              backupHash: request.result.backupHash ?? null,
              backup: null,
              backups: new Map(),
              backupRefs: request.result.backups ?? [],
            };
            if (
              !Array.isArray(value.backupRefs) ||
              value.backupRefs.length > 33
            )
              fail("invalidCanonicalPackage");
            for (const ref of value.backupRefs) {
              if (!/^[a-f0-9]{64}$/.test(ref.sha256))
                fail("invalidCanonicalPackage");
              const b = get("blobs").get(ref.sha256);
              b.onsuccess = () =>
                value.backups.set(ref.sha256, {
                  blob: b.result,
                  name: ref.name,
                });
            }
            if (value.backupHash) {
              const b = get("blobs").get(value.backupHash);
              b.onsuccess = () => (value.backup = b.result);
            }
            for (const o of p.origins.filter((o) => o.kind === "file")) {
              const b = get("blobs").get(o.sha256);
              b.onsuccess = () => originals.set(o.sha256, b.result);
            }
            for (const a of p.assets) {
              const row = {};
              entries.set(a.id, row);
              const b = get("blobs").get(a.sha256),
                c = get("credits").get(
                  documentId + ":" + a.id + ":" + a.sha256,
                );
              b.onsuccess = () => (row.blob = b.result);
              c.onsuccess = () =>
                (row.provenance = c.result?.versions.find(
                  (v) => v.revision === r,
                )?.provenance);
            }
          } catch (e) {
            code = e.code ?? "invalidCanonicalProject";
            tx.abort();
          }
        };
      };
      if (revision !== null) read(revision);
      else {
        const pointer = get("pointers").get(documentId);
        pointer.onsuccess = () => {
          if (pointer.result) read(pointer.result.revision);
        };
      }
      const done = () => signal?.removeEventListener("abort", abort);
      tx.oncomplete = () => {
        done();
        resolve(value ? { ...value, entries, originals } : null);
      };
      tx.onerror = () => {};
      tx.onabort = () => {
        done();
        reject(Object.assign(Error(code), { code }));
      };
    });
    check(signal);
    if (!raw) return null;
    const bundle = await createCanonicalBundle(raw.project, {
      registry: this.registry,
      memory: this.memory,
      signal,
      entries: raw.entries,
      originals: raw.originals,
      backup: raw.backup,
      backups: raw.backups,
    });
    if (bundle.backupHash !== raw.backupHash) {
      bundle.dispose();
      fail("canonicalBackupHash");
    }
    if (JSON.stringify(bundle.backupRefs) !== JSON.stringify(raw.backupRefs)) {
      bundle.dispose();
      fail("canonicalBackupHash");
    }
    return { bundle, revision: raw.revision };
  }
  close() {
    this.closed = true;
    this.db?.close();
    this.db = null;
  }
}
