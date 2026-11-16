import { tutorialPairs } from "./messages.js";
import { navigationHref } from "../app/routes.js";

const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );

function copy(locale, id, tag = "p", attrs = "") {
  return `<${tag} data-i18n="${id}" ${attrs}>${escape(tutorialPairs[id][locale === "en" ? 1 : 0])}</${tag}>`;
}

export function tutorialLink(
  locale,
  target,
  key = "tutorial.back",
  className = "tutorial-jump",
) {
  return `<a class="${className}" href="#${target}" data-tutorial-jump>${copy(locale, key, "span")}</a>`;
}

export function tutorialReturn(locale, step) {
  return tutorialLink(
    locale,
    `tutorial-step-${step}`,
    "tutorial.back",
    "tutorial-return",
  );
}

export function tutorialNote(locale, key) {
  return copy(locale, key, "p", 'class="tutorial-context"');
}

export function renderStudioRecipe(locale) {
  const text = (key) => copy(locale, `tutorial.studio.${key}`, "span");
  return `<table class="tutorial-pattern"><caption>${text("recipeCaption")}</caption><thead><tr><th scope="col">${text("recipeSound")}</th><th scope="col">${text("recipeColumns")}</th></tr></thead><tbody><tr><th scope="row">Kick</th><td>1 · 5 · 9 · 13</td></tr><tr><th scope="row">Snare</th><td>5 · 13</td></tr><tr><th scope="row">${text("closedHat")}</th><td>1 · 3 · 5 · 7 · 9 · 11 · 13 · 15</td></tr></tbody></table>`;
}

export function renderPadPractice(locale) {
  return `<details id="ps-drums" class="tutorial-practice tutorial-destination" tabindex="-1"><summary>${copy(locale, "tutorial.pads.practiceTitle", "span")}</summary><div class="tutorial-practice-body"><ol class="tutorial-count">${["Kick", "Snare", "Kick", "Snare"].map((sound, i) => `<li><b>${i + 1}</b><span>${sound}</span></li>`).join("")}</ol>${copy(locale, "tutorial.pads.practiceHint")}${tutorialReturn(locale, 2)}</div></details>`;
}

export function renderStudioPractice(locale) {
  return `<details id="st-grid-practice" class="tutorial-practice tutorial-destination" tabindex="-1"><summary>${copy(locale, "tutorial.studio.practiceTitle", "span")}</summary><div class="tutorial-practice-body">${copy(locale, "tutorial.studio.practiceHint")}${renderStudioRecipe(locale)}${tutorialReturn(locale, 3)}</div></details>`;
}

const stepTargets = {
  pads: {
    1: ["ps-drums", "tutorial.pads.tryDrums"],
    2: ["ps-drums", "tutorial.pads.tryRhythm"],
    3: ["ps-extra-title", "tutorial.pads.tryExtras"],
    4: ["ps-controls", "tutorial.controls"],
  },
  studio: {
    1: ["st-patterns", "tutorial.studio.prepare"],
    2: ["st-controls", "tutorial.studio.setTempo"],
    3: ["st-grid-practice", "tutorial.studio.tryGrid"],
    4: ["st-controls", "tutorial.controls"],
    5: ["st-chain", "tutorial.studio.tryChain"],
    6: ["st-project", "tutorial.studio.tryExport"],
  },
  beatbox: {
    1: ["bb-controls", "tutorial.controls"],
    2: ["bb-stage", "tutorial.beatbox.tryMix"],
    3: ["bb-stage", "tutorial.beatbox.tryVariants"],
    4: ["bb-controls", "tutorial.controls"],
    5: ["bb-project", "tutorial.beatbox.tryExport"],
  },
};

export function renderTutorial(tool, locale) {
  const text = (key, tag = "p", attrs = "") =>
    copy(
      locale,
      key.startsWith("tutorial.") ? key : `tutorial.${tool}.${key}`,
      tag,
      attrs,
    );
  const section = (title, body) =>
    `<section class="tutorial-reference">${text(title, "h3")}${text(body)}</section>`;
  const steps = Array.from({ length: tool === "studio" ? 6 : 5 }, (_, i) => {
    const n = i + 1;
    const destination = stepTargets[tool][n];
    return `<li id="tutorial-step-${n}" tabindex="-1">${text(`step${n}Title`, "h3")}${text(`step${n}`)}${tool === "studio" && n === 3 ? renderStudioRecipe(locale) : ""}${destination ? tutorialLink(locale, ...destination) : ""}</li>`;
  }).join("");
  const references =
    tool === "studio"
      ? section("saveTitle", "save") + section("demoTitle", "demo")
      : section("tutorial.keyboard", "keys");
  const next =
    tool === "pads"
      ? `<section class="tutorial-next">${text("nextTitle", "h3")}${text("next")}<a data-route="studio" href="${navigationHref("studio", locale)}">${text("studioLink", "span")}</a></section>`
      : "";
  return `<details class="tool-tutorial" id="tutorial"><summary>${text("title", "span", 'class="tutorial-title"')}${text("summary", "span", 'class="tutorial-summary"')}</summary><div class="tutorial-body">${text("intro", "p", 'class="tutorial-intro"')}${text("tutorial.useLinks", "p")}<ol class="tutorial-steps">${steps}</ol>${references}${section("tutorial.soundHelp", "trouble")}${next}</div></details>`;
}

export function renderPadQuickStart(locale) {
  const index = locale === "en" ? 1 : 0;
  return `<ol class="tutorial-quick" aria-label="${escape(tutorialPairs["tutorial.steps"][index])}" data-i18n-aria-label="tutorial.steps">${[1, 2, 3].map((n) => `<li><b aria-hidden="true">${n}</b><span data-i18n="tutorial.pads.quick${n}">${escape(tutorialPairs[`tutorial.pads.quick${n}`][index])}</span></li>`).join("")}</ol>`;
}
