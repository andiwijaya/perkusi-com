import {
  createCanonicalBundle,
  retainCanonicalBundle,
} from "./canonical-package.js";
import { validateCanonicalMetadata } from "./canonical-metadata.js";
import { fail, utf8Bytes } from "./instrument-contract.js";
import { PPQ } from "./instrument-project.js";
const BAR = 4 * PPQ,
  check = (s) => {
    if (s?.aborted) fail("cancelled");
  };
function unified(value) {
  const p = structuredClone(value);
  if (p.mixPolicy) return p;
  const volume = p.master.volume;
  for (const d of p.sourceDefs)
    if (d.master.binding === "project") d.master = { binding: "local", volume };
  if (p.compatibility.sourceVersion < 5) p.master.volume = 1;
  p.mixPolicy = "unified-outer-v1";
  return p;
}
export function canonicalMaterialTracks(project) {
  return project.tracks
    .filter((t) =>
      project.sections.some((s) =>
        s.placements.some((p) => p.trackId === t.id),
      ),
    )
    .map((t) => t.id);
}
// Explicit finite material-copy operation. The full input file is archived;
// chosen working tracks acquire independent IDs, controls, buses and payloads.
// No tempo conversion, source-period rewrite, trimming, EQ baking or pitch shift.
export async function combineCanonicalMaterial(
  base,
  incoming,
  {
    registry,
    memory,
    trackIds = canonicalMaterialTracks(incoming.project),
    bars = 4,
    startTick = 0,
    signal,
  } = {},
) {
  const left = retainCanonicalBundle(base);
  let held, right;
  try {
    right = retainCanonicalBundle(incoming);
    check(signal);
    if (
      ![4, 8].includes(bars) ||
      !Number.isSafeInteger(startTick) ||
      startTick < 0
    )
      fail("hubRegionUnsupported");
    if (left.project.timing.bpm !== right.project.timing.bpm)
      fail("hubTempoConflict");
    held = memory.reserve(
      2 *
        (utf8Bytes(JSON.stringify(left.project)) +
          utf8Bytes(JSON.stringify(right.project))) +
        65536,
      "canonical/hub-copy-working-metadata",
    );
    check(signal);
    const out = unified(left.project),
      source = unified(right.project),
      selected = new Set(trackIds);
    if (
      !selected.size ||
      [...selected].some((id) => !source.tracks.some((t) => t.id === id))
    )
      fail("hubNoMaterial");
    if (out.tracks.length + selected.size > 8) fail("hubTrackLimit");
    if (!source.master.limiter.bypass) fail("hubLimiterUnsupported");
    let fixed = null;
    for (const p of [out, source])
      if (p.timing.clock.kind === "fixed-bar") {
        if (
          fixed &&
          ["sampleRate", "framesPerBar"].some(
            (key) => fixed[key] !== p.timing.clock[key],
          )
        )
          fail("hubClockConflict");
        fixed = p.timing.clock;
      }
    if (fixed) {
      const exact = (240 * fixed.sampleRate) / out.timing.bpm;
      if (!Number.isInteger(exact) || exact !== fixed.framesPerBar)
        fail("hubClockConflict");
      out.timing.clock = structuredClone(fixed);
    }
    let ordinal = 1;
    const existingIds = [
      ...out.origins,
      ...out.sourceDefs,
      ...out.assets,
      ...out.tracks,
      ...out.sections.flatMap((s) => s.placements),
    ].map((r) => r.id);
    while (existingIds.some((id) => id.startsWith("m" + ordinal + "-")))
      ordinal++;
    const prefix = "m" + ordinal + "-",
      ids = (rows, kind) =>
        new Map(rows.map((r, i) => [r.id, prefix + kind + i])),
      origins = ids(source.origins, "o"),
      defs = ids(source.sourceDefs, "s"),
      assets = ids(source.assets, "a"),
      tracks = ids(
        source.tracks.filter((t) => selected.has(t.id)),
        "t",
      ),
      placementMap = new Map();
    for (const o of source.origins)
      out.origins.push({ ...o, id: origins.get(o.id) });
    for (const d of source.sourceDefs) {
      const row = structuredClone(d);
      row.id = defs.get(d.id);
      row.originId = origins.get(d.originId);
      row.workingOriginId =
        d.workingOriginId === null ? null : origins.get(d.workingOriginId);
      row.parentId = d.parentId === null ? null : defs.get(d.parentId);
      if (row.kind === "instrument-events")
        row.programme.accompanimentRef = defs.get(d.programme.accompanimentRef);
      out.sourceDefs.push(row);
    }
    const entries = new Map(
      out.assets.map((a) => [a.id, left.entries.get(a.id)]),
    );
    for (const a of source.assets) {
      const id = assets.get(a.id);
      out.assets.push({ ...a, id, creditsRef: prefix + "credit-" + id });
      entries.set(id, right.entries.get(a.id));
    }
    const target = out.sections.find((s) => s.id === out.activeSection);
    if (out.transport.kind === "legacy-continuous") {
      target.lengthTicks = Math.max(target.lengthTicks, bars * BAR);
      out.chain = [{ id: "hub-window", sectionId: target.id, repeats: 1 }];
    }
    out.transport = {
      kind: "chain",
      nativeLengthTicks: null,
      accompanimentLengthTicks: null,
    };
    const importedTracks = source.tracks
      .filter((t) => selected.has(t.id))
      .map((t) => ({
        ...structuredClone(t),
        id: tracks.get(t.id),
        name: (source.title + " · " + t.name).slice(0, 80),
        mix: { ...t.mix, volume: t.mix.volume * source.master.volume },
      }));
    let offset = startTick,
      index = 0;
    const chain = source.chain.length
      ? source.chain
      : [{ sectionId: source.activeSection, repeats: 1 }];
    for (const occurrence of chain)
      for (let r = 0; r < occurrence.repeats; r++) {
        const section = source.sections.find(
            (s) => s.id === occurrence.sectionId,
          ),
          span =
            source.transport.kind === "legacy-continuous"
              ? bars * BAR
              : section.lengthTicks;
        for (const p of section.placements.filter((p) =>
          selected.has(p.trackId),
        )) {
          const id = prefix + "p" + index++;
          if (!placementMap.has(p.id)) placementMap.set(p.id, id);
          const row = {
            ...structuredClone(p),
            id,
            trackId: tracks.get(p.trackId),
            sourceRef: {
              kind: p.sourceRef.kind,
              id: (p.sourceRef.kind === "asset" ? assets : defs).get(
                p.sourceRef.id,
              ),
            },
            startTick: offset + p.startTick,
          };
          target.placements.push(row);
        }
        offset += span;
      }
    for (const t of importedTracks) {
      if (t.layering) {
        t.layering.basePlacementId = placementMap.get(
          t.layering.basePlacementId,
        );
        t.layering.overdubPlacementId = placementMap.get(
          t.layering.overdubPlacementId,
        );
      }
      out.tracks.push(t);
    }
    target.lengthTicks = Math.max(
      target.lengthTicks,
      offset,
      ...target.placements.map((p) => p.startTick + p.lengthTicks),
    );
    for (const s of out.sections)
      for (const p of s.placements) {
        const d = out.sourceDefs.find((d) => d.id === p.sourceRef.id);
        if (d?.kind === "instrument-events") {
          const child = out.sourceDefs.find(
            (c) => c.id === d.programme.accompanimentRef,
          );
          if (p.lengthTicks < child.programme.chain.length * BAR)
            fail("hubRegionUnsupported");
        }
      }
    const allIds = new Map([
      ...origins,
      ...defs,
      ...assets,
      ...tracks,
      ...placementMap,
    ]);
    for (const row of source.compatibility.rolePresence)
      out.compatibility.rolePresence.push({
        ...row,
        sourceId: defs.get(row.sourceId),
      });
    for (const field of source.compatibility.fieldPresence) {
      const slash = field.indexOf("/"),
        id = allIds.get(field.slice(0, slash));
      if (id) out.compatibility.fieldPresence.push(id + field.slice(slash));
    }
    out.compatibility.fieldPresence = [
      ...new Set(out.compatibility.fieldPresence),
    ].sort();
    for (const m of source.compatibility.idMap) {
      const map =
        m.kind === "origin"
          ? origins
          : m.kind === "track"
            ? tracks
            : m.kind === "placement"
              ? placementMap
              : defs;
      if (map.has(m.newId))
        out.compatibility.idMap.push({
          ...m,
          sourceId: prefix + m.sourceId,
          newId: map.get(m.newId),
        });
    }
    const originals = new Map();
    for (const b of [left, right])
      for (const o of b.project.origins.filter((o) => o.kind === "file"))
        originals.set(o.sha256, b.originals.get(o.sha256));
    const backups = new Map();
    for (const b of [left, right]) {
      for (const ref of b.backupRefs)
        backups.set(ref.sha256, b.backups.get(ref.sha256));
      if (
        b.backup &&
        !out.origins.some((o) => o.kind === "file" && o.sha256 === b.backupHash)
      )
        backups.set(b.backupHash, {
          blob: b.backup,
          name: b.project.title.slice(0, 80),
        });
    }
    const project = await validateCanonicalMetadata(out, registry);
    check(signal);
    return await createCanonicalBundle(project, {
      registry,
      memory,
      signal,
      entries,
      originals,
      backups,
      backup: left.backup,
    });
  } finally {
    held?.release();
    left.dispose();
    right?.dispose();
  }
}
