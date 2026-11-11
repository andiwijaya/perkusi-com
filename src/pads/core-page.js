import { LIVE_PAD_GROUPS } from "../studio/live-pads.js";
import { STUDIO_ROLES } from "../project/studio-model.js";

export const CORE_GROUPS = [
  { family: "drum", id: "Drum", en: "Drums", pitches: STUDIO_ROLES },
  ...LIVE_PAD_GROUPS,
];
export const coreCopy = {
  id: {
    waiting: "Menunggu pemuatan suara {name}… 0/{total} file siap",
    loading: "Memuat suara {name}… {ready}/{total} file siap",
    ready: "{name} siap dimainkan · {ready}/{total} file",
    error: "Suara {name} belum lengkap. {ready}/{total} file siap.",
    paused:
      "Pemuatan {name} dijeda. {ready}/{total} file siap. Pulihkan pemuatan untuk melanjutkan.",
    retry: "Coba lagi",
    continue: "Lanjutkan pemuatan",
    extraWaiting: "Menunggu lima grup utama siap…",
    extraBlocked:
      "Pemuatan instrumen tambahan menunggu semua grup utama berhasil.",
  },
  en: {
    waiting: "Waiting to load {name} sounds… 0/{total} files ready",
    loading: "Loading {name} sounds… {ready}/{total} files ready",
    ready: "{name} ready to play · {ready}/{total} files",
    error: "{name} sounds are incomplete. {ready}/{total} files ready.",
    paused:
      "Loading {name} is paused. {ready}/{total} files ready. Recover loading to continue.",
    retry: "Try again",
    continue: "Continue loading",
    extraWaiting: "Waiting for all five main groups to be ready…",
    extraBlocked:
      "Additional instruments are waiting for every main group to load successfully.",
  },
};
export function coreStatusText(locale, family, view) {
  const g = CORE_GROUPS.find((g) => g.family === family);
  return coreCopy[locale][view.state]
    .replace("{name}", g[locale])
    .replace("{ready}", view.ready)
    .replace("{total}", view.total);
}
export function renderCoreStatus(locale, family) {
  const g = CORE_GROUPS.find((g) => g.family === family);
  return `<div class="ps-core-loading" data-core-loading="${family}" data-state="waiting"><p role="status" aria-live="polite" aria-atomic="true"><span class="ps-loading-spinner" aria-hidden="true"></span><span data-core-status="${family}">${coreStatusText(locale, family, { state: "waiting", ready: 0, total: g.pitches.length })}</span></p><button type="button" data-core-retry="${family}" hidden>${coreCopy[locale].retry}</button></div>`;
}
