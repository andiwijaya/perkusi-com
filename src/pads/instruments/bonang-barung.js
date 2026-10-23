import s261801 from "../../../internal/gamelan-flac/audio/48000/s261801.flac?url";
import source261801 from "../../../internal/gamelan-source-forms/archives/work-261801-source.zip?url";
import s261799 from "../../../internal/gamelan-flac/audio/48000/s261799.flac?url";
import source261799 from "../../../internal/gamelan-source-forms/archives/work-261799-source.zip?url";
import s261807 from "../../../internal/gamelan-flac/audio/48000/s261807.flac?url";
import source261807 from "../../../internal/gamelan-source-forms/archives/work-261807-source.zip?url";
import s261785 from "../../../internal/gamelan-flac/audio/48000/s261785.flac?url";
import source261785 from "../../../internal/gamelan-source-forms/archives/work-261785-source.zip?url";
import s261789 from "../../../internal/gamelan-flac/audio/48000/s261789.flac?url";
import source261789 from "../../../internal/gamelan-source-forms/archives/work-261789-source.zip?url";
import s261786 from "../../../internal/gamelan-flac/audio/48000/s261786.flac?url";
import source261786 from "../../../internal/gamelan-source-forms/archives/work-261786-source.zip?url";
import s261706 from "../../../internal/gamelan-flac/audio/48000/s261706.flac?url";
import source261706 from "../../../internal/gamelan-source-forms/archives/work-261706-source.zip?url";
import s261704 from "../../../internal/gamelan-flac/audio/48000/s261704.flac?url";
import source261704 from "../../../internal/gamelan-source-forms/archives/work-261704-source.zip?url";
import recordingLicense from "../../../internal/gamelan-delivery/LICENSE_CC_BY_3.0.txt?url";
import packageLicense from "../../../internal/gamelan-delivery/LICENSE_ARTISTIC_2.0.txt?url";
import notice from "../../../internal/gamelan-delivery/NOTICE.txt?url&no-inline";
export const bonangBarungLevel = 1.2070286914731359;
export const bonangBarungNotices = {
  recordingLicense,
  packageLicense,
  notice,
  source261801,
  page261801: "https://freesound.org/people/Digitopia_CdM/sounds/261801/",
  source261799,
  page261799: "https://freesound.org/people/Digitopia_CdM/sounds/261799/",
  source261807,
  page261807: "https://freesound.org/people/Digitopia_CdM/sounds/261807/",
  source261785,
  page261785: "https://freesound.org/people/Digitopia_CdM/sounds/261785/",
  source261789,
  page261789: "https://freesound.org/people/Digitopia_CdM/sounds/261789/",
  source261786,
  page261786: "https://freesound.org/people/Digitopia_CdM/sounds/261786/",
  source261706,
  page261706: "https://freesound.org/people/Digitopia_CdM/sounds/261706/",
  source261704,
  page261704: "https://freesound.org/people/Digitopia_CdM/sounds/261704/",
};
export const bonangBarungPelogPack = {
  schemaVersion: 1,
  id: "pad-bonang-barung-pelog",
  kind: "one-shot",
  version: "1.0.0",
  bpm: 120,
  beatsPerBar: 4,
  bars: 1,
  key: null,
  stems: [
    {
      id: "pelog-1",
      url: s261801,
      frames: 482221,
      sha256:
        "ab6646b1de0b80211f9dac1f38b11ecf883fe7ba621d72998521699f5545c798",
    },
    {
      id: "pelog-2",
      url: s261799,
      frames: 383806,
      sha256:
        "ca0c1be67e94099176c68d62aff71f7bfd9a677ff9bf0f1a2a8621e80bc68c7a",
    },
    {
      id: "pelog-5",
      url: s261807,
      frames: 495118,
      sha256:
        "8531cd2ce1f752bf02daf0e91b14239859614668130f8ba770c6e1fc31452d71",
    },
    {
      id: "pelog-6",
      url: s261785,
      frames: 372935,
      sha256:
        "cb784a66a3570e9bbc71e16c80ea7c83ba7094be767be140b615bcea44fcb9be",
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
export const bonangBarungSlendroPack = {
  schemaVersion: 1,
  id: "pad-bonang-barung-slendro",
  kind: "one-shot",
  version: "1.0.0",
  bpm: 120,
  beatsPerBar: 4,
  bars: 1,
  key: null,
  stems: [
    {
      id: "slendro-1",
      url: s261789,
      frames: 489273,
      sha256:
        "0c285417fba13142effa3efb1cecc540859b5a67750b1a6b2e1e40e117157b6e",
    },
    {
      id: "slendro-2",
      url: s261786,
      frames: 406325,
      sha256:
        "1651fc17ddecd133ccd99493f394756560aa9f6054d2ecea5076ffc33f5158dd",
    },
    {
      id: "slendro-3",
      url: s261706,
      frames: 433442,
      sha256:
        "36e67d189dd8fbce5f5c5664fd443c9018cc49b357fd09a61fb24c9909afcb96",
    },
    {
      id: "slendro-5",
      url: s261704,
      frames: 270000,
      sha256:
        "a8ebe6aa57832a3d751298ad4fdcef57a9a842acf047226a197eaf845a2db852",
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
