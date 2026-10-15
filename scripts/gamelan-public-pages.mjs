import { gamelanPublicMetadata } from "../src/gamelan/public-context.js";
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
  { page = null, locale = "id", credits = false } = {},
) {
  const t = createTranslator(messages, locale),
    href = locale === "en" ? "/en/gamelan/" : "/gamelan/?lang=id";
  if (page) {
    const link = `<a data-gamelan-link href="${href}" data-i18n="common.gamelanPreview">${escape(t("common.gamelanPreview"))}</a>`;
    html = html.replace(/(<nav id="navigation"[^>]*>)/, "$1" + link);
    if (page === "home")
      html = html.replace(
        '<div class="tool-grid">',
        '<div class="tool-grid">' +
          `<article class="tool-card"><h3 data-i18n="common.gamelanPreview">${escape(t("common.gamelanPreview"))}</h3><p data-i18n="home.gamelanPreviewCopy">${escape(t("home.gamelanPreviewCopy"))}</p><div class="card-bottom"><a data-gamelan-link href="${href}" data-i18n="common.gamelanPlay">${escape(t("common.gamelanPlay"))}</a></div></article>`,
      );
    return html;
  }
  const m = gamelanPublicMetadata(locale, { credits });
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
