import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { previewOutputPath } from "./gamelan-preview-assets.mjs";
export function candidateOutput(root, outDir) {
  const path = previewOutputPath(root, outDir);
  if (existsSync(path))
    throw Error(
      "Candidate output already exists; use a fresh QA directory to preserve review evidence",
    );
  return path;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const outDir = process.argv[2] || "qa-artifacts/gamelan-production-candidate";
  process.env.PERKUSI_GAMELAN_DELIVERY = "flac";
  const { runLocalBuild } = await import("./local-build.mjs");
  const result = await runLocalBuild({ root, mode: "gamelan-preview", outDir });
  console.log(
    JSON.stringify({
      buildStatus: result.buildStatus,
      cleanup: result.cleanup,
      receipt: result.receiptPath,
    }),
  );
  process.exitCode = result.buildExit ?? 1;
}
