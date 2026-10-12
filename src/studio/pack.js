import v3 from "../../internal/v3-sounds/manifest.json";
import manifest from "../../internal/studio-kits/manifest.json";
import { validatePack } from "../audio/sample-bank.js";
import { validateStudioCatalog } from "../audio/studio-catalog.js";
validateStudioCatalog(manifest);
export const studioCatalog = {
  ...manifest,
  kind: "studio",
  composition: true,
  kits: [...manifest.kits, ...v3.kits],
};
const assets = import.meta.glob("../../internal/studio-kits/audio/*.wav", {
  eager: true,
  query: "?url",
  import: "default",
});
const extraAssets = import.meta.glob("../../internal/v3-sounds/audio/*.wav", {
  eager: true,
  query: "?url",
  import: "default",
});
export function instrumentPack() {
  return validatePack({
    schemaVersion: 1,
    id: "bilah",
    kind: "one-shot",
    version: "1.0.0",
    bpm: 120,
    beatsPerBar: 4,
    bars: 1,
    key: null,
    stems: v3.instrument.assets.map((a) => ({
      ...a,
      url: extraAssets["../../internal/v3-sounds/" + a.assetPath],
    })),
  });
}
export function studioPack(variant = 1) {
  const kit = studioCatalog.kits[variant - 1];
  if (!kit) throw new Error("Unknown studio kit");
  return validatePack({
    schemaVersion: 1,
    id: "studio-kits",
    kind: "one-shot",
    version: manifest.version,
    bpm: 120,
    beatsPerBar: 4,
    bars: 1,
    key: null,
    stems: kit.assets.map((a) => ({
      ...a,
      id: a.id,
      variant,
      url:
        variant === 3
          ? extraAssets["../../internal/v3-sounds/" + a.assetPath]
          : assets["../../internal/studio-kits/" + a.assetPath],
    })),
  });
}
