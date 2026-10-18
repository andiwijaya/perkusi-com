// Local V5 starter scores use the existing event/project pipeline and native note recordings.
import { emptyLoopProject, assignSource } from "./model.js";
import { emptyInstrumentTake } from "../project/instrument-take.js";
import { PPQ } from "../project/instrument-project.js";
import { physicalFocus } from "../gamelan/instrument-focus.js";
const drum = (sample, beats, velocity = 0.5) =>
  beats.map((beat) => ({ sample: "ruang-" + sample, beat, velocity }));
const tone = (sample, beat, length, velocity = 0.62) => ({
  sample,
  beat,
  length,
  velocity,
});
export const starterContent = [
  {
    id: "pocket-88",
    bpm: 88,
    key: "E minor (E/G/B only)",
    genre: "hip-hop-inspired pocket",
    name: { id: "Ruang Saku", en: "Pocket Room" },
    description: {
      id: "Bass pendek, snare di dua dan empat, gitar dengan ruang antarfrasa.",
      en: "Short bass, backbeat snare, and a sparse guitar response.",
    },
    lanes: [
      {
        name: "Ruang drums",
        bank: "studio-ruang",
        notes: [
          ...drum("kick", [0, 2.5, 4, 6.5], 0.64),
          ...drum("snare", [1, 3, 5, 7], 0.56),
          ...drum("closed-hat", [0, 0.56, 2, 2.56, 4, 4.56, 6, 6.56], 0.28),
        ],
      },
      {
        name: "Picked bass",
        bank: "freepats-bass-yr",
        notes: [
          tone("bass-e1", 0, 0.7),
          tone("bass-g1", 2.5, 0.4, 0.48),
          tone("bass-e1", 4, 0.9),
          tone("bass-b1", 6.5, 0.4, 0.5),
        ],
      },
      {
        name: "Classical guitar",
        bank: "freepats-classical-guitar",
        notes: [
          tone("guitar-e3", 0.5, 0.45, 0.48),
          tone("guitar-g3", 2.75, 0.35, 0.42),
          tone("guitar-b2", 4.5, 0.6, 0.48),
          tone("guitar-e3", 7, 0.55, 0.5),
        ],
      },
    ],
  },
  {
    id: "offbeat-112",
    bpm: 112,
    key: "E minor (E/G/B only)",
    genre: "dub-inspired offbeat",
    name: { id: "Ruang Sela", en: "Between Beats" },
    description: {
      id: "Akor petik di sela ketukan, bass panjang-pendek, drum renggang.",
      en: "Offbeat plucked chords, long-short bass, and an open drum groove.",
    },
    lanes: [
      {
        name: "Ruang drums",
        bank: "studio-ruang",
        notes: [
          ...drum("kick", [2, 6], 0.62),
          ...drum("snare", [2, 6], 0.51),
          ...drum("closed-hat", [0.5, 2.5, 4.5, 6.5], 0.32),
        ],
      },
      {
        name: "Picked bass",
        bank: "freepats-bass-yr",
        notes: [
          tone("bass-e1", 0, 1.25),
          tone("bass-g1", 3.25, 0.4),
          tone("bass-e1", 4, 1.25),
          tone("bass-b1", 7.25, 0.4),
        ],
      },
      {
        name: "Classical guitar offbeats",
        bank: "freepats-classical-guitar",
        notes: [1.5, 3.5, 5.5, 7.5].flatMap((beat) =>
          ["guitar-e3", "guitar-g3"].map((sample, i) =>
            tone(sample, beat + i * 0.025, 0.22, 0.41),
          ),
        ),
      },
    ],
  },
  {
    id: "nusantara-96",
    bpm: 96,
    key: "E minor (E/G/B); unpitched Ciblon strokes",
    genre: "original Nusantara fusion Preview",
    name: { id: "Dialog Ciblon", en: "Ciblon Dialogue" },
    description: {
      id: "Dua stroke Ciblon saling menjawab bass dan gitar. Komposisi fusion baru; bukan gendhing tradisional.",
      en: "Two Ciblon strokes answer bass and guitar. An original fusion composition, not a traditional gendhing.",
    },
    lanes: [
      {
        name: "Ruang pulse",
        bank: "studio-ruang",
        notes: [...drum("kick", [0, 4], 0.4), ...drum("shaker", [1, 5], 0.2)],
      },
      {
        name: "Picked bass",
        bank: "freepats-bass-yr",
        notes: [
          tone("bass-e1", 0, 0.8, 0.52),
          tone("bass-g1", 2.5, 0.4, 0.45),
          tone("bass-e1", 4, 1, 0.52),
          tone("bass-b1", 6.5, 0.5, 0.46),
        ],
      },
      {
        name: "Classical guitar response",
        bank: "freepats-classical-guitar",
        notes: [
          tone("guitar-e3", 1, 0.7, 0.43),
          tone("guitar-g3", 3, 0.4, 0.4),
          tone("guitar-b2", 5, 0.5, 0.43),
        ],
      },
      {
        name: "Ciblon Preview",
        bank: "ciblon-native",
        notes: [
          ...[0, 2.75, 4, 7].map((beat) => ({
            sample: 0,
            beat,
            velocity: 0.45,
          })),
          ...[1.5, 3.5, 5.5, 7.5].map((beat) => ({
            sample: 1,
            beat,
            velocity: 0.4,
          })),
        ],
      },
    ],
  },
];
export function createStarter(id, registry) {
  const recipe = starterContent.find((s) => s.id === id);
  if (!recipe) throw Error("unknownStarter");
  let project = structuredClone(emptyLoopProject(registry));
  project.title = recipe.name.id;
  project.timing.bpm = recipe.bpm;
  project.master.volume = 1;
  for (const [index, lane] of recipe.lanes.entries()) {
    const ciblon =
      lane.bank === "ciblon-native"
        ? physicalFocus(registry, "kendhang-ciblon", "slendro").slice(0, 2)
        : null;
    const bank = ciblon
      ? ciblon[0].bank
      : registry.bank(
          lane.bank,
          lane.bank.startsWith("freepats-") ? "candidate-1.0.0" : "1.0.0",
        );
    if (!bank || ciblon?.length < 2) throw Error("starterSourceMissing");
    const take = structuredClone(emptyInstrumentTake(registry));
    take.composition.title = lane.name;
    take.composition.timing.bpm = recipe.bpm;
    take.composition.master.volume = 0.75;
    take.clock.lengthTicks = 8 * PPQ;
    take.banks = [{ id: bank.id, version: bank.version }];
    take.events = [];
    for (const note of lane.notes) {
      const sample = ciblon ? ciblon[note.sample].descriptor.id : note.sample;
      registry.sample(bank.id, bank.version, sample);
      const e = {
        id: "event-" + take.events.length,
        tick: Math.round(note.beat * PPQ),
        action: "strike",
        velocity: note.velocity,
        bankId: bank.id,
        sampleId: sample,
      };
      take.events.push(e);
      if (note.length !== undefined)
        take.events.push({
          ...e,
          id: "event-" + take.events.length,
          tick: Math.round((note.beat + note.length) * PPQ),
          action: "damp",
          velocity: 0,
        });
    }
    project = assignSource(
      project,
      registry,
      project.tracks[index].id,
      JSON.stringify(take),
      { loop: true },
    );
  }
  return project;
}
