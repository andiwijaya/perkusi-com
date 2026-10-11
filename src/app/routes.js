export const pages = ["home", "beatbox", "studio", "privacy", "notFound"];
const basePaths = {
  home: "/",
  beatbox: "/beatbox/",
  studio: "/studio/",
  privacy: "/privacy.html",
  notFound: "/404.html",
};
export function pagePath(page, locale = "id") {
  const base = basePaths[page];
  if (!base) throw new Error("Unknown page: " + page);
  return locale === "en" ? "/en" + (base === "/" ? "/" : base) : base;
}
// User navigation must carry ID explicitly: an unqualified ID path may resolve
// to a remembered EN preference. Metadata continues to use query-free pagePath.
export function navigationHref(page, locale = "id", anchor = "") {
  return (
    pagePath(page, locale) +
    (locale === "id" ? "?lang=id" : "") +
    (anchor ? "#" + anchor : "")
  );
}
export function pageFromPath(pathname) {
  const base =
    (pathname === "/en" || pathname.startsWith("/en/")
      ? pathname.slice(3)
      : pathname) || "/";
  if (base === "/") return "home";
  if (base === "/beatbox" || base === "/beatbox/") return "beatbox";
  if (base === "/studio" || base === "/studio/") return "studio";
  if (base === "/privacy" || base === "/privacy.html") return "privacy";
  return "notFound";
}
export const buildEntries = Object.fromEntries(
  pages
    .flatMap((page) =>
      ["id", "en"].map((locale) => [
        page + "_" + locale,
        pagePath(page, locale).slice(1) || "index.html",
      ]),
    )
    .map(([key, file]) => [
      key,
      file.endsWith("/") ? file + "index.html" : file,
    ]),
);
