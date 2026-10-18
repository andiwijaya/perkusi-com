import { migrateToLoopProject, validateLoopProject } from "./project.js";
import {
  migrateToInstrumentProject,
  parseInstrumentProject,
} from "../project/instrument-project.js";
import { legacyAudible } from "../project/instrument-mix.js";
import { fail, utf8Bytes } from "../project/instrument-contract.js";
export function instrumentSource(text, registry) {
  if (
    typeof text !== "string" ||
    text.length > 2 * 1024 * 1024 ||
    utf8Bytes(text) > 2 * 1024 * 1024
  )
    fail("projectTooLarge");
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    fail("invalidLoopProject");
  }
  return raw?.schemaVersion === 4
    ? parseInstrumentProject(text, registry)
    : migrateToInstrumentProject(text, registry);
}
export function eightTrackProject(text, registry) {
  const p = structuredClone(migrateToLoopProject(text, registry));
  p.clock ??= { kind: "musical" };
  p.sources ??= [];
  while (p.tracks.length < 8) {
    let n = 1;
    const used = new Set(
      p.tracks.flatMap((t) => [t.id, ...t.clips.map((c) => c.id)]),
    );
    while (used.has("track-" + n)) n++;
    p.tracks.push({
      id: "track-" + n,
      kind: "event",
      gain: 1,
      pan: 0,
      mute: false,
      solo: false,
      clips: [],
    });
  }
  return validateLoopProject(p, registry);
}
export function replaceWorkingSource(project, registry, sourceId, text) {
  const next = structuredClone(validateLoopProject(project, registry));
  const source = next.sources?.find((s) => s.id === sourceId);
  if (!source) fail("unknownLoopSource");
  parseInstrumentProject(text, registry);
  source.text = text;
  return validateLoopProject(next, registry);
}
export function assignSource(project, registry, trackId, text, { loop } = {}) {
  const next = structuredClone(validateLoopProject(project, registry)),
    track = next.tracks.find((t) => t.id === trackId);
  if (!track || (loop !== undefined && typeof loop !== "boolean"))
    fail("invalidLoopTrack");
  const normalized = instrumentSource(text, registry);
  loop ??= !legacyAudible(normalized.composition);
  if (next.tracks.every((t) => !t.clips.length) && !next.assetRefs.length) {
    next.timing.bpm = normalized.composition.timing.bpm;
    next.clock = { kind: "musical" };
  }
  next.sources ??= [];
  let origin = next.origins.find((o) => o.text === text);
  if (!origin) {
    let n = 1;
    if (next.origins.length >= 8) fail("loopSourceLimit");
    while (
      [...next.origins, ...next.sources, ...next.assetRefs].some(
        (o) => o.id === "origin-" + n,
      )
    )
      n++;
    origin = {
      id: "origin-" + n,
      schemaVersion: JSON.parse(text).schemaVersion,
      text,
    };
    next.origins.push(origin);
  }
  let source = next.sources.find(
    (s) => s.originId === origin.id && s.text === JSON.stringify(normalized),
  );
  if (!source) {
    let n = 1;
    while (
      [...next.origins, ...next.sources, ...next.assetRefs].some(
        (s) => s.id === "source-" + n,
      )
    )
      n++;
    source = {
      id: "source-" + n,
      originId: origin.id,
      text: JSON.stringify(normalized),
    };
    next.sources.push(source);
  }
  let n = 1;
  const ids = new Set(
    next.tracks.flatMap((t) => [t.id, ...t.clips.map((c) => c.id)]),
  );
  while (ids.has("clip-" + n)) n++;
  track.clips = [
    {
      id: "clip-" + n,
      sourceId: source.id,
      startTick: 0,
      lengthTicks: normalized.clock.lengthTicks,
      offsetFrames: 0,
      loop,
    },
  ];
  delete track.layering;
  track.kind = "event";
  return validateLoopProject(next, registry);
}
export class LoopHistory {
  constructor(project, registry) {
    this.registry = registry;
    this.project = validateLoopProject(project, registry);
    this.undoStack = [];
    this.redoStack = [];
  }
  commit(change) {
    const next = validateLoopProject(change(this.project), this.registry);
    if (JSON.stringify(next) === JSON.stringify(this.project))
      return this.project;
    this.undoStack.push(this.project);
    if (this.undoStack.length > 32) this.undoStack.shift();
    this.redoStack = [];
    return (this.project = next);
  }
  undo() {
    if (this.undoStack.length) {
      this.redoStack.push(this.project);
      this.project = this.undoStack.pop();
    }
    return this.project;
  }
  redo() {
    if (this.redoStack.length) {
      this.undoStack.push(this.project);
      this.project = this.redoStack.pop();
    }
    return this.project;
  }
}

export function emptyLoopProject(registry) {
  return eightTrackProject(
    JSON.stringify({
      format: "perkusi-project",
      schemaVersion: 5,
      mode: "loop-station",
      title: "Loop Station",
      timing: { bpm: 96, meter: [4, 4] },
      master: { volume: 1 },
      origins: [],
      assetRefs: [],
      tracks: [],
      clock: { kind: "musical" },
      sources: [],
    }),
    registry,
  );
}

// New recording workspaces reserve room for live input plus loop replay.
// Legacy parsing and imported/saved mixer values keep their original defaults.
export function newRecordingProject(registry) {
  const project = structuredClone(emptyLoopProject(registry));
  project.master.volume = 0.5;
  return validateLoopProject(project, registry);
}
