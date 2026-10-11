import {
  characterDefinitions,
  characterSvg,
} from "../characters/characters.js";
import { beatboxMessages } from "./messages.js";
import { navigationHref } from "../app/routes.js";

const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
export function renderBeatbox(locale) {
  const copy = beatboxMessages[locale];
  const t = (key) => escape(copy[key]);
  const text = (key, tag = "span", attrs = "") =>
    `<${tag} data-bb-copy="${key}" ${attrs}>${t(key)}</${tag}>`;
  const roles = characterDefinitions
    .map(
      (c, i) =>
        `<article class="bb-role" data-role-card="${c.role}"><button type="button" class="character" data-role="${c.role}" data-state="idle" data-selected="false" aria-pressed="false" aria-describedby="status-${c.role}" disabled>${characterSvg(c.role)}<span class="bb-role-number" aria-hidden="true">0${i + 1}</span><span class="character-name">${c.name}</span><span class="character-role" data-role-label="${c.role}">${escape(copy.roles[c.role])}</span></button><div class="bb-variations" role="group" data-variant-group="${c.role}" aria-label="${escape(copy.variantLabel)} — ${c.name}">${text("variant")}<div>${[1, 2].map((variant) => `<button type="button" data-variant-role="${c.role}" data-variant="${variant}" aria-pressed="${variant === 1}" aria-label="${c.name} — ${t("variant")} ${variant === 1 ? "A" : "B"}" disabled>${variant === 1 ? "A" : "B"}</button>`).join("")}</div></div><p class="bb-role-status" id="status-${c.role}" data-role-status="${c.role}">${t("off")}</p><button type="button" class="bb-retry" data-retry="${c.role}" hidden>${t("retry")}</button></article>`,
    )
    .join("");
  return `<main id="main" class="beatbox-page wrap" tabindex="-1"><section class="bb-intro"><div>${text("eyebrow", "p", 'class="eyebrow"')}<h1>${text("title1")}<br>${text("title2", "em")}</h1>${text("intro", "p", 'class="bb-intro-copy"')}</div><div class="bb-pack"><span class="bb-preview" data-bb-copy="preview">${t("preview")}</span><p><span class="bb-pack-mark" aria-hidden="true">◉</span> Original Groove</p><div><strong>96 BPM</strong><span>4/4</span><span>D minor</span></div></div></section><ol class="bb-guide" aria-label="${t("guide")}">${[1, 2, 3].map((i) => `<li><b aria-hidden="true">${i}</b>${text("step" + i)}</li>`).join("")}</ol><section class="bb-stage" aria-label="${t("stageLabel")}"><div class="bb-stage-top"><span data-bb-copy="stageLabel">${t("stageLabel")}</span><div class="bb-beats" aria-hidden="true"><i></i><i></i><i></i><i></i></div></div><div class="bb-cast">${roles}</div><div class="bb-bar-track" aria-hidden="true"><i></i></div></section><section class="bb-transport" aria-label="${t("transport")}"><div class="bb-transport-buttons"><button id="bb-play" class="bb-primary" type="button" disabled><span aria-hidden="true">▶</span><span data-play-label>${t("start")}</span></button><button id="bb-pause" type="button" disabled>${t("pause")}</button><button id="bb-reset" type="button" disabled>${t("reset")}</button><button id="bb-demo" class="bb-demo" type="button" disabled>${t("demo")}</button></div><label class="bb-volume">${text("volume")}<input id="bb-volume" type="range" min="0" max="0.75" step="0.01" value="0.65" aria-label="${t("volume")}" disabled></label><div class="bb-transport-meta"><p id="bb-status" role="status" aria-live="polite">${t("idle")}</p><span id="bb-position" aria-live="off">${t("bar")} 1 · ${t("beat")} 1</span></div></section><details class="bb-help"><summary data-bb-copy="help">${t("help")}</summary>${text("helpCopy", "p")}${text("shortcuts", "p")}</details><div class="bb-bottom"><a data-home-anchor="tools" href="${navigationHref("home", locale, "tools")}" data-bb-copy="home">${t("home")}</a>${text("soundNote", "p")}</div><p id="bb-announcement" class="bb-sr-only" role="status" aria-live="polite"></p><noscript>${t("jsRequired")}</noscript></main>`;
}
