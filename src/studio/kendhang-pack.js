import takURL from "../../internal/gamelan-flac/audio/48000/s261992.flac?url";
import thungURL from "../../internal/gamelan-flac/audio/48000/s261991.flac?url";
import takSource from "../../internal/gamelan-source-forms/archives/work-261992-source.zip?url";
import thungSource from "../../internal/gamelan-source-forms/archives/work-261991-source.zip?url";
import recordingLicense from "../../internal/gamelan-delivery/LICENSE_CC_BY_3.0.txt?url";
import packageLicense from "../../internal/gamelan-delivery/LICENSE_ARTISTIC_2.0.txt?url";
import notice from "../../internal/gamelan-delivery/NOTICE.txt?url&no-inline";
import { validatePack } from "../audio/sample-bank.js";
export const kendhangNotices = {
  takSource,
  thungSource,
  recordingLicense,
  packageLicense,
  notice,
};
export function kendhangPack() {
  return validatePack({
    schemaVersion: 1,
    id: "kendhang-ciblon",
    kind: "one-shot",
    version: "1.0.0",
    bpm: 120,
    beatsPerBar: 4,
    bars: 1,
    key: null,
    stems: [
      {
        id: "tak",
        url: takURL,
        frames: 42780,
        durationSeconds: 42780 / 48000,
        sha256:
          "ec6702a531f1226dab30f6a9578d28c1b415687c553189f0200d70a204e2139d",
      },
      {
        id: "thung",
        url: thungURL,
        frames: 32821,
        durationSeconds: 32821 / 48000,
        sha256:
          "7678c4b06d904d2d4af7aae9680f9d8487b7eeb366638d6139e2771bac04b065",
      },
    ].map((a) => ({
      ...a,
      sampleRate: 48000,
      channels: 2,
      gainTrim: 0.55,
      licenseId: "CC-BY-3.0",
    })),
  });
}
