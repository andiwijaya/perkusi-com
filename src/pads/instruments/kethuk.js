import pelog from "../../../internal/gamelan-flac/audio/48000/s261691.flac?url";
import slendro from "../../../internal/gamelan-flac/audio/48000/s261685.flac?url";
import pelogSource from "../../../internal/gamelan-source-forms/archives/work-261691-source.zip?url";
import slendroSource from "../../../internal/gamelan-source-forms/archives/work-261685-source.zip?url";
import recordingLicense from "../../../internal/gamelan-delivery/LICENSE_CC_BY_3.0.txt?url";
import packageLicense from "../../../internal/gamelan-delivery/LICENSE_ARTISTIC_2.0.txt?url";
import notice from "../../../internal/gamelan-delivery/NOTICE.txt?url&no-inline";

// Standalone-only registration. Never import from Studio's catalogs or page.
export const kethukLevel = 2.7741171376902196;
export const kethukNotices = {
  pelogSource,
  slendroSource,
  recordingLicense,
  packageLicense,
  notice,
};
export const kethukPack = {
  schemaVersion: 1,
  id: "pad-kethuk",
  kind: "one-shot",
  version: "1.0.0",
  bpm: 120,
  beatsPerBar: 4,
  bars: 1,
  key: null,
  stems: [
    {
      id: "pelog-6",
      url: pelog,
      frames: 68416,
      sha256:
        "4ab317ba6e4aadd53d22930ceaf99812bb6582cf26a431a8bb91ed4076eaa92f",
    },
    {
      id: "slendro-2",
      url: slendro,
      frames: 92883,
      sha256:
        "02ab934bc777ffa3c651b6783b7f0a8a94dc1bec08c15f82d9625b49e24658bb",
    },
  ].map((s) => ({
    ...s,
    sampleRate: 48000,
    channels: 2,
    durationSeconds: s.frames / 48000,
    gainTrim: 0.55,
    licenseId: "CC-BY-3.0",
  })),
};
