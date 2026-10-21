import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
// Fixed provenance/legal records only. No audio, archive ZIPs or general walker.
export const RETIREMENT_PROVENANCE = [
  ...[
    "LICENSE_CC_BY_3.0.txt",
    "LICENSE_ARTISTIC_2.0.txt",
    "NOTICE.txt",
    "credits.json",
    "asset-map.json",
    "quality-flags.json",
    "derive-reference.py",
  ].map((name) => "internal/gamelan-delivery/" + name),
  ...["asset-map.json", "NOTICE.txt", "encode-reference.py"].map(
    (name) => "internal/gamelan-flac/" + name,
  ),
  "internal/gamelan-source-forms/manifest.json",
];
export function retirementProvenance(root) {
  return {
    name: "retired-provenance-records",
    async generateBundle() {
      for (const path of RETIREMENT_PROVENANCE)
        this.emitFile({
          type: "asset",
          fileName: path,
          source: await readFile(resolve(root, path)),
        });
    },
  };
}
