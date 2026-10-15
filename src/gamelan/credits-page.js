import "./focus-workspace.css";
import credits from "../../internal/gamelan-delivery/credits.json" with { type: "json" };
import flags from "../../internal/gamelan-delivery/quality-flags.json" with { type: "json" };
import { resolveLocale } from "../i18n/locale.js";
import { gamelanPreviewPaths } from "./preview-paths.js";
import { creditsCopy } from "./credits-copy.js";
import {
  gamelanHostAllowed,
  syncGamelanPublicMetadata,
} from "./public-context.js";
if (
  !gamelanHostAllowed(location.hostname, import.meta.env.GAMELAN_PUBLIC_BUILD)
)
  throw Error("Local candidate only");
const locale = resolveLocale({
    pathname: location.pathname,
    explicitLocale: new URL(location.href).searchParams.get("lang"),
  }),
  en = locale === "en",
  t = creditsCopy[locale],
  flac = import.meta.env.GAMELAN_DELIVERY === "flac",
  host = document.getElementById("credits");
document.documentElement.lang = locale;
host.tabIndex = -1;
const skip = document.createElement("a");
skip.className = "skip-link";
skip.href = "#credits";
skip.textContent = t.skip;
host.before(skip);
document.title = en
  ? "Perkusi — Gamelan candidate credits"
  : "Perkusi — Kredit kandidat gamelan";
if (import.meta.env.GAMELAN_PUBLIC_BUILD)
  syncGamelanPublicMetadata(locale, { credits: true });
function line(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  host.append(node);
  return node;
}
function link(text, url, parent = host) {
  const a = document.createElement("a");
  a.textContent = text;
  a.href = url;
  parent.append(a);
  return a;
}
line("h1", t.title);
link(
  t.back,
  gamelanPreviewPaths(location.pathname, locale, {
    studio: new URL(location.href).searchParams.get("back") === "studio",
  }).play,
);
line("p", t.people);
line("p", t.rights);
line("p", t.changes);
if (flac) line("p", t.flacChanges);
line("p", t.pending);
line("p", t.originalRecords);
for (const [title, path] of [
  ["CC BY 3.0", "LICENSE_CC_BY_3.0.txt"],
  ["Artistic 2.0", "LICENSE_ARTISTIC_2.0.txt"],
  [t.notice, "NOTICE.txt"],
  [t.credits, "credits.json"],
  [t.pcmManifest, "asset-map.json"],
  [t.quality, "quality-flags.json"],
  [t.recipe, "derive-reference.py"],
]) {
  const p = line("p", "");
  link(title, "/internal/gamelan-delivery/" + path, p);
}
if (flac)
  for (const [label, path] of [
    [t.flacManifest, "asset-map.json"],
    [t.flacNotice, "NOTICE.txt"],
    [t.flacRecipe, "encode-reference.py"],
  ])
    link(label, "/internal/gamelan-flac/" + path, line("p", ""));
link(t.library, credits.sourceLibrary);
line("p", "");
link(t.pinned, credits.librarySourceURL);
link(
  t.sourceForms,
  "/source-forms/cdm-porto-" + credits.version + "/" + (en ? "en/" : ""),
  line("p", ""),
);
line("h2", t.flags);
for (const flag of flags) line("p", JSON.stringify(flag));
line("h2", t.recordings);
for (const row of credits.rows) {
  const article = document.createElement("article");
  article.className = "readiness-panel";
  host.append(article);
  const p = document.createElement("p");
  p.textContent = row.title + " — " + row.creator + " — " + row.license;
  article.append(p);
  link(t.source + " / " + row.sampleId, row.sourcePage, article);
  article.append(document.createTextNode(" · "));
  link(row.license, row.licenseURL, article);
  const hashes = document.createElement("p");
  hashes.textContent = t.sourceHash + ": " + row.sourceIdentity.SHA256;
  article.append(hashes);
}
