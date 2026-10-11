import manifest from "../../internal/original-groove/manifest.json";
import { createPackFromCatalog } from "../audio/pack-catalog.js";

const urls = import.meta.glob("../../internal/original-groove/audio/*.wav", {
  eager: true,
  query: "?url",
  import: "default",
});
export const originalCatalog = manifest;
export const originalGroovePack = (variant) =>
  createPackFromCatalog(
    manifest,
    Object.fromEntries(manifest.roleOrder.map((role) => [role, variant])),
    (path) => urls[`../../internal/original-groove/${path}`],
  );
