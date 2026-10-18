import { fileURLToPath } from "node:url";
import { runLocalBuild } from "./local-build.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const outDir = process.argv[2] || "qa-artifacts/gamelan-public-candidate";
const delivery = process.env.PERKUSI_GAMELAN_DELIVERY || "flac";
if (!["pcm", "flac"].includes(delivery))
  throw Error("Unsupported Gamelan delivery");
process.env.PERKUSI_GAMELAN_DELIVERY = delivery;
const result = await runLocalBuild({
  root,
  mode: "gamelan-public-candidate",
  outDir,
});
console.log(
  JSON.stringify({
    buildStatus: result.buildStatus,
    cleanup: result.cleanup,
    receipt: result.receiptPath,
  }),
);
process.exitCode = result.buildExit ?? 1;
