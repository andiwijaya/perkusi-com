import { createCollectionPreload } from "../audio/collection-preload.js";
export { renderPreparedAudio } from "../audio/collection-preload.js";

export function studioPreparationBanks(engine, playback) {
  const drums = [
    ...new Set(
      [...engine.variants.values()].flatMap((choices) =>
        [...choices.values()].map((c) => c.bank),
      ),
    ),
  ];
  return Object.fromEntries([
    ...drums.map((bank, n) => ["kit-" + n, bank]),
    ["bilah", playback.banks.instrument],
    ["kendhang", playback.banks.kendhang],
    ["bass", playback.banks.bass],
    ["guitar", playback.banks.guitar],
    ...playback.banks.loops.map((bank, n) => ["loop-" + n, bank]),
  ]);
}
export function createStudioPreload(engine, playback, onChange) {
  return createCollectionPreload(
    engine,
    studioPreparationBanks(engine, playback),
    onChange,
  );
}
