import { validateInstrumentProject } from "./instrument-project.js";
import {
  record,
  array,
  utf8Bytes,
  frozenCopy,
  fail,
} from "./instrument-contract.js";

export const INSTRUMENT_STORE_KEY = "perkusi.workspace.gamelan.v4";
export const INSTRUMENT_STORE_BYTES = 4 * 1024 * 1024;
export const INSTRUMENT_SAVED_MAX = 30;

// Metadata only; no PCM, local paths, user takes or legacy store rewrites.
// A single bounded envelope makes saved items + current draft one atomic write.
export class InstrumentProjectStore {
  constructor(
    registry,
    {
      storage = () => globalThis.localStorage,
      makeId = () => globalThis.crypto.randomUUID(),
    } = {},
  ) {
    Object.assign(this, { registry, storage, makeId });
  }
  #read() {
    let raw;
    try {
      raw = this.storage().getItem(INSTRUMENT_STORE_KEY);
    } catch {
      fail("storageUnavailable");
    }
    if (raw === null) return { version: 4, draft: null, items: [] };
    try {
      if (typeof raw !== "string" || utf8Bytes(raw) > INSTRUMENT_STORE_BYTES)
        throw Error();
      const data = JSON.parse(raw);
      // JSON.parse creates data properties; bound the envelope here, then apply
      // the existing tree/grammar budget independently to each complete project.
      record(data, ["version", "draft", "items"], "storageCorrupt");
      if (data.version !== 4) throw Error();
      array(data.items, 0, INSTRUMENT_SAVED_MAX, "storageCorrupt");
      const ids = new Set(),
        items = data.items.map((item) => {
          record(item, ["id", "project"], "storageCorrupt");
          if (
            typeof item.id !== "string" ||
            !/^[a-z0-9-]{1,64}$/.test(item.id) ||
            ids.has(item.id)
          )
            throw Error();
          ids.add(item.id);
          return {
            id: item.id,
            project: validateInstrumentProject(item.project, this.registry),
          };
        });
      return {
        version: 4,
        draft:
          data.draft === null
            ? null
            : validateInstrumentProject(data.draft, this.registry),
        items,
      };
    } catch {
      fail("storageCorrupt");
    }
  }
  #write(data) {
    const text = JSON.stringify(data);
    if (utf8Bytes(text) > INSTRUMENT_STORE_BYTES) fail("storageFull");
    try {
      this.storage().setItem(INSTRUMENT_STORE_KEY, text);
    } catch (e) {
      fail(
        e?.name === "QuotaExceededError" ? "storageFull" : "storageUnavailable",
      );
    }
  }
  list() {
    return frozenCopy(this.#read().items);
  }
  readDraft() {
    return this.#read().draft;
  }
  saveDraft(project) {
    const valid = validateInstrumentProject(project, this.registry),
      data = this.#read();
    data.draft = valid;
    this.#write(data);
  }
  save(project) {
    const valid = validateInstrumentProject(project, this.registry),
      data = this.#read();
    if (data.items.length >= INSTRUMENT_SAVED_MAX) fail("storageFull");
    const id = this.makeId();
    if (
      typeof id !== "string" ||
      !/^[a-z0-9-]{1,64}$/.test(id) ||
      data.items.some((i) => i.id === id)
    )
      fail("storageUnavailable");
    data.items.push({ id, project: valid });
    data.draft = valid;
    this.#write(data);
    return id;
  }
  load(id) {
    const item = this.#read().items.find((i) => i.id === id);
    if (!item) fail("missingProject");
    return item.project;
  }
  remove(id) {
    const data = this.#read(),
      index = data.items.findIndex((i) => i.id === id);
    if (index < 0) fail("missingProject");
    data.items.splice(index, 1);
    this.#write(data);
  }
}
