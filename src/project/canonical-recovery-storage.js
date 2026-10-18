import { CanonicalStorage } from "./canonical-storage.js";
import { fail } from "./instrument-contract.js";

// Recovery never creates/upgrades a database and exposes only readonly reads.
export class CanonicalRecoveryStorage extends CanonicalStorage {
  async open() {
    if (this.closed) fail("canonicalStorageClosed");
    if (this.db) return this.db;
    if (this.opening) return this.opening;
    if (!this.indexedDB) fail("canonicalStorageUnavailable");
    this.opening = new Promise((resolve, reject) => {
      let created = false;
      const r = this.indexedDB.open(this.name);
      r.onupgradeneeded = () => {
        created = true;
        r.transaction.abort();
      };
      r.onerror = r.onblocked = () =>
        reject(
          Object.assign(
            Error(created ? "missingProject" : "canonicalStorageUnavailable"),
            {
              code: created ? "missingProject" : "canonicalStorageUnavailable",
            },
          ),
        );
      r.onsuccess = () => {
        const db = r.result;
        if (
          this.closed ||
          db.version !== 1 ||
          !["documents", "blobs", "credits", "refs", "pointers"].every((n) =>
            db.objectStoreNames.contains(n),
          )
        ) {
          db.close();
          reject(
            Object.assign(Error("canonicalStorageUnavailable"), {
              code: "canonicalStorageUnavailable",
            }),
          );
          return;
        }
        this.db = db;
        db.onversionchange = () => {
          db.close();
          this.db = null;
        };
        resolve(db);
      };
    });
    try {
      return await this.opening;
    } finally {
      this.opening = null;
    }
  }
  save() {
    fail("recoveryReadOnly");
  }
  async list({ after = null } = {}) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const rows = [],
        tx = db.transaction(["pointers"], "readonly"),
        r = tx.objectStore("pointers").openCursor();
      let more = false;
      r.onsuccess = () => {
        const c = r.result;
        if (!c) return;
        if (after !== null && c.key <= after) {
          c.continue();
          return;
        }
        if (rows.length === 30) {
          more = true;
          return;
        }
        rows.push({ id: c.key, revision: c.value.revision });
        c.continue();
      };
      tx.oncomplete = () =>
        resolve({ rows, next: more ? rows.at(-1).id : null });
      tx.onabort = tx.onerror = () =>
        reject(
          Object.assign(Error("canonicalStorageUnavailable"), {
            code: "canonicalStorageUnavailable",
          }),
        );
    });
  }
}
