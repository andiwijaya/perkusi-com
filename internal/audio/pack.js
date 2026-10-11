export const fixturePack = Object.freeze({
  schemaVersion: 1,
  id: "s2-technical-fixture",
  version: 1,
  bpm: 96,
  beatsPerBar: 4,
  bars: 2,
  key: "D minor",
  technicalFixture: true,
  acceptedVocalBeatbox: false,
  stems: [
    {
      id: "thump",
      gainTrim: 0.85,
      licenseId: "CC0-1.0",
      url: new URL("./fixtures/thump.wav", import.meta.url).href,
    },
    {
      id: "air",
      gainTrim: 0.85,
      licenseId: "CC0-1.0",
      url: new URL("./fixtures/air.wav", import.meta.url).href,
    },
    {
      id: "hum",
      gainTrim: 0.85,
      licenseId: "CC0-1.0",
      url: new URL("./fixtures/hum.wav", import.meta.url).href,
    },
  ],
});
