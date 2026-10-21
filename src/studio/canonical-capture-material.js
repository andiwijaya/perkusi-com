import { newRecordingProject } from "../loop-station/model.js";
import { freezeCaptureProject } from "../loop-station/master-capture-clock.js";
import { overdubBase } from "../loop-station/overdub.js";
import { deriveCanonicalBundle } from "../project/canonical-package.js";
import {
  combineCanonicalMaterial,
  canonicalMaterialTracks,
} from "../project/canonical-hub.js";
import { fail } from "../project/instrument-contract.js";

export function canonicalCaptureProject(
  project,
  registry,
  { trackId = null, rate = 48000 } = {},
) {
  const p = structuredClone(newRecordingProject(registry));
  p.title = project.title;
  p.timing.bpm = project.timing.bpm;
  p.clock =
    project.timing.clock.kind === "fixed-bar"
      ? structuredClone(project.timing.clock)
      : { kind: "musical" };
  if (trackId !== null) {
    const bus = project.tracks.find((t) => t.id === trackId),
      section = project.sections.find((s) => s.id === project.activeSection),
      all = project.sections.flatMap((s) =>
        s.placements.filter((a) => a.trackId === trackId),
      ),
      a = all[0],
      asset = project.assets.find((r) => r.id === a?.sourceRef.id);
    if (
      !bus ||
      bus.layering ||
      all.length !== 1 ||
      !section.placements.includes(a) ||
      a.sourceRef.kind !== "asset" ||
      !asset ||
      a.startTick !== 0 ||
      a.offsetFrames !== 0 ||
      !a.loop
    )
      fail("overdubBaseRequired");
    const ref = structuredClone(asset);
    delete ref.creditsRef;
    p.assetRefs = [ref];
    p.master = {
      volume: project.master.volume,
      limiter: structuredClone(project.master.limiter),
    };
    Object.assign(p.tracks[0], {
      kind: "recording",
      gain: bus.mix.volume,
      pan: bus.mix.pan,
      mute: bus.mix.mute,
      solo: bus.mix.solo,
      eq: structuredClone(bus.fx.eq),
      clips: [
        {
          id: "base-clip",
          sourceId: asset.id,
          startTick: 0,
          lengthTicks: a.lengthTicks,
          offsetFrames: 0,
          loop: true,
          ...(a.alignment
            ? { phaseAlignment: structuredClone(a.alignment) }
            : {}),
        },
      ],
    });
    overdubBase(p, p.tracks[0].id);
  }
  return freezeCaptureProject(p, registry, rate);
}

// Replaces only the selected base bus. Raw base/overdub blobs, the previous
// canonical package and every source archive stay retained by normal bundles.
export async function replaceCanonicalOverdub(
  base,
  incoming,
  trackId,
  { registry, memory, signal } = {},
) {
  canonicalCaptureProject(base.project, registry, {
    trackId,
    rate: base.project.timing.clock.sampleRate,
  });
  const ids = canonicalMaterialTracks(incoming.project);
  if (ids.length !== 1) fail("overdubBaseRequired");
  const layer = incoming.project.tracks.find((t) => t.id === ids[0]);
  if (!layer.layering) fail("overdubBaseRequired");
  const current = base.project.tracks.find((t) => t.id === trackId),
    oldPlacements = base.project.sections.flatMap((s) =>
      s.placements.filter((p) => p.trackId === trackId),
    ),
    removed = new Set([trackId, ...oldPlacements.map((p) => p.id)]),
    working = structuredClone(base.project);
  working.tracks = working.tracks.filter((t) => t.id !== trackId);
  for (const s of working.sections)
    s.placements = s.placements.filter((p) => p.trackId !== trackId);
  working.compatibility.fieldPresence =
    working.compatibility.fieldPresence.filter(
      (p) => !removed.has(p.split("/")[0]),
    );
  working.compatibility.idMap = working.compatibility.idMap.filter(
    (p) => !removed.has(p.newId),
  );
  let stripped, combined;
  try {
    stripped = await deriveCanonicalBundle(working, base, { registry });
    combined = await combineCanonicalMaterial(stripped, incoming, {
      registry,
      memory,
      signal,
    });
    const p = structuredClone(combined.project),
      added = p.tracks.find((t) => !working.tracks.some((x) => x.id === t.id)),
      newId = added.id;
    added.id = trackId;
    added.name = current.name;
    added.mix = structuredClone(current.mix);
    added.fx = structuredClone(current.fx);
    for (const s of p.sections)
      for (const a of s.placements)
        if (a.trackId === newId) a.trackId = trackId;
    p.compatibility.fieldPresence = p.compatibility.fieldPresence
      .map((v) =>
        v.startsWith(newId + "/") ? trackId + v.slice(newId.length) : v,
      )
      .sort();
    for (const m of p.compatibility.idMap)
      if (m.newId === newId) m.newId = trackId;
    return await deriveCanonicalBundle(p, combined, { registry });
  } finally {
    combined?.dispose();
    stripped?.dispose();
  }
}
