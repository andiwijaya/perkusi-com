import { emptyLoopProject, assignSource } from "./model.js";
import { emptyInstrumentTake } from "../project/instrument-take.js";
import { physicalFocus, instrumentNames } from "../gamelan/instrument-focus.js";
import { PPQ } from "../project/instrument-project.js";
export function eightTrackDemo(registry) {
  let project = structuredClone(emptyLoopProject(registry));
  project.title = "Ruang delapan lapis";
  const lanes = [
    ["kendhang-ciblon", 0, [0, 2], null],
    ["kendhang-ciblon", 1, [1, 3], null],
    ["saron-barung", 0, [0, 4], 0.7],
    ["bonang-barung", 0, [1.5, 5.5], 0.5],
    ["demung", 0, [0], 0.7],
    ["peking", 1, [3.5], 0.5],
    ["kethuk", 0, [2, 6], null],
    ["gong-ageng", 0, [4], null],
  ];
  for (let i = 0; i < lanes.length; i++) {
    const [instrument, index, beats, damp] = lanes[i],
      note = physicalFocus(registry, instrument, "pelog")[index],
      p = structuredClone(emptyInstrumentTake(registry));
    p.composition.title = instrumentNames[instrument] + " " + (i + 1);
    p.composition.master.volume = 0.75;
    p.clock.lengthTicks = 8 * PPQ;
    p.banks = [{ id: note.bank.id, version: note.bank.version }];
    p.events = [];
    for (const beat of beats) {
      const e = {
        id: "event-" + p.events.length,
        tick: Math.round(beat * PPQ),
        action: "strike",
        velocity: 0.4,
        bankId: note.bank.id,
        sampleId: note.descriptor.id,
      };
      p.events.push(e);
      if (damp !== null)
        p.events.push({
          ...e,
          id: "event-" + p.events.length,
          tick: Math.round((beat + damp) * PPQ),
          action: "damp",
          velocity: 0,
        });
    }
    project = assignSource(
      project,
      registry,
      project.tracks[i].id,
      JSON.stringify(p),
    );
  }
  return project;
}
