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
    finalStudio = false,
    loop = false,
  } = {},
) {
  const translate = createTranslator(messages, locale),
    key = (k) =>
      finalStudio
        ? ({
            "common.gamelanPreview": "common.gamelan",
            "common.previewStatus": "common.instrumentStatus",
            "home.gamelanPreviewCopy": "home.gamelanCopy",
          }[k] ?? k)
        : k,
    t = (k) => translate(key(k)),
    href = locale === "en" ? "/en/gamelan/" : "/gamelan/?lang=id";
  // The homepage advertises only the two retained rhythm tools.
  if (page === "home") return html;
  if (page) {
    const link = `<a data-gamelan-link href="${href}" data-i18n="common.gamelanPreview">${escape(t("common.gamelanPreview"))}</a>`;
    html = html.replace(/(<nav id="navigation"[^>]*>)/, "$1" + link);
    if (finalStudio)
      html = html.replace(
        /data-i18n="(common.gamelanPreview|common.previewStatus|home.gamelanPreviewCopy)"/g,
        (_, k) => `data-i18n="${key(k)}"`,
      );
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
