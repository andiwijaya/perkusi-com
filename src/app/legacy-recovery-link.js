// Stable navigation only. No experimental storage, schema or audio imports.
export function legacyRecoveryHref(locale = "id") {
  const language = locale === "en" ? "en" : "id";
  return (
    (language === "en" ? "/en" : "") + "/studio/recovery/?lang=" + language
  );
}
export function originalRecoveryHref(locale = "id", handoff = null) {
  const language = locale === "en" ? "en" : "id";
  const base =
    (language === "en" ? "/en" : "") +
    "/studio/recovery/originals/?lang=" +
    language;
  return /^[a-f0-9-]{36}$/.test(handoff ?? "")
    ? base + "&handoff=" + encodeURIComponent(handoff)
    : base;
}
export function handoffRecoveryRedirect(href) {
  const url = new URL(href),
    id =
      url.searchParams.get("handoff") ??
      url.searchParams.get("canonicalOrigin");
  if (
    !/^\/(?:en\/)?studio(?:\/|\/index.html)?$/.test(url.pathname) ||
    !/^[a-f0-9-]{36}$/.test(id ?? "")
  )
    return null;
  const locale = url.searchParams.get("lang");
  return originalRecoveryHref(
    locale === "en" || (locale !== "id" && url.pathname.startsWith("/en/"))
      ? "en"
      : "id",
    id,
  );
}
