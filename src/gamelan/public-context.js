const localHosts = ["127.0.0.1", "localhost", "[::1]"];
export function gamelanHostAllowed(host, publicBuild = false) {
  return (
    localHosts.includes(host) ||
    (publicBuild === true && ["perkusi.com", "www.perkusi.com"].includes(host))
  );
}
export function gamelanBuildMode(mode) {
  return mode === "gamelan-preview" || mode === "gamelan-public-candidate";
}
export function gamelanPublicMetadata(
  locale,
  { studio = false, credits = false } = {},
) {
  const en = locale === "en",
    base = en ? "/en" : "";
  const suffix = studio
    ? "/studio/?workspace=gamelan"
    : "/gamelan/" + (credits ? "credits/" : "");
  const heading = credits
    ? en
      ? "Credits, sources & licenses"
      : "Kredit, sumber & lisensi"
    : studio
      ? "Studio Gamelan — Preview"
      : "Gamelan Preview";
  return {
    heading,
    title: "Perkusi — " + heading,
    description: en
      ? "Play separate Pelog and Slendro banks and save browser projects. Culture, listening and physical-device validation remain pending."
      : "Mainkan bank Pelog dan Slendro terpisah serta simpan proyek di browser. Validasi budaya, listening dan perangkat fisik masih tertunda.",
    canonical: "https://perkusi.com" + base + suffix,
    alternates: {
      id: "https://perkusi.com" + suffix,
      en: "https://perkusi.com/en" + suffix,
      "x-default": "https://perkusi.com" + suffix,
    },
  };
}
export function syncGamelanPublicMetadata(locale, options) {
  const meta = gamelanPublicMetadata(locale, options);
  document.title = meta.title;
  const set = (tag, attribute, value, attributes) => {
    let node = document.head.querySelector(
      tag + "[" + attribute + '="' + value + '"]',
    );
    if (!node) {
      node = document.createElement(tag);
      node.setAttribute(attribute, value);
      document.head.append(node);
    }
    for (const [key, text] of Object.entries(attributes))
      node.setAttribute(key, text);
  };
  set("link", "rel", "canonical", { href: meta.canonical });
  for (const [lang, href] of Object.entries(meta.alternates))
    set("link", "hreflang", lang, { rel: "alternate", href });
  set("meta", "name", "description", { content: meta.description });
  set("meta", "property", "og:title", { content: meta.title });
  set("meta", "property", "og:url", { content: meta.canonical });
  return meta;
}
