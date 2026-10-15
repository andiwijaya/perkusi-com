import { validateInstrumentProject } from "./instrument-project.js";
import { record, integer, utf8Bytes, fail } from "./instrument-contract.js";

export const INSTRUMENT_ROUTE_KEY = "perkusi.workspace.instrument-route.v4";
export const INSTRUMENT_ROUTE_BYTES = 3 * 1024 * 1024;
// One tab, one editable project across views. No shared legacy target draft or
// pending replay token; Back/Forward always read this tab's latest accepted data.
export class InstrumentRouteStore {
  #expected;
  #loaded = false;
  #closed = false;
  #hasRaw = false;
  #hasOriginal = false;
  constructor(registry, { storage = () => globalThis.sessionStorage } = {}) {
    Object.assign(this, { registry, storage });
  }
  #raw() {
    try {
      return this.storage().getItem(INSTRUMENT_ROUTE_KEY);
    } catch {
      fail("storageUnavailable");
    }
  }
  #parse(raw) {
    if (raw === null) return null;
    try {
      if (typeof raw !== "string" || utf8Bytes(raw) > INSTRUMENT_ROUTE_BYTES)
        throw Error();
      const value = JSON.parse(raw);
      record(
        value,
        ["version", "revision", "project", "source"],
        "routeCorrupt",
      );
      if (value.version !== 1 || !integer(value.revision, 1, 1000000000))
        throw Error();
      return {
        ...value,
        project: validateInstrumentProject(value.project, this.registry),
        source:
          value.source === null
            ? null
            : validateInstrumentProject(value.source, this.registry),
      };
    } catch {
      fail("routeCorrupt");
    }
  }
  readDraft() {
    if (this.#closed) fail("routeClosed");
    this.#loaded = false;
    this.#expected = undefined;
    this.#hasOriginal = false;
    const raw = this.#raw();
    this.#hasRaw = raw !== null;
    const data = this.#parse(raw);
    this.#hasOriginal = data?.source !== null && !!data;
    this.#expected = raw;
    this.#loaded = true;
    return data?.project ?? null;
  }
  #write(project, source) {
    if (this.#closed) fail("routeClosed");
    const valid = validateInstrumentProject(project, this.registry);
    if (!this.#loaded) {
      const unseen = this.readDraft();
      if (unseen !== null) {
        this.#loaded = false;
        this.#expected = undefined;
        fail("routeConflict");
      }
    }
    const raw = this.#raw();
    if (raw !== this.#expected) fail("routeConflict");
    const old = this.#parse(raw);
    if (!source && old && JSON.stringify(old.project) === JSON.stringify(valid))
      return;
    const text = JSON.stringify({
      version: 1,
      revision: (old?.revision ?? 0) + 1,
      project: valid,
      source: source ? valid : (old?.source ?? null),
    });
    if (
      (old?.revision ?? 0) >= 1000000000 ||
      utf8Bytes(text) > INSTRUMENT_ROUTE_BYTES
    )
      fail("storageFull");
    try {
      this.storage().setItem(INSTRUMENT_ROUTE_KEY, text);
    } catch (error) {
      if (this.#raw() !== text)
        fail(
          error?.name === "QuotaExceededError"
            ? "storageFull"
            : "storageUnavailable",
        );
    }
    const actual = this.#raw();
    if (actual !== text)
      fail(actual === raw ? "storageUnavailable" : "routeConflict");
    this.#expected = text;
    this.#hasRaw = true;
    this.#hasOriginal = source || !!old?.source;
  }
  saveDraft(project) {
    this.#write(project, false);
  }
  prepare(project) {
    this.#write(project, true);
  }
  original() {
    return this.#parse(this.#raw())?.source ?? null;
  }
  rawBackup() {
    const raw = this.#raw();
    if (raw !== null && utf8Bytes(raw) > INSTRUMENT_ROUTE_BYTES)
      fail("routeCorrupt");
    return raw;
  }
  close() {
    this.#closed = true;
  }
  get hasRaw() {
    return this.#hasRaw;
  }
  get hasOriginal() {
    return this.#hasOriginal;
  }
}
