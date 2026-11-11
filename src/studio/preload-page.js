export const preloadCopy = {
  id: {
    waiting:
      "Menunggu persiapan audio Rhythm Studio… {ready}/{total} file siap",
    loading: "Menyiapkan audio Rhythm Studio… {ready}/{total} file siap",
    ready: "Semua audio siap · {ready}/{total} file",
    error:
      "Pemuatan audio dijeda karena ada file yang gagal. {ready}/{total} file siap.",
    paused: "Persiapan audio dijeda. {ready}/{total} file siap.",
    retry: "Coba lagi",
    continue: "Lanjutkan pemuatan",
    label: "Persiapan audio Rhythm Studio",
  },
  en: {
    waiting:
      "Waiting to prepare Rhythm Studio audio… {ready}/{total} files ready",
    loading: "Preparing Rhythm Studio audio… {ready}/{total} files ready",
    ready: "All audio ready · {ready}/{total} files",
    error:
      "Audio loading is paused because a file failed. {ready}/{total} files ready.",
    paused: "Audio preparation is paused. {ready}/{total} files ready.",
    retry: "Try again",
    continue: "Continue loading",
    label: "Rhythm Studio audio preparation",
  },
};
export function preloadText(locale, view) {
  return preloadCopy[locale][view.state]
    .replace("{ready}", view.ready)
    .replace("{total}", view.total);
}
export function renderStudioPreload(locale) {
  const t = preloadCopy[locale];
  return `<section class="st-preload" id="st-preload" data-state="waiting" aria-label="${t.label}"><p role="status" aria-live="polite" aria-atomic="true"><span class="st-preload-spinner" aria-hidden="true"></span><span id="st-preload-status">${preloadText(locale, { state: "waiting", ready: 0, total: 49 })}</span></p><progress id="st-preload-progress" max="49" value="0" aria-label="${t.label}"></progress><button type="button" id="st-preload-retry" hidden>${t.retry}</button></section>`;
}
