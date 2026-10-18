import {
  gamelanPublicMetadata,
  loopPublicMetadata,
} from "../src/gamelan/public-context.js";
import { createTranslator } from "../src/i18n/locale.js";
import { messages } from "../src/i18n/messages.js";
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function publicCandidateHTML(
  html,
  {
    page = null,
    locale = "id",
    credits = false,
    v5UX = false,
    loop = false,
  } = {},
) {
  const t = createTranslator(messages, locale),
    href = locale === "en" ? "/en/gamelan/" : "/gamelan/?lang=id";
  if (page) {
    const link = `<a data-gamelan-link href="${href}" data-i18n="common.gamelanPreview">${escape(t("common.gamelanPreview"))}</a>`;
    html = html.replace(/(<nav id="navigation"[^>]*>)/, "$1" + link);
    if (page === "home") {
      const card = v5UX
        ? `<article class="tool-card" data-gamelan-card><div class="card-meta"><span>05 / GAMELAN</span><span class="badge" data-i18n="common.previewStatus">${escape(t("common.previewStatus"))}</span></div><div class="tool-symbol gamelan-symbol" aria-hidden="true">${"<i></i>".repeat(7)}</div><h3 data-i18n="common.gamelanPreview">${escape(t("common.gamelanPreview"))}</h3><p data-i18n="home.gamelanPreviewCopy">${escape(t("home.gamelanPreviewCopy"))}</p><div class="card-bottom"><a data-gamelan-link href="${href}" data-i18n="common.gamelanPlay">${escape(t("common.gamelanPlay"))}</a><span aria-hidden="true">↗</span></div></article>`
        : `<article class="tool-card"><h3 data-i18n="common.gamelanPreview">${escape(t("common.gamelanPreview"))}</h3><p data-i18n="home.gamelanPreviewCopy">${escape(t("home.gamelanPreviewCopy"))}</p><div class="card-bottom"><a data-gamelan-link href="${href}" data-i18n="common.gamelanPlay">${escape(t("common.gamelanPlay"))}</a></div></article>`;
      html = html.replace(
        '<div class="tool-grid">',
        '<div class="tool-grid">' + card,
      );
      if (v5UX) {
        const loopHref =
          locale === "en" ? "/en/loop-station/" : "/loop-station/?lang=id";
        const loopCard = `<article class="tool-card" data-v5-loop-card><div class="card-meta"><span>02 / LOOP STATION</span><span class="badge" data-i18n="common.previewStatus">${escape(t("common.previewStatus"))}</span></div><div class="tool-symbol loop-symbol" aria-hidden="true">${"<i></i>".repeat(3)}</div><h3 data-i18n="common.loopPreview">${escape(t("common.loopPreview"))}</h3><p data-i18n="home.loopPreviewCopy">${escape(t("home.loopPreviewCopy"))}</p><div class="card-bottom"><a data-loop-link href="${loopHref}" data-i18n="home.loopPreviewAction">${escape(t("home.loopPreviewAction"))}</a></div></article>`;
        html = html.replace(
          /<article class="tool-card">(?:(?!<\/article>)[\s\S])*?data-i18n="home.card2.title"(?:(?!<\/article>)[\s\S])*?<\/article>/,
          loopCard,
        );
        html = html.replace(/<body\b/, "<body data-v5-ux");
      }
    }
    return html;
  }
  const m = loop
    ? loopPublicMetadata(locale)
    : gamelanPublicMetadata(locale, { credits });
  html = html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escape(m.title)}</title>`)
    .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?\s*>/g, "");
  const head = `<meta name="description" content="${escape(m.description)}"><link rel="canonical" href="${m.canonical}">${Object.entries(
    m.alternates,
  )
    .map(
      ([lang, url]) =>
        `<link rel="alternate" hreflang="${lang}" href="${url}">`,
    )
    .join(
      "",
    )}<meta property="og:title" content="${escape(m.title)}"><meta property="og:url" content="${m.canonical}">`;
  return html.replace("</head>", head + "</head>");
}
