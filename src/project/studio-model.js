import { cleanTitle, ProjectError, PROJECT_FORMAT } from "./schema.js";
import { MASTER_MAX } from "../audio/voice.js";

export const STUDIO_ROLES = [
  "kick",
  "snare",
  "closed-hat",
  "open-hat",
  "clap",
  "tom",
  "rim",
  "shaker",
];
export const MAX_PATTERNS = 16;
export const MAX_CHAIN = 8;
export function emptyPattern(id = "p1", name = "A") {
  return {
    id,
    name,
    steps: Object.fromEntries(
      STUDIO_ROLES.map((role) => [role, Array(16).fill(0)]),
    ),
  };
}
export function newStudioProject(title = "Ruang 01") {
  return {
    format: PROJECT_FORMAT,
    schemaVersion: 2,
    mode: "studio",
    title,
    pack: { id: "ruang", version: "1.0.0" },
    timing: { bpm: 110, meter: [4, 4], swing: 0, quantize: true },
    master: { volume: 0.65 },
    tracks: STUDIO_ROLES.map((role) => ({
      role,
      volume: 0.8,
      pan: 0,
      mute: false,
      solo: false,
    })),
    patterns: [emptyPattern()],
    activePattern: "p1",
    chain: ["p1"],
    export: { arrangement: true },
  };
}
function obj(v, keys) {
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
const number = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
export function validateStudioProject(v, catalog) {
  if (catalog?.kind !== "studio") throw new ProjectError("unsupportedMode");
  obj(v, [
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
  ]);
  if (
    v.format !== PROJECT_FORMAT ||
    v.schemaVersion !== 2 ||
    v.mode !== "studio"
  )
    throw new ProjectError("invalidProject");
  obj(v.pack, ["id", "version"]);
  if (
    v.pack.version !== catalog.version ||
    !catalog.kits.some((k) => k.id === v.pack.id)
  )
    throw new ProjectError("unknownPack");
  obj(v.timing, ["bpm", "meter", "swing", "quantize"]);
  if (
    !number(v.timing.bpm, 60, 180) ||
    !Array.isArray(v.timing.meter) ||
    v.timing.meter.length !== 2 ||
    v.timing.meter[0] !== 4 ||
    v.timing.meter[1] !== 4 ||
    !number(v.timing.swing, 0, 0.5) ||
    typeof v.timing.quantize !== "boolean"
  )
    throw new ProjectError("invalidProject");
  obj(v.master, ["volume"]);
  if (!number(v.master.volume, 0, MASTER_MAX))
    throw new ProjectError("invalidProject");
  obj(v.export, ["arrangement"]);
  if (
    v.export.arrangement !== true ||
    !Array.isArray(v.tracks) ||
    v.tracks.length !== 8
  )
    throw new ProjectError("invalidProject");
  const roles = new Set();
  for (const t of v.tracks) {
    obj(t, ["role", "volume", "pan", "mute", "solo"]);
    if (
      !STUDIO_ROLES.includes(t.role) ||
      roles.has(t.role) ||
      !number(t.volume, 0, 1) ||
      !number(t.pan, -1, 1) ||
      typeof t.mute !== "boolean" ||
      typeof t.solo !== "boolean"
    )
      throw new ProjectError("invalidProject");
    roles.add(t.role);
  }
  if (
    !Array.isArray(v.patterns) ||
    !v.patterns.length ||
    v.patterns.length > MAX_PATTERNS
  )
    throw new ProjectError("invalidProject");
  const ids = new Set();
  for (const p of v.patterns) {
    obj(p, ["id", "name", "steps"]);
    if (
      typeof p.id !== "string" ||
      !/^[a-z0-9-]{1,32}$/.test(p.id) ||
      ids.has(p.id)
    )
      throw new ProjectError("invalidProject");
    ids.add(p.id);
    cleanTitle(p.name);
    obj(p.steps, STUDIO_ROLES);
    for (const row of Object.values(p.steps))
      if (
        !Array.isArray(row) ||
        row.length !== 16 ||
        row.some((x) => !number(x, 0, 1))
      )
        throw new ProjectError("invalidProject");
  }
  if (
    typeof v.activePattern !== "string" ||
    !ids.has(v.activePattern) ||
    !Array.isArray(v.chain) ||
    !v.chain.length ||
    v.chain.length > MAX_CHAIN ||
    v.chain.some((id) => typeof id !== "string" || !ids.has(id))
  )
    throw new ProjectError("invalidProject");
  return {
    ...structuredClone(v),
    title: cleanTitle(v.title),
    patterns: v.patterns.map((p) => ({
      ...structuredClone(p),
      name: cleanTitle(p.name),
    })),
    tracks: STUDIO_ROLES.map((role) => ({
      ...v.tracks.find((t) => t.role === role),
    })),
  };
}
export function studioDemo(genre = "ruang") {
  const p = newStudioProject(genre === "arus" ? "Arus 01" : "Ruang 01");
  p.pack.id = genre;
  p.timing.bpm = genre === "arus" ? 124 : 110;
  p.timing.swing = genre === "arus" ? 0.16 : 0.1;
  p.patterns = ["A", "B", "C", "D"].map((name, i) => {
    const a = emptyPattern("p" + (i + 1), name);
    const hits = {
      kick: i === 3 ? [0, 6, 10, 14] : [0, 7, 8],
      snare: [4, 12],
      "closed-hat": [0, 2, 4, 6, 8, 10, 12, 14],
      "open-hat": i % 2 ? [15] : [10],
      clap: i === 2 ? [4, 12] : [],
      tom: i === 3 ? [11, 13] : [],
      rim: [3, 11],
      shaker: [1, 5, 9, 13],
    };
    for (const [role, steps] of Object.entries(hits))
      for (const s of steps) a.steps[role][s] = role === "shaker" ? 0.65 : 1;
    return a;
  });
  p.chain = ["p1", "p2", "p3", "p4"];
  return p;
}
// Bounded complete snapshots preserve steps, patterns, chains and mixer together.
export class ProjectHistory {
  constructor(project, validate, limit = 60) {
    this.validate = validate;
    this.current = validate(project);
    this.past = [];
    this.future = [];
    this.limit = limit;
  }
  edit(fn) {
    const next = structuredClone(this.current);
    fn(next);
    const valid = this.validate(next);
    if (JSON.stringify(valid) === JSON.stringify(this.current)) return false;
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.current = valid;
    this.future = [];
    return true;
  }
  undo() {
    if (!this.past.length) return false;
    this.future.push(this.current);
    this.current = this.past.pop();
    return true;
  }
  redo() {
    if (!this.future.length) return false;
    this.past.push(this.current);
    this.current = this.future.pop();
    return true;
  }
  replace(p) {
    this.current = this.validate(p);
    this.past = [];
    this.future = [];
  }
}
