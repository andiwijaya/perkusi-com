export const KENDHANG_STROKES = Object.freeze(["tak", "thung"]);
export const KENDHANG_CREDITS =
  "Kendhang Ciblon: DRUMS_CIBLON_MEDIUM_TAK.wav and DRUMS_CIBLON_MEDIUM_THUNG.wav, Digitopia_CdM / Digitopia Casa da Musica. Recordings: Pedro Augusto and Rui Penha; editing: Pedro Augusto; support: Jorge Queijo and Maria Monica. Sources: https://freesound.org/people/Digitopia_CdM/sounds/261992/ and https://freesound.org/people/Digitopia_CdM/sounds/261991/ . Recordings CC BY 3.0: https://creativecommons.org/licenses/by/3.0/ . Library package Artistic 2.0: https://digitopia.casadamusica.com/CDM-GAMELAN-SAMPLE-LIBRARY/ . Changes: uniform source gain 0.8; 48 kHz resampling, PCM24 and lossless FLAC packaging; playback velocity/mix and short edge envelopes; arrangement/mixing on export. No retuning or endorsement. Original/modified source forms and license notices are available from the instrument credits in Perkusi.com.";
export function emptyKendhang() {
  return Object.fromEntries(
    KENDHANG_STROKES.map((id) => [id, Array(16).fill(0)]),
  );
}
export function withKendhang(value) {
  const p = structuredClone(value);
  if (Object.hasOwn(p, "kendhang")) return p;
  p.kendhang = {
    id: "kendhang-ciblon",
    version: "1.0.0",
    credits: KENDHANG_CREDITS,
    volume: 0.65,
    pan: 0,
    mute: false,
    solo: false,
  };
  for (const pattern of p.patterns) pattern.kendhang = emptyKendhang();
  return p;
}
export function kendhangUsed(p) {
  return (
    !!p.kendhang &&
    p.patterns.some((a) =>
      KENDHANG_STROKES.some((id) => a.kendhang[id].some((v) => v > 0)),
    )
  );
}
