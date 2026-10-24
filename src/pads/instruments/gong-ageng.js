import audio from "../../../internal/gamelan-flac/audio/48000/s261893.flac?url";
import source from "../../../internal/gamelan-source-forms/archives/work-261893-source.zip?url";
import recordingLicense from "../../../internal/gamelan-delivery/LICENSE_CC_BY_3.0.txt?url";
import packageLicense from "../../../internal/gamelan-delivery/LICENSE_ARTISTIC_2.0.txt?url";
import notice from "../../../internal/gamelan-delivery/NOTICE.txt?url&no-inline";
// Modest +2 dB audition gain; this cannot restore bass absent on a phone speaker.
export const gongLevel = 3.564828356373349;
export const gongNotices = {
  source,
  recordingLicense,
  packageLicense,
  notice,
  sourcePage: "https://freesound.org/people/Digitopia_CdM/sounds/261893/",
};
export const gongPack = {
  schemaVersion: 1,
  id: "pad-gong-ageng",
  kind: "one-shot",
  version: "1.0.0",
  bpm: 120,
  beatsPerBar: 4,
  bars: 1,
  key: null,
  stems: [
    {
      id: "ageng",
      url: audio,
      frames: 962338,
      sha256:
        "cf99aa1f1a2dfc2ab2fea2d69b1b9bddf7e956ebcf7f22c58cffeec61c88ae1f",
      sampleRate: 48000,
      channels: 2,
      durationSeconds: 962338 / 48000,
      gainTrim: 0.55,
      licenseId: "CC-BY-3.0",
    },
  ],
};
