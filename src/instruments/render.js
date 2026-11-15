import { instruments, instrumentBySlug } from "./catalog.js";
import { instrumentCopy } from "./copy.js";
import { navigationHref } from "../app/routes.js";

export const html = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const copy = (locale, key, tag = "span", attrs = "") =>
  `<${tag} data-instrument-copy="${key}" ${attrs}>${html(instrumentCopy[locale][key])}</${tag}>`;
export function renderInstrumentCard(instrument, locale) {
  const t = instrumentCopy[locale];
  return `<article class="instrument-card" data-category="${instrument.category}" data-search="${html(instrument.id + " " + instrument.en)}"><a data-route="${instrument.page}" href="${navigationHref(instrument.page, locale)}"><img src="${instrument.image}" alt="${html(instrument[locale])}" width="1536" height="1024" loading="lazy"><div class="instrument-card-copy"><span class="eyebrow" data-instrument-copy="${instrument.category}">${html(t[instrument.category])}</span><h2 data-instrument-name="${instrument.slug}">${html(instrument[locale])}</h2><p class="instrument-card-summary" data-instrument-summary="${instrument.slug}">${html(instrument.summary[locale])}</p><p><strong>${instrument.count}</strong> ${copy(locale, "sounds")}</p><span class="instrument-card-cta">${copy(locale, "read")} <span aria-hidden="true">↗</span></span></div></a></article>`;
}
export function renderInstrumentIndex(locale) {
  const t = instrumentCopy[locale];
  return `<main id="main" class="instrument-index wrap" tabindex="-1"><header class="instrument-index-intro">${copy(locale, "eyebrow", "p", 'class="eyebrow"')}${copy(locale, "title", "h1")}${copy(locale, "intro", "p", 'class="instrument-dek"')}<div class="instrument-index-numbers"><span><b>16</b> ${copy(locale, "index")}</span><span><b>110</b> ${copy(locale, "sounds")}</span></div></header><div class="instrument-filters" hidden><label>${copy(locale, "search")}<input id="instrument-search" type="search" maxlength="100" autocomplete="off"></label><label>${copy(locale, "category")}<select id="instrument-category">${["all", "gamelan", "percussion", "strings", "synthetic"].map((key) => `<option value="${key}" data-instrument-copy="${key}">${html(t[key])}</option>`).join("")}</select></label></div><p class="instrument-result-count" role="status" aria-live="polite"><b id="instrument-count">16</b> ${copy(locale, "results")}</p><p id="instrument-empty" hidden>${html(t.empty)}</p><div class="instrument-grid">${instruments.map((i) => renderInstrumentCard(i, locale)).join("")}</div><noscript>${html(t.noscript)}</noscript></main>`;
}
export function renderArticleReading(content) {
  return content.sections
    .map(
      (section, n) =>
        `<section id="story-${n + 1}"><h2>${html(section.heading)}</h2>${section.paragraphs.map((p) => `<p>${html(p)}</p>`).join("")}</section>`,
    )
    .join("");
}
export function renderArticlePractice(content, locale) {
  return `${copy(locale, "exercise", "h2", 'id="exercise"')}<ol>${content.exercise.map((p) => `<li>${html(p)}</li>`).join("")}</ol>${copy(locale, "listening", "h2")}<p>${html(content.listening)}</p>`;
}
export function renderArticleFacts(content, locale) {
  return ["origin", "materials", "technique"]
    .map(
      (key) =>
        `<div>${copy(locale, key, "dt")}<dd>${html(content[key])}</dd></div>`,
    )
    .join("");
}
export function renderArticleToc(content, locale) {
  return `${copy(locale, "contents", "p", 'class="eyebrow"')}<ol>${content.sections.map((section, n) => `<li><a href="#story-${n + 1}">${html(section.heading)}</a></li>`).join("")}<li><a href="#exercise">${html(instrumentCopy[locale].exercise)}</a></li></ol>`;
}
export function renderArticlePad(instrument, locale) {
  const t = instrumentCopy[locale];
  return `<section class="article-pad" id="try-instrument" aria-labelledby="article-pad-title" data-instrument="${instrument.slug}" data-state="idle"><div class="article-pad-heading"><div><p class="eyebrow"><span data-instrument-name="${instrument.slug}">${html(instrument[locale])}</span> / LIVE PAD</p>${copy(locale, "padTitle", "h2", 'id="article-pad-title"')}${copy(locale, "padIntro", "p")}</div><span class="article-pad-mark" aria-hidden="true">♪</span></div><div class="article-pad-controls"><button type="button" class="button" id="article-prepare" disabled>${html(t.prepare)}</button><button type="button" id="article-stop" disabled>${html(t.stop)}</button><label>${copy(locale, "volume")}<input id="article-volume" type="range" min="0" max="0.75" step="0.01" value="0.5" aria-label="${html(t.volume)}"></label>${instrument.banks.length > 1 ? `<label>${copy(locale, "scale")}<select id="article-bank">${instrument.banks.map((bank) => `<option value="${bank.key}">${html(bank.label)}</option>`).join("")}</select></label>` : ""}</div><p id="article-pad-status" role="status" aria-live="polite" aria-atomic="true">${html(t.idle)}</p><div class="article-pad-buttons">${renderArticleButtons(instrument, instrument.banks[0].key, false, locale)}</div>${copy(locale, "keyboard", "p", 'class="article-pad-hint"')}${copy(locale, instrument.slug === "bilah" ? "syntheticNote" : instrument.category === "gamelan" ? "subset" : "selectedNote", "p", 'class="article-pad-hint"')}<noscript>${html(t.noscript)}</noscript></section>`;
}
export function renderArticleButtons(
  instrument,
  key,
  ready = false,
  locale = "id",
) {
  return instrument.banks
    .find((b) => b.key === key)
    .notes.map(
      ([id, label], n) =>
        `<button type="button" class="article-sound-pad" data-article-note="${id}" aria-keyshortcuts="${n + 1}" ${ready ? "" : "disabled"}><kbd aria-hidden="true">${n + 1}</kbd><strong>${html(articleNoteLabel(instrument, id, label, locale))}</strong><span aria-hidden="true">●</span></button>`,
    )
    .join("");
}
export function renderInstrumentArticle(slug, locale, article) {
  const instrument = instrumentBySlug(slug),
    content = article[locale];
  const words = content.sections
    .flatMap((s) => s.paragraphs)
    .join(" ")
    .split(/\s+/).length;
  const peers = instruments.filter(
    (i) => i.slug !== slug && i.category === instrument.category,
  );
  const related = [
    ...peers,
    ...instruments.filter((i) => i.slug !== slug && !peers.includes(i)),
  ].slice(0, 3);
  const credits = ["drum", "bilah"].includes(slug)
    ? "original"
    : ["gitar-nylon", "bass-elektrik"].includes(slug)
      ? "freepats"
      : "recorded";
  return `<main id="main" class="instrument-article wrap" tabindex="-1" data-article-slug="${slug}"><nav class="instrument-breadcrumb" aria-label="Breadcrumb"><a data-route="home" href="${navigationHref("home", locale)}">${copy(locale, "home")}</a><span aria-hidden="true">/</span><a data-route="instruments" href="${navigationHref("instruments", locale)}">${copy(locale, "index")}</a><span aria-hidden="true">/</span><span data-instrument-name="${slug}">${html(instrument[locale])}</span></nav><header class="instrument-article-hero"><div><p class="eyebrow">${copy(locale, "eyebrow")} / ${String(instruments.indexOf(instrument) + 1).padStart(2, "0")}</p><h1 data-article-title>${html(content.title)}</h1><p class="instrument-dek" data-article-dek>${html(content.dek)}</p><p class="instrument-byline">${copy(locale, "author")} · <time datetime="2026-11-15">${copy(locale, "date")}</time> · <span data-reading-time>${Math.max(3, Math.ceil(words / 180))}</span> ${copy(locale, "minutes")}</p><a class="instrument-jump" href="#try-instrument">${copy(locale, "read")} <span aria-hidden="true">↓</span></a></div><figure><img class="instrument-cover" src="${instrument.image}" alt="${html(instrument[locale])}" width="1536" height="1024" fetchpriority="high"><figcaption>${copy(locale, "ai")}</figcaption></figure></header><dl class="instrument-facts">${renderArticleFacts(content, locale)}</dl>${renderArticlePad(instrument, locale)}<div class="instrument-story-layout"><aside class="instrument-toc">${renderArticleToc(content, locale)}</aside><article class="instrument-prose"><div class="instrument-reading">${renderArticleReading(content)}</div><section class="instrument-practice">${renderArticlePractice(content, locale)}</section><section class="instrument-sources">${copy(locale, "sources", "h2")}<ul>${article.sources.map((source) => `<li><a href="${html(source.url)}" target="_blank" rel="noopener noreferrer">${html(source.title)} ↗</a></li>`).join("")}</ul></section><details class="instrument-audio-credits"><summary>${copy(locale, "credits")}</summary>${copy(locale, credits, "p")}${credits === "recorded" ? '<p><a href="/internal/gamelan-delivery/LICENSE_CC_BY_3.0.txt">CC BY 3.0</a> · <a href="/internal/gamelan-delivery/LICENSE_ARTISTIC_2.0.txt">Artistic 2.0</a> · <a href="/internal/gamelan-delivery/NOTICE.txt">NOTICE</a></p>' : credits === "original" ? '<p><a href="/STUDIO-KITS-LICENSE.txt">Drum CC0</a> · <a href="/V3-SOUNDS-LICENSE.txt">Bilah CC0</a></p>' : '<p><a href="https://freepats.zenvoid.org/">FreePats</a></p>'}<ul id="article-audio-links"></ul></details></article></div><section class="instrument-related">${copy(locale, "related", "h2")}<div class="instrument-grid">${related.map((i) => renderInstrumentCard(i, locale)).join("")}</div><div class="instrument-bottom-links"><a class="button" data-route="instruments" href="${navigationHref("instruments", locale)}">${copy(locale, "allArticles")}</a><a data-route="pads" href="${navigationHref("pads", locale)}">${copy(locale, "padStation")} ↗</a></div></section></main>`;
}

export function articleNoteLabel(instrument, id, label, locale) {
  if (instrument.slug === "drum" && locale === "id")
    return (
      { "closed-hat": "Hi-hat rapat", "open-hat": "Hi-hat terbuka" }[id] ||
      label
    );
  return label;
}
