import { ProjectStore, assertSavedProjectUnchanged } from "./store.js";
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
        store.read().map((item) => ({
          id: `legacy${i}-${item.id}`,
          project: migrateProject(item.project, this.catalog),
        })),
      ),
    ];
  }
  save(project, { separate = false } = {}) {
    // The saved originals from other stores are read-only in Studio.
    return this.addSavedItem(
      migrateProject(project, this.catalog),
      super.read(),
      separate,
    );
  }
  remove(id, expected) {
    if (id.startsWith("legacy")) throw new ProjectError("legacyOriginal");
    const items = super.read();
    assertSavedProjectUnchanged(
      items.find((x) => x.id === id),
      expected,
    );
    this.write(items.filter((x) => x.id !== id));
  }
  draftSnapshot() {
    const current = super.draftSnapshot();
    if (current.raw) return current;
    const old = this.legacy[0].draftSnapshot();
    return old.raw ? old : current;
  }
}
