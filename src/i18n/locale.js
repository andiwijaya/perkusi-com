export const localeKey = "perkusi.locale";
export const supportedLocales = ["id", "en"];
export function isLocale(value) {
  return supportedLocales.includes(value);
}
export function resolveLocale({
  pathname = "/",
  explicitLocale,
  storedLocale,
} = {}) {
  if (isLocale(explicitLocale)) return explicitLocale;
  if (pathname === "/en" || pathname.startsWith("/en/")) return "en";
  return isLocale(storedLocale) ? storedLocale : "id";
}
export function readLocale(storage) {
  try {
    const value = storage.getItem(localeKey);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}
export function saveLocale(storage, locale) {
  try {
    if (isLocale(locale)) storage.setItem(localeKey, locale);
  } catch {
    /* Language still works when storage is unavailable. */
  }
}
export function createTranslator(catalog, locale, reportMissing = () => {}) {
  return (key) => {
    if (catalog[locale]?.[key] !== undefined) return catalog[locale][key];
    reportMissing(key, locale);
    if (catalog.id[key] !== undefined) return catalog.id[key];
    throw new Error("Unknown translation key: " + key);
  };
}
