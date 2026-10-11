// Public GA4 configuration for the Perkusi.com Web stream.
export const measurementId = "G-G9ETDLX4XP";

const events = new Set([
  "playground_open",
  "audio_started",
  "first_layer_enabled",
  "three_layers_reached",
  "language_changed",
  "audio_error",
  "project_saved",
  "export_succeeded",
  "export_failed",
]);
const exportFailureCategories = new Set([
  "empty_mix",
  "memory",
  "asset",
  "output",
  "busy",
  "render",
  "other",
]);
export function exportFailureCategory(code) {
  return (
    {
      emptyMix: "empty_mix",
      exportLimit: "memory",
      assetFailed: "asset",
      unsafeOutput: "output",
      exportBusy: "busy",
      exportFailed: "render",
    }[code] || "other"
  );
}
// Narrow payload contract: no arbitrary parameters, patterns, assets or identifiers.
export function createEventTracker(enabled, send) {
  return (name, locale) => {
    if (!enabled || !events.has(name)) return;
    try {
      send(
        "event",
        name,
        name === "language_changed" && ["id", "en"].includes(locale)
          ? { language: locale }
          : name === "export_failed"
            ? {
                category: exportFailureCategories.has(locale)
                  ? locale
                  : "other",
              }
            : {},
      );
    } catch {
      /* Analytics must never own application control flow. */
    }
  };
}
let sendEvent = () => {};
export const trackEvent = (name, locale) => sendEvent(name, locale);

export function initAnalytics() {
  if (
    !import.meta.env.PROD ||
    !["perkusi.com", "www.perkusi.com"].includes(location.hostname) ||
    !measurementId
  )
    return;
  try {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      window.dataLayer.push(arguments);
    };
    window.gtag("js", new Date());
    window.gtag("config", measurementId, {
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    document.head.append(script);
    sendEvent = createEventTracker(true, (...args) => window.gtag(...args));
  } catch {
    sendEvent = () => {};
  }
}
