import { allMix } from "./composition-model.js";
import { arrangementEvents, trackGain } from "../audio/sequencing.js";
import { fail } from "./instrument-contract.js";

export function legacyAudible(p) {
  if (p.master.volume === 0) return false;
  const tracks = allMix(p),
    gain = (role) =>
      trackGain(
        tracks.find((t) => t.role === role),
        tracks,
      );
  return (
    arrangementEvents(p).some((e) => e.velocity * gain(e.role) > 0) ||
    p.clips.some((c) => c.enabled && gain("clip-" + c.role) > 0) ||
    (gain("bilah") > 0 &&
      p.patterns.some((a) => p.chain.includes(a.id) && a.notes.some(Boolean)))
  );
}
export function instrumentGroups(project, registry) {
  const groups = new Map();
  for (const e of project.events) {
    const version = project.banks.find((b) => b.id === e.bankId).version,
      instrumentId = registry.sample(
        e.bankId,
        version,
        e.sampleId,
      ).instrumentId,
      id = e.bankId + "/" + instrumentId;
    if (!groups.has(id))
      groups.set(id, {
        bankId: e.bankId,
        instrumentId,
        volume: 1,
        pan: 0,
        mute: false,
        solo: false,
      });
  }
  for (const m of project.instrumentMix ?? [])
    groups.set(m.bankId + "/" + m.instrumentId, m);
  return [...groups.values()];
}
export function groupMix(project, registry, bankId, instrumentId) {
  const groups = instrumentGroups(project, registry),
    group = groups.find(
      (g) => g.bankId === bankId && g.instrumentId === instrumentId,
    );
  return {
    volume: !group
      ? 1
      : group.mute || (groups.some((g) => g.solo) && !group.solo)
        ? 0
        : group.volume,
    pan: group?.pan ?? 0,
  };
}
export function assertTuningConsent(project, registry) {
  const p = project.composition,
    tracks = allMix(p),
    audible = (r) =>
      trackGain(
        tracks.find((t) => t.role === r),
        tracks,
      ) > 0;
  const pitchedLegacy =
    p.master.volume > 0 &&
    ((audible("bilah") &&
      p.patterns.some(
        (a) => p.chain.includes(a.id) && a.notes.some(Boolean),
      )) ||
      p.clips.some(
        (c) =>
          c.enabled &&
          ["hum", "vocal-bass"].includes(c.role) &&
          audible("clip-" + c.role),
      ));
  const pitchedEvents = project.events.some((e) => {
    if (e.action !== "strike") return false;
    const version = project.banks.find((b) => b.id === e.bankId).version,
      bank = registry.bank(e.bankId, version),
      sample = registry.sample(e.bankId, version, e.sampleId);
    return (
      ["pelog", "slendro"].includes(bank.laras) &&
      groupMix(project, registry, e.bankId, sample.instrumentId).volume > 0
    );
  });
  if (pitchedLegacy && pitchedEvents && project.tuningConsent !== true)
    fail("tuningConsentRequired");
}
