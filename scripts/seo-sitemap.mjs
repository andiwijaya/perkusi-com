import {
  indexablePages,
  pageAlternates,
  pagePath,
  siteOrigin,
} from "../src/app/routes.js";
import { supportedLocales } from "../src/i18n/locale.js";

export function renderSitemap() {
  const entries = indexablePages.flatMap((page) => {
    const alternates = pageAlternates(page)
      .map(
        ([language, url]) =>
          `    <xhtml:link rel="alternate" hreflang="${language}" href="${url}"/>`,
      )
      .join("\n");
    return supportedLocales.map(
      (locale) =>
        `  <url>\n    <loc>${siteOrigin + pagePath(page, locale)}</loc>\n${alternates}\n  </url>`,
    );
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join("\n")}\n</urlset>\n`;
}
