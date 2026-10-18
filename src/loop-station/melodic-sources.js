import c44 from "../../internal/loop-instruments/registry-44100.json" with { type: "json" };
import c48 from "../../internal/loop-instruments/registry-48000.json" with { type: "json" };
import provenance from "../../internal/loop-instruments/manifest.json" with { type: "json" };
import { fail, frozenCopy } from "../project/instrument-contract.js";
export const melodicBanks = (rate = 48000) =>
  rate === 44100 ? c44.banks : rate === 48000 ? c48.banks : [];
export function melodicBank(instrumentId, rate = 48000) {
  return melodicBanks(rate).find(
    (b) => b.samples[0].instrumentId === instrumentId,
  );
}
export const melodicPolicy = (instrumentId) =>
  instrumentId === "electric-bass"
    ? { voices: 2, release: 0.3, liveLevel: 1 }
    : instrumentId === "classical-guitar"
      ? { voices: 3, release: 1.5, liveLevel: 0.5 }
      : null;
export function isMelodicAssignment(bankId, version, sampleIds, descriptors) {
  const bank = melodicBanks(descriptors[0]?.sampleRate).find(
    (b) => b.id === bankId && b.version === version,
  );
  if (!bank) return false;
  if (
    JSON.stringify(sampleIds) !==
      JSON.stringify(bank.samples.map((s) => s.id)) ||
    JSON.stringify(descriptors) !== JSON.stringify(bank.samples)
  )
    fail("invalidCaptureSource");
  return true;
}
export function melodicAttribution(events) {
  const refs = new Map();
  for (const e of events) {
    if (e.action !== "strike" || !e.bankId?.startsWith("freepats-")) continue;
    const row = provenance.assets.find((r) => r.sampleId === e.sampleId);
    if (!row) fail("recordingCreditsRequired");
    refs.set(row.sampleId, row);
  }
  if (!refs.size) return "";
  return [
    "Recorded bass / classical guitar: FreePats; CC0-1.0 https://creativecommons.org/publicdomain/zero/1.0/ ; no endorsement.",
    "Native note recordings; no pitch shifting or loop stretching. Full mono source duration; uniform gain0.8, Float32 WAV and separate44.1/48k native decode/resampling. Event timing, damping and mixer are arrangement changes. Listening validation pending.",
    ...[...refs.values()].map(
      (r) =>
        `${r.sampleId} | ${r.creator} | ${r.sourcePage} | publisher ${r.publisherVersion} | original SHA256 ${r.originalSHA256}`,
    ),
  ].join("\n");
}
export function melodicAssignmentAttribution(assignment) {
  const bank = melodicBanks().find(
    (b) => b.id === assignment.bankId && b.version === assignment.bankVersion,
  );
  if (
    !bank ||
    JSON.stringify(assignment.sampleIds) !==
      JSON.stringify(bank.samples.map((s) => s.id))
  )
    fail("invalidCaptureSource");
  return melodicAttribution(
    assignment.sampleIds.map((sampleId) => ({
      action: "strike",
      bankId: bank.id,
      sampleId,
    })),
  );
}
export const melodicManifest = frozenCopy(provenance);
