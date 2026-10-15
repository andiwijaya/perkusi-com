import { newComposition } from "./composition-model.js";
import {
  migrateToInstrumentProject,
  validateInstrumentProject,
  orderedEvents,
  eventFrame,
  PPQ,
} from "./instrument-project.js";
import { fail } from "./instrument-contract.js";
import { DAMP_SECONDS } from "../audio/instrument-voice.js";
import {
  groupMix,
  legacyAudible,
  assertTuningConsent,
} from "./instrument-mix.js";

export function emptyInstrumentTake(registry) {
  const composition = newComposition("Rekaman instrumen");
  composition.timing.bpm = 96;
  return migrateToInstrumentProject(JSON.stringify(composition), registry);
}
export function assertEmptyLegacyLayer(project) {
  const p = project.composition;
  if (
    p.clips.some((c) => c.enabled) ||
    p.patterns.some(
      (pattern) =>
        pattern.notes.some(Boolean) ||
        Object.values(pattern.steps).some((steps) => steps.some(Boolean)),
    )
  )
    fail("legacyLayerUnsupported");
}
export function takePlan(value, registry, rate, { includeMuted = false } = {}) {
  if (typeof includeMuted !== "boolean") fail("invalidInstrumentProject");
  const project = validateInstrumentProject(value, registry);
  assertTuningConsent(project, registry);
  const refs = new Map(project.banks.map((b) => [b.id, b.version])),
    active = new Map(),
    voices = [];
  for (const event of orderedEvents(project.events)) {
    const key = event.bankId + "/" + event.sampleId,
      frame = eventFrame(event.tick, project.composition.timing.bpm, rate);
    if (event.action === "damp") {
      for (const v of active.get(key) ?? [])
        if (v.dampFrame === null) {
          v.dampFrame = frame;
          v.endFrame = Math.min(
            v.endFrame,
            frame + Math.round(DAMP_SECONDS * rate),
          );
        }
      active.delete(key);
    } else {
      const descriptor = registry.sample(
        event.bankId,
        refs.get(event.bankId),
        event.sampleId,
      );
      const v = {
        ...event,
        key,
        version: refs.get(event.bankId),
        descriptor,
        startFrame: frame,
        naturalEndFrame: frame + descriptor.frames,
        endFrame: frame + descriptor.frames,
        dampFrame: null,
        mix: groupMix(project, registry, event.bankId, descriptor.instrumentId),
      };
      voices.push(v);
      const group = active.get(key) ?? [];
      group.push(v);
      active.set(key, group);
    }
  }
  const sounding = voices.filter((v) => v.mix.volume > 0);
  if (
    !sounding.length &&
    !legacyAudible(project.composition) &&
    !(includeMuted && voices.length)
  )
    fail("emptyMix");
  const planned = includeMuted ? voices : sounding;
  return {
    project,
    voices: planned,
    rate,
    frames: Math.max(
      eventFrame(
        project.clock.lengthTicks,
        project.composition.timing.bpm,
        rate,
      ),
      legacyAudible(project.composition)
        ? Math.round(
            ((project.composition.chain.length * 4 * 60) /
              project.composition.timing.bpm) *
              rate,
          )
        : 0,
      ...planned.map((v) => v.endFrame),
    ),
  };
}
export function appendInstrumentEvent(value, registry, event) {
  if (value.events.length >= 4096) fail("eventLimit");
  const next = structuredClone(value),
    bank = registry.bank(event.bankId, event.version);
  if (!next.banks.some((b) => b.id === bank.id))
    next.banks.push({ id: bank.id, version: bank.version });
  let tick = event.tick;
  while (
    next.events.some(
      (e) =>
        e.tick === tick &&
        e.bankId === event.bankId &&
        e.sampleId === event.sampleId &&
        e.action === event.action,
    )
  )
    tick++;
  next.clock.lengthTicks = Math.max(
    next.clock.lengthTicks,
    Math.ceil((tick + 1) / (4 * PPQ)) * 4 * PPQ,
  );
  next.events.push({
    id: event.id,
    tick,
    bankId: event.bankId,
    sampleId: event.sampleId,
    action: event.action,
    velocity: event.velocity,
  });
  return validateInstrumentProject(next, registry);
}
