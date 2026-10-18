import {
  dataTree,
  record,
  integer,
  finite,
  fail,
} from "./instrument-contract.js";

// Q1 metadata/planning primitives only. No route, storage or schema dispatch
// uses these yet. Limits do not grant an audio allocation or voice admission.
export const ARRANGEMENT_LIMITS = Object.freeze({
  sections: 16,
  chainEntries: 8,
  repeats: 8,
  occurrences: 8,
  lengthTicks: 491520000,
  candidates: 1343488,
  scheduleBytes: 8 * 1024 * 1024,
  recordBytes: 64,
  headerBytes: 1024,
});
const invalid = "invalidArrangementContract";

export function planChainExpansion(sections, chain) {
  dataTree({ sections, chain }, invalid);
  if (
    !Array.isArray(sections) ||
    !integer(sections.length, 1, ARRANGEMENT_LIMITS.sections) ||
    !Array.isArray(chain) ||
    !integer(chain.length, 1, ARRANGEMENT_LIMITS.chainEntries)
  )
    fail(invalid);
  const defs = new Map(),
    ids = new Set();
  for (const section of sections) {
    record(section, ["id", "lengthTicks", "candidateCount"], invalid);
    if (
      typeof section.id !== "string" ||
      !section.id ||
      defs.has(section.id) ||
      !integer(section.lengthTicks, 1, ARRANGEMENT_LIMITS.lengthTicks) ||
      !integer(section.candidateCount, 0, ARRANGEMENT_LIMITS.candidates)
    )
      fail(invalid);
    defs.set(section.id, section);
  }
  let occurrences = 0,
    lengthTicks = 0,
    candidateCount = 0;
  for (const entry of chain) {
    record(entry, ["id", "sectionId", "repeats"], invalid);
    const section = defs.get(entry.sectionId);
    if (
      typeof entry.id !== "string" ||
      !entry.id ||
      ids.has(entry.id) ||
      !section ||
      !integer(entry.repeats, 1, ARRANGEMENT_LIMITS.repeats)
    )
      fail(invalid);
    ids.add(entry.id);
    occurrences += entry.repeats;
    lengthTicks += section.lengthTicks * entry.repeats;
    candidateCount += section.candidateCount * entry.repeats;
  }
  const scheduleBytes =
    ARRANGEMENT_LIMITS.headerBytes +
    (occurrences + candidateCount) * ARRANGEMENT_LIMITS.recordBytes;
  if (
    occurrences > ARRANGEMENT_LIMITS.occurrences ||
    lengthTicks > ARRANGEMENT_LIMITS.lengthTicks ||
    candidateCount > ARRANGEMENT_LIMITS.candidates ||
    scheduleBytes > ARRANGEMENT_LIMITS.scheduleBytes
  )
    fail("arrangementExpansionLimit");
  // No occurrence/event allocation before cumulative admission succeeds.
  const expanded = [];
  let startTick = 0;
  for (const entry of chain) {
    const section = defs.get(entry.sectionId);
    for (let repeatIndex = 0; repeatIndex < entry.repeats; repeatIndex++) {
      expanded.push(
        Object.freeze({
          entryId: entry.id,
          sectionId: entry.sectionId,
          repeatIndex,
          startTick,
          lengthTicks: section.lengthTicks,
        }),
      );
      startTick += section.lengthTicks;
    }
  }
  return Object.freeze({
    occurrences: Object.freeze(expanded),
    lengthTicks,
    candidateCount,
    scheduleBytes,
  });
}

const identityKeys = ["packId", "packVersion", "processing", "role", "variant"];
function control(value) {
  record(
    value,
    ["identity", "enabled", "gate", "volume", "pan", "phasePolicy"],
    invalid,
  );
  record(value.identity, identityKeys, invalid);
  if (
    identityKeys
      .slice(0, 4)
      .some(
        (k) => typeof value.identity[k] !== "string" || !value.identity[k],
      ) ||
    ![1, 2].includes(value.identity.variant) ||
    typeof value.enabled !== "boolean" ||
    typeof value.gate !== "boolean" ||
    !finite(value.volume, 0, 1) ||
    !finite(value.pan, -1, 1) ||
    !["continue-source", "restart-on-entry"].includes(value.phasePolicy)
  )
    fail(invalid);
}

// gate is the owning group's already-computed mute/solo result. Mixer changes
// can gate/rejoin a reader, but never accidentally select a different anchor.
export function phraseTransition(previous, next, options) {
  dataTree({ previous, next, options }, invalid);
  record(options, ["phaseFrame", "elapsedFrames", "periodFrames"], invalid);
  const { phaseFrame, elapsedFrames, periodFrames } = options;
  if (previous !== null) control(previous);
  control(next);
  if (
    !integer(periodFrames, 1, 192000 * 32) ||
    !(
      integer(phaseFrame, 0, periodFrames - 1) ||
      (phaseFrame === null && !previous?.enabled)
    ) ||
    !integer(elapsedFrames, 0, Number.MAX_SAFE_INTEGER)
  )
    fail(invalid);
  if (!next.enabled)
    return Object.freeze({
      action: previous?.enabled ? "exit" : "silent",
      phaseFrame: null,
      audible: false,
    });
  const sameSource =
    previous?.enabled &&
    identityKeys.every((k) => previous.identity[k] === next.identity[k]);
  const continuing = sameSource && next.phasePolicy === "continue-source";
  return Object.freeze({
    action: continuing ? "continue" : "restart",
    phaseFrame: continuing
      ? (phaseFrame + (elapsedFrames % periodFrames)) % periodFrames
      : 0,
    audible: next.gate && next.volume > 0,
  });
}

// A source may occur in many placements and window recurrences. Never count
// only unique buffers/definitions when reserving a flattened scheduling window.
export function placementCandidateCount(placements, counts) {
  dataTree({ placements, counts }, invalid);
  if (
    !Array.isArray(placements) ||
    placements.length > 256 ||
    !counts ||
    typeof counts !== "object" ||
    Array.isArray(counts)
  )
    fail(invalid);
  let total = 0;
  for (const p of placements) {
    record(p, ["sourceId", "recurrences"], invalid);
    if (!Object.hasOwn(counts, p.sourceId)) fail(invalid);
    const count = counts[p.sourceId];
    if (
      !integer(count, 0, ARRANGEMENT_LIMITS.candidates) ||
      !integer(p.recurrences, 1, ARRANGEMENT_LIMITS.candidates)
    )
      fail(invalid);
    total += count * p.recurrences;
    if (!Number.isSafeInteger(total) || total > ARRANGEMENT_LIMITS.candidates)
      fail("arrangementExpansionLimit");
  }
  return total;
}
