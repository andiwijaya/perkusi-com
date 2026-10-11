import { validatePack } from "./sample-bank.js";

export const VOCAL_ROLES = [
  "kick",
  "snare",
  "hat",
  "vocal-bass",
  "hum",
  "percussion-fx",
];
function safeProvenancePath(value) {
  return (
    typeof value === "string" &&
    /^[a-zA-Z0-9_./()-]+$/.test(value) &&
    !value.startsWith("/") &&
    !value
      .split("/")
      .some((part) => part === ".." || part === "" || part === ".")
  );
}
export function validatePackCatalog(catalog) {
  if (
    catalog.schemaVersion !== 1 ||
    !/^[a-z0-9-]+$/.test(catalog.packId) ||
    !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(catalog.version)
  )
    throw new Error("Invalid catalog identity");
  if (
    !Array.isArray(catalog.meter) ||
    catalog.meter.join() !== "4,4" ||
    catalog.beatsPerBar !== 4 ||
    !Number.isInteger(catalog.bars) ||
    catalog.bars < 1 ||
    catalog.bars > 8 ||
    !Number.isFinite(catalog.bpm) ||
    catalog.bpm < 60 ||
    catalog.bpm > 180
  )
    throw new Error("Invalid catalog geometry");
  if (
    !Array.isArray(catalog.roleOrder) ||
    catalog.roleOrder.length !== 6 ||
    new Set(catalog.roleOrder).size !== 6 ||
    VOCAL_ROLES.some((role) => !catalog.roleOrder.includes(role))
  )
    throw new Error("Missing vocal roles");
  if (!Array.isArray(catalog.assets)) throw new Error("Missing catalog assets");
  const ids = new Set(),
    slots = new Set();
  const duration = (catalog.bars * 4 * 60) / catalog.bpm;
  for (const asset of catalog.assets) {
    const slot = `${asset.role}:${asset.variant}`;
    if (
      !VOCAL_ROLES.includes(asset.role) ||
      !Number.isInteger(asset.variant) ||
      asset.variant < 1 ||
      !/^[a-z0-9-]+$/.test(asset.id) ||
      ids.has(asset.id) ||
      slots.has(slot)
    )
      throw new Error("Invalid asset slot");
    if (
      !/^audio\/[a-z0-9-]+\.wav$/.test(asset.assetPath) ||
      !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      !asset.sourceRecipe ||
      typeof asset.sourceRecipe !== "string" ||
      !safeProvenancePath(asset.sourceRecipe) ||
      !/^[a-f0-9]{64}$/.test(asset.sourceRecipeSha256) ||
      !safeProvenancePath(asset.sourceMaster) ||
      !/^[a-f0-9]{64}$/.test(asset.masterSha256) ||
      !safeProvenancePath(asset.licensePath) ||
      typeof asset.author !== "string" ||
      !asset.author.trim() ||
      typeof asset.sourceType !== "string" ||
      !asset.sourceType.trim() ||
      typeof asset.createdAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(asset.createdAt) ||
      !Number.isFinite(Date.parse(asset.createdAt)) ||
      typeof asset.attributionRequired !== "boolean" ||
      !asset.licenseId ||
      asset.commercialUse !== true ||
      asset.rawRedistribution !== true
    )
      throw new Error("Unsafe asset provenance");
    if (
      asset.channels !== 1 ||
      !Number.isInteger(asset.sampleRate) ||
      asset.sampleRate < 8000 ||
      asset.frames !== Math.round(duration * asset.sampleRate) ||
      !Number.isFinite(asset.durationSeconds) ||
      asset.durationSeconds <= 0 ||
      Math.abs(asset.durationSeconds - duration) > 1 / asset.sampleRate ||
      asset.loopStart !== 0 ||
      asset.loopEnd !== duration ||
      !Number.isFinite(asset.gainTrim) ||
      asset.gainTrim < 0 ||
      asset.gainTrim > 1
    )
      throw new Error("Incompatible loop");
    ids.add(asset.id);
    slots.add(slot);
  }
  for (const role of VOCAL_ROLES)
    if (!slots.has(`${role}:1`) || !slots.has(`${role}:2`))
      throw new Error("Each role needs two variants");
  return catalog;
}

// The catalog stores all variants; the shared engine owns only six selected
// stems. Do not increase its active-track cap just to store inactive variants.
export function createPackFromCatalog(
  catalog,
  selection = catalog.initialSelection,
  resolveAsset = (path) => path,
) {
  validatePackCatalog(catalog);
  if (Object.keys(selection).some((role) => !VOCAL_ROLES.includes(role)))
    throw new Error("Unknown selected role");
  const stems = catalog.roleOrder.map((role) => {
    const variant = selection[role] ?? 1;
    const asset = catalog.assets.find(
      (item) => item.role === role && item.variant === variant,
    );
    if (!asset) throw new Error("Unknown selected variant");
    const url = resolveAsset(asset.assetPath);
    if (typeof url !== "string" || !url)
      throw new Error("Missing resolved audio asset");
    return {
      id: role,
      assetId: asset.id,
      variant,
      url,
      gainTrim: asset.gainTrim,
      licenseId: asset.licenseId,
    };
  });
  return validatePack({
    schemaVersion: 1,
    id: catalog.packId,
    version: catalog.version,
    bpm: catalog.bpm,
    beatsPerBar: catalog.beatsPerBar,
    bars: catalog.bars,
    key: catalog.key,
    stems,
  });
}
