import { ProjectStore } from "./store.js";
import { migrateProject, ProjectError } from "./schema.js";
import { originalRegistry } from "./original-registry.js";
export class CompositionStore extends ProjectStore {
  constructor(
    catalog,
    storage = () => globalThis.localStorage,
    makeId = () => globalThis.crypto.randomUUID(),
  ) {
    super(catalog, storage, makeId, {
      projects: "perkusi.projects.studio.v3",
      draft: "perkusi.draft.studio.v3",
    });
    this.legacy = [
      new ProjectStore(catalog, storage, makeId, {
        projects: "perkusi.projects.studio.v2",
        draft: "perkusi.draft.studio.v2",
      }),
      new ProjectStore(originalRegistry, storage, makeId),
    ];
  }
  read() {
    return [
      ...super.read(),
      ...this.legacy.flatMap((store, i) =>
        store
          .read()
          .map((item) => ({
            id: `legacy${i}-${item.id}`,
            project: migrateProject(item.project, this.catalog),
          })),
      ),
    ];
  }
  save(project) {
    // ProjectStore.save dispatches this.read; exclude untouched legacy copies.
    const valid = migrateProject(project, this.catalog),
      items = super.read();
    if (items.length >= 30) throw new ProjectError("storageFull");
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
    if (id.startsWith("legacy")) throw new ProjectError("legacyOriginal");
    const items = super.read();
    if (!items.some((x) => x.id === id))
      throw new ProjectError("missingProject");
    this.write(items.filter((x) => x.id !== id));
  }
  readDraft() {
    const current = super.readDraft();
    if (current) return current;
    const old = this.legacy[0].readDraft();
    return old ? migrateProject(old, this.catalog) : null;
  }
}
