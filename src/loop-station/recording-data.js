import { validateLoopProject } from "./project.js";
import { PPQ } from "../project/instrument-project.js";
import { fail } from "../project/instrument-contract.js";

export const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
export const MAX_CREDIT_BYTES = 64 * 1024;
export function checkAbort(signal) {
  if (signal?.aborted) fail("cancelled");
}
export async function digest(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export function creditText(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    new TextEncoder().encode(value).length > MAX_CREDIT_BYTES
  )
    fail("recordingCreditsRequired");
  return value;
}
export function recordingProject(value, registry) {
  const p = validateLoopProject(value, registry);
  if (p.assetRefs.reduce((n, a) => n + a.bytes, 0) > MAX_AUDIO_BYTES)
    fail("recordingPackageTooLarge");
  if (
    p.assetRefs.length &&
    (p.clock?.kind !== "fixed-bar" ||
      ![44100, 48000].includes(p.clock.sampleRate))
  )
    fail("takeRateMismatch");
  for (const a of p.assetRefs)
    if (a.sampleRate !== p.clock.sampleRate) fail("takeRateMismatch");
  for (const t of p.tracks)
    for (const c of t.clips) {
      const a = p.assetRefs.find((a) => a.id === c.sourceId);
      if (
        a &&
        (c.offsetFrames !== 0 ||
          (c.loop &&
            a.frames !== (c.lengthTicks / (4 * PPQ)) * p.clock.framesPerBar))
      )
        fail("recordingOffsetUnsupported");
    }
  return p;
}
export async function validateRecording(ref, entry, { memory, signal } = {}) {
  checkAbort(signal);
  if (!(entry?.blob instanceof Blob) || entry.blob.size !== ref.bytes)
    fail("missingRecording");
  creditText(entry.provenance);
  const lease = memory?.reserve(ref.bytes * 2, "recording-validation-copy");
  try {
    const bytes = await entry.blob.arrayBuffer();
    checkAbort(signal);
    if ((await digest(bytes)) !== ref.sha256) fail("recordingHashMismatch");
    const data = new DataView(bytes);
    let peak = 0;
    for (let i = 0; i < ref.bytes; i += 4) {
      const v = data.getFloat32(i, true);
      if (!Number.isFinite(v)) fail("invalidRecordingPCM");
      peak = Math.max(peak, Math.abs(v));
    }
    checkAbort(signal);
    return { peak };
  } finally {
    lease?.release();
  }
}
export function adoptRecording(project, registry, trackId, take, sha256) {
  if (take.partial) fail("partialTakeNeedsReview");
  const next = structuredClone(project),
    track = next.tracks.find((t) => t.id === trackId);
  if (!track || track.clips.length) fail("recorderEmptyTarget");
  if (
    next.clock?.kind !== "fixed-bar" ||
    next.clock.sampleRate !== take.sampleRate ||
    take.frames % next.clock.framesPerBar
  )
    fail("overdubGeometryMismatch");
  const ids = new Set(
    [
      ...next.origins,
      ...(next.sources ?? []),
      ...next.assetRefs,
      ...next.tracks,
      ...next.tracks.flatMap((t) => t.clips),
    ].map((v) => v.id),
  );
  const unique = (prefix) => {
    let n = 1;
    while (ids.has(prefix + n)) n++;
    ids.add(prefix + n);
    return prefix + n;
  };
  const ref = {
    id: unique("recording-"),
    kind: "recording",
    sha256,
    bytes: take.validBytes,
    frames: take.frames,
    channels: take.channels,
    sampleRate: take.sampleRate,
    encoding: "float32le",
    recordedBpm: next.timing.bpm,
  };
  next.assetRefs.push(ref);
  track.kind = "recording";
  track.clips = [
    {
      id: unique("clip-"),
      sourceId: ref.id,
      startTick: 0,
      lengthTicks: (take.frames / next.clock.framesPerBar) * 4 * PPQ,
      offsetFrames: 0,
      loop: true,
    },
  ];
  return { project: recordingProject(next, registry), ref };
}
