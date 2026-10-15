import { gamelanBuildMode } from "./public-context.js";
export function instrumentRouteContext(pathname, query, mode) {
  if (!gamelanBuildMode(mode)) return null;
  if (/^\/(?:en\/)?gamelan\/?$/.test(pathname)) return { studio: false };
  if (
    /^\/(?:en\/)?studio\/?$/.test(pathname) &&
    new URLSearchParams(query).get("workspace") === "gamelan"
  )
    return { studio: true };
  return null;
}
export function instrumentRouteHref(studio, locale) {
  return (
    (locale === "en" ? "/en" : "") +
    (studio ? "/studio/?workspace=gamelan&lang=" : "/gamelan/?lang=") +
    (locale === "en" ? "en" : "id")
  );
}
