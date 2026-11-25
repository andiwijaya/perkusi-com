import { instruments } from "../instruments/catalog.js";
import { tutorialGuides } from "../tutorials/topics.js";
import { supportedLocales } from "../i18n/locale.js";

export const siteOrigin = "https://perkusi.com";
export const tutorialGuidePage = (tool) => `tutorial-${tool}`;
export const tutorialToolByPage = Object.fromEntries(
  Object.keys(tutorialGuides).map((tool) => [tutorialGuidePage(tool), tool]),
);
const basePaths = {
  home: "/",
  beatbox: "/beatbox/",
  studio: "/studio/",
  pads: "/pad-station/",
  tutorials: "/tutorial/",
  ...Object.fromEntries(
    Object.entries(tutorialGuides).map(([tool, { slug }]) => [
      tutorialGuidePage(tool),
      `/tutorial/${slug}/`,
    ]),
  ),
  privacy: "/privacy",
  notFound: "/404.html",
  instruments: "/instrumen/",
  ...Object.fromEntries(
    instruments.map((i) => [i.page, "/instrumen/" + i.slug + "/"]),
  ),
};
export const pages = Object.keys(basePaths);
export const indexablePages = pages.filter((page) => page !== "notFound");
export function pagePath(page, locale = "id") {
  const base = basePaths[page];
  if (!base) throw new Error("Unknown page: " + page);
  return locale === "en" ? "/en" + (base === "/" ? "/" : base) : base;
}
export function navigationHref(page, locale = "id", anchor = "") {
  return pagePath(page, locale) + (anchor ? "#" + anchor : "");
}
export function pageAlternates(page) {
  const localized = supportedLocales.map((language) => [
    language,
    siteOrigin + pagePath(page, language),
  ]);
  return [...localized, ["x-default", localized[0][1]]];
}
export function pageFromPath(pathname) {
  const base =
    (pathname === "/en" || pathname.startsWith("/en/")
      ? pathname.slice(3)
      : pathname) || "/";
  if (base === "/privacy.html") return "privacy";
  return (
    Object.entries(basePaths).find(
      ([, path]) => path === base || path === base + "/",
    )?.[0] ?? "notFound"
  );
}
export const buildEntries = Object.fromEntries(
  pages.flatMap((page) =>
    supportedLocales.map((locale) => {
      const path = pagePath(page, locale);
      const suffix = path.endsWith("/")
        ? "index.html"
        : page === "privacy"
          ? ".html"
          : "";
      return [`${page}_${locale}`, path.slice(1) + suffix];
    }),
  ),
);
