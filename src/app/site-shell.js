import { messages } from "../i18n/messages.js";
import { createTranslator } from "../i18n/locale.js";
import { navigationHref } from "./routes.js";

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
}
export function renderSiteShell(
  page,
  locale,
  { languageHref, gamelanHref } = {},
) {
  const t = createTranslator(messages, locale);
  const text = (key) => escapeHtml(t(key));
  const path = (target) => navigationHref(target, locale);
  const routeAttrs = (target) =>
    `data-route="${target}" href="${path(target)}"`;
  const brand = `<a class="brand" ${routeAttrs("home")} data-i18n-aria-label="common.homeLabel" aria-label="${text("common.homeLabel")}"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3 14v4m6-10v16m7-21v26m7-21v16m6-10v4"/></svg>perkusi<span>.com</span></a>`;
  const langLinks = `<div class="language-switch" role="group" data-i18n-aria-label="common.language" aria-label="${text("common.language")}">${["id", "en"].map((lang) => `<a data-locale="${lang}" href="${languageHref?.(lang) ?? navigationHref(page, lang)}" lang="${lang}" hreflang="${lang}" aria-current="${lang === locale ? "true" : "false"}" data-i18n-aria-label="${lang === "id" ? "common.toId" : "common.toEn"}" aria-label="${text(lang === "id" ? "common.toId" : "common.toEn")}">${lang === "id" ? "ID" : "EN"}</a>`).join("")}</div>`;
  const header = `<a class="skip-link" href="#main" data-i18n="common.skip">${text("common.skip")}</a><header class="site-header wrap">${brand}<div class="header-controls">${langLinks}<button class="menu-toggle" aria-expanded="false" aria-controls="navigation"><span data-i18n="common.menu">${text("common.menu")}</span><span aria-hidden="true">+</span></button></div><nav id="navigation" data-i18n-aria-label="common.navLabel" aria-label="${text("common.navLabel")}"><a data-home-anchor="tools" href="${path("home")}#tools" data-i18n="common.tools">${text("common.tools")}</a><a data-home-anchor="approach" href="${path("home")}#approach" data-i18n="common.approach">${text("common.approach")}</a><a ${routeAttrs("studio")} data-i18n="common.studio">${text("common.studio")}</a><a ${routeAttrs("pads")} data-i18n="common.pads">${text("common.pads")}</a><a class="nav-cta" ${routeAttrs("beatbox")}><span data-i18n="common.find">${text("common.find")}</span><span aria-hidden="true">↗</span></a></nav></header>`;
  return {
    brand,
    header: gamelanHref
      ? header.replace(
          /(<nav id="navigation"[^>]*>)/,
          `$1<a data-gamelan-link href="${escapeHtml(gamelanHref)}" data-i18n="common.gamelanPreview">${text("common.gamelanPreview")}</a>`,
        )
      : header,
  };
}
