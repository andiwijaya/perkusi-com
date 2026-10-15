import {
  validateInstrumentProject,
  PPQ,
  MAX_EVENT_TICK,
} from "./instrument-project.js";
import { ProjectHistory } from "./studio-model.js";
import { fail, finite, integer, utf8Bytes } from "./instrument-contract.js";

// An event extension of Studio's existing validated history, never a schema3 flatten.
export class InstrumentStudioBridge {
  #registry;
  #history;
  #commit;
  constructor(project, registry, commit) {
    this.#registry = registry;
    this.#commit = commit;
    this.replace(project);
  }
  #validate = (project) => {
    const valid = validateInstrumentProject(project, this.#registry);
    return valid;
  };
  replace(project) {
    this.#history = new ProjectHistory(project, this.#validate, 16);
  }
  get project() {
    return this.#history.current;
  }
  get canUndo() {
    return !!this.#history.past.length;
  }
  get canRedo() {
    return !!this.#history.future.length;
  }
  #transaction(change) {
    const trial = new ProjectHistory(this.project, this.#validate, 16);
    trial.past = [...this.#history.past];
    trial.future = [...this.#history.future];
    if (!change(trial)) return false;
    const bytes = [trial.current, ...trial.past, ...trial.future].reduce(
      (n, p) => n + utf8Bytes(JSON.stringify(p)),
      0,
    );
    if (bytes > 2 * 1024 * 1024) fail("studioHistoryLimit");
    // Failed session admission leaves both the source and undo/redo unchanged.
    this.#commit(trial.current);
    this.#history = trial;
    return true;
  }
  editEvent(id, { tick, velocity }) {
    if (!integer(tick, 0, MAX_EVENT_TICK - 1)) fail("invalidStudioEdit");
    return this.#transaction((h) =>
      h.edit((project) => {
        const event = project.events.find((e) => e.id === id);
        if (
          !event ||
          (event.action === "strike"
            ? !finite(velocity, Number.MIN_VALUE, 1)
            : velocity !== 0)
        )
          fail("invalidStudioEdit");
        event.tick = tick;
        event.velocity = velocity;
        project.clock.lengthTicks = Math.max(
          project.clock.lengthTicks,
          Math.ceil((tick + 1) / (4 * PPQ)) * 4 * PPQ,
        );
      }),
    );
  }
  deleteEvent(id) {
    return this.#transaction((h) =>
      h.edit((project) => {
        const index = project.events.findIndex((e) => e.id === id);
        if (index < 0) fail("invalidStudioEdit");
        project.events.splice(index, 1);
      }),
    );
  }
  editComposition(change) {
    return this.#transaction((h) =>
      h.edit((project) => {
        change(project.composition);
        project.clock.lengthTicks = Math.max(
          project.clock.lengthTicks,
          project.composition.chain.length * 4 * PPQ,
        );
      }),
    );
  }
  editGroup(group) {
    return this.#transaction((h) =>
      h.edit((project) => {
        project.instrumentMix ??= [];
        const old = project.instrumentMix.find(
          (m) =>
            m.bankId === group.bankId && m.instrumentId === group.instrumentId,
        );
        if (old) Object.assign(old, group);
        else project.instrumentMix.push(group);
      }),
    );
  }
  acknowledgeTuning(value) {
    return this.#transaction((h) =>
      h.edit((p) => {
        p.tuningConsent = value;
      }),
    );
  }
  loadProject(value) {
    const valid = this.#validate(value);
    return this.#transaction((h) =>
      h.edit((p) => {
        for (const key of Object.keys(p)) delete p[key];
        Object.assign(p, structuredClone(valid));
      }),
    );
  }
  undo() {
    return this.#transaction((h) => h.undo());
  }
  redo() {
    return this.#transaction((h) => h.redo());
  }
  toFocus() {
    return this.#validate(this.project);
  }
  toJSON() {
    return JSON.stringify(this.project, null, 2) + "\n";
  }
}
