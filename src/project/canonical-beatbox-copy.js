import {
  validateCanonicalMetadata,
  projectLegacyMetadata,
} from "./canonical-metadata.js";
import { migrateProject } from "./schema.js";
import { originalRegistry } from "./original-registry.js";
import {
  newComposition,
  reverseReasons,
  toBeatbox,
} from "./composition-model.js";
import { fail } from "./instrument-contract.js";
import { exportCanonicalPackage } from "./canonical-package.js";
import { prepareTransfer } from "./mode-transfer.js";
import { MASTER_MAX } from "../audio/voice.js";

// Read current canonical controls, never the retained original file. An exact
// legacy inverse is deliberately the only compatible path; all other projects
// require an explicit, described derived copy and a complete archive first.
export async function canonicalBeatboxCopy(value, { registry, sourceId } = {}) {
  const c = await validateCanonicalMetadata(value, registry);
  try {
    const old = await projectLegacyMetadata(c, { registry });
    if ([0, 1].includes(old.schemaVersion))
      return {
        compatible: true,
        candidate: migrateProject(old, originalRegistry),
      };
    if (old.schemaVersion === 3 && !reverseReasons(old).length)
      return { compatible: true, candidate: toBeatbox(old) };
  } catch (error) {
    if (error.code !== "needsConversion") throw error;
  }
  const selected = c.sourceDefs.find((d) => d.id === sourceId);
  if (!selected || selected.kind !== "composition")
    fail("beatboxSourceRequired");
  const g = selected.programme,
    pattern = g.patterns.find((a) => a.id === g.activePattern),
    p = newComposition(c.title),
    parent = selected.parentId
      ? c.sourceDefs.find((d) => d.id === selected.parentId)
      : selected,
    outerSolo = c.tracks.some((t) => t.mix.solo),
    placements = c.sections
      .find((s) => s.id === c.activeSection)
      .placements.filter(
        (a) => a.sourceRef.kind === "working" && a.sourceRef.id === parent.id,
      ),
    audible = placements.some((a) => {
      const t = c.tracks.find((t) => t.id === a.trackId);
      return !t.mix.mute && t.mix.volume > 0 && (!outerSolo || t.mix.solo);
    });
  p.master.volume = Math.min(c.master.volume, MASTER_MAX);
  p.tracks = structuredClone(g.percussion);
  p.instrument = structuredClone(g.bilah);
  p.clips = pattern.beatbox.map((control) => {
    const copy = { ...control };
    delete copy.phasePolicy;
    return copy;
  });
  const master = (d) =>
    d.master.binding === "project"
      ? c.master.volume
      : d.master.binding === "local"
        ? d.master.volume
        : master(c.sourceDefs.find((s) => s.id === d.parentId));
  if (!audible || master(selected) === 0)
    p.clips = p.clips.map((a) => ({ ...a, enabled: false }));
  return {
    compatible: false,
    candidate: migrateProject(toBeatbox(p, true), originalRegistry),
    sourceId: selected.id,
    sourceTitle: g.title,
    patternName: pattern.name,
  };
}

export async function stageCanonicalBeatboxCopy(
  bundle,
  {
    registry,
    memory,
    store,
    sourceId,
    storage,
    session,
    archiveId = crypto.randomUUID(),
    check = () => {},
  } = {},
) {
  const review = await canonicalBeatboxCopy(bundle.project, {
    registry,
    sourceId,
  });
  check();
  const archive = await exportCanonicalPackage(bundle, { memory });
  let info;
  try {
    info = await store.stage(archive.blob, {
      id: archiveId,
      kind: "legacy",
      title: bundle.project.title,
    });
    check();
    prepareTransfer(review.candidate, "beatbox", { storage, session });
  } finally {
    archive.release();
  }
  return { ...review, archive: info };
}
