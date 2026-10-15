import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import {
  physicalFocus,
  CORPUS_INSTRUMENTS,
} from "../src/gamelan/instrument-focus.js";
export const FLAC_DELIVERY_BUDGET = Object.freeze({
  maxSingleFile: 8 * 1024 * 1024,
  maxSingleProfile: 128 * 1024 * 1024,
  maxCompleteCorpus: 256 * 1024 * 1024,
  maxPhysicalFocus: 19 * 1024 * 1024,
  maxDecodedFocus: 52 * 1024 * 1024,
  maxDefaultFocus: 8 * 1024 * 1024,
  unchangedApplicationAdmission: 64 * 1024 * 1024,
});
export function flacDeliveryBudget(manifest, catalogs) {
  const b = FLAC_DELIVERY_BUDGET,
    files = manifest.files;
  if (
    !Array.isArray(files) ||
    files.length !== 202 ||
    files.some(
      (r) =>
        !Number.isSafeInteger(r.bytes) ||
        r.bytes < 1 ||
        r.bytes > b.maxSingleFile,
    ) ||
    files.reduce((s, r) => s + r.bytes, 0) > b.maxCompleteCorpus
  )
    throw Error("Lossless delivery file/corpus budget exceeded");
  const byPath = new Map(files.map((r) => [r.assetPath, r]));
  if (byPath.size !== 202) throw Error("Duplicate lossless delivery path");
  const rows = [];
  for (const rate of [44100, 48000]) {
    if (
      files.filter((r) => r.rate === rate).length !== 101 ||
      files.filter((r) => r.rate === rate).reduce((s, r) => s + r.bytes, 0) >
        b.maxSingleProfile
    )
      throw Error("Lossless profile budget exceeded");
    const registry = new InstrumentRegistry(catalogs[rate].banks);
    for (const laras of ["pelog", "slendro"])
      for (const instrument of CORPUS_INSTRUMENTS) {
        const notes = physicalFocus(registry, instrument, laras);
        const encodedBytes = notes.reduce(
          (s, n) => s + byPath.get(n.descriptor.assetPath).bytes,
          0,
        );
        const decodedBytes = notes.reduce(
          (s, n) => s + n.descriptor.frames * n.descriptor.channels * 4,
          0,
        );
        if (
          encodedBytes > b.maxPhysicalFocus ||
          decodedBytes > b.maxDecodedFocus ||
          (instrument === "saron-barung" &&
            laras === "pelog" &&
            encodedBytes > b.maxDefaultFocus)
        )
          throw Error("Lossless focus budget exceeded");
        rows.push({
          rate,
          laras,
          instrument,
          notes: notes.length,
          encodedBytes,
          decodedBytes,
        });
      }
  }
  return {
    kind: "bounded-flac-delivery-candidate",
    budgets: b,
    physicalFocusRows: rows,
    networkAcceptance: {
      coldUIBytes: 1024 * 1024,
      defaultFocusReadySeconds: 20,
      maxPhysicalFocusReadySeconds: 45,
      simulatedGlobalMbps: 4,
      simulatedHeaderDelayMs: 150,
      qualification:
        "Native measured laptop acceptance; not physical/mobile/CDN/Safari guarantees.",
    },
    qualification:
      "Encoded transfer budgets only. Decoded buffers/tails unchanged; existing64MiB admission remains mandatory. No file/sample removal or runtime budget increase.",
  };
}
