import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { candidateOutput } from "./build-gamelan-candidate.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const outDir = candidateOutput(
  root,
  process.argv[2] || "qa-artifacts/gamelan-public-candidate",
);
const delivery = process.env.PERKUSI_GAMELAN_DELIVERY || "flac";
if (!["pcm", "flac"].includes(delivery))
  throw Error("Unsupported Gamelan delivery");
process.env.PERKUSI_GAMELAN_DELIVERY = delivery;
const { build } = await import("vite");
await build({
  root,
  mode: "gamelan-public-candidate",
  build: { outDir: resolve(outDir), emptyOutDir: false },
});
