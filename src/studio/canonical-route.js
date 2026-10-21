const hosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

// Public Preview is separately compiled and always opt-in. The normal public
// build keeps this third argument false; a query cannot enable that build.
export function canonicalLocalBuild(enabled, href, publicPreview = false) {
  const url = new URL(href);
  return (
    (enabled === true && hosts.has(url.hostname)) ||
    (publicPreview === true &&
      ((url.protocol === "https:" &&
        ["perkusi.com", "www.perkusi.com"].includes(url.hostname)) ||
        hosts.has(url.hostname)))
  );
}
export function canonicalLocalRoute(
  enabled,
  href,
  publicPreview = false,
  finalStudio = import.meta.env?.CANONICAL_FINAL_STUDIO === true,
) {
  const url = new URL(href);
  return (
    canonicalLocalBuild(enabled, href, publicPreview || finalStudio) &&
    [
      "/studio/",
      "/studio",
      "/en/studio/",
      "/en/studio",
      "/studio/index.html",
      "/en/studio/index.html",
    ].includes(url.pathname) &&
    (finalStudio ||
      (url.searchParams.get("candidate") === "canonical" &&
        !url.searchParams.has("workspace")))
  );
}
export function canonicalLocalSession(
  enabled,
  href,
  publicPreview = false,
  finalStudio = import.meta.env?.CANONICAL_FINAL_STUDIO === true,
) {
  return (
    canonicalLocalBuild(enabled, href, publicPreview || finalStudio) &&
    (finalStudio || new URL(href).searchParams.get("candidate") === "canonical")
  );
}
export function canonicalLegacyHref(locale = "id") {
  return (
    (locale === "en" ? "/en" : "") +
    "/studio/?workspace=legacy&lang=" +
    (locale === "en" ? "en" : "id")
  );
}
export function canonicalRecoveryHref(locale = "id") {
  return (
    (locale === "en" ? "/en" : "") +
    "/studio/recovery/?lang=" +
    (locale === "en" ? "en" : "id")
  );
}
export function canonicalStudioHref(locale = "id") {
  return (
    (locale === "en" ? "/en" : "") +
    (import.meta.env?.CANONICAL_FINAL_STUDIO
      ? "/studio/?lang="
      : "/studio/?candidate=canonical&lang=") +
    (locale === "en" ? "en" : "id")
  );
}
