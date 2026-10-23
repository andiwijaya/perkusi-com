export const GUITAR_PITCHES = Object.freeze(["b2", "e3", "g3"]);
export const GUITAR_CREDITS =
  "Short nylon guitar B2/E3/G3: Roberto / FreePats, version 2019-06-18. Source https://freepats.zenvoid.org/Guitar/acoustic-guitar.html . CC0-1.0 https://creativecommons.org/publicdomain/zero/1.0/ . Changes: retained 48 kHz mono delivery with source gain 0.8; first 1.8 seconds, final 80 ms half-cosine fade; velocity/mix, short attack and 10 ms same-pitch retrigger fade; different pitches ring together. No repitch, time stretch or missing notes generated. Originals and exact transformations/hashes retained by Perkusi.com. Limited three-note set, not a complete guitar or chord library.";
export const emptyGuitarNotes = () => Array(16).fill(null);
export function withGuitar(value) {
  const p = structuredClone(value);
  if (Object.hasOwn(p, "guitar")) return p;
  p.guitar = {
    id: "nylon-guitar-short",
    version: "1.0.0",
    credits: GUITAR_CREDITS,
    volume: 0.65,
    pan: 0,
    mute: false,
    solo: false,
  };
  for (const pattern of p.patterns) pattern.guitarNotes = emptyGuitarNotes();
  return p;
}
export function guitarUsed(p) {
  return !!p.guitar && p.patterns.some((a) => a.guitarNotes.some(Boolean));
}
