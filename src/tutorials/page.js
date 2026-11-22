import { tutorialPairs } from "./messages.js";
import { screenshotFor, screenshotDetails } from "./screenshots.js";
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

export function tutorialDeviceHint(locale, tool) {
  return (
    copy(
      locale,
      `tutorial.${tool}.desktopHint`,
      "p",
      'class="tutorial-desktop-note"',
    ) +
    (tool === "beatbox"
      ? copy(
          locale,
          "tutorial.beatbox.mobileHint",
          "p",
          'class="tutorial-mobile-note"',
        )
      : "")
  );
}

export function renderStudioRecipe(locale) {
  const text = (key) => copy(locale, `tutorial.studio.${key}`, "span");
  return `<table class="tutorial-pattern"><caption>${text("recipeCaption")}</caption><thead><tr><th scope="col">${text("recipeSound")}</th><th scope="col">${text("recipeColumns")}</th></tr></thead><tbody><tr><th scope="row">Kick</th><td>1 · 5 · 9 · 13</td></tr><tr><th scope="row">Snare</th><td>5 · 13</td></tr><tr><th scope="row">${text("closedHat")}</th><td>1 · 3 · 5 · 7 · 9 · 11 · 13 · 15</td></tr></tbody></table>`;
}

export function renderPadPractice(locale) {
  return `<details id="ps-drums" class="tutorial-practice tutorial-destination" tabindex="-1"><summary>${copy(locale, "tutorial.pads.practiceTitle", "span")}</summary><div class="tutorial-practice-body"><ol class="tutorial-count">${["Kick", "Snare", "Kick", "Snare"].map((sound, i) => `<li><b>${i + 1}</b><span>${sound}</span></li>`).join("")}</ol>${copy(locale, "tutorial.pads.practiceHint")}${tutorialDeviceHint(locale, "pads")}${tutorialReturn(locale, 2)}</div></details>`;
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

function renderScreenshot(screenshot, step, locale) {
  const { name, src, width, height, alt } = screenshotDetails(
    screenshot,
    locale,
  );
  const caption = copy(locale, `tutorial.screenshot.${name}.caption`, "span");
  return `<figure class="tutorial-screenshot" data-tutorial-screenshot="${step}"><img src="${src}" width="${width}" height="${height}" alt="${escape(alt)}" loading="lazy" decoding="async"><figcaption>${caption}<a href="${src}" target="_blank" rel="noopener">${copy(locale, "tutorial.screenshot.enlarge", "span")}</a></figcaption></figure>`;
}

export function renderTutorial(tool, locale) {
  const text = (key, tag = "p", attrs = "") =>
    copy(
      locale,
      key.startsWith("tutorial.") ? key : `tutorial.${tool}.${key}`,
      tag,
      attrs,
    );
  const section = (
    id,
    title,
    body,
    extra = "",
    className = "tutorial-reference",
  ) =>
    `<section id="tutorial-topic-${id}" class="${className} tutorial-destination" tabindex="-1" data-tutorial-topic>${text(title, "h3")}${text(body)}${extra}</section>`;
  const steps = Array.from({ length: tool === "studio" ? 6 : 5 }, (_, i) => {
    const n = i + 1;
    const destination = stepTargets[tool][n];
    const screenshot = screenshotFor(tool, n);
    return `<li id="tutorial-step-${n}" tabindex="-1" data-tutorial-topic>${text(`step${n}Title`, "h3")}${text(`step${n}`)}${tool === "studio" && n === 3 ? renderStudioRecipe(locale) : ""}${destination ? tutorialLink(locale, ...destination) : ""}${screenshot ? renderScreenshot(screenshot, n, locale) : ""}</li>`;
  }).join("");
  const references =
    tool === "studio"
      ? section("save", "saveTitle", "save") +
        section("demo", "demoTitle", "demo")
      : section("keyboard", "tutorial.keyboard", "keys");
  const next =
    tool === "pads"
      ? section(
          "next",
          "nextTitle",
          "next",
          `<a data-route="studio" href="${navigationHref("studio", locale)}">${text("studioLink", "span")}</a>`,
          "tutorial-next",
        )
      : "";
  const search = `<form class="tutorial-search" role="search" aria-labelledby="tutorial-search-label" hidden>${text("tutorial.search.label", "label", 'id="tutorial-search-label" for="tutorial-query"')}<div class="tutorial-search-controls"><input id="tutorial-query" type="search" autocomplete="off" maxlength="100" aria-controls="tutorial-search-results"><button type="button" data-tutorial-clear hidden>${text("tutorial.search.clear", "span")}</button></div><p class="tutorial-search-status" role="status"></p><ul class="tutorial-search-results" id="tutorial-search-results" hidden></ul></form>`;
  return `<details class="tool-tutorial" id="tutorial" data-tutorial-tool="${tool}"><summary>${text("title", "span", 'class="tutorial-title"')}${text("summary", "span", 'class="tutorial-summary"')}</summary><div class="tutorial-body">${text("intro", "p", 'class="tutorial-intro"')}${text("tutorial.useLinks", "p")}${search}<ol class="tutorial-steps">${steps}</ol>${references}${section("sound", "tutorial.soundHelp", "trouble")}${next}</div></details>`;
}

export function renderPadQuickStart(locale) {
  const index = locale === "en" ? 1 : 0;
  return `<ol class="tutorial-quick" aria-label="${escape(tutorialPairs["tutorial.steps"][index])}" data-i18n-aria-label="tutorial.steps">${[1, 2, 3].map((n) => `<li><b aria-hidden="true">${n}</b><span data-i18n="tutorial.pads.quick${n}">${escape(tutorialPairs[`tutorial.pads.quick${n}`][index])}</span></li>`).join("")}</ol>`;
}
