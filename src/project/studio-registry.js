import manifest from "../../internal/studio-kits/manifest.json" with { type: "json" };
import v3 from "../../internal/v3-sounds/manifest.json" with { type: "json" };
export const compositionRegistry = {
  ...manifest,
  kind: "studio",
  composition: true,
  kits: [...manifest.kits, ...v3.kits],
};
