import manifest from "../../internal/studio-kits/manifest.json";
import { validatePack } from "../audio/sample-bank.js";
import { validateStudioCatalog } from "../audio/studio-catalog.js";
validateStudioCatalog(manifest);
export const studioCatalog = { ...manifest, kind: "studio" };
const assets = import.meta.glob("../../internal/studio-kits/audio/*.wav", {
  eager: true,
  query: "?url",
  import: "default",
});
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
      url: assets["../../internal/studio-kits/" + a.assetPath],
    })),
  });
}
