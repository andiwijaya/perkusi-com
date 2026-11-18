import { parseProject, validateProject, ProjectError } from "./schema.js";

export const PROJECTS_KEY = "perkusi.projects.v1";
export const DRAFT_KEY = "perkusi.draft.v1";
export const MAX_SAVED_PROJECTS = 30;
export const MAX_STORE_BYTES = 256 * 1024;
const SEPARATE_SAVE_PREFIX = "separate-";
export const isSeparateSave = (id) => id.startsWith(SEPARATE_SAVE_PREFIX);
export function assertSavedProjectUnchanged(item, expected) {
  if (!item)
    throw new ProjectError(
      expected === undefined ? "missingProject" : "projectChanged",
    );
  if (expected === undefined) return;
  const sorted = (value) =>
    Array.isArray(value)
      ? value.map(sorted)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, sorted(value[key])]),
          )
        : value;
  if (JSON.stringify(sorted(item.project)) !== JSON.stringify(sorted(expected)))
    throw new ProjectError("projectChanged");
}
export class ProjectStore {
  constructor(
    catalog,
    storage = () => globalThis.localStorage,
    makeId = () => globalThis.crypto.randomUUID(),
    keys = { projects: PROJECTS_KEY, draft: DRAFT_KEY },
  ) {
    this.catalog = catalog;
    this.storage = storage;
    this.makeId = makeId;
    this.keys = keys;
  }
  read() {
    try {
      const text = this.storage().getItem(this.keys.projects);
      if (!text) return [];
      if (new TextEncoder().encode(text).length > MAX_STORE_BYTES)
        throw Error();
      const data = JSON.parse(text);
      if (
        data.version !== 1 ||
        Object.keys(data).sort().join() !== "items,version" ||
        !Array.isArray(data.items) ||
        data.items.length > MAX_SAVED_PROJECTS
      )
        throw Error();
      const ids = new Set();
      return data.items.map((item) => {
        if (
          !item ||
          Object.keys(item).sort().join() !== "id,project" ||
          typeof item.id !== "string" ||
          !/^[a-z0-9-]{1,64}$/.test(item.id) ||
          ids.has(item.id)
        )
          throw Error();
        ids.add(item.id);
        return {
          id: item.id,
          project: validateProject(item.project, this.catalog),
        };
      });
    } catch {
      throw new ProjectError("storageUnavailable");
    }
  }
  write(items) {
    const text = JSON.stringify({ version: 1, items });
    if (new TextEncoder().encode(text).length > MAX_STORE_BYTES)
      throw new ProjectError("storageFull");
    try {
      this.storage().setItem(this.keys.projects, text);
    } catch {
      throw new ProjectError("storageUnavailable");
    }
  }
  save(project, { separate = false } = {}) {
    return this.addSavedItem(
      validateProject(project, this.catalog),
      this.read(),
      separate,
    );
  }
  addSavedItem(project, items, separate) {
    if (items.length >= MAX_SAVED_PROJECTS)
      throw new ProjectError("storageFull");
    const base = this.makeId();
    if (typeof base !== "string" || !/^[a-z0-9-]{1,64}$/.test(base))
      throw new ProjectError("storageUnavailable");
    const id = separate ? SEPARATE_SAVE_PREFIX + base : base;
    if (id.length > 64 || items.some((x) => x.id === id))
      throw new ProjectError("storageUnavailable");
    this.write([...items, { id, project }]);
    return id;
  }
  remove(id, expected) {
    const items = this.read();
    assertSavedProjectUnchanged(
      items.find((x) => x.id === id),
      expected,
    );
    this.write(items.filter((x) => x.id !== id));
  }
  load(id, expected) {
    const item = this.read().find((x) => x.id === id);
    assertSavedProjectUnchanged(item, expected);
    return item.project;
  }
  draftSnapshot() {
    try {
      const key = this.keys.draft;
      return { key, raw: this.storage().getItem(key) };
    } catch {
      throw new ProjectError("storageUnavailable");
    }
  }
  readDraft({ raw } = this.draftSnapshot()) {
    try {
      return raw ? parseProject(raw, this.catalog) : null;
    } catch {
      throw new ProjectError("storageUnavailable");
    }
  }
  draftText(project) {
    return JSON.stringify(validateProject(project, this.catalog));
  }
  saveDraft(project) {
    try {
      this.storage().setItem(this.keys.draft, this.draftText(project));
    } catch {
      throw new ProjectError("storageUnavailable");
    }
  }
}
