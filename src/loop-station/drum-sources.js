import catalog from "../../internal/studio-kits/manifest.json" with { type: "json" };
import { validateStudioCatalog } from "../audio/studio-catalog.js";
import { fail, frozenCopy } from "../project/instrument-contract.js";

// Existing original synthetic Studio one-shots; no new recording or transforms.
validateStudioCatalog(catalog);
export const DRUM_KEYS = Object.freeze([
  "A",
  "S",
  "D",
  "F",
  "G",
  "H",
  "J",
  "K",
]);
export const DRUM_VOICES = 4;
export const drumBanks = frozenCopy(
  catalog.kits.map((kit) => ({
    id: "studio-" + kit.id,
    version: catalog.version,
    kind: "instrument-bank",
    setId: "studio-original-synthesis",
    tradition: "original-synthesis",
    laras: "none",
    samples: kit.assets.map((a) => ({
      id: kit.id + "-" + a.id,
      instrumentId: "drum-" + kit.id,
      pitchId: a.id,
      articulation: "one-shot",
      assetPath: "/internal/studio-kits/" + a.assetPath,
      sha256: a.sha256,
      sourceWorkId: "studio-" + kit.id + "-" + a.id,
      licenseId: "cc0-1-0",
      encodedBytes: a.bytes,
      sampleRate: a.sampleRate,
      channels: a.channels,
      frames: a.frames,
      gainTrim: a.gainTrim,
      voicePolicy: a.id === "closed-hat" ? "choke" : "polyphonic",
    })),
  })),
);
export function drumBank(instrumentId) {
  return drumBanks.find((b) => b.samples[0].instrumentId === instrumentId);
}
export function isDrumAssignment(bankId, bankVersion, sampleIds, descriptors) {
  const b = drumBanks.find((b) => b.id === bankId && b.version === bankVersion);
  if (!b) return false;
  if (
    JSON.stringify(sampleIds) !== JSON.stringify(b.samples.map((s) => s.id)) ||
    JSON.stringify(descriptors) !== JSON.stringify(b.samples)
  )
    fail("invalidCaptureSource");
  return true;
}
export function drumAttribution(assignment) {
  const bank = drumBanks.find((b) => b.id === assignment.bankId);
  if (!bank) fail("invalidCaptureSource");
  return (
    "Perkusi.com original synthetic Studio drums; CC0-1.0 https://creativecommons.org/publicdomain/zero/1.0/\n" +
    "Creator: Perkusi.com original code synthesis. Source: internal/studio-kits/manifest.json; recipe scripts/make-studio-kits.py; created 2026-10-11.\n" +
    "Transforms: native48k mono one-shots, Studio gain trims and attack/tail fades, explicit hi-hat choke; duplicated to stereo capture bus. Input timing and arrangement are user performance changes.\n" +
    JSON.stringify({
      kit: bank.id,
      sources: catalog.kits.find((k) => "studio-" + k.id === bank.id).assets,
    })
  );
}
