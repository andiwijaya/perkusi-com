import { MASTER_MAX } from "../audio/voice.js";

export const PROJECT_FORMAT = "perkusi-project";
export const PROJECT_VERSION = 1;
export const MAX_PROJECT_BYTES = 64 * 1024;
export class ProjectError extends Error {
  constructor(code) {
    super(code);
    this.name = "ProjectError";
    this.code = code;
  }
}
export function cleanTitle(value) {
  if (typeof value !== "string" || value.length > 200)
    throw new ProjectError("invalidProject");
  const title = [...value.normalize("NFC")]
    .filter((char) => {
      const code = char.codePointAt(0);
      return code >= 32 && !(code >= 127 && code <= 159);
    })
    .join("")
    .replace(/[\u202a-\u202e\u2066-\u2069<>]/g, "")
    .trim();
  if (!title || title.length > 80) throw new ProjectError("invalidTitle");
  return title;
}
function object(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(value, k))
  )
    throw new ProjectError("invalidProject");
}

// Explicit version dispatch: unknown/future formats never silently lose fields.
export function migrateProject(value, catalog) {
  if (value?.schemaVersion === 0) {
    object(value, [
      "format",
      "schemaVersion",
      "title",
      "packId",
      "packVersion",
      "bpm",
      "volume",
      "layers",
      "exportBars",
    ]);
    object(value.layers, catalog.roleOrder);
    for (const layer of Object.values(value.layers))
      object(layer, ["enabled", "variant"]);
    value = {
      format: value.format,
      schemaVersion: 1,
      mode: "beatbox",
      title: value.title,
      pack: { id: value.packId, version: value.packVersion },
      timing: { bpm: value.bpm, meter: [4, 4] },
      master: { volume: value.volume },
      tracks: catalog.roleOrder.map((role) => ({
        role,
        ...value.layers[role],
      })),
      export: { bars: value.exportBars },
    };
  }
  return validateProject(value, catalog);
}
export function validateProject(value, catalog) {
  if (!value || value.format !== PROJECT_FORMAT)
    throw new ProjectError("invalidProject");
  if (value.schemaVersion !== PROJECT_VERSION)
    throw new ProjectError("unsupportedVersion");
  object(value, [
    "format",
    "schemaVersion",
    "mode",
    "title",
    "pack",
    "timing",
    "master",
    "tracks",
    "export",
  ]);
  if (value.mode !== "beatbox") throw new ProjectError("unsupportedMode");
  object(value.pack, ["id", "version"]);
  if (
    value.pack.id !== catalog.packId ||
    value.pack.version !== catalog.version
  )
    throw new ProjectError("unknownPack");
  object(value.timing, ["bpm", "meter"]);
  if (
    value.timing.bpm !== catalog.bpm ||
    !Array.isArray(value.timing.meter) ||
    value.timing.meter.length !== 2 ||
    value.timing.meter[0] !== 4 ||
    value.timing.meter[1] !== 4
  )
    throw new ProjectError("invalidProject");
  object(value.master, ["volume"]);
  if (
    !Number.isFinite(value.master.volume) ||
    value.master.volume < 0 ||
    value.master.volume > MASTER_MAX
  )
    throw new ProjectError("invalidProject");
  object(value.export, ["bars"]);
  if (![4, 8].includes(value.export.bars))
    throw new ProjectError("invalidProject");
  if (
    !Array.isArray(value.tracks) ||
    value.tracks.length !== catalog.roleOrder.length
  )
    throw new ProjectError("invalidProject");
  const seen = new Set();
  for (const track of value.tracks) {
    object(track, ["role", "enabled", "variant"]);
    if (
      seen.has(track.role) ||
      typeof track.enabled !== "boolean" ||
      !catalog.assets.some(
        (a) => a.role === track.role && a.variant === track.variant,
      )
    )
      throw new ProjectError("invalidProject");
    seen.add(track.role);
  }
  return {
    format: PROJECT_FORMAT,
    schemaVersion: PROJECT_VERSION,
    mode: "beatbox",
    title: cleanTitle(value.title),
    pack: { ...value.pack },
    timing: { bpm: catalog.bpm, meter: [4, 4] },
    master: { volume: value.master.volume },
    tracks: catalog.roleOrder.map((role) => ({
      ...value.tracks.find((t) => t.role === role),
    })),
    export: { bars: value.export.bars },
  };
}
export function parseProject(text, catalog) {
  if (
    typeof text !== "string" ||
    new TextEncoder().encode(text).length > MAX_PROJECT_BYTES
  )
    throw new ProjectError("projectTooLarge");
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ProjectError("invalidProject");
  }
  return migrateProject(value, catalog);
}
export function serializeProject(project, catalog) {
  return JSON.stringify(validateProject(project, catalog), null, 2) + "\n";
}
