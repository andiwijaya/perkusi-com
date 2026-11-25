import { instrumentCopy } from "./copy.js";
import { instruments, instrumentBySlug } from "./catalog.js";
import {
  articleBreadcrumb,
  renderArticleFacts,
  renderArticleReading,
  renderArticlePractice,
  renderArticleToc,
} from "./render.js";

const contentLoaders = import.meta.glob("./content/*.js");
export async function initInstrumentPages() {
  const slug = document.querySelector("[data-article-slug]")?.dataset
    .articleSlug;
  const article = slug
    ? (await contentLoaders["./content/" + slug + ".js"]()).default
    : null;
  const search = document.querySelector("#instrument-search"),
    category = document.querySelector("#instrument-category");
  const filter = () => {
    let count = 0;
    for (const card of document.querySelectorAll(
      ".instrument-index .instrument-card",
    )) {
      const show =
        (!search.value ||
          card.dataset.search
            .toLowerCase()
            .includes(search.value.toLowerCase().trim())) &&
        (category.value === "all" || card.dataset.category === category.value);
      card.hidden = !show;
      if (show) count++;
    }
    document.querySelector("#instrument-count").textContent = count;
    document.querySelector("#instrument-empty").hidden = count !== 0;
  };
  if (search) {
    document.querySelector(".instrument-filters").hidden = false;
    search.addEventListener("input", filter);
    category.addEventListener("change", filter);
  }
  const localize = () => {
    const locale = document.documentElement.lang,
      t = instrumentCopy[locale];
    if (article) {
      const content = article[locale];
      document.querySelector("[data-article-title]").textContent =
        content.title;
      document.querySelector("[data-article-dek]").textContent = content.dek;
      document.querySelector(".instrument-facts").innerHTML =
        renderArticleFacts(content, locale);
      document.querySelector(".instrument-reading").innerHTML =
        renderArticleReading(content);
      document.querySelector(".instrument-practice").innerHTML =
        renderArticlePractice(content, locale);
      document.querySelector(".instrument-toc").innerHTML = renderArticleToc(
        content,
        locale,
      );
      const schema = document.querySelector("script[data-article-schema]");
      const data = JSON.parse(schema.textContent);
      data.headline = content.title;
      data.description = content.dek;
      data.inLanguage = locale;
      data.mainEntityOfPage = document.querySelector(
        'link[rel="canonical"]',
      ).href;
      schema.textContent = JSON.stringify(data);
      document.querySelector("[data-breadcrumb-schema]").textContent =
        JSON.stringify({
          "@context": "https://schema.org",
          ...articleBreadcrumb(instrumentBySlug(slug), locale),
        });
      const words = content.sections
        .flatMap((s) => s.paragraphs)
        .join(" ")
        .split(/\s+/).length;
      document.querySelector("[data-reading-time]").textContent = Math.max(
        3,
        Math.ceil(words / 180),
      );
    }
    document.querySelectorAll("[data-instrument-copy]").forEach((el) => {
      el.textContent = t[el.dataset.instrumentCopy];
    });
    document.querySelectorAll("[data-instrument-name]").forEach((el) => {
      el.textContent = instrumentBySlug(el.dataset.instrumentName)[locale];
    });
    for (const item of instruments)
      document
        .querySelectorAll('img[src="' + item.image + '"]')
        .forEach((img) => {
          img.alt = item[locale];
        });
    document.querySelectorAll("[data-instrument-summary]").forEach((el) => {
      el.textContent = instrumentBySlug(el.dataset.instrumentSummary).summary[
        locale
      ];
    });
    if (search) {
      document.querySelector("#instrument-empty").textContent = t.empty;
      filter();
    }
  };
  document.addEventListener("perkusi:locale", localize);
  localize();
  if (slug) {
    const { initArticlePad } = await import("./pad.js");
    initArticlePad(instrumentBySlug(slug));
  }
}
