import { INSTRUMENT_BASE_GAIN } from "../audio/instrument-levels.js";
// Import only the selected descriptor. Asset URLs do not fetch or decode audio.
const extras = {
  kethuk: () => import("../pads/instruments/kethuk.js"),
  kempyang: () => import("../pads/instruments/kempyang.js"),
  kenong: () => import("../pads/instruments/kenong.js"),
  "bonang-panerus": () => import("../pads/instruments/bonang-panerus.js"),
  peking: () => import("../pads/instruments/peking.js"),
  "saron-barung": () => import("../pads/instruments/saron-barung.js"),
  "bonang-barung": () => import("../pads/instruments/bonang-barung.js"),
  demung: () => import("../pads/instruments/demung.js"),
  kempul: () => import("../pads/instruments/kempul.js"),
  "gong-ageng": () => import("../pads/instruments/gong-ageng.js"),
  slenthem: () => import("../pads/instruments/slenthem.js"),
};
const names = {
  "bonang-panerus": "bonangPanerus",
  "bonang-barung": "bonangBarung",
  "saron-barung": "saronBarung",
  "gong-ageng": "gong",
};
export async function loadInstrumentBank(slug, key) {
  if (slug === "drum" || slug === "bilah") {
    const m = await import("../studio/pack.js");
    return {
      pack: slug === "drum" ? m.studioPack(1) : m.instrumentPack(),
      level: INSTRUMENT_BASE_GAIN[slug],
      notices: {},
    };
  }
  if (slug === "bass-elektrik") {
    const m = await import("../studio/bass-pack.js");
    return {
      pack: m.bassPack(),
      level: INSTRUMENT_BASE_GAIN.bass,
      notices: m.bassNotices,
    };
  }
  if (slug === "gitar-nylon") {
    const m = await import("../studio/guitar-pack.js");
    return {
      pack: m.guitarPack(),
      level: INSTRUMENT_BASE_GAIN.guitar,
      notices: m.guitarNotices,
    };
  }
  if (slug === "kendhang-ciblon") {
    const m = await import("../studio/kendhang-pack.js");
    return {
      pack: m.kendhangPack(),
      level: INSTRUMENT_BASE_GAIN.kendhang,
      notices: m.kendhangNotices,
    };
  }
  if (!extras[slug]) throw new Error("Unknown instrument");
  const m = await extras[slug](),
    name = names[slug] || slug;
  const scale = key.endsWith("-pelog")
    ? "Pelog"
    : key.endsWith("-slendro")
      ? "Slendro"
      : "";
  const pack = m[name + scale + "Pack"];
  const level = m[name + scale + "Level"] ?? m[name + "Level"];
  if (!pack || !Number.isFinite(level))
    throw new Error("Unknown instrument bank");
  return { pack, level, notices: m[name + "Notices"] };
}
