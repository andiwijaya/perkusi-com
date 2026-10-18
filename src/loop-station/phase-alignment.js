import { fail } from "../project/instrument-contract.js";
import { PPQ } from "../project/instrument-project.js";

// Positive frames advance late material, wrapping within this complete period.
// Original PCM/hash/window never change; outside-window material is not restored.
export function phaseAdvance(clip, ref, clock) {
  const p = clip.phaseAlignment;
  if (p === undefined) return 0;
  if (
    !p ||
    Object.keys(p).sort().join(",") !==
      "advanceFrames,mode,sourceSHA256,version" ||
    p.version !== 1 ||
    p.mode !== "circular-period" ||
    p.sourceSHA256 !== ref?.sha256 ||
    ref?.kind !== "recording" ||
    !clip.loop ||
    clip.offsetFrames !== 0 ||
    clock?.kind !== "fixed-bar" ||
    clock.sampleRate !== ref.sampleRate ||
    !Number.isSafeInteger(p.advanceFrames) ||
    Math.abs(p.advanceFrames) > Math.floor(ref.sampleRate * 0.25) ||
    Math.abs(p.advanceFrames) >= ref.frames ||
    ref.frames < 128 ||
    ![1, 2, 4, 8].includes(ref.frames / clock.framesPerBar) ||
    ref.frames !== (clip.lengthTicks / (4 * PPQ)) * clock.framesPerBar
  )
    fail("invalidPhaseAlignment");
  return p.advanceFrames;
}
export function alignRecordedClip(project, trackId, clipId, advanceFrames) {
  const next = structuredClone(project),
    track = next.tracks.find((t) => t.id === trackId),
    clip = track?.clips.find((c) => c.id === clipId),
    ref = next.assetRefs.find((a) => a.id === clip?.sourceId);
  if (!clip || !ref || !Number.isSafeInteger(advanceFrames))
    fail("invalidPhaseAlignment");
  clip.phaseAlignment = {
    version: 1,
    mode: "circular-period",
    sourceSHA256: ref.sha256,
    advanceFrames,
  };
  phaseAdvance(clip, ref, next.clock);
  if (advanceFrames === 0) delete clip.phaseAlignment;
  return next;
}
export const phaseIndex = (frame, advance, period) =>
  (((frame + advance) % period) + period) % period;
