import { wavSnapshotKey } from "./wav-snapshot.js";

export function studioPlaybackKey(project, arrangement) {
  const score = {
    ...project,
    title: undefined,
    playback: undefined,
    patterns: project.patterns.map((pattern) => ({
      ...pattern,
      name: undefined,
    })),
  };
  return JSON.stringify([
    wavSnapshotKey(score),
    arrangement ? "chain" : project.activePattern,
  ]);
}

// Playback level is part of a saved session, but only for the score it belongs
// to. Unplayed edits must not inherit a gain measured for another arrangement.
export function studioProjectSnapshot(project, arrangement, playback) {
  const next = structuredClone(project);
  next.playback = { mode: arrangement ? "chain" : "pattern" };
  if (
    playback?.arrangement === arrangement &&
    playback.key === studioPlaybackKey(next, arrangement)
  )
    next.playback.programmeGain = playback.gain;
  return next;
}
