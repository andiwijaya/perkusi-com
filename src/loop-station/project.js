import { cleanTitle, parseProject } from "../project/schema.js";
import { validateEQ, validateLimiter } from "./fx-model.js";
import { compositionRegistry } from "../project/studio-registry.js";
import { phaseAdvance } from "./phase-alignment.js";
import {
  parseInstrumentProject,
  PPQ,
  MAX_EVENT_TICK,
} from "../project/instrument-project.js";
import {
  dataTree,
  record,
  array,
  identifier,
  integer,
  finite,
  fail,
  frozenCopy,
  utf8Bytes,
} from "../project/instrument-contract.js";

export const LOOP_SCHEMA_VERSION = 5;
export const MAX_LOOP_PROJECT_BYTES = 2 * 1024 * 1024;
const invalid = "invalidLoopProject";
const keys = [
  "format",
  "schemaVersion",
  "mode",
  "title",
  "timing",
  "master",
  "origins",
  "assetRefs",
  "tracks",
];
function source(text, version, registry) {
  const normalized =
    version === 4
      ? parseInstrumentProject(text, registry)
      : parseProject(text, compositionRegistry);
  const raw = JSON.parse(text);
  if (raw.schemaVersion !== version || !integer(version, 0, 4)) fail(invalid);
  const composition = version === 4 ? normalized.composition : normalized;
  return {
    bpm: composition.timing.bpm,
    title: composition.title,
    lengthTicks:
      version === 4
        ? normalized.clock.lengthTicks
        : composition.chain.length * 4 * PPQ,
  };
}
export function validateLoopProject(value, registry) {
  dataTree(value, invalid);
  record(
    value,
    [
      ...keys,
      ...["clock", "sources", "tuningConsent"].filter((k) =>
        Object.hasOwn(value, k),
      ),
    ],
    invalid,
  );
  if (utf8Bytes(JSON.stringify(value)) > MAX_LOOP_PROJECT_BYTES)
    fail("projectTooLarge");
  if (
    value.format !== "perkusi-project" ||
    value.schemaVersion !== LOOP_SCHEMA_VERSION ||
    value.mode !== "loop-station"
  )
    fail(invalid);
  const title = cleanTitle(value.title);
  record(value.timing, ["bpm", "meter"], invalid);
  if (
    !finite(value.timing.bpm, 60, 180) ||
    JSON.stringify(value.timing.meter) !== "[4,4]"
  )
    fail(invalid);
  if (
    value.tuningConsent !== undefined &&
    typeof value.tuningConsent !== "boolean"
  )
    fail(invalid);
  if (value.clock !== undefined) {
    if (value.clock?.kind === "musical") record(value.clock, ["kind"], invalid);
    else {
      record(value.clock, ["kind", "sampleRate", "framesPerBar"], invalid);
      if (
        value.clock.kind !== "fixed-bar" ||
        !integer(value.clock.sampleRate, 8000, 192000) ||
        value.clock.framesPerBar !==
          Math.round((4 * 60 * value.clock.sampleRate) / value.timing.bpm)
      )
        fail(invalid);
    }
  }
  record(
    value.master,
    [
      "volume",
      ...(Object.hasOwn(value.master ?? {}, "limiter") ? ["limiter"] : []),
    ],
    invalid,
  );
  if (!finite(value.master.volume, 0, 1)) fail(invalid);
  if (value.master.limiter !== undefined) validateLimiter(value.master.limiter);
  array(value.origins, 0, 8, invalid);
  array(value.assetRefs, 0, 128, invalid);
  array(value.tracks, 0, 8, invalid);
  const refs = new Map(),
    ids = new Set();
  for (const o of value.origins) {
    record(o, ["id", "schemaVersion", "text"], invalid);
    if (!identifier(o.id) || refs.has(o.id) || typeof o.text !== "string")
      fail(invalid);
    const valid = source(o.text, o.schemaVersion, registry);
    refs.set(o.id, { kind: "event", ...valid });
  }
  if (value.sources !== undefined) {
    array(value.sources, 0, 8, invalid);
    for (const s of value.sources) {
      record(s, ["id", "originId", "text"], invalid);
      if (
        !identifier(s.id) ||
        refs.has(s.id) ||
        !value.origins.some((o) => o.id === s.originId) ||
        typeof s.text !== "string"
      )
        fail(invalid);
      const valid = source(s.text, 4, registry);
      refs.set(s.id, { kind: "event", ...valid });
    }
  }
  for (const a of value.assetRefs) {
    record(
      a,
      [
        "id",
        "kind",
        "sha256",
        "bytes",
        "frames",
        "channels",
        "sampleRate",
        "encoding",
        "recordedBpm",
      ],
      invalid,
    );
    if (
      !identifier(a.id) ||
      refs.has(a.id) ||
      a.kind !== "recording" ||
      !/^[a-f0-9]{64}$/.test(a.sha256) ||
      ![1, 2].includes(a.channels) ||
      !integer(a.sampleRate, 8000, 192000) ||
      !integer(a.frames, 1, a.sampleRate * 32) ||
      a.encoding !== "float32le" ||
      a.bytes !== a.frames * a.channels * 4
    )
      fail(invalid);
    if (a.recordedBpm !== value.timing.bpm) fail("loopTempoLocked");
    refs.set(a.id, a);
  }
  for (const t of value.tracks) {
    record(
      t,
      [
        "id",
        "kind",
        "gain",
        "pan",
        "mute",
        "solo",
        "clips",
        ...(Object.hasOwn(t, "layering") ? ["layering"] : []),
        ...(Object.hasOwn(t, "eq") ? ["eq"] : []),
      ],
      invalid,
    );
    if (
      !identifier(t.id) ||
      ids.has(t.id) ||
      !["event", "recording", "hybrid"].includes(t.kind) ||
      !finite(t.gain, 0, 1) ||
      !finite(t.pan, -1, 1) ||
      typeof t.mute !== "boolean" ||
      typeof t.solo !== "boolean"
    )
      fail(invalid);
    ids.add(t.id);
    if (t.eq !== undefined) validateEQ(t.eq);
    array(t.clips, 0, 32, invalid);
    for (const c of t.clips) {
      record(
        c,
        [
          "id",
          "sourceId",
          "startTick",
          "lengthTicks",
          "offsetFrames",
          "loop",
          ...(Object.hasOwn(c, "phaseAlignment") ? ["phaseAlignment"] : []),
        ],
        invalid,
      );
      const ref = refs.get(c.sourceId);
      if (
        !identifier(c.id) ||
        ids.has(c.id) ||
        !ref ||
        !integer(c.startTick, 0, MAX_EVENT_TICK) ||
        !integer(c.lengthTicks, 1, MAX_EVENT_TICK - c.startTick) ||
        !integer(c.offsetFrames, 0, Number.MAX_SAFE_INTEGER) ||
        typeof c.loop !== "boolean"
      )
        fail(invalid);
      ids.add(c.id);
      phaseAdvance(c, ref, value.clock);
      if (ref.kind === "event" && ref.bpm !== value.timing.bpm)
        fail("loopTempoLocked");
      if (ref.kind === "event") {
        if (
          t.kind === "recording" ||
          c.offsetFrames !== 0 ||
          c.lengthTicks > ref.lengthTicks
        )
          fail(invalid);
      } else if (
        t.kind === "event" ||
        c.offsetFrames >= ref.frames ||
        (!c.loop &&
          c.offsetFrames +
            Math.round(
              (c.lengthTicks * ref.sampleRate * 60) / value.timing.bpm / PPQ,
            ) >
            ref.frames)
      )
        fail(invalid);
    }
    if (t.layering !== undefined) {
      record(t.layering, ["version", "baseClipId", "overdubClipId"], invalid);
      const [base, layer] = t.clips,
        a = refs.get(base?.sourceId),
        b = refs.get(layer?.sourceId);
      if (
        t.layering.version !== 1 ||
        t.kind !== "recording" ||
        t.clips.length !== 2 ||
        t.layering.baseClipId !== base.id ||
        t.layering.overdubClipId !== layer.id ||
        base.sourceId === layer.sourceId ||
        a?.kind !== "recording" ||
        b?.kind !== "recording" ||
        a.frames !== b.frames ||
        a.channels !== b.channels ||
        a.sampleRate !== b.sampleRate ||
        value.clock?.kind !== "fixed-bar" ||
        value.clock.sampleRate !== a.sampleRate ||
        ![1, 2, 4, 8].includes(a.frames / value.clock.framesPerBar) ||
        base.lengthTicks !== layer.lengthTicks ||
        a.frames !==
          (base.lengthTicks / (4 * PPQ)) * value.clock.framesPerBar ||
        t.clips.some(
          (c) => c.startTick !== 0 || c.offsetFrames !== 0 || !c.loop,
        )
      )
        fail("invalidOverdubLayers");
    }
  }
  return frozenCopy({ ...value, title });
}
export function parseLoopProject(text, registry) {
  if (
    typeof text !== "string" ||
    text.length > MAX_LOOP_PROJECT_BYTES ||
    utf8Bytes(text) > MAX_LOOP_PROJECT_BYTES
  )
    fail("projectTooLarge");
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail(invalid);
  }
  return validateLoopProject(value, registry);
}
export function migrateToLoopProject(text, registry) {
  if (
    typeof text !== "string" ||
    text.length > MAX_LOOP_PROJECT_BYTES ||
    utf8Bytes(text) > MAX_LOOP_PROJECT_BYTES
  )
    fail("projectTooLarge");
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    fail(invalid);
  }
  if (raw.schemaVersion === LOOP_SCHEMA_VERSION)
    return validateLoopProject(raw, registry);
  const old = source(text, raw.schemaVersion, registry);
  return validateLoopProject(
    {
      format: "perkusi-project",
      schemaVersion: LOOP_SCHEMA_VERSION,
      mode: "loop-station",
      title: old.title,
      timing: { bpm: old.bpm, meter: [4, 4] },
      master: { volume: 1 },
      origins: [{ id: "origin-1", schemaVersion: raw.schemaVersion, text }],
      assetRefs: [],
      tracks: [
        {
          id: "track-1",
          kind: "event",
          gain: 1,
          pan: 0,
          mute: false,
          solo: false,
          clips: [
            {
              id: "clip-1",
              sourceId: "origin-1",
              startTick: 0,
              lengthTicks: old.lengthTicks,
              offsetFrames: 0,
              loop: false,
            },
          ],
        },
      ],
    },
    registry,
  );
}
