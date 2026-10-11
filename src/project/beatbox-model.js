import { validateProject, PROJECT_FORMAT, PROJECT_VERSION } from "./schema.js";

export function captureBeatboxProject(engine, catalog, title, bars = 4) {
  return validateProject(
    {
      format: PROJECT_FORMAT,
      schemaVersion: PROJECT_VERSION,
      mode: "beatbox",
      title,
      pack: { id: catalog.packId, version: catalog.version },
      timing: { bpm: catalog.bpm, meter: [4, 4] },
      master: { volume: engine.volume },
      tracks: catalog.roleOrder.map((role) => ({
        role,
        enabled: engine.enabled.get(role),
        variant: engine.selectedVariant.get(role),
      })),
      export: { bars },
    },
    catalog,
  );
}
export function applyBeatboxProject(engine, project, catalog) {
  const valid = validateProject(project, catalog);
  // Validate completely before touching the active composition. Loading never plays.
  engine.reset();
  engine.setVolume(valid.master.volume);
  const operations = valid.tracks.map((t) => {
    const pending = engine.setVariation(t.role, t.variant);
    engine.setLayer(t.role, t.enabled);
    return pending;
  });
  return Promise.all(operations);
}
