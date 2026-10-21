import { PPQ } from "../project/instrument-project.js";
import { startSongChain } from "../project/canonical-authoring.js";
import { fail } from "../project/instrument-contract.js";

// Only freshly generated starter metadata enters here. Imported/user projects
// keep all their slots and geometry. Original starter files remain external,
// untouched bundle payloads; this is the editable Studio working copy.
export function canonicalStarterProject(value) {
  const p = structuredClone(value),
    bar = 4 * PPQ,
    placed = p.sections.flatMap((s) => s.placements),
    used = new Set(placed.map((a) => a.trackId)),
    removed = new Set(p.tracks.filter((t) => !used.has(t.id)).map((t) => t.id));
  p.tracks = p.tracks.filter((t) => used.has(t.id));
  p.compatibility.fieldPresence = p.compatibility.fieldPresence.filter(
    (v) => !removed.has(v.split("/")[0]),
  );
  p.compatibility.idMap = p.compatibility.idMap.filter(
    (m) => !removed.has(m.newId),
  );
  for (const a of placed) {
    const d = p.sourceDefs.find((d) => d.id === a.sourceRef.id);
    if (
      a.sourceRef.kind !== "working" ||
      d?.kind !== "instrument-events" ||
      !a.loop ||
      a.offsetFrames !== 0 ||
      a.lengthTicks !== d.programme.clock.lengthTicks
    )
      fail("invalidStarterGeometry");
    const child = p.sourceDefs.find(
        (c) => c.id === d.programme.accompanimentRef,
      ),
      g = child?.programme,
      bars = d.programme.clock.lengthTicks / bar;
    if (
      !g ||
      !Number.isInteger(bars) ||
      bars < 1 ||
      bars > 8 ||
      g.patterns.length !== 1 ||
      g.chain.some((id) => id !== g.activePattern) ||
      g.patterns.some(
        (a) =>
          a.notes.some(Boolean) ||
          a.beatbox.some((b) => b.enabled) ||
          Object.values(a.steps).some((row) => row.some(Boolean)),
      ) ||
      g.chain.length > bars
    )
      fail("invalidStarterGeometry");
    // Extend silence to the existing native period; no native event is moved,
    // duplicated or cut, and no audio-bearing accompaniment can pass this gate.
    g.chain = Array(bars).fill(g.activePattern);
  }
  startSongChain(p, 4);
  return p;
}
