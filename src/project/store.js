import { parseProject, validateProject, ProjectError } from "./schema.js";

export const PROJECTS_KEY = "perkusi.projects.v1";
export const DRAFT_KEY = "perkusi.draft.v1";
export const MAX_SAVED_PROJECTS = 30;
export const MAX_STORE_BYTES = 256 * 1024;
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
  save(project) {
    const valid = validateProject(project, this.catalog),
      items = this.read();
    if (items.length >= MAX_SAVED_PROJECTS)
      throw new ProjectError("storageFull");
    const id = this.makeId();
    if (
      typeof id !== "string" ||
      !/^[a-z0-9-]{1,64}$/.test(id) ||
      items.some((x) => x.id === id)
    )
      throw new ProjectError("storageUnavailable");
    this.write([...items, { id, project: valid }]);
    return id;
  }
  remove(id) {
    const items = this.read();
    if (!items.some((x) => x.id === id))
      throw new ProjectError("missingProject");
    this.write(items.filter((x) => x.id !== id));
  }
  load(id) {
    const item = this.read().find((x) => x.id === id);
    if (!item) throw new ProjectError("missingProject");
    return item.project;
  }
  readDraft() {
    try {
      const text = this.storage().getItem(this.keys.draft);
      return text ? parseProject(text, this.catalog) : null;
    } catch {
      throw new ProjectError("storageUnavailable");
    }
  }
  saveDraft(project) {
    try {
      this.storage().setItem(
        this.keys.draft,
        JSON.stringify(validateProject(project, this.catalog)),
      );
    } catch {
      throw new ProjectError("storageUnavailable");
    }
  }
}
