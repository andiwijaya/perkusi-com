import { screenshotFor } from "./screenshots.js";

export const tutorialGuides = {
  pads: { nameKey: "home.pads.title", steps: 5, slug: "pad-station" },
  studio: { nameKey: "home.card1.title", steps: 6, slug: "rhythm-studio" },
  beatbox: {
    nameKey: "home.card3.title",
    steps: 5,
    slug: "beatbox-playground",
  },
};

export function tutorialTopics(tool) {
  const text = (key) => `tutorial.${tool}.${key}`;
  const steps = Array.from(
    { length: tutorialGuides[tool].steps },
    (_, index) => {
      const step = index + 1;
      const screenshot = screenshotFor(tool, step);
      return {
        id: `tutorial-step-${step}`,
        titleKey: text(`step${step}Title`),
        bodyKey: text(`step${step}`),
        step,
        screenshot,
        captionKey:
          screenshot && `tutorial.screenshot.${screenshot[0]}.caption`,
        recipe: tool === "studio" && step === 3,
      };
    },
  );
  const sections =
    tool === "studio"
      ? [
          { id: "save", titleKey: text("saveTitle"), bodyKey: text("save") },
          { id: "demo", titleKey: text("demoTitle"), bodyKey: text("demo") },
        ]
      : [
          {
            id: "keyboard",
            titleKey: "tutorial.keyboard",
            bodyKey: text("keys"),
          },
        ];
  sections.push({
    id: "sound",
    titleKey: "tutorial.soundHelp",
    bodyKey: text("trouble"),
  });
  if (tool === "pads") {
    sections.push({
      id: "next",
      titleKey: text("nextTitle"),
      bodyKey: text("next"),
    });
  }
  return [
    ...steps,
    ...sections.map((section) => ({
      ...section,
      id: `tutorial-topic-${section.id}`,
    })),
  ];
}
