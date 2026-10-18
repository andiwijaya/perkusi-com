import { validateLoopProject } from "./project.js";
import { adoptRecording, MAX_AUDIO_BYTES } from "./recording-data.js";
import { PPQ } from "../project/instrument-project.js";
import { fail, frozenCopy } from "../project/instrument-contract.js";

// Explicit two-layer capability. Generic occupied tracks are never reinterpreted
// as a recording base; the empty-target adoption API remains unchanged.
export function overdubBase(project, trackId) {
  const t = project.tracks.find((t) => t.id === trackId),
    c = t?.clips[0],
    a = project.assetRefs.find((a) => a.id === c?.sourceId),
    clock = project.clock;
  if (
    !t ||
    t.kind !== "recording" ||
    t.layering ||
    t.clips.length !== 1 ||
    !a ||
    clock?.kind !== "fixed-bar" ||
    c.startTick !== 0 ||
    !c.loop ||
    c.offsetFrames !== 0 ||
    a.sampleRate !== clock.sampleRate ||
    a.frames !== (c.lengthTicks / (4 * PPQ)) * clock.framesPerBar ||
    ![1, 2, 4, 8].includes(a.frames / clock.framesPerBar)
  )
    fail("overdubBaseRequired");
  return frozenCopy({
    trackId,
    clipId: c.id,
    sourceId: a.id,
    sha256: a.sha256,
    frames: a.frames,
    channels: a.channels,
    sampleRate: a.sampleRate,
    bars: a.frames / clock.framesPerBar,
    lengthTicks: c.lengthTicks,
    ...(c.phaseAlignment ? { phaseAlignment: c.phaseAlignment } : {}),
  });
}
export function admitOverdubBytes(project, base) {
  if (
    project.assetRefs.reduce((sum, a) => sum + a.bytes, 0) +
      base.frames * base.channels * 4 >
    MAX_AUDIO_BYTES
  )
    fail("recordingPackageTooLarge");
}
export function adoptOverdub(
  project,
  registry,
  trackId,
  take,
  sha256,
  expectedBase,
) {
  const base = overdubBase(project, trackId);
  admitOverdubBytes(project, base);
  if (JSON.stringify(base) !== JSON.stringify(expectedBase))
    fail("captureProjectChanged");
  if (take.partial) fail("partialTakeNeedsReview");
  if (
    take.frames !== base.frames ||
    take.sampleRate !== base.sampleRate ||
    take.channels !== base.channels
  )
    fail("overdubGeometryMismatch");
  const empty = structuredClone(project),
    target = empty.tracks.find((t) => t.id === trackId),
    original = structuredClone(target.clips[0]);
  target.clips = [];
  const proposed = adoptRecording(empty, registry, trackId, take, sha256),
    next = structuredClone(proposed.project),
    layered = next.tracks.find((t) => t.id === trackId);
  // adoptRecording's unique allocator did not see the temporarily removed clip.
  const used = new Set(
    [
      ...project.tracks,
      ...project.origins,
      ...(project.sources ?? []),
      ...project.assetRefs,
      ...project.tracks.flatMap((t) => t.clips),
    ].map((v) => v.id),
  );
  let n = 1;
  while (used.has("clip-" + n)) n++;
  layered.clips[0].id = "clip-" + n;
  layered.layering = {
    version: 1,
    baseClipId: original.id,
    overdubClipId: layered.clips[0].id,
  };
  layered.clips.unshift(original);
  return { project: validateLoopProject(next, registry), ref: proposed.ref };
}
