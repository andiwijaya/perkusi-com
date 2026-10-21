import { newComposition } from "../project/composition-model.js";
import { migrateLegacyMetadata } from "../project/canonical-metadata.js";
import { fail } from "../project/instrument-contract.js";

// Transient audition score only. Never replaces/edits/saves the editor document.
export async function canonicalPadDocument(project, sourceId, role, registry) {
  const source = project.sourceDefs.find(
    (d) => d.id === sourceId && d.kind === "composition",
  );
  if (!source || !source.programme.percussion.some((t) => t.role === role))
    fail("invalidPattern");
  const g = source.programme,
    raw = newComposition("Pad " + role);
  raw.pack = structuredClone(g.pack);
  raw.timing = { ...raw.timing, bpm: project.timing.bpm };
  raw.tracks = structuredClone(g.percussion);
  raw.patterns[0].steps[role][0] = 1;
  const migrated = await migrateLegacyMetadata(JSON.stringify(raw), {
    registry,
  });
  const p = structuredClone(migrated.project);
  let masterSource = source;
  while (masterSource.master.binding === "parent") {
    masterSource = project.sourceDefs.find(
      (d) => d.id === masterSource.parentId,
    );
    if (!masterSource) fail("invalidCanonicalSource");
  }
  p.master.volume =
    masterSource.master.binding === "local"
      ? masterSource.master.volume
      : project.master.volume;
  p.master.limiter = structuredClone(project.master.limiter);
  const parentId = source.parentId ?? sourceId;
  const placement = project.sections
    .find((s) => s.id === project.activeSection)
    ?.placements.find((a) => a.sourceRef.id === parentId);
  const bus = project.tracks.find((t) => t.id === placement?.trackId);
  if (bus) {
    p.tracks[0].mix = structuredClone(bus.mix);
    p.tracks[0].fx = structuredClone(bus.fx);
  }
  return p;
}
