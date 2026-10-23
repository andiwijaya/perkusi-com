export const BASS_PITCHES = Object.freeze(["e1", "g1", "b1"]);
export const BASS_CREDITS =
  "Short electric bass E1/G1/B1: Bass Guitar YR, Andrea Biasior; FreePats integration edits by Roberto, version 2019-09-30. Source https://freepats.zenvoid.org/ElectricGuitar/clean-electric-bass.html . CC0-1.0 https://creativecommons.org/publicdomain/zero/1.0/ . Changes: retained 48 kHz mono delivery with source gain 0.8; first 1.2 seconds, final 50 ms half-cosine fade; velocity/mix, short attack and 20 ms monophonic retrigger fade. No repitch, time stretch or missing notes generated. Originals and exact transformations/hashes retained by Perkusi.com. Limited three-note set, not a complete bass library.";
export const emptyBassNotes = () => Array(16).fill(null);
export function withBass(value) {
  const p = structuredClone(value);
  if (Object.hasOwn(p, "bass")) return p;
  p.bass = {
    id: "electric-bass-short",
    version: "1.0.0",
    credits: BASS_CREDITS,
    volume: 0.65,
    pan: 0,
    mute: false,
    solo: false,
  };
  for (const pattern of p.patterns) pattern.bassNotes = emptyBassNotes();
  return p;
}
export function bassUsed(p) {
  return !!p.bass && p.patterns.some((a) => a.bassNotes.some(Boolean));
}
