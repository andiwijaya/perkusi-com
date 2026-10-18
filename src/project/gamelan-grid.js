import {
  validateInstrumentProject,
  PPQ,
  MAX_EVENT_TICK,
} from "./instrument-project.js";
import { finite, integer, fail } from "./instrument-contract.js";

export const GAMELAN_BAR_TICKS = 4 * PPQ;
export const GAMELAN_STEP_TICKS = PPQ / 4;
export const gamelanBarCount = (project) =>
  Math.ceil(project.clock.lengthTicks / GAMELAN_BAR_TICKS);

// Grid edits affect one exact bank/sample/action/tick, never nearby recorded hits.
export function toggleGamelanStep(
  project,
  registry,
  { bankId, version, sampleId, bar, step, action = "strike", velocity = 0.65 },
) {
  const valid = validateInstrumentProject(project, registry);
  if (
    !integer(bar, 0, MAX_EVENT_TICK / GAMELAN_BAR_TICKS - 1) ||
    !integer(step, 0, 15) ||
    !["strike", "damp"].includes(action) ||
    (action === "strike" && !finite(velocity, Number.MIN_VALUE, 1))
  )
    fail("invalidStudioEdit");
  const bank = registry.bank(bankId, version);
  registry.sample(bankId, version, sampleId);
  const oldBank = valid.banks.find((b) => b.id === bankId);
  if (oldBank && oldBank.version !== version) fail("invalidStudioEdit");
  const tick = bar * GAMELAN_BAR_TICKS + step * GAMELAN_STEP_TICKS;
  const next = structuredClone(valid),
    index = next.events.findIndex(
      (e) =>
        e.bankId === bankId &&
        e.sampleId === sampleId &&
        e.action === action &&
        e.tick === tick,
    );
  if (index >= 0) next.events.splice(index, 1);
  else {
    if (next.events.length >= 4096) fail("eventLimit");
    if (!oldBank) next.banks.push({ id: bank.id, version: bank.version });
    let n = 1;
    const ids = new Set(next.events.map((e) => e.id));
    while (ids.has("grid-" + n)) n++;
    next.events.push({
      id: "grid-" + n,
      tick,
      action,
      bankId,
      sampleId,
      velocity: action === "damp" ? 0 : velocity,
    });
    next.clock.lengthTicks = Math.max(
      next.clock.lengthTicks,
      (bar + 1) * GAMELAN_BAR_TICKS,
    );
  }
  return validateInstrumentProject(next, registry);
}

export function appendGamelanBar(project, registry) {
  const valid = validateInstrumentProject(project, registry),
    next = structuredClone(valid);
  const length = (gamelanBarCount(valid) + 1) * GAMELAN_BAR_TICKS;
  if (length > MAX_EVENT_TICK) fail("invalidStudioEdit");
  next.clock.lengthTicks = length;
  return validateInstrumentProject(next, registry);
}
