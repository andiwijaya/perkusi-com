import { studioMessages, studioRoleNames } from "./messages.js";
import { STUDIO_ROLES } from "../project/studio-model.js";
import { navigationHref } from "../app/routes.js";
import { legacyRecoveryHref } from "../app/legacy-recovery-link.js";
import { renderPadGroups } from "./live-pads.js";
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function renderStudio(locale) {
  const c = studioMessages[locale],
    t = (k) => esc(c[k]);
  const copy = (k, tag = "span", attrs = "") =>
    `<${tag} data-st-copy="${k}" ${attrs}>${t(k)}</${tag}>`;
  const button = (id, k, extra = "") =>
    `<button type="button" id="st-${id}" ${extra}>${copy(k)}</button>`;
  const range = (id, k, min, max, step, value) =>
    `<label>${copy(k)}<input id="st-${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"><output for="st-${id}" id="st-${id}-value">${value}</output></label>`;
  const grid = STUDIO_ROLES.map(
    (role, i) =>
      `<tr><th scope="row"><span data-st-role="${i}">${esc(studioRoleNames[locale][i])}</span><span class="st-track-number">0${i + 1}</span></th>${Array.from({ length: 16 }, (_, s) => `<td class="${s % 4 === 0 ? "st-quarter" : ""}"><button type="button" class="st-step" data-st-step="${role}:${s}" aria-pressed="false" aria-label="${esc(studioRoleNames[locale][i])} ${t("step")} ${s + 1}" ${s ? 'tabindex="-1"' : ""}><span class="st-dot" aria-hidden="true"></span><span class="st-velocity" aria-hidden="true"></span></button></td>`).join("")}</tr>`,
  ).join("");
  const mixer = STUDIO_ROLES.map(
    (role, i) =>
      `<div class="st-mixer-track" data-st-mixer="${role}"><strong data-st-role="${i}">${esc(studioRoleNames[locale][i])}</strong><div class="st-mix-toggles"><button type="button" data-st-mute="${role}" aria-pressed="false">${copy("mute")}</button><button type="button" data-st-solo="${role}" aria-pressed="false">${copy("solo")}</button></div><label>${copy("volume")}<input data-st-volume="${role}" type="range" min="0" max="1" step="0.01" value="0.8"><output data-st-volume-value="${role}">80%</output></label><label>${copy("pan")}<input data-st-pan="${role}" type="range" min="-1" max="1" step="0.05" value="0"><output data-st-pan-value="${role}">0</output></label></div>`,
  ).join("");
  const heading = (key, tag = "h2") => copy(key, tag);
  const intro = `<section class="st-intro"><div>${copy("eyebrow", "p", 'class="eyebrow"')}${heading("title", "h1")}${copy("intro", "p")}</div><div class="st-mark" aria-hidden="true"><i></i><i></i><i></i><i></i><b>16 / 08</b></div></section>
    <div id="st-desktop" class="st-desktop-note">${copy("desktop", "p")}${button("dismiss", "dismiss")}</div>
    <ol class="st-guide" aria-label="${t("quick")}">${[1, 2, 3].map((n) => `<li><b>${n}</b>${copy("step" + n)}</li>`).join("")}</ol>`;
  const transport = `<section class="st-transport" aria-label="${t("tempo")}"><div class="st-buttons">${button("play", "play", 'class="st-primary"')}${button("pause", "pause")}${button("stop", "stop")}</div>
    <label>${copy("tempo")}<input id="st-bpm" type="number" min="60" max="180" step="1" value="110"> BPM</label>${range("swing", "swing", 0, 0.5, 0.01, 0)}${range("master", "master", 0, 0.75, 0.01, 0.65)}
    <p id="st-status" role="status" aria-live="polite">${t("idle")}</p><output id="st-position" aria-live="off">1 : 1</output></section>`;
  const patterns = `<section class="st-panel st-patterns"><div class="st-panel-top">${heading("pattern")}<div>${button("undo", "undo", "disabled")}${button("redo", "redo", "disabled")}</div></div>
    <div class="st-pattern-controls"><label>${copy("pattern")}<select id="st-pattern"><option value="p1">A</option></select></label><label>${copy("patternName")}<input id="st-pattern-name" maxlength="80" value="A"></label>${button("rename", "rename")}${button("new", "newPattern")}${button("duplicate", "duplicate")}${button("delete-pattern", "delete")}</div>
    <div class="st-sound-controls"><label>${copy("kit")}<select id="st-kit"><option value="ruang">${t("ruang")}</option><option value="arus">${t("arus")}</option></select></label><label>${copy("demoKind")}<select id="st-demo-kind"><option value="ruang">Ruang</option><option value="arus">Arus</option></select></label>${button("demo", "demo")}${button("clear", "clear")}</div>
    ${heading("sequencer", "h3")}${copy("gridHint", "p", 'class="st-hint" id="st-grid-hint"')}<div class="st-grid-scroll" tabindex="0" role="region" aria-label="${t("sequencer")}" aria-describedby="st-grid-hint"><table class="st-grid"><thead><tr><th scope="col">${copy("pattern")}</th>${Array.from({ length: 16 }, (_, i) => `<th scope="col" data-st-head="${i}" class="${i % 4 === 0 ? "st-quarter" : ""}">${i + 1}</th>`).join("")}</tr></thead><tbody>${grid}</tbody></table></div></section>`;
  const chain = `<section class="st-panel st-chain"><div class="st-panel-top">${heading("chain")}<label>${copy("chainMode")}<input id="st-chain-mode" type="checkbox"></label></div>${copy("chainHint", "p", 'class="st-hint"')}<div id="st-chain-list"></div>${button("add-chain", "addChain")}<p>${copy("duration")} <output id="st-duration">2.18 s</output></p></section>`;
  const padPanel = `<section class="st-panel st-live-pads">${heading("pads")}${copy("padsHint", "p", 'class="st-hint"')}${renderPadGroups(locale)}<label class="st-quantize"><input id="st-quantize" type="checkbox" checked>${copy("quantize")}</label>${copy("quantizeHint", "p", 'class="st-hint"')}</section>`;
  const projectPanel = `<section class="st-panel st-project">${heading("projects")}${copy("projectHint", "p", 'class="st-hint"')}<div class="st-project-columns"><div><label>${copy("titleLabel")}<input id="st-title" maxlength="80" value="Ruang 01"></label><div class="st-buttons">${button("save", "save")}${button("project-download", "downloadProject")}</div><label>${copy("choose")}<select id="st-saved"><option value="">${t("choose")}</option></select></label><div class="st-buttons">${button("load", "load", "disabled")}${button("saved-delete", "remove", "disabled")}${button("import", "importProject")}</div><input id="st-file" type="file" accept=".perkusi.json,application/json" aria-label="${t("file")}" hidden>${copy("fileHint", "p", 'class="st-hint"')}</div><div>${button("render", "render", 'class="st-primary"')}${button("cancel", "cancel", "hidden")}<progress id="st-progress" max="1" value="0" hidden></progress><p id="st-project-status" role="status" aria-live="polite">${t("idle")}</p><div id="st-result" hidden><p>${copy("readyFile")} <b id="st-filename"></b></p><div class="st-buttons">${button("wav-download", "download")}${button("share", "shareDownload")}</div></div></div></div></section>`;
  const html = `<main id="main" class="studio-page wrap" tabindex="-1">${intro}${transport}<div class="studio-workspace"><div class="st-compose">${patterns}${chain}${padPanel}</div><aside class="st-panel st-mixer">${heading("mixer")}<div class="st-mixer-rows">${mixer}</div></aside></div>${projectPanel}<details class="st-panel st-help"><summary data-st-copy="help">${t("help")}</summary>${copy("helpCopy", "p")}${copy("shortcuts", "p")}</details><div class="st-foot"><a data-route="beatbox" href="${navigationHref("beatbox", locale)}" data-st-copy="back">${t("back")}</a><a data-st-recovery href="${legacyRecoveryHref(locale)}" data-st-copy="canonicalRecovery">${t("canonicalRecovery")}</a><a href="/V3-SOUNDS-LICENSE.txt" data-st-copy="sounds">${t("sounds")}</a></div><noscript>${t("jsRequired")}</noscript></main>`;
  return html
    .replace(/\sdisabled\b/g, "")
    .replace(/<(button|input|select)(?=[\s>])/g, "<$1 disabled");
}
