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

export function renderTutorial(tool, locale) {
  const text = (key, tag = "p", attrs = "") => {
    const id = key.startsWith("tutorial.") ? key : `tutorial.${tool}.${key}`;
    return `<${tag} data-i18n="${id}" ${attrs}>${escape(tutorialPairs[id][locale === "en" ? 1 : 0])}</${tag}>`;
  };
  const section = (title, body) =>
    `<section class="tutorial-reference">${text(title, "h3")}${text(body)}</section>`;
  const recipe =
    tool === "studio"
      ? `<table class="tutorial-pattern"><caption>${text("recipeCaption", "span")}</caption><thead><tr><th scope="col">${text("recipeSound", "span")}</th><th scope="col">${text("recipeColumns", "span")}</th></tr></thead><tbody><tr><th scope="row">Kick</th><td>1 · 5 · 9 · 13</td></tr><tr><th scope="row">Snare</th><td>5 · 13</td></tr><tr><th scope="row">${text("closedHat", "span")}</th><td>1 · 3 · 5 · 7 · 9 · 11 · 13 · 15</td></tr></tbody></table>`
      : "";
  const steps = Array.from({ length: tool === "studio" ? 6 : 5 }, (_, i) => {
    const n = i + 1;
    return `<li>${text(`step${n}Title`, "h3")}${text(`step${n}`)}${tool === "studio" && n === 3 ? recipe : ""}</li>`;
  }).join("");
  const references =
    tool === "studio"
      ? section("saveTitle", "save") + section("demoTitle", "demo")
      : section("tutorial.keyboard", "keys");
  const next =
    tool === "pads"
      ? `<section class="tutorial-next">${text("nextTitle", "h3")}${text("next")}<a data-route="studio" href="${navigationHref("studio", locale)}">${text("studioLink", "span")}</a></section>`
      : "";
  return `<details class="tool-tutorial" id="tutorial"><summary>${text("title", "span", 'class="tutorial-title"')}${text("summary", "span", 'class="tutorial-summary"')}</summary><div class="tutorial-body">${text("intro", "p", 'class="tutorial-intro"')}<ol class="tutorial-steps">${steps}</ol>${references}${section("tutorial.soundHelp", "trouble")}${next}</div></details>`;
}

export function renderPadQuickStart(locale) {
  const index = locale === "en" ? 1 : 0;
  return `<ol class="tutorial-quick" aria-label="${escape(tutorialPairs["tutorial.steps"][index])}" data-i18n-aria-label="tutorial.steps">${[1, 2, 3].map((n) => `<li><b aria-hidden="true">${n}</b><span data-i18n="tutorial.pads.quick${n}">${escape(tutorialPairs[`tutorial.pads.quick${n}`][index])}</span></li>`).join("")}</ol>`;
}
