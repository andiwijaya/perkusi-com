import { renderPadGroups } from "../studio/live-pads.js";
import { KENDHANG_CREDITS } from "../project/kendhang.js";
import { BASS_CREDITS } from "../project/bass.js";
import { GUITAR_CREDITS } from "../project/guitar.js";
import { renderExtraPads, extraPadCopy } from "./extra-page.js";

const pairs = {
  title: ["Pad Station", "Pad Station"],
  intro: [
    "Ketuk, mainkan, bikin musik bareng.",
    "Tap, play, make music together.",
  ],
  hint: [
    "Pad langsung. Tanpa pola, rekaman atau autoplay. Tiap perangkat bermain sendiri; tidak ada sinkronisasi antar-HP.",
    "Live pads. No patterns, recording or autoplay. Each device plays independently; phones are not synchronized.",
  ],
  stop: ["Hentikan suara", "Stop sounds"],
  master: ["Volume utama", "Master volume"],
  mute: ["Bisukan semua", "Mute all"],
  ready: ["Siap. Ketuk pad untuk mulai.", "Ready. Tap a pad to start."],
  loading: ["Menyiapkan suara…", "Preparing sounds…"],
  stopped: [
    "Suara dihentikan. Ketuk lagi untuk bermain.",
    "Sounds stopped. Tap again to play.",
  ],
  error: [
    "Suara belum siap. Hentikan, lalu ketuk lagi. Jika masih gagal, muat ulang halaman.",
    "Sound is not ready. Stop, then tap again. If it still fails, reload the page.",
  ],
  keys: [
    "Keyboard: drum 1–8 · Bilah Z/X/C/V/B · kendhang A/S · bass D/F/G · gitar H/J/K. Shortcut tidak aktif saat mengubah input. Pad tidak merekam.",
    "Keyboard: drums 1–8 · Bilah Z/X/C/V/B · kendhang A/S · bass D/F/G · guitar H/J/K. Shortcuts ignore input fields. Pads do not record.",
  ],
  credits: ["Sumber suara & lisensi", "Sound sources & licenses"],
  originals: ["Drum & Bilah orisinal — CC0", "Original drums & Bilah — CC0"],
  source: ["Sumber", "Source"],
};
export const padMessages = Object.fromEntries(
  ["id", "en"].map((l, i) => [
    l,
    Object.fromEntries(Object.entries(pairs).map(([k, v]) => [k, v[i]])),
  ]),
);
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function renderPadStation(locale) {
  const t = (key) => esc(padMessages[locale][key]);
  const copy = (key, tag = "span") =>
    `<${tag} data-pad-copy="${key}">${t(key)}</${tag}>`;
  return `<main id="main" class="pad-station wrap" tabindex="-1"><header class="ps-intro"><p class="eyebrow">PERKUSI / LIVE PADS</p>${copy("title", "h1")}${copy("intro", "p")}${copy("hint", "p")}</header><section class="ps-controls" aria-label="${t("master")}"><button type="button" id="ps-stop" disabled>${copy("stop")}</button><label>${copy("master")}<input id="ps-master" type="range" min="0" max="0.75" step="0.01" value="0.65" disabled><output id="ps-volume" for="ps-master">87%</output></label><label><input id="ps-mute" type="checkbox" disabled>${copy("mute")}</label></section><p id="ps-status" role="status" aria-live="polite">${t("ready")}</p><section class="st-live-pads" aria-label="${t("title")}">${renderPadGroups(locale, { disabled: true })}${renderExtraPads(locale)}</section>${copy("keys", "p")}<details class="ps-credits"><summary data-pad-copy="credits">${t("credits")}</summary>${copy("originals", "h2")}<p><a href="/STUDIO-KITS-LICENSE.txt">Drum — CC0</a> · <a href="/V3-SOUNDS-LICENSE.txt">Bilah — CC0</a></p><h2>Kendhang Ciblon</h2><p>${esc(KENDHANG_CREDITS)}</p><ul data-pad-credits="kendhang"></ul><h2>Bass</h2><p>${esc(BASS_CREDITS)}</p><ul data-pad-credits="bass"></ul><h2>Gitar nylon / Nylon guitar</h2><p>${esc(GUITAR_CREDITS)}</p><ul data-pad-credits="guitar"></ul><h2>Kethuk</h2><p data-extra-copy="credits">${esc(extraPadCopy[locale].credits)}</p><ul data-pad-credits="kethuk"></ul><h2>Kempyang</h2><p data-extra-copy="kempyangCredits">${esc(extraPadCopy[locale].kempyangCredits)}</p><ul data-pad-credits="kempyang"></ul><h2>Kenong</h2><p data-extra-copy="kenongCredits">${esc(extraPadCopy[locale].kenongCredits)}</p><ul data-pad-credits="kenong"></ul><h2>Bonang panerus</h2><p data-extra-copy="bonangPanerusCredits">${esc(extraPadCopy[locale].bonangPanerusCredits)}</p><ul data-pad-credits="bonang-panerus"></ul></details><noscript>JavaScript diperlukan untuk suara. JavaScript is required for audio.</noscript></main>`;
}
