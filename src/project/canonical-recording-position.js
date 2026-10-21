import { phaseAdvance } from "../loop-station/phase-alignment.js";
import { fail } from "./instrument-contract.js";
export function canonicalRecordingPlacement(project, id) {
  const section = project.sections.find((s) => s.id === project.activeSection),
    placement = section?.placements.find((a) => a.id === id),
    ref = project.assets.find((r) => r.id === placement?.sourceRef.id);
  if (!placement || placement.sourceRef.kind !== "asset" || !ref)
    fail("invalidPhaseAlignment");
  const clip = {
    id: placement.id,
    sourceId: ref.id,
    startTick: placement.startTick,
    lengthTicks: placement.lengthTicks,
    offsetFrames: placement.offsetFrames,
    loop: placement.loop,
    ...(placement.alignment ? { phaseAlignment: placement.alignment } : {}),
  };
  return { placement, ref, clip, clock: project.timing.clock };
}
export function canonicalRecordingPhase(
  project,
  id,
  advanceFrames,
  expectedHash,
) {
  const next = structuredClone(project),
    { placement, ref, clip, clock } = canonicalRecordingPlacement(next, id);
  if (expectedHash !== undefined && ref.sha256 !== expectedHash)
    fail("draftConflict");
  clip.phaseAlignment = {
    version: 1,
    mode: "circular-period",
    sourceSHA256: ref.sha256,
    advanceFrames,
  };
  phaseAdvance(clip, ref, clock);
  placement.alignment = advanceFrames === 0 ? null : clip.phaseAlignment;
  return next;
}
