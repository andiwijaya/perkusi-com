import { tutorialPairs } from "./messages.js";

const screenshots = {
  pads: {
    2: ["pads-drums", 646, 251],
    3: ["pads-instruments", 530, 480],
    4: ["pads-volume", 500, 132],
  },
  studio: {
    2: ["studio-tempo", 708, 173],
    3: ["studio-grid", 950, 184],
    5: ["studio-chain", 708, 341, 342],
    6: ["studio-wav", 674, 579],
  },
  beatbox: {
    1: ["beatbox-play", 580, 139],
    2: ["beatbox-mix", 678, 679],
    3: ["beatbox-variation", 150, 331],
    5: ["beatbox-wav", 490, 382, 409],
  },
};

export function screenshotFor(tool, step) {
  return screenshots[tool][step];
}

export function screenshotDetails([name, width, idHeight, enHeight], locale) {
  return {
    src: `/images/tutorials/${name}-${locale}.webp`,
    width,
    height: locale === "en" ? (enHeight ?? idHeight) : idHeight,
    alt: tutorialPairs[`tutorial.screenshot.${name}.alt`][
      locale === "en" ? 1 : 0
    ],
  };
}

export function initTutorialScreenshots(guide, signal) {
  const tool = guide.dataset.tutorialTool;
  const figures = guide.querySelectorAll("[data-tutorial-screenshot]");
  function update(locale) {
    for (const figure of figures) {
      const { src, height, alt } = screenshotDetails(
        screenshotFor(tool, figure.dataset.tutorialScreenshot),
        locale,
      );
      const image = figure.querySelector("img");
      image.alt = alt;
      image.height = height;
      image.src = src;
      figure.querySelector("a").href = src;
    }
  }
  document.addEventListener(
    "perkusi:locale",
    (event) => update(event.detail.locale),
    { signal },
  );
  // Initial localization can resolve a ?lang= override before listeners attach.
  update(document.documentElement.lang);
}
