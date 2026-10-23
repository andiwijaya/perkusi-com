import manifest from "../../internal/bass-short/manifest.json";
import bassLicense from "../../internal/bass-short/LICENSE.txt?url&no-inline";
import provenance from "../../internal/bass-short/manifest.json?url&no-inline";
import { validatePack } from "../audio/sample-bank.js";
const urls = import.meta.glob("../../internal/bass-short/audio/*.wav", {
  eager: true,
  query: "?url",
  import: "default",
});
export const bassNotices = {
  license: bassLicense,
  provenance,
  source:
    "https://freepats.zenvoid.org/ElectricGuitar/clean-electric-bass.html",
};
export function bassPack() {
  return validatePack({
    schemaVersion: 1,
    id: manifest.id,
    kind: "one-shot",
    version: manifest.version,
    bpm: 120,
    beatsPerBar: 4,
    bars: 1,
    key: null,
    stems: manifest.assets.map((a) => ({
      ...a,
      url: urls["../../internal/bass-short/" + a.assetPath],
    })),
  });
}
