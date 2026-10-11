import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  characterDefinitions,
  characterSvg,
} from "../src/characters/characters.js";

const out = "internal/original-groove/characters";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
await mkdir(out, { recursive: true });
const source = "src/characters/characters.js";
const files = [];
for (const c of characterDefinitions) {
  const path = `${out}/${c.name.toLowerCase()}.svg`;
  const bytes = characterSvg(c.role) + "\n";
  await writeFile(path, bytes);
  files.push({
    ...c,
    body: undefined,
    accent: undefined,
    mouth: undefined,
    path,
    sha256: sha(bytes),
    author: "Perkusi.com project / Codex",
    createdAt: "2026-10-11",
    source,
    sourceSha256: sha(await readFile(source)),
    licenseId: "CC0-1.0",
    licensePath: "internal/original-groove/CHARACTERS-LICENSE.txt",
    commercialUse: true,
    rawRedistribution: true,
    sourceType: "original code-native SVG",
    thirdPartyInputs: [],
    states: ["idle", "active/perform", "selected", "focus", "loading", "error"],
    reducedMotion: "static equivalent",
    production: false,
  });
}
await writeFile(
  `${out}/provenance.json`,
  JSON.stringify({ characters: files }, null, 2) + "\n",
);
console.log(
  JSON.stringify({ result: "GENERATED", originalCharacters: files.length }),
);
