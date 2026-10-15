import { parseProject, validateProject, MAX_PROJECT_BYTES } from "./schema.js";
import { compositionRegistry } from "./studio-registry.js";
import { toBeatbox } from "./composition-model.js";
import { InstrumentRegistry } from "../audio/instrument-registry.js";
import {
  record,
  array,
  dataTree,
  integer,
  identifier,
  version,
  finite,
  utf8Bytes,
  frozenCopy,
  fail,
} from "./instrument-contract.js";

export const PPQ = 960000;
export const MAX_EVENT_TICK = 491520000;
export const MAX_INSTRUMENT_PROJECT_BYTES = 1024 * 1024;
const invalid = "invalidInstrumentProject";
const keys = [
  "format",
  "schemaVersion",
  "mode",
  "composition",
  "origin",
  "clock",
  "banks",
  "events",
];
const eventKeys = ["id", "tick", "action", "bankId", "sampleId", "velocity"];
const issuedProjects = new WeakSet();
export function orderedEvents(events) {
  return [...events].sort(
    (a, b) =>
      a.tick - b.tick ||
      (a.action === b.action ? 0 : a.action === "damp" ? -1 : 1) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
export function eventFrame(tick, bpm, sampleRate, originFrame = 0) {
  if (
    !integer(tick, 0, MAX_EVENT_TICK) ||
    !finite(bpm, 60, 180) ||
    !integer(sampleRate, 8000, 192000) ||
    !integer(originFrame, 0, Number.MAX_SAFE_INTEGER)
  )
    fail("invalidEventClock");
  const delta = Math.round((tick * sampleRate * 60) / (bpm * PPQ));
  if (!Number.isSafeInteger(delta + originFrame)) fail("invalidEventClock");
  return delta + originFrame;
}
export function validateInstrumentProject(value, registry) {
  // No getters run, and byte admission precedes normalization/copying.
  dataTree(value, invalid);
  record(
    value,
    [
      ...keys,
      ...["instrumentMix", "tuningConsent"].filter((k) =>
        Object.hasOwn(value, k),
      ),
    ],
    invalid,
  );
  if (utf8Bytes(JSON.stringify(value) + "\n") > MAX_INSTRUMENT_PROJECT_BYTES)
    fail("projectTooLarge");
  if (
    !(registry instanceof InstrumentRegistry) ||
    value.format !== "perkusi-project" ||
    value.schemaVersion !== 4 ||
    value.mode !== "instrument-events"
  )
    fail(invalid);
  if (value.composition?.schemaVersion !== 3) fail(invalid);
  const composition = validateProject(value.composition, compositionRegistry);
  record(value.origin, ["schemaVersion", "text"], invalid);
  if (
    !integer(value.origin.schemaVersion, 0, 3) ||
    typeof value.origin.text !== "string"
  )
    fail(invalid);
  // The legacy parser enforces its unchanged 64KiB bound and complete grammar.
  parseProject(value.origin.text, compositionRegistry);
  if (
    JSON.parse(value.origin.text).schemaVersion !== value.origin.schemaVersion
  )
    fail(invalid);
  record(value.clock, ["unit", "ppq", "lengthTicks"], invalid);
  if (
    value.clock.unit !== "tick" ||
    value.clock.ppq !== PPQ ||
    !integer(value.clock.lengthTicks, 1, MAX_EVENT_TICK)
  )
    fail(invalid);
  array(value.banks, 0, 8, invalid);
  array(value.events, 0, 4096, invalid);
  const banks = new Map();
  for (const ref of value.banks) {
    record(ref, ["id", "version"], invalid);
    if (!identifier(ref.id) || !version(ref.version) || banks.has(ref.id))
      fail(invalid);
    registry.bank(ref.id, ref.version);
    banks.set(ref.id, ref.version);
  }
  if (
    Object.hasOwn(value, "tuningConsent") &&
    typeof value.tuningConsent !== "boolean"
  )
    fail(invalid);
  if (Object.hasOwn(value, "instrumentMix")) {
    array(value.instrumentMix, 0, 96, invalid);
    const groups = new Set();
    for (const m of value.instrumentMix) {
      record(
        m,
        ["bankId", "instrumentId", "volume", "pan", "mute", "solo"],
        invalid,
      );
      const id = m.bankId + "/" + m.instrumentId;
      if (
        !banks.has(m.bankId) ||
        !identifier(m.instrumentId) ||
        groups.has(id) ||
        !registry
          .bank(m.bankId, banks.get(m.bankId))
          .samples.some((s) => s.instrumentId === m.instrumentId) ||
        !finite(m.volume, 0, 1) ||
        !finite(m.pan, -1, 1) ||
        typeof m.mute !== "boolean" ||
        typeof m.solo !== "boolean"
      )
        fail(invalid);
      groups.add(id);
    }
  }
  const ids = new Set(),
    collisions = new Set();
  for (const e of value.events) {
    record(e, eventKeys, invalid);
    if (
      ![e.id, e.bankId, e.sampleId].every(identifier) ||
      ids.has(e.id) ||
      !integer(e.tick, 0, value.clock.lengthTicks - 1) ||
      !["strike", "damp"].includes(e.action) ||
      (e.action === "strike"
        ? !finite(e.velocity, Number.MIN_VALUE, 1)
        : e.velocity !== 0 || Object.is(e.velocity, -0)) ||
      !banks.has(e.bankId)
    )
      fail(invalid);
    registry.sample(e.bankId, banks.get(e.bankId), e.sampleId);
    const collision = [e.tick, e.bankId, e.sampleId, e.action].join("|");
    if (collisions.has(collision)) fail(invalid);
    ids.add(e.id);
    collisions.add(collision);
  }
  const result = { ...value, composition, events: orderedEvents(value.events) };
  if (utf8Bytes(JSON.stringify(result) + "\n") > MAX_INSTRUMENT_PROJECT_BYTES)
    fail("projectTooLarge");
  const frozen = frozenCopy(result);
  issuedProjects.add(frozen);
  return frozen;
}
export function parseInstrumentProject(text, registry) {
  if (
    typeof text !== "string" ||
    utf8Bytes(text) > MAX_INSTRUMENT_PROJECT_BYTES
  )
    fail("projectTooLarge");
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail(invalid);
  }
  return validateInstrumentProject(value, registry);
}
export function migrateToInstrumentProject(text, registry) {
  if (typeof text !== "string" || utf8Bytes(text) > MAX_PROJECT_BYTES)
    fail("projectTooLarge");
  const composition = parseProject(text, compositionRegistry),
    source = JSON.parse(text);
  if (![0, 1, 2, 3].includes(source.schemaVersion)) fail(invalid);
  return validateInstrumentProject(
    {
      format: "perkusi-project",
      schemaVersion: 4,
      mode: "instrument-events",
      composition,
      origin: { schemaVersion: source.schemaVersion, text },
      clock: {
        unit: "tick",
        ppq: PPQ,
        lengthTicks: composition.chain.length * 4 * PPQ,
      },
      banks: [],
      events: [],
    },
    registry,
  );
}
export function deriveLegacyProject(
  value,
  registry,
  { derived = false, target = "composition" } = {},
) {
  const valid = validateInstrumentProject(value, registry);
  if (
    typeof derived !== "boolean" ||
    !["composition", "beatbox"].includes(target)
  )
    fail(invalid);
  if (valid.events.length && !derived) fail("needsConversion");
  const project =
    target === "beatbox"
      ? toBeatbox(valid.composition, derived)
      : valid.composition;
  // Retain all new events/historical text for derived reverse, without storage side effects.
  return Object.freeze({
    project: frozenCopy(project),
    retainedOriginal: issuedProjects.has(value) ? value : valid,
  });
}
