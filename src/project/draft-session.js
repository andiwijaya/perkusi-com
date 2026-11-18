import { MAX_PROJECT_BYTES, ProjectError } from "./schema.js";

export function withDraftLock(key, work, locks = globalThis.navigator?.locks) {
  return locks ? locks.request(`${key}.write`, work) : work();
}

function sameDraft(a, b) {
  return a?.key === b?.key && a?.raw === b?.raw;
}

function readPending(storage, key) {
  const text = storage.getItem(key);
  if (!text || text.length > 4 * MAX_PROJECT_BYTES + 1024) return null;
  try {
    const pending = JSON.parse(text);
    return typeof pending?.raw === "string" && pending.raw.length > 0
      ? pending
      : null;
  } catch {
    return null;
  }
}

// Write each tab's pending edit before the tab can leave. Only its owner can
// update the slot, and a new tab only recovers slots with no live owner.
export function createDraftSession(store, onError) {
  const key = store.keys.draft;
  const prefix = `${key}.pending.`;
  let slot;
  let stopped = false;
  let release = () => {};
  let source;
  let queued = false;
  let locks;

  async function recoverPending() {
    const storage = store.storage();
    const slots = Array.from({ length: storage.length }, (_, i) =>
      storage.key(i),
    ).filter((name) => name?.startsWith(prefix) && name !== slot);
    for (const name of slots) {
      await locks.request(name, { ifAvailable: true }, (owner) => {
        if (!owner) return;
        const pending = readPending(storage, name);
        if (pending && sameDraft(store.draftSnapshot(), pending.source)) {
          let project;
          try {
            project = store.readDraft({ raw: pending.raw });
          } catch {
            // A damaged pending slot cannot replace the active draft.
          }
          if (project) storage.setItem(key, store.draftText(project));
        }
        storage.removeItem(name);
      });
    }
    return store.draftSnapshot();
  }

  async function open() {
    locks = globalThis.navigator?.locks;
    if (!locks) throw new ProjectError("draftAutosaveUnavailable");
    slot = prefix + globalThis.crypto.randomUUID();
    const lifetime = new Promise((resolve) => (release = resolve));
    return new Promise((resolve, reject) => {
      void locks
        .request(slot, async () => {
          if (stopped) return resolve(null);
          source = await withDraftLock(key, recoverPending, locks);
          resolve(source);
          await lifetime;
        })
        .catch(reject);
    });
  }

  function save(project) {
    if (stopped) return;
    try {
      if (!source) throw new ProjectError("storageUnavailable");
      const storage = store.storage();
      const raw = store.draftText(project);
      if (!sameDraft(store.draftSnapshot(), source))
        throw new ProjectError("draftConflict");
      if (sameDraft(source, { key, raw })) {
        // An Undo back to the saved version cancels any queued edit.
        storage.removeItem(slot);
        return;
      }
      storage.setItem(slot, JSON.stringify({ source, raw }));
      if (queued) return;
      queued = true;
      void withDraftLock(
        key,
        () => {
          queued = false;
          if (stopped) return;
          const pending = readPending(storage, slot);
          if (!pending) return;
          if (!sameDraft(store.draftSnapshot(), pending.source)) {
            storage.removeItem(slot);
            throw new ProjectError("draftConflict");
          }
          storage.setItem(key, pending.raw);
          source = { key, raw: pending.raw };
          storage.removeItem(slot);
        },
        locks,
      ).catch((error) => {
        queued = false;
        if (!stopped) onError(error);
      });
    } catch (error) {
      if (!stopped) onError(error);
    }
  }

  return {
    open,
    save,
    // Transfer delivery uses the same write lock while installing its draft.
    adopt() {
      if (source) source = store.draftSnapshot();
    },
    close() {
      stopped = true;
      release();
    },
  };
}
