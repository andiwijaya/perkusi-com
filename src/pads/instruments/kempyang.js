import pelog from "../../../internal/gamelan-flac/audio/48000/s261984.flac?url";
import slendro from "../../../internal/gamelan-flac/audio/48000/s261760.flac?url";
import pelogSource from "../../../internal/gamelan-source-forms/archives/work-261984-source.zip?url";
import slendroSource from "../../../internal/gamelan-source-forms/archives/work-261760-source.zip?url";
import recordingLicense from "../../../internal/gamelan-delivery/LICENSE_CC_BY_3.0.txt?url";
import packageLicense from "../../../internal/gamelan-delivery/LICENSE_ARTISTIC_2.0.txt?url";
import notice from "../../../internal/gamelan-delivery/NOTICE.txt?url&no-inline";

// Standalone-only registration. Never import from Studio's catalogs or page.
export const kempyangLevel = 5.6919205368527805;
export const kempyangNotices = {
  pelogSource,
  slendroSource,
  recordingLicense,
  packageLicense,
  notice,
};
export const kempyangPack = {
  schemaVersion: 1,
  id: "pad-kempyang",
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
      frames: 47728,
      sha256:
        "bc1be5bdd121ae2d6a0374a0e99370d3cea87b99e8264ddc0f4842de25131813",
    },
    {
      id: "slendro-1",
      url: slendro,
      frames: 50103,
      sha256:
        "b25209e302bd615a40572de1a5d44f47b7386330e0c3badd6f5aea13d489d794",
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
