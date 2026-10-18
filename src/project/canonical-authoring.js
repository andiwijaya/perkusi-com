import { fail } from "./instrument-contract.js";
import { PPQ } from "./instrument-project.js";
import { MasterClock } from "../loop-station/master-clock.js";

const BAR = 4 * PPQ;
const requireValue = (ok, code = "invalidPatternControl") => {
  if (!ok) fail(code);
};
const section = (p, id = p.activeSection) => {
  const value = p.sections.find((s) => s.id === id);
  requireValue(value);
  return value;
};
const finite = (p) =>
  requireValue(p.transport.kind === "chain", "songChainRequired");
function fresh(p, prefix) {
  const ids = new Set(
    [
      ...p.sections,
      ...p.tracks,
      ...p.sourceDefs,
      ...p.chain,
      ...p.sections.flatMap((s) => s.placements),
    ].map((r) => r.id),
  );
  let n = 1;
  while (ids.has(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
}

// These commands only mutate an editor-owned draft. Validation/promotion and
// owner cleanup ACK remain in canonical-editor; no PCM or audio owner is made.
export function startSongChain(p, bars) {
  if (p.transport.kind === "chain") return;
  const s = section(p);
  if (p.transport.kind === "legacy-continuous") {
    requireValue([4, 8].includes(bars), "arrangementWindowRequired");
    requireValue(
      s.placements.every((a) => a.startTick < bars * BAR),
      "songWindowTooShort",
    );
    s.lengthTicks = bars * BAR;
  } else if (p.transport.kind === "legacy-score") {
    requireValue(
      p.transport.nativeLengthTicks >= p.transport.accompanimentLengthTicks,
      "hubRegionUnsupported",
    );
    s.lengthTicks = Math.max(s.lengthTicks, p.transport.nativeLengthTicks);
  }
  assertSongGeometry(p, s);
  p.transport = {
    kind: "chain",
    nativeLengthTicks: null,
    accompanimentLengthTicks: null,
  };
  if (!p.chain.length)
    p.chain = [{ id: fresh(p, "song-entry"), sectionId: s.id, repeats: 1 }];
}

function assertSongGeometry(p, s) {
  for (const a of s.placements) {
    requireValue(a.startTick < s.lengthTicks, "songWindowTooShort");
    if (a.sourceRef.kind === "working") {
      const d = p.sourceDefs.find((d) => d.id === a.sourceRef.id);
      const length =
        d.kind === "composition"
          ? d.programme.chain.length * BAR
          : d.programme.clock.lengthTicks;
      requireValue(
        a.lengthTicks <= length && (!a.loop || a.lengthTicks === length),
        "legacyRegionUnsupported",
      );
      if (d.kind === "instrument-events") {
        const child = p.sourceDefs.find(
          (c) => c.id === d.programme.accompanimentRef,
        );
        const childLength = child.programme.chain.length * BAR;
        // Explicit authoring keeps every accompaniment bar, even currently muted.
        requireValue(
          a.lengthTicks >= childLength &&
            (!a.loop || a.lengthTicks === childLength),
          "hubRegionUnsupported",
        );
      }
      requireValue(
        a.startTick + a.lengthTicks <= s.lengthTicks || a.loop,
        "songWindowTooShort",
      );
    } else {
      const asset = p.assets.find((r) => r.id === a.sourceRef.id);
      const clock = new MasterClock(
        { timing: p.timing, clock: p.timing.clock },
        asset.sampleRate,
      );
      if (a.loop) {
        const period = clock.frame(a.lengthTicks);
        requireValue(
          p.timing.clock.kind === "fixed-bar" &&
            period === asset.frames &&
            (clock.frame(s.lengthTicks) - clock.frame(a.startTick)) % period ===
              0,
          "loopPeriodMismatch",
        );
      } else
        requireValue(
          clock.frame(a.startTick) + asset.frames <= clock.frame(s.lengthTicks),
          "songWindowTooShort",
        );
    }
  }
}

export function cloneSongPattern(p, name) {
  finite(p);
  requireValue(p.sections.length < 16, "patternLimit");
  const source = section(p),
    copy = structuredClone(source),
    sourceMap = new Map(),
    placementMap = new Map();
  copy.id = fresh(p, "song-pattern");
  copy.name = name;
  // Register the section before allocating IDs so every generated ID is unique.
  copy.placements = [];
  p.sections.push(copy);
  const remapPresence = (oldId, newId, fields) => {
    p.compatibility.fieldPresence.push(
      ...p.compatibility.fieldPresence
        .filter((v) => fields.some((field) => v === oldId + "/" + field))
        .map((v) => newId + v.slice(oldId.length)),
    );
  };
  const cloneDef = (id, parentId = null) => {
    if (sourceMap.has(id)) return sourceMap.get(id);
    const old = p.sourceDefs.find((d) => d.id === id),
      d = structuredClone(old);
    requireValue(p.sourceDefs.length < 32, "songSourceLimit");
    d.id = fresh(p, "song-source");
    sourceMap.set(id, d.id);
    d.parentId = parentId;
    p.sourceDefs.push(d);
    if (d.kind === "instrument-events")
      remapPresence(id, d.id, ["instrumentMix", "tuningConsent"]);
    if (d.kind === "instrument-events")
      d.programme.accompanimentRef = cloneDef(
        old.programme.accompanimentRef,
        d.id,
      );
    else
      p.compatibility.rolePresence.push({
        ...structuredClone(
          p.compatibility.rolePresence.find((r) => r.sourceId === id),
        ),
        sourceId: d.id,
      });
    return d.id;
  };
  const buses = new Map();
  for (const a of source.placements) {
    const item = structuredClone(a);
    item.id = fresh(p, "song-placement");
    placementMap.set(a.id, item.id);
    if (a.sourceRef.kind === "working")
      item.sourceRef.id = cloneDef(a.sourceRef.id);
    copy.placements.push(item);
    remapPresence(a.id, item.id, ["alignment"]);
  }
  for (const item of copy.placements) {
    const bus = p.tracks.find((t) => t.id === item.trackId);
    if (!bus.layering) continue;
    if (!buses.has(bus.id)) {
      requireValue(p.tracks.length < 8, "hubTrackLimit");
      const next = structuredClone(bus);
      next.id = fresh(p, "song-layer-bus");
      next.layering.basePlacementId = placementMap.get(
        bus.layering.basePlacementId,
      );
      next.layering.overdubPlacementId = placementMap.get(
        bus.layering.overdubPlacementId,
      );
      p.tracks.push(next);
      buses.set(bus.id, next.id);
      remapPresence(bus.id, next.id, ["eq", "layering"]);
    }
    item.trackId = buses.get(bus.id);
  }
  p.compatibility.fieldPresence.sort();
  p.activeSection = copy.id;
  assertSongGeometry(p, copy);
}

export function newSongPattern(p, name) {
  finite(p);
  requireValue(p.sections.length < 16, "patternLimit");
  const s = {
    id: fresh(p, "song-pattern"),
    name,
    lengthTicks: section(p).lengthTicks,
    placements: [],
  };
  p.sections.push(s);
  p.activeSection = s.id;
}
export function selectSongPattern(p, id) {
  section(p, id);
  p.activeSection = id;
}
export function renameSongPattern(p, name) {
  section(p).name = name;
}
export function setSongLength(p, ticks) {
  finite(p);
  requireValue(Number.isSafeInteger(ticks) && ticks > 0);
  section(p).lengthTicks = ticks;
  assertSongGeometry(p, section(p));
}
export function setSongPlacement(p, id, field, value) {
  finite(p);
  requireValue(["loop", "phasePolicy"].includes(field));
  const s = section(p),
    a = s.placements.find((a) => a.id === id);
  requireValue(a);
  requireValue(
    !(field === "loop" && value === false && a.alignment !== null),
    "alignedLoopRequired",
  );
  // Layered takes share one loop decision and phase policy inside this pattern.
  const bus = p.tracks.find((t) => t.id === a.trackId);
  for (const row of bus.layering
    ? s.placements.filter((a) => a.trackId === bus.id)
    : [a])
    row[field] = value;
  assertSongGeometry(p, s);
}
export function deleteSongPattern(p) {
  finite(p);
  requireValue(p.sections.length > 1, "lastPattern");
  const id = p.activeSection;
  const removedSources = new Set(
    section(p)
      .placements.filter((a) => a.sourceRef.kind === "working")
      .map((a) => a.sourceRef.id),
  );
  for (const d of p.sourceDefs)
    if (removedSources.has(d.id) && d.kind === "instrument-events")
      removedSources.add(d.programme.accompanimentRef);
  p.sections = p.sections.filter((s) => s.id !== id);
  p.chain = p.chain.filter((r) => r.sectionId !== id);
  p.activeSection = p.sections[0].id;
  if (!p.chain.length)
    p.chain.push({
      id: fresh(p, "song-entry"),
      sectionId: p.activeSection,
      repeats: 1,
    });
  // Prune only deleted pattern's orphan working definitions. Immutable originals,
  // assets and full source archives remain; Undo owns the prior working state.
  const usedSources = new Set(
    p.sections.flatMap((s) =>
      s.placements
        .filter((a) => a.sourceRef.kind === "working")
        .map((a) => a.sourceRef.id),
    ),
  );
  for (const d of p.sourceDefs)
    if (usedSources.has(d.id) && d.kind === "instrument-events")
      usedSources.add(d.programme.accompanimentRef);
  p.sourceDefs = p.sourceDefs.filter(
    (d) => !removedSources.has(d.id) || usedSources.has(d.id),
  );
  p.compatibility.rolePresence = p.compatibility.rolePresence.filter((r) =>
    p.sourceDefs.some((d) => d.id === r.sourceId),
  );
  // Orphan layered buses must go: their mandatory pair no longer exists.
  const used = new Set(
    p.sections.flatMap((s) => s.placements.map((a) => a.trackId)),
  );
  p.tracks = p.tracks.filter((t) => !t.layering || used.has(t.id));
  const placements = p.sections.flatMap((s) => s.placements);
  p.compatibility.idMap = p.compatibility.idMap.filter((r) =>
    (r.kind === "origin"
      ? p.origins
      : r.kind === "track"
        ? p.tracks
        : r.kind === "placement"
          ? placements
          : p.sourceDefs
    ).some((v) => v.id === r.newId),
  );
  const allowed = new Set();
  for (const t of p.tracks)
    for (const k of ["eq", "layering"]) allowed.add(t.id + "/" + k);
  for (const a of placements) allowed.add(a.id + "/alignment");
  for (const d of p.sourceDefs.filter((d) => d.kind === "instrument-events"))
    for (const k of ["instrumentMix", "tuningConsent"])
      allowed.add(d.id + "/" + k);
  p.compatibility.fieldPresence = p.compatibility.fieldPresence.filter(
    (v) => v.startsWith("root/") || allowed.has(v),
  );
}
export function moveSongPattern(p, direction) {
  finite(p);
  const index = p.sections.findIndex((s) => s.id === p.activeSection),
    to = index + direction;
  requireValue(
    [-1, 1].includes(direction) && to >= 0 && to < p.sections.length,
  );
  [p.sections[index], p.sections[to]] = [p.sections[to], p.sections[index]];
}
export function appendSongPattern(p) {
  finite(p);
  requireValue(p.chain.reduce((n, r) => n + r.repeats, 0) < 8, "chainLimit");
  p.chain.push({
    id: fresh(p, "song-entry"),
    sectionId: p.activeSection,
    repeats: 1,
  });
}
export function editSongChain(p, index, action, value) {
  finite(p);
  requireValue(Number.isInteger(index) && p.chain[index]);
  if (action === "remove") {
    requireValue(p.chain.length > 1, "lastPattern");
    p.chain.splice(index, 1);
  } else if (action === "repeats") p.chain[index].repeats = value;
  else if (action === "move") {
    const to = index + value;
    requireValue([-1, 1].includes(value) && to >= 0 && to < p.chain.length);
    [p.chain[index], p.chain[to]] = [p.chain[to], p.chain[index]];
  } else fail("invalidPatternControl");
  requireValue(p.chain.reduce((n, r) => n + r.repeats, 0) <= 8, "chainLimit");
}

export function newRhythmPattern(p, sourceId, id, name) {
  const g = p.sourceDefs.find((d) => d.id === sourceId)?.programme;
  requireValue(
    g?.patterns &&
      g.patterns.length < 16 &&
      !g.patterns.some((a) => a.id === id),
    "patternLimit",
  );
  const a = structuredClone(g.patterns[0]);
  a.id = id;
  a.name = name;
  for (const role of Object.keys(a.steps)) a.steps[role].fill(0);
  a.notes.fill(null);
  for (const b of a.beatbox)
    Object.assign(b, {
      enabled: false,
      variant: 1,
      volume: 1,
      pan: 0,
      mute: false,
      solo: false,
      phasePolicy: "continue-source",
    });
  g.patterns.push(a);
  g.activePattern = id;
}
export function deleteRhythmPattern(p, sourceId) {
  const g = p.sourceDefs.find((d) => d.id === sourceId)?.programme;
  requireValue(g?.patterns && g.patterns.length > 1, "lastPattern");
  // Explicit definition deletion is safe only after its occurrences are removed.
  requireValue(!g.chain.includes(g.activePattern), "patternInChain");
  g.patterns = g.patterns.filter((a) => a.id !== g.activePattern);
  g.activePattern = g.patterns[0].id;
}
export function moveRhythmPattern(p, sourceId, direction) {
  const g = p.sourceDefs.find((d) => d.id === sourceId)?.programme;
  requireValue(g?.patterns);
  const index = g.patterns.findIndex((a) => a.id === g.activePattern),
    to = index + direction;
  requireValue(
    [-1, 1].includes(direction) && to >= 0 && to < g.patterns.length,
  );
  [g.patterns[index], g.patterns[to]] = [g.patterns[to], g.patterns[index]];
}
