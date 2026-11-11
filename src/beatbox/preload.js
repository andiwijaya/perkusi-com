import { createCollectionPreload } from "../audio/collection-preload.js";

export function beatboxPreparationBanks(engine) {
  const banks = new Set(
    [...engine.variants.values()].flatMap((choices) =>
      [...choices.values()].map((choice) => choice.bank),
    ),
  );
  return Object.fromEntries(
    [...banks].map((bank, n) => ["variation-" + n, bank]),
  );
}
export function createBeatboxPreload(engine, onChange) {
  return createCollectionPreload(
    engine,
    beatboxPreparationBanks(engine),
    onChange,
  );
}
export const beatboxPreloadCopy = {
  id: {
    label: "Persiapan audio Beatbox",
    waiting: "Menunggu persiapan audio Beatbox… {ready}/{total} file siap",
    loading: "Menyiapkan audio Beatbox… {ready}/{total} file siap",
    ready: "Semua audio siap · {ready}/{total} file",
    error:
      "Pemuatan audio dijeda karena ada file yang gagal. {ready}/{total} file siap.",
    paused: "Persiapan audio dijeda. {ready}/{total} file siap.",
    retry: "Coba lagi",
    continue: "Lanjutkan pemuatan",
  },
  en: {
    label: "Beatbox audio preparation",
    waiting: "Waiting to prepare Beatbox audio… {ready}/{total} files ready",
    loading: "Preparing Beatbox audio… {ready}/{total} files ready",
    ready: "All audio ready · {ready}/{total} files",
    error:
      "Audio loading is paused because a file failed. {ready}/{total} files ready.",
    paused: "Audio preparation is paused. {ready}/{total} files ready.",
    retry: "Try again",
    continue: "Continue loading",
  },
};
export function beatboxPreloadText(locale, view) {
  return beatboxPreloadCopy[locale][view.state]
    .replace("{ready}", view.ready)
    .replace("{total}", view.total);
}
export function renderBeatboxPreload(locale) {
  const t = beatboxPreloadCopy[locale];
  return `<section class="bb-preload" id="bb-preload" data-state="waiting" aria-label="${t.label}"><p role="status" aria-live="polite" aria-atomic="true"><span class="bb-preload-spinner" aria-hidden="true"></span><span id="bb-preload-status">${beatboxPreloadText(locale, { state: "waiting", ready: 0, total: 12 })}</span></p><progress id="bb-preload-progress" max="12" value="0" aria-label="${t.label}"></progress><button type="button" id="bb-preload-retry" hidden>${t.retry}</button></section>`;
}
