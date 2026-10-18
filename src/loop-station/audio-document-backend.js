import { checkAbort } from "./recording-data.js";
import { fail } from "../project/instrument-contract.js";

// The document, PCM and credits share one commit point. There is no automatic GC:
// project undo/redo and an older portable backup may still reference these bytes.
export class AudioDocumentBackend {
  constructor(
    indexedDB = globalThis.indexedDB,
    name = "perkusi.loop-audio.v1",
  ) {
    this.indexedDB = indexedDB;
    this.name = name;
    this.db = null;
  }
  async open() {
    if (this.db) return;
    if (!this.indexedDB) fail("audioStorageUnavailable");
    this.db = await new Promise((resolve, reject) => {
      const request = this.indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => {
        for (const name of ["documents", "audio", "credits"])
          request.result.createObjectStore(name);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          Object.assign(new Error("storage"), {
            code: "audioStorageUnavailable",
          }),
        );
      request.onblocked = () => {
        reject(
          Object.assign(new Error("blocked"), {
            code: "audioStorageUnavailable",
          }),
        );
        request.onsuccess = () => request.result.close();
      };
    });
    this.db.onversionchange = () => {
      this.db.close();
      this.db = null;
    };
  }
  async read(store, key) {
    await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, "readonly"),
        request = tx.objectStore(store).get(key);
      let value;
      request.onsuccess = () => {
        value = request.result;
      };
      tx.oncomplete = () => resolve(value ?? null);
      tx.onerror = tx.onabort = () =>
        reject(
          Object.assign(new Error("read"), { code: "audioStorageUnavailable" }),
        );
    });
  }
  async entry(ref) {
    const [blob, provenance] = await Promise.all([
      this.read("audio", ref.sha256),
      this.read("credits", ref.id + ":" + ref.sha256),
    ]);
    return { blob, provenance };
  }
  async commit(raw, refs, entries, expected, { signal, backup } = {}) {
    checkAbort(signal);
    await this.open();
    checkAbort(signal);
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(
          ["documents", "audio", "credits"],
          "readwrite",
        ),
        docs = tx.objectStore("documents"),
        audio = tx.objectStore("audio"),
        credits = tx.objectStore("credits");
      let code = "audioStorageWriteFailed",
        revision;
      const abort = () => {
        code = "cancelled";
        try {
          tx.abort();
        } catch {
          /* Already committed. */
        }
      };
      signal?.addEventListener("abort", abort, { once: true });
      const request = docs.get("current");
      request.onsuccess = () => {
        try {
          if ((request.result?.revision ?? null) !== expected) {
            code = "draftConflict";
            tx.abort();
            return;
          }
          revision = (expected ?? 0) + 1;
          for (const ref of refs) {
            const entry = entries.get(ref.id);
            if (!entry || entry.blob.size !== ref.bytes) {
              code = "missingRecording";
              tx.abort();
              return;
            }
            audio.put(entry.blob, ref.sha256);
            const key = ref.id + ":" + ref.sha256,
              prior = credits.get(key);
            prior.onsuccess = () => {
              try {
                const old = prior.result;
                // Keep both sets of credits when identical immutable PCM has two origins.
                const text =
                  old && old !== entry.provenance
                    ? old.includes(entry.provenance)
                      ? old
                      : old + "\n\n" + entry.provenance
                    : entry.provenance;
                if (new TextEncoder().encode(text).length > 65536) {
                  code = "recordingCreditsRequired";
                  tx.abort();
                  return;
                }
                credits.put(text, key);
              } catch (e) {
                code =
                  e.name === "QuotaExceededError"
                    ? "audioStorageFull"
                    : "audioStorageWriteFailed";
                tx.abort();
              }
            };
          }
          if (backup) docs.put(backup, "recovery");
          docs.put({ raw, revision }, "current");
        } catch (e) {
          code =
            e.name === "QuotaExceededError"
              ? "audioStorageFull"
              : signal?.aborted
                ? "cancelled"
                : "audioStorageWriteFailed";
          try {
            tx.abort();
          } catch {
            /* Abort already issued. */
          }
        }
      };
      const cleanup = () => signal?.removeEventListener("abort", abort);
      tx.oncomplete = () => {
        cleanup();
        resolve(revision);
      };
      tx.onabort = () => {
        cleanup();
        reject(
          Object.assign(new Error(code), {
            code:
              tx.error?.name === "QuotaExceededError"
                ? "audioStorageFull"
                : code,
          }),
        );
      };
      tx.onerror = () => {
        if (tx.error?.name === "QuotaExceededError") code = "audioStorageFull";
      };
    });
  }
  close() {
    this.db?.close();
    this.db = null;
  }
}
