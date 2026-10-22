import { ProjectError, cleanTitle, MAX_PROJECT_BYTES } from "./schema.js";
import {
  newStudioProject,
  validateStudioProject,
  studioDemo,
} from "./studio-model.js";
import {
  KENDHANG_STROKES,
  KENDHANG_CREDITS,
  kendhangUsed,
} from "./kendhang.js";
export const CLIP_ROLES = [
  "kick",
  "snare",
  "hat",
  "vocal-bass",
  "hum",
  "percussion-fx",
];
export const PITCHES = ["d4", "f4", "g4", "a4", "c5"];
export const CLIP_PACK = Object.freeze({
  id: "original-groove",
  version: "0.1.0-candidate",
  bpm: 96,
  bars: 2,
  key: "D minor",
  processing: "bumi-presence-v1",
});
const mix = () => ({ volume: 1, pan: 0, mute: false, solo: false });
export function newCompositionClip(role) {
  if (!CLIP_ROLES.includes(role)) throw new ProjectError("invalidProject");
  return { role, variant: 1, enabled: false, ...mix() };
}
export function patternClips(p, id = p.activePattern) {
  return p.loopScope === "pattern-v1"
    ? p.patterns.find((pattern) => pattern.id === id).clips
    : p.clips;
}
export function compositionClips(p) {
  return p.loopScope === "pattern-v1"
    ? p.patterns.flatMap((pattern) => pattern.clips)
    : p.clips;
}
export function withPatternLoops(value) {
  const p = structuredClone(value);
  if (p.loopScope === "pattern-v1") return p;
  p.loopScope = "pattern-v1";
  p.patterns = p.patterns.map((pattern) => ({
    ...pattern,
    clips: structuredClone(p.clips),
  }));
  delete p.clips;
  return p;
}
export function editCompositionClip(p, role, field, value) {
  if (!["enabled", "variant", "volume", "pan", "mute", "solo"].includes(field))
    throw new ProjectError("invalidProject");
  const clips = patternClips(p),
    existing = clips.find((c) => c.role === role);
  const next = { ...(existing || newCompositionClip(role)), [field]: value };
  if (
    !CLIP_ROLES.includes(role) ||
    ![1, 2].includes(next.variant) ||
    typeof next.enabled !== "boolean"
  )
    throw new ProjectError("invalidProject");
  validateMix(next);
  if (existing) Object.assign(existing, next);
  else clips.push(next);
  if (field === "enabled" && value) p.timing.bpm = 96;
}
function object(v, keys) {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(v)) ||
    Object.keys(v).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(v, k))
  )
    throw new ProjectError("invalidProject");
}
function validateMix(v) {
  if (
    !Number.isFinite(v.volume) ||
    v.volume < 0 ||
    v.volume > 1 ||
    !Number.isFinite(v.pan) ||
    v.pan < -1 ||
    v.pan > 1 ||
    typeof v.mute !== "boolean" ||
    typeof v.solo !== "boolean"
  )
    throw new ProjectError("invalidProject");
}
export function studioView(p) {
  const base = { ...p };
  delete base.clipPack;
  delete base.clips;
  delete base.loopScope;
  delete base.instrument;
  delete base.kendhang;
  return {
    ...base,
    schemaVersion: 2,
    mode: "studio",
    patterns: p.patterns.map((a) => ({
      id: a.id,
      name: a.name,
      steps: a.steps,
    })),
  };
}
export function fromStudio(p) {
  return {
    ...structuredClone(p),
    schemaVersion: 3,
    mode: "composition",
    clipPack: { ...CLIP_PACK },
    clips: [],
    instrument: { id: "bilah", version: "1.0.0", ...mix(), volume: 0.65 },
    patterns: p.patterns.map((a) => ({
      ...structuredClone(a),
      notes: Array(16).fill(null),
    })),
  };
}
export function newComposition(title = "Ruang 01") {
  return fromStudio(newStudioProject(title));
}
export function validateComposition(v, catalog) {
  object(v, [
    "format",
    "schemaVersion",
    "mode",
    "title",
    "pack",
    "timing",
    "master",
    "tracks",
    "patterns",
    "activePattern",
    "chain",
    "export",
    "clipPack",
    ...(v.loopScope === "pattern-v1" ? ["loopScope"] : ["clips"]),
    "instrument",
    ...(Object.hasOwn(v, "kendhang") ? ["kendhang"] : []),
  ]);
  if (v.schemaVersion !== 3 || v.mode !== "composition")
    throw new ProjectError("unsupportedVersion");
  object(v.clipPack, Object.keys(CLIP_PACK));
  if (Object.keys(CLIP_PACK).some((k) => v.clipPack[k] !== CLIP_PACK[k]))
    throw new ProjectError("unknownPack");
  const collections =
    v.loopScope === "pattern-v1" ? v.patterns?.map((p) => p.clips) : [v.clips];
  if (!Array.isArray(collections)) throw new ProjectError("invalidProject");
  for (const clips of collections) {
    if (!Array.isArray(clips) || clips.length > 6)
      throw new ProjectError("invalidProject");
    const roles = new Set();
    for (const c of clips) {
      object(c, [
        "role",
        "variant",
        "enabled",
        "volume",
        "pan",
        "mute",
        "solo",
      ]);
      if (
        !CLIP_ROLES.includes(c.role) ||
        roles.has(c.role) ||
        ![1, 2].includes(c.variant) ||
        typeof c.enabled !== "boolean"
      )
        throw new ProjectError("invalidProject");
      roles.add(c.role);
      validateMix(c);
    }
  }
  object(v.instrument, ["id", "version", "volume", "pan", "mute", "solo"]);
  if (v.instrument.id !== "bilah" || v.instrument.version !== "1.0.0")
    throw new ProjectError("unknownPack");
  validateMix(v.instrument);
  if (Object.hasOwn(v, "kendhang")) {
    object(v.kendhang, [
      "id",
      "version",
      "credits",
      "volume",
      "pan",
      "mute",
      "solo",
    ]);
    if (
      v.kendhang.id !== "kendhang-ciblon" ||
      v.kendhang.version !== "1.0.0" ||
      v.kendhang.credits !== KENDHANG_CREDITS
    )
      throw new ProjectError("unknownPack");
    validateMix(v.kendhang);
  }
  if (compositionClips(v).some((c) => c.enabled) && v.timing?.bpm !== 96)
    throw new ProjectError("clipTempo");
  for (const p of v.patterns || []) {
    object(p, [
      "id",
      "name",
      "steps",
      "notes",
      ...(v.loopScope === "pattern-v1" ? ["clips"] : []),
      ...(Object.hasOwn(v, "kendhang") ? ["kendhang"] : []),
    ]);
    if (Object.hasOwn(v, "kendhang")) {
      object(p.kendhang, KENDHANG_STROKES);
      for (const row of Object.values(p.kendhang))
        if (
          !Array.isArray(row) ||
          row.length !== 16 ||
          row.some((x) => !Number.isFinite(x) || x < 0 || x > 1)
        )
          throw new ProjectError("invalidProject");
    }
    if (!Array.isArray(p.notes) || p.notes.length !== 16)
      throw new ProjectError("invalidProject");
    for (const n of p.notes)
      if (n !== null) {
        object(n, ["pitch", "velocity"]);
        if (
          !PITCHES.includes(n.pitch) ||
          !Number.isFinite(n.velocity) ||
          n.velocity <= 0 ||
          n.velocity > 1
        )
          throw new ProjectError("invalidProject");
      }
  }
  const base = validateStudioProject(studioView(v), catalog);
  const result = {
    ...structuredClone(v),
    title: cleanTitle(v.title),
    tracks: base.tracks,
    patterns: v.patterns.map((p, i) => ({
      ...structuredClone(p),
      name: base.patterns[i].name,
    })),
  };
  if (
    new TextEncoder().encode(JSON.stringify(result)).length + 1 >
    MAX_PROJECT_BYTES
  )
    throw new ProjectError("projectTooLarge");
  return result;
}
export function fromBeatbox(p) {
  const result = newComposition(p.title);
  result.timing = { bpm: 96, meter: [4, 4], swing: 0, quantize: true };
  result.master = { ...p.master };
  result.chain = Array(p.export.bars).fill("p1");
  result.clips = p.tracks.map((t) => ({ ...t, ...mix() }));
  return result;
}
export function reverseReasons(p) {
  const reasons = [];
  if (p.pack.id !== "ruang") reasons.push("kit");
  if (p.timing.bpm !== 96 || p.timing.swing !== 0) reasons.push("tempo");
  if (
    ![4, 8].includes(p.chain.length) ||
    p.patterns.length !== 1 ||
    p.patterns[0].id !== "p1" ||
    p.patterns[0].name !== "A" ||
    !p.timing.quantize ||
    p.chain.some((id) => id !== p.activePattern)
  )
    reasons.push("arrangement");
  if (
    p.patterns.some((a) =>
      Object.values(a.steps).some((row) => row.some(Boolean)),
    )
  )
    reasons.push("drums");
  if (p.patterns.some((a) => a.notes.some(Boolean))) reasons.push("notes");
  if (kendhangUsed(p)) reasons.push("kendhang");
  if (
    patternClips(p).length !== 6 ||
    compositionClips(p).some(
      (c) => c.volume !== 1 || c.pan !== 0 || c.mute || c.solo,
    ) ||
    p.tracks.some((t) => t.volume !== 0.8 || t.pan !== 0 || t.mute || t.solo) ||
    p.instrument.volume !== 0.65 ||
    p.instrument.pan !== 0 ||
    p.instrument.mute ||
    p.instrument.solo
  )
    reasons.push("mix");
  if (
    p.loopScope === "pattern-v1" &&
    p.patterns.some(
      (a) => JSON.stringify(a.clips) !== JSON.stringify(patternClips(p)),
    )
  )
    reasons.push("patternLoops");
  return reasons;
}
export function toBeatbox(p, derived = false) {
  const reasons = reverseReasons(p);
  if (reasons.length && !derived) throw new ProjectError("needsConversion");
  const solo = allMix(p).some((t) => t.solo);
  return {
    format: "perkusi-project",
    schemaVersion: 1,
    mode: "beatbox",
    title: cleanTitle(p.title),
    pack: { id: CLIP_PACK.id, version: CLIP_PACK.version },
    timing: { bpm: 96, meter: [4, 4] },
    master: { ...p.master },
    tracks: CLIP_ROLES.map((role) => {
      const c = patternClips(p).find((c) => c.role === role);
      return {
        role,
        variant: c?.variant || 1,
        enabled: !!c?.enabled && !c.mute && c.volume > 0 && (!solo || c.solo),
      };
    }),
    export: { bars: p.chain.length === 8 ? 8 : 4 },
  };
}
export function allMix(p, patternId = p.activePattern) {
  return [
    ...p.tracks,
    ...patternClips(p, patternId).map((c) => ({
      ...c,
      role: "clip-" + c.role,
      mute: c.mute || !c.enabled,
    })),
    { ...p.instrument, role: "bilah" },
    ...(p.kendhang ? [{ ...p.kendhang, role: "kendhang" }] : []),
  ];
}
export function mixedStudioView(p, patternId = p.activePattern) {
  const v = studioView(p),
    solo = allMix(p, patternId).some((t) => t.solo);
  v.tracks = v.tracks.map((t) => ({ ...t, mute: t.mute || (solo && !t.solo) }));
  return v;
}
export function compositionDemo(kind) {
  if (["ruang", "arus"].includes(kind)) return fromStudio(studioDemo(kind));
  const p = fromStudio(studioDemo(kind === "malam" ? "arus" : "ruang"));
  p.title =
    kind === "fusion"
      ? "Nusantara Fusion"
      : kind === "malam"
        ? "Malam Bilah"
        : "Bumi dan Tangan";
  p.pack.id =
    kind === "fusion" ? "fusion" : kind === "malam" ? "arus" : "ruang";
  p.timing.bpm = kind === "malam" ? 108 : 96;
  p.timing.swing = kind === "malam" ? 0.16 : 0;
  p.tracks.forEach((t) => (t.volume = 0.45));
  p.instrument.volume = 0.5;
  if (kind === "fusion")
    for (const [i, a] of p.patterns.entries()) {
      a.steps = Object.fromEntries(
        p.tracks.map((t) => [t.role, Array(16).fill(0)]),
      );
      const hits = {
        kick: [0, 6, 8, 14],
        snare: i % 2 ? [3, 7, 12, 15] : [3, 7, 12],
        tom: i === 3 ? [2, 5, 9, 11, 13, 15] : [2, 5, 10, 13],
        rim: [1, 9],
        clap: [4, 12],
        shaker: [0, 2, 4, 6, 8, 10, 12, 14],
        "closed-hat": [7, 15],
        "open-hat": i % 2 ? [14] : [],
      };
      for (const [role, steps] of Object.entries(hits))
        for (const step of steps)
          a.steps[role][step] =
            role === "shaker" ? 0.45 : role === "tom" ? 0.8 : 0.7;
    }
  for (let i = 0; i < 4; i++) {
    const row = p.patterns[i];
    const pitches =
      kind === "malam"
        ? ["a4", "f4", "d4", "c5"]
        : kind === "fusion"
          ? ["d4", "g4", "a4", "f4"]
          : ["d4", "f4", "a4", "d4"];
    for (const [j, step] of [0, 5, 10, 14].entries())
      row.notes[step] = {
        pitch: pitches[(j + i) % 4],
        velocity: 0.5 + 0.1 * (j % 2),
      };
  }
  if (kind !== "malam")
    p.clips = CLIP_ROLES.map((role) => ({
      role,
      variant: kind === "bumi" ? 2 : 1,
      enabled: (kind === "fusion"
        ? ["vocal-bass", "hum", "percussion-fx"]
        : ["kick", "vocal-bass"]
      ).includes(role),
      ...mix(),
      volume: role === "kick" ? 0.55 : 0.4,
    }));
  return p;
}
