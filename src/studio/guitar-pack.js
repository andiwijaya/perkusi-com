import manifest from "../../internal/guitar-short/manifest.json";
import guitarLicense from "../../internal/guitar-short/LICENSE.txt?url&no-inline";
import provenance from "../../internal/guitar-short/manifest.json?url&no-inline";
import { validatePack } from "../audio/sample-bank.js";
const urls = import.meta.glob("../../internal/guitar-short/audio/*.wav", {
  eager: true,
  query: "?url",
  import: "default",
});
export const guitarNotices = {
  license: guitarLicense,
  provenance,
  source: "https://freepats.zenvoid.org/Guitar/acoustic-guitar.html",
};
export function guitarPack() {
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
      url: urls["../../internal/guitar-short/" + a.assetPath],
    })),
  });
}
