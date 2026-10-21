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
  async save(
    bundle,
    { documentId = "current", expected = null, currentExpected, signal } = {},
  ) {
    const owned = retainCanonicalBundle(bundle);
    let held, previousHeld;
    try {
      if (
        typeof documentId !== "string" ||
        !/^[a-z0-9-]{1,64}$/.test(documentId)
      )
        fail("invalidDocumentId");
      if (currentExpected !== undefined && documentId === "current")
        fail("invalidDocumentId");
      check(signal);
      held = this.memory.reserve(
        new TextEncoder().encode(JSON.stringify(owned.project)).length *
          (currentExpected === undefined ? 2 : 4) +
          (currentExpected === undefined ? 8192 : 16384),
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
        const targets = [{ documentId, expected }];
        if (currentExpected !== undefined)
          targets.push({ documentId: "current", expected: currentExpected });
        let code = "canonicalStorageWriteFailed",
          unread = targets.length;
        const abort = () => {
          code = "cancelled";
          try {
            tx.abort();
          } catch {
            /* Completed. */
          }
        };
        signal?.addEventListener("abort", abort, { once: true });
        const write = ({ documentId: id, revision }) => {
          try {
            check(signal);
            for (const o of owned.project.origins.filter(
              (o) => o.kind === "file",
            ))
              blobs.put(owned.originals.get(o.sha256), o.sha256);
            for (const a of owned.project.assets) {
              const e = owned.entries.get(a.id);
              blobs.put(e.blob, a.sha256);
              const key = id + ":" + a.id + ":" + a.sha256,
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
              id + ":" + revision,
            );
            get("refs").put(
              {
                documentId: id,
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
              id + ":" + revision,
            );
            pointers.put(
              id === "current" && targets.length === 2
                ? {
                    revision,
                    libraryDocumentId: documentId,
                    libraryRevision: targets[0].revision,
                  }
                : { revision },
              id,
            );
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
        const writeAll = () => {
          for (const t of targets) write(t);
        };
        const preserveCurrent = () => {
          const p = targets.find((t) => t.documentId === "current")?.prior;
          if (!p) return writeAll();
          const preserve = () => {
            const id = "recovered-current-" + p.revision,
              prior = pointers.get(id);
            prior.onsuccess = () => {
              if (
                prior.result &&
                (prior.result.recoveredCurrentRevision !== p.revision ||
                  prior.result.revision !== p.revision)
              ) {
                code = "draftConflict";
                tx.abort();
                return;
              }
              if (prior.result) return writeAll();
              try {
                previousHeld = this.memory.reserve(
                  4 * 1024 * 1024 + 16384,
                  "canonical/preserve-current-metadata",
                );
                const old = documents.get("current:" + p.revision);
                old.onsuccess = () => {
                  try {
                    const row = old.result;
                    if (
                      !row ||
                      !Array.isArray(row.project?.assets) ||
                      row.project.assets.length > 128
                    )
                      fail("invalidCanonicalProject");
                    documents.put(row, id + ":" + p.revision);
                    const refs = get("refs").get("current:" + p.revision);
                    refs.onsuccess = () => {
                      if (!refs.result) {
                        code = "invalidCanonicalProject";
                        tx.abort();
                        return;
                      }
                      get("refs").put(
                        { ...refs.result, documentId: id },
                        id + ":" + p.revision,
                      );
                    };
                    for (const a of row.project.assets) {
                      const key = ":" + a.id + ":" + a.sha256,
                        credit = credits.get("current" + key);
                      credit.onsuccess = () => {
                        const provenance = credit.result?.versions?.find(
                          (v) => v.revision === p.revision,
                        );
                        if (!provenance) {
                          code = "invalidCanonicalProject";
                          tx.abort();
                          return;
                        }
                        credits.put({ versions: [provenance] }, id + key);
                      };
                    }
                    // Copy only metadata/credits; immutable source blobs and
                    // historical references remain pinned and unchanged.
                    pointers.put(
                      {
                        revision: p.revision,
                        recoveredCurrentRevision: p.revision,
                      },
                      id,
                    );
                    writeAll();
                  } catch (e) {
                    code = e.code ?? "canonicalStorageWriteFailed";
                    tx.abort();
                  }
                };
              } catch (e) {
                code = e.code ?? "canonicalStorageWriteFailed";
                tx.abort();
              }
            };
          };
          if (
            typeof p.libraryDocumentId === "string" &&
            /^[a-z0-9-]{1,64}$/.test(p.libraryDocumentId) &&
            p.libraryDocumentId !== "current"
          ) {
            const named = pointers.get(p.libraryDocumentId);
            named.onsuccess = () =>
              named.result?.revision === p.libraryRevision
                ? writeAll()
                : preserve();
          } else preserve();
        };
        // A named project and the existing compatible "current" recovery
        // snapshot commit in ONE transaction. No new database/schema or GC.
        for (const target of targets) {
          const prior = pointers.get(target.documentId);
          prior.onsuccess = () => {
            if ((prior.result?.revision ?? null) !== target.expected) {
              code = "draftConflict";
              tx.abort();
              return;
            }
            target.revision = (target.expected ?? 0) + 1;
            target.prior = prior.result;
            if (!Number.isSafeInteger(target.revision)) {
              code = "canonicalRevisionLimit";
              tx.abort();
              return;
            }
            if (!--unread)
              targets.length === 2 ? preserveCurrent() : writeAll();
          };
        }
        const done = () => signal?.removeEventListener("abort", abort);
        tx.oncomplete = () => {
          done();
          resolve(
            targets.length === 2
              ? {
                  revision: targets[0].revision,
                  currentRevision: targets[1].revision,
                }
              : targets[0].revision,
          );
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
      previousHeld?.release();
      held?.release();
      owned.dispose();
    }
  }
  async load({ documentId = "current", revision = null, signal } = {}) {
    if (
      typeof documentId !== "string" ||
      !/^[a-z0-9-]{1,64}$/.test(documentId) ||
      (revision !== null && (!Number.isSafeInteger(revision) || revision < 1))
    )
      fail("invalidDocumentId");
    check(signal);
    const db = await this.open();
    check(signal);
    const raw = await new Promise((resolve, reject) => {
      const tx = db.transaction(stores, "readonly"),
        get = (n) => tx.objectStore(n),
        entries = new Map(),
        originals = new Map();
      let value = null,
        library = null,
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
          if (pointer.result) {
            const p = pointer.result;
            if (
              documentId === "current" &&
              typeof p.libraryDocumentId === "string" &&
              /^[a-z0-9-]{1,64}$/.test(p.libraryDocumentId) &&
              p.libraryDocumentId !== "current" &&
              Number.isSafeInteger(p.libraryRevision) &&
              p.libraryRevision > 0
            ) {
              const named = get("pointers").get(p.libraryDocumentId);
              named.onsuccess = () => {
                if (named.result?.revision === p.libraryRevision)
                  library = {
                    documentId: p.libraryDocumentId,
                    revision: p.libraryRevision,
                  };
              };
            }
            read(p.revision);
          }
        };
      }
      const done = () => signal?.removeEventListener("abort", abort);
      tx.oncomplete = () => {
        done();
        resolve(value ? { ...value, entries, originals, library } : null);
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
    return {
      bundle,
      revision: raw.revision,
      ...(raw.library ? { library: raw.library } : {}),
    };
  }
  async readCurrentRevision({ signal } = {}) {
    check(signal);
    const held = this.memory.reserve(8192, "canonical/current-pointer-read");
    try {
      const db = await this.open();
      check(signal);
      const revision = await new Promise((resolve, reject) => {
        const tx = db.transaction(["pointers"], "readonly"),
          request = tx.objectStore("pointers").get("current");
        tx.oncomplete = () => resolve(request.result?.revision ?? null);
        tx.onabort = () =>
          reject(
            Object.assign(Error("canonicalStorageUnavailable"), {
              code: "canonicalStorageUnavailable",
            }),
          );
        tx.onerror = () => {};
      });
      check(signal);
      if (
        revision !== null &&
        (!Number.isSafeInteger(revision) || revision < 1)
      )
        fail("invalidCanonicalProject");
      return revision;
    } finally {
      held.release();
    }
  }
  close() {
    this.closed = true;
    this.db?.close();
    this.db = null;
  }
}
