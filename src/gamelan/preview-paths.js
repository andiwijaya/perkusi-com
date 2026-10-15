// Public-shaped entries remain opt-in/local-only; internal review routes stay usable.
export function gamelanPreviewPaths(pathname, locale, { studio = false } = {}) {
  const en = locale === "en";
  if (/^\/(?:en\/)?(?:gamelan|studio)(?:\/|$)/.test(pathname)) {
    const base = en ? "/en/gamelan/" : "/gamelan/";
    return {
      play: studio
        ? (en ? "/en" : "") +
          "/studio/?workspace=gamelan&lang=" +
          (en ? "en" : "id")
        : base,
      credits: base + "credits/" + (studio ? "?back=studio" : ""),
    };
  }
  return {
    play: "/internal/instrument-focus/?lang=" + (en ? "en" : "id"),
    credits:
      "/internal/instrument-focus/credits.html?lang=" + (en ? "en" : "id"),
  };
}
