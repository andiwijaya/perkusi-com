import { tutorialPairs } from "./messages.js";
import { screenshotDetails } from "./screenshots.js";
import { tutorialTopics } from "./topics.js";
import { navigationHref, tutorialGuidePage } from "../app/routes.js";

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

function renderScreenshot({ screenshot, step, captionKey }, locale) {
  const { src, width, height, alt } = screenshotDetails(screenshot, locale);
  const caption = copy(locale, captionKey, "span");
  return `<figure class="tutorial-screenshot" data-tutorial-screenshot="${step}"><img src="${src}" width="${width}" height="${height}" alt="${escape(alt)}" loading="lazy" decoding="async"><figcaption>${caption}<a href="${src}" target="_blank" rel="noopener">${copy(locale, "tutorial.screenshot.enlarge", "span")}</a></figcaption></figure>`;
}

export function renderTutorialSearch(locale, all = false) {
  const label = all ? "tutorial.search.all" : "tutorial.search.label";
  return `<form class="tutorial-search" role="search" aria-labelledby="tutorial-search-label" hidden>${copy(locale, label, "label", 'id="tutorial-search-label" for="tutorial-query"')}<div class="tutorial-search-controls"><input id="tutorial-query" type="search" autocomplete="off" maxlength="100" aria-controls="tutorial-search-results"><button type="button" data-tutorial-clear hidden>${copy(locale, "tutorial.search.clear", "span")}</button></div><p class="tutorial-search-status" role="status"></p><ul class="tutorial-search-results" id="tutorial-search-results" hidden></ul></form>`;
}

function guideLink(locale, page, key, anchor = "") {
  return `<a class="tutorial-jump" data-route="${page}"${anchor ? ` data-route-anchor="${anchor}"` : ""} href="${navigationHref(page, locale, anchor)}">${copy(locale, key, "span")}</a>`;
}

function renderTutorialBody(tool, locale, standalone = false) {
  const steps = [];
  const sections = [];
  for (const topic of tutorialTopics(tool)) {
    const { id, titleKey, bodyKey, step, recipe, screenshot } = topic;
    const content =
      copy(locale, titleKey, standalone ? "h2" : "h3") + copy(locale, bodyKey);
    if (step) {
      const destination = stepTargets[tool][step];
      const link = destination
        ? standalone
          ? guideLink(locale, tool, destination[1], destination[0])
          : tutorialLink(locale, ...destination)
        : "";
      steps.push(
        `<li id="${id}" tabindex="-1" data-tutorial-topic>${content}${recipe ? renderStudioRecipe(locale) : ""}${link}${screenshot ? renderScreenshot(topic, locale) : ""}</li>`,
      );
    } else {
      const next = id === "tutorial-topic-next";
      const link = next
        ? `<a data-route="studio" href="${navigationHref("studio", locale)}">${copy(locale, "tutorial.pads.studioLink", "span")}</a>`
        : "";
      sections.push(
        `<section id="${id}" class="${next ? "tutorial-next" : "tutorial-reference"} tutorial-destination" tabindex="-1" data-tutorial-topic>${content}${link}</section>`,
      );
    }
  }
  const guide = standalone
    ? ""
    : guideLink(locale, tutorialGuidePage(tool), "tutorial.guide.read");
  return `<div class="tutorial-body">${copy(locale, `tutorial.${tool}.intro`, "p", 'class="tutorial-intro"')}${standalone ? "" : copy(locale, "tutorial.useLinks")}${guide}${renderTutorialSearch(locale)}<ol class="tutorial-steps">${steps.join("")}</ol>${sections.join("")}</div>`;
}

export function renderTutorial(tool, locale) {
  return `<details class="tool-tutorial" id="tutorial" data-tutorial-tool="${tool}"><summary>${copy(locale, `tutorial.${tool}.title`, "span", 'class="tutorial-title"')}${copy(locale, `tutorial.${tool}.summary`, "span", 'class="tutorial-summary"')}</summary>${renderTutorialBody(tool, locale)}</details>`;
}

export function renderTutorialGuide(tool, locale) {
  return `<main id="main" class="tutorial-hub tutorial-guide wrap" tabindex="-1" data-tutorial-tool="${tool}"><header class="tutorial-hub-intro">${guideLink(locale, "tutorials", "tutorial.guide.all")}${copy(locale, `tutorial.${tool}.guideHeading`, "h1")}${copy(locale, `tutorial.${tool}.summary`)}${guideLink(locale, tool, "tutorial.guide.try", "tutorial")}</header>${renderTutorialBody(tool, locale, true)}</main>`;
}

export function renderPadQuickStart(locale) {
  const index = locale === "en" ? 1 : 0;
  return `<ol class="tutorial-quick" aria-label="${escape(tutorialPairs["tutorial.steps"][index])}" data-i18n-aria-label="tutorial.steps">${[1, 2, 3].map((n) => `<li><b aria-hidden="true">${n}</b><span data-i18n="tutorial.pads.quick${n}">${escape(tutorialPairs[`tutorial.pads.quick${n}`][index])}</span></li>`).join("")}</ol>`;
}
