import { fail } from "../project/instrument-contract.js";
import { drumBank } from "./drum-sources.js";
import { melodicBank } from "./melodic-sources.js";

// Bounded recorded Preview pairs from one existing set/laras at native48k.
// Availability is not a cultural/listening approval of the rest of the bank.
export const RECORD_INSTRUMENTS = Object.freeze([
  "saron-barung",
  "slenthem",
  "drum-ruang",
  "drum-arus",
  "electric-bass",
  "classical-guitar",
]);
const pairs = {
  "saron-barung": ["fs-261724", "fs-261923"],
  slenthem: ["fs-261898", "fs-261896"],
};
export function recordSource(instrumentId = "saron-barung") {
  if (!RECORD_INSTRUMENTS.includes(instrumentId)) fail("invalidCaptureSource");
  const melodic = melodicBank(instrumentId);
  if (melodic)
    return {
      bankId: melodic.id,
      bankVersion: melodic.version,
      sampleIds: melodic.samples.map((s) => s.id),
    };
  const drum = drumBank(instrumentId);
  if (drum)
    return {
      bankId: drum.id,
      bankVersion: drum.version,
      sampleIds: drum.samples.map((s) => s.id),
    };
  return {
    bankId: "cdm-slendro",
    bankVersion: "candidate-1.0.0",
    sampleIds: [...pairs[instrumentId]],
  };
}
