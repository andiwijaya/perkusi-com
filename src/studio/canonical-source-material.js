import { newComposition } from "../project/composition-model.js";
import {
  migrateToInstrumentProject,
  PPQ,
} from "../project/instrument-project.js";
import { migrateLegacyMetadata } from "../project/canonical-metadata.js";
import { createCanonicalBundle } from "../project/canonical-package.js";
import { physicalFocus, instrumentNames } from "../gamelan/instrument-focus.js";
import { fail } from "../project/instrument-contract.js";
import { recordSource } from "../loop-station/record-sources.js";

export async function createCanonicalRackMaterial({
  project,
  registry,
  memory,
  instrument,
  sampleId,
}) {
  const source = recordSource(instrument);
  if (!source.sampleIds.includes(sampleId)) fail("unknownInstrumentSample");
  const note = registry.sample(source.bankId, source.bankVersion, sampleId),
    composition = newComposition(instrument + " / " + note.pitchId);
  composition.timing.bpm = project.timing.bpm;
  const native = structuredClone(
    migrateToInstrumentProject(JSON.stringify(composition), registry),
  );
  native.banks = [{ id: source.bankId, version: source.bankVersion }];
  native.clock.lengthTicks = Math.max(
    4 * PPQ,
    project.sections.find((s) => s.id === project.activeSection).lengthTicks,
  );
  native.events = [
    {
      id: "first-strike",
      tick: 0,
      action: "strike",
      velocity: 0.65,
      bankId: source.bankId,
      sampleId,
    },
  ];
  const migrated = await migrateLegacyMetadata(JSON.stringify(native), {
      registry,
    }),
    working = structuredClone(migrated.project);
  working.timing.clock = structuredClone(project.timing.clock);
  return createCanonicalBundle(working, {
    registry,
    memory,
    originals: migrated.originals,
  });
}

// Author new material from registered, original sample identities. Existing
// sources, PCM, mix levels and natural tails are never transformed here.
export async function createCanonicalGamelanMaterial({
  project,
  registry,
  memory,
  instrument = "saron-barung",
  laras = "pelog",
}) {
  const notes = physicalFocus(registry, instrument, laras),
    note = notes[0];
  if (!note) fail("unknownInstrumentSample");
  const title = (instrumentNames[instrument] ?? instrument) + " · " + laras,
    composition = newComposition(title);
  composition.timing.bpm = project.timing.bpm;
  const native = structuredClone(
      migrateToInstrumentProject(JSON.stringify(composition), registry),
    ),
    section = project.sections.find((s) => s.id === project.activeSection);
  native.banks = [{ id: note.bank.id, version: note.bank.version }];
  native.clock.lengthTicks = Math.max(4 * PPQ, section.lengthTicks);
  native.events = [
    {
      id: "first-strike",
      tick: 0,
      action: "strike",
      velocity: 0.65,
      bankId: note.bank.id,
      sampleId: note.descriptor.id,
    },
  ];
  const migrated = await migrateLegacyMetadata(JSON.stringify(native), {
    registry,
  });
  const working = structuredClone(migrated.project);
  // This material is authored on the current song grid, not imported with a
  // different recorded period. The generated original file remains untouched.
  working.timing.clock = structuredClone(project.timing.clock);
  return createCanonicalBundle(working, {
    registry,
    memory,
    originals: migrated.originals,
  });
}
