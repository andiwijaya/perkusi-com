import { AudioDocument } from "../loop-station/audio-document.js";
import { fail } from "./instrument-contract.js";

// Explicit read-only recovery. Never creates/upgrades a legacy database, opens
// audio, writes a pointer, or migrates the user's saved document in place.
export async function exportLegacyLoopProject({
  indexedDB = globalThis.indexedDB,
  registry,
  memory,
} = {}) {
  if (!indexedDB) fail("audioStorageUnavailable");
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      let missing = false;
      const r = indexedDB.open("perkusi.loop-audio.v1");
      r.onupgradeneeded = () => {
        missing = true;
        r.transaction.abort();
      };
      r.onerror = () =>
        reject(
          Object.assign(
            Error(missing ? "missingProject" : "audioStorageUnavailable"),
            { code: missing ? "missingProject" : "audioStorageUnavailable" },
          ),
        );
      r.onblocked = () => {
        reject(
          Object.assign(Error("audioStorageUnavailable"), {
            code: "audioStorageUnavailable",
          }),
        );
        r.onsuccess = () => r.result.close();
      };
      r.onsuccess = () => {
        if (
          r.result.version !== 1 ||
          !["documents", "audio", "credits"].every((s) =>
            r.result.objectStoreNames.contains(s),
          )
        ) {
          r.result.close();
          reject(
            Object.assign(Error("audioStorageUnavailable"), {
              code: "audioStorageUnavailable",
            }),
          );
        } else resolve(r.result);
      };
    });
    const read = (store, key) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readonly"),
          r = tx.objectStore(store).get(key);
        let value;
        r.onsuccess = () => (value = r.result);
        tx.oncomplete = () => resolve(value ?? null);
        tx.onabort = tx.onerror = () =>
          reject(tx.error ?? Error("audioStorageUnavailable"));
      });
    const backend = {
        read,
        async entry(ref) {
          const [blob, provenance] = await Promise.all([
            read("audio", ref.sha256),
            read("credits", ref.id + ":" + ref.sha256),
          ]);
          return { blob, provenance };
        },
      },
      document = new AudioDocument({ registry, memory, backend }),
      project = await document.read();
    if (!project) fail("missingProject");
    const output = await document.portable(project);
    return output;
  } finally {
    db?.close();
  }
}
