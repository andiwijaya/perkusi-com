export function validateStudioCatalog(catalog) {
  if (
    catalog?.schemaVersion !== 1 ||
    catalog.version !== "1.0.0" ||
    catalog.kind !== "one-shot" ||
    !Array.isArray(catalog.roleOrder) ||
    catalog.roleOrder.length !== 8 ||
    new Set(catalog.roleOrder).size !== 8 ||
    !Array.isArray(catalog.kits) ||
    catalog.kits.length !== 2
  )
    throw new Error("Invalid studio catalog");
  const kits = new Set(),
    paths = new Set();
  for (const kit of catalog.kits) {
    if (
      !/^[a-z0-9-]+$/.test(kit.id) ||
      kits.has(kit.id) ||
      !kit.name ||
      !Array.isArray(kit.assets) ||
      kit.assets.length !== 8
    )
      throw new Error("Invalid kit identity");
    kits.add(kit.id);
    const roles = new Set();
    for (const a of kit.assets) {
      if (
        !catalog.roleOrder.includes(a.id) ||
        roles.has(a.id) ||
        !/^audio\/[a-z0-9-]+\.wav$/.test(a.assetPath) ||
        paths.has(a.assetPath) ||
        !/^[a-f0-9]{64}$/.test(a.sha256) ||
        !/^[a-f0-9]{64}$/.test(a.sourceRecipeSha256) ||
        a.licenseId !== "CC0-1.0" ||
        a.licensePath !== "LICENSE.txt" ||
        a.commercialUse !== true ||
        a.rawRedistribution !== true ||
        a.attributionRequired !== false ||
        !a.author ||
        !a.sourceType ||
        a.sourceRecipe !== "scripts/make-studio-kits.py" ||
        a.createdAt !== "2026-10-11"
      )
        throw new Error("Invalid one-shot provenance");
      if (
        a.sampleRate !== 48000 ||
        a.channels !== 1 ||
        !Number.isFinite(a.durationSeconds) ||
        a.durationSeconds <= 0 ||
        a.durationSeconds > 2 ||
        a.frames !== Math.round(a.durationSeconds * 48000) ||
        a.bytes !== 44 + a.frames * 2 ||
        !Number.isFinite(a.gainTrim) ||
        a.gainTrim <= 0 ||
        a.gainTrim > 0.25
      )
        throw new Error("Invalid one-shot geometry");
      roles.add(a.id);
      paths.add(a.assetPath);
    }
  }
  return catalog;
}
