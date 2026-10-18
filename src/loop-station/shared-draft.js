import { fail } from "../project/instrument-contract.js";
// The raw schema5 JSON remains unchanged. Web Locks serialize the expected-value
// check and write across tabs; a renderer revision is not a storage revision.
export class SharedLoopDraft {
  constructor({ key, storage, locks, expected }) {
    Object.assign(this, { key, storage, locks, expected });
  }
  read() {
    try {
      return this.storage().getItem(this.key);
    } catch {
      fail("routeConflict");
    }
  }
  adopt(raw) {
    this.expected = raw;
  }
  async write(raw, { backup } = {}) {
    if (!this.locks?.request) fail("draftLockUnavailable");
    const result = await this.locks.request(this.key, () => {
      let store, current;
      try {
        store = this.storage();
        current = store.getItem(this.key);
      } catch {
        return { error: "routeConflict" };
      }
      // An unreadable initial store can recover only if no other draft exists.
      if (
        current !== this.expected &&
        !(this.expected === undefined && current === null)
      )
        return { error: "draftConflict" };
      try {
        if (backup) store.setItem(this.key + ".recovery", backup);
        store.setItem(this.key, raw);
      } catch {
        return { error: "routeConflict" };
      }
      this.expected = raw;
      return { value: raw };
    });
    // Return errors across the WebIDL callback boundary as data. In particular,
    // Firefox can report a rejected grant callback as a global page error even
    // when the request's promise is handled by the application.
    if (result.error) fail(result.error);
    return result.value;
  }
}
