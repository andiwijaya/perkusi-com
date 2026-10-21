import { newComposition } from "./composition-model.js";
import { emptyPattern } from "./studio-model.js";
import { migrateToInstrumentProject, PPQ } from "./instrument-project.js";
import { migrateLegacyMetadata } from "./canonical-metadata.js";
import { startSongChain } from "./canonical-authoring.js";

// Original authored score. This opt-in local candidate is not a default route,
// autoplay action, user recording or replacement for a rejected QA fixture.
export const FLAGSHIP_DEMO_VERSION = "evening-conversation-2";
export function flagshipDemoLegacy(registry, locale = "id") {
  const composition = newComposition(
    locale === "en" ? "Evening Conversation" : "Percakapan Senja",
  );
  composition.timing = { bpm: 96, meter: [4, 4], swing: 0, quantize: true };
  // Use the existing product default master, matching the accepted Beatbox
  // reference. The quiet 0.17 technical draft remains separate QA evidence;
  // production calibration, source PCM and admission limits are unchanged.
  composition.master.volume = 0.65;
  const levels = { kick: 0.65, snare: 0.48, "closed-hat": 0.26, shaker: 0.22 };
  for (const t of composition.tracks) {
    t.volume = levels[t.role] ?? 0.45;
    t.pan = t.role === "closed-hat" ? 0.1 : t.role === "shaker" ? -0.12 : 0;
  }
  const pattern = (id, hits) => {
    const p = {
      ...emptyPattern(id.toLowerCase(), id),
      notes: Array(16).fill(null),
    };
    for (const [role, values] of Object.entries(hits))
      for (const [step, velocity] of values) p.steps[role][step] = velocity;
    return p;
  };
  const hats = [
    [0, 0.34],
    [2, 0.25],
    [4, 0.31],
    [6, 0.24],
    [8, 0.35],
    [10, 0.25],
    [12, 0.3],
    [14, 0.23],
  ];
  composition.patterns = [
    pattern("A", {
      kick: [
        [0, 0.78],
        [8, 0.67],
      ],
      snare: [
        [4, 0.61],
        [12, 0.67],
      ],
      "closed-hat": hats,
    }),
    pattern("B", {
      kick: [[0, 0.74]],
      snare: [
        [4, 0.58],
        [12, 0.64],
      ],
      "closed-hat": hats.slice(0, -1),
      shaker: [[15, 0.28]],
    }),
    pattern("A2", {
      kick: [
        [0, 0.78],
        [8, 0.66],
      ],
      snare: [
        [4, 0.6],
        [12, 0.66],
      ],
      "closed-hat": [...hats, [11, 0.14]],
    }),
    pattern("C", { kick: [[0, 0.64]] }),
  ];
  composition.activePattern = "a";
  composition.chain = ["a", "b", "a2", "c"];
  const project = structuredClone(
    migrateToInstrumentProject(JSON.stringify(composition), registry),
  );
  project.clock.lengthTicks = 16 * PPQ;
  project.banks = [
    { id: "freepats-bass-yr", version: "candidate-1.0.0" },
    { id: "freepats-classical-guitar", version: "candidate-1.0.0" },
    { id: "cdm-pelog", version: "candidate-1.0.0" },
  ];
  const event = (id, beat, bankId, sampleId, velocity) => ({
    id,
    tick: beat * PPQ,
    action: "strike",
    bankId,
    sampleId,
    velocity,
  });
  project.events = [
    event("bass-opening", 0, "freepats-bass-yr", "bass-e1", 0.7),
    event("guitar-answer", 2, "freepats-classical-guitar", "guitar-e3", 0.57),
    event("saron-call", 4.5, "cdm-pelog", "fs-261720", 0.56),
    event("bass-response", 6, "freepats-bass-yr", "bass-b1", 0.59),
    event(
      "guitar-response",
      6.5,
      "freepats-classical-guitar",
      "guitar-b2",
      0.52,
    ),
    event("bass-return", 8, "freepats-bass-yr", "bass-e1", 0.66),
    event("slenthem-answer", 8.5, "cdm-pelog", "fs-261745", 0.53),
    event("guitar-return", 10, "freepats-classical-guitar", "guitar-e3", 0.53),
    event("bass-ending", 12, "freepats-bass-yr", "bass-e1", 0.63),
    event("guitar-ending", 12, "freepats-classical-guitar", "guitar-e3", 0.55),
    event("saron-ending", 12, "cdm-pelog", "fs-261720", 0.51),
  ];
  project.instrumentMix = [
    {
      bankId: "freepats-bass-yr",
      instrumentId: "electric-bass",
      volume: 0.55,
      pan: 0,
      mute: false,
      solo: false,
    },
    {
      bankId: "freepats-classical-guitar",
      instrumentId: "classical-guitar",
      volume: 0.4,
      pan: 0.12,
      mute: false,
      solo: false,
    },
    {
      bankId: "cdm-pelog",
      instrumentId: "saron-barung",
      volume: 0.32,
      pan: -0.1,
      mute: false,
      solo: false,
    },
    {
      bankId: "cdm-pelog",
      instrumentId: "slenthem",
      volume: 0.4,
      pan: 0.05,
      mute: false,
      solo: false,
    },
  ];
  // Consent to a contemporary fusion of intact recorded tunings; this does not
  // assert that pelog degrees equal Western note names or authenticate a set.
  project.tuningConsent = true;
  return project;
}
export async function createFlagshipDemo(registry, locale = "id") {
  const legacy = flagshipDemoLegacy(registry, locale),
    migrated = await migrateLegacyMetadata(JSON.stringify(legacy), {
      registry,
    });
  const canonical = structuredClone(migrated.project);
  // Authored demo starts ready to edit; original imported bytes remain untouched.
  startSongChain(canonical, 4);
  return { legacy, canonical, originals: migrated.originals };
}
