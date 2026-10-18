import { messages } from "../i18n/messages.js";
import {
  createTranslator,
  isLocale,
  readLocale,
  resolveLocale,
  saveLocale,
} from "../i18n/locale.js";
import { navigationHref, pagePath } from "./routes.js";
import { createSession } from "./session.js";
import { trackEvent } from "../analytics.js";

export function initLocalization() {
  const page = document.body.dataset.page;
  const session = createSession({
    page,
    locale: document.documentElement.lang,
  });
  const preference = () => {
    try {
      return readLocale(window.localStorage);
    } catch {
      return null;
    }
  };
  const persist = (locale) => {
    try {
      saveLocale(window.localStorage, locale);
    } catch {
      /* Storage is optional. */
    }
  };
  function applyLocale(locale) {
    const t = createTranslator(messages, locale, (key) =>
      console.error("Missing translation:", key),
    );
    document.documentElement.lang = locale;
    session.update({ locale });
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
      el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel));
    });
    document.querySelectorAll("[data-route]").forEach((el) => {
      el.href = navigationHref(el.dataset.route, locale);
    });
    document.querySelectorAll("[data-gamelan-link]").forEach((el) => {
      el.href = locale === "en" ? "/en/gamelan/" : "/gamelan/?lang=id";
    });
    document.querySelectorAll("[data-loop-link]").forEach((el) => {
      el.href =
        locale === "en" ? "/en/loop-station/" : "/loop-station/?lang=id";
    });
    document.querySelectorAll("[data-home-anchor]").forEach((el) => {
      el.href =
        page === "home"
          ? "#" + el.dataset.homeAnchor
          : navigationHref("home", locale, el.dataset.homeAnchor);
    });
    document.querySelectorAll("[data-locale]").forEach((el) => {
      el.href = navigationHref(page, el.dataset.locale);
      el.setAttribute("aria-current", String(el.dataset.locale === locale));
    });
    const canonical = "https://perkusi.com" + pagePath(page, locale);
    document.title = t("meta." + page + ".title");
    document.querySelector('link[rel="canonical"]').href = canonical;
    document.querySelector('meta[name="description"]').content = t(
      "meta." + page + ".description",
    );
    document.querySelector('meta[property="og:title"]').content =
      document.title;
    document.querySelector('meta[property="og:description"]').content = t(
      page === "home" ? "meta.home.social" : "meta." + page + ".description",
    );
    document.querySelector('meta[property="og:url"]').content = canonical;
    document.querySelector('meta[property="og:locale"]').content =
      locale === "id" ? "id_ID" : "en_US";
    document.dispatchEvent(
      new CustomEvent("perkusi:locale", { detail: { locale } }),
    );
  }
  function applyUrl(event) {
    const url = new URL(location.href);
    const queryLocale = url.searchParams.get("lang");
    const historyLocale =
      event?.type === "popstate" ? event.state?.perkusiLocale : null;
    const explicitLocale = isLocale(queryLocale) ? queryLocale : historyLocale;
    const locale = resolveLocale({
      pathname: url.pathname,
      explicitLocale,
      storedLocale: preference(),
    });
    if (
      isLocale(explicitLocale) ||
      url.pathname === "/en" ||
      url.pathname.startsWith("/en/")
    )
      persist(locale);
    applyLocale(locale);
    // A missing URL must remain a missing URL; never turn a 404 into a valid route.
    if (page !== "notFound") {
      url.pathname = pagePath(page, locale);
      history.replaceState(
        { ...history.state, perkusiLocale: locale },
        "",
        url.pathname + url.search + url.hash,
      );
    }
  }
  document.querySelectorAll("[data-locale]").forEach((link) =>
    link.addEventListener("click", (event) => {
      if (
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      event.preventDefault();
      const locale = link.dataset.locale;
      if (locale !== document.documentElement.lang)
        trackEvent("language_changed", locale);
      persist(locale);
      const current = new URL(location.href);
      current.searchParams.delete("lang");
      if (locale === "id" || page === "notFound")
        current.searchParams.set("lang", locale);
      const pathname =
        page === "notFound" ? current.pathname : pagePath(page, locale);
      history.pushState(
        { ...history.state, perkusiLocale: locale },
        "",
        pathname + current.search + current.hash,
      );
      applyLocale(locale);
    }),
  );
  window.addEventListener("popstate", applyUrl);
  applyUrl();
  return session;
}
