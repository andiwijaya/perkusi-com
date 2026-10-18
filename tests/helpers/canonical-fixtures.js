import catalog from "../../internal/instrument-focus/registry-48000.json" with { type: "json" };
import { InstrumentRegistry } from "../../src/audio/instrument-registry.js";
import { originalRegistry } from "../../src/project/original-registry.js";
import { migrateProject } from "../../src/project/schema.js";
import {
  newStudioProject,
  emptyPattern,
} from "../../src/project/studio-model.js";
import { compositionDemo } from "../../src/project/composition-model.js";
import {
  migrateToInstrumentProject,
  PPQ,
} from "../../src/project/instrument-project.js";
import { physicalFocus } from "../../src/gamelan/instrument-focus.js";
import {
  emptyLoopProject,
  assignSource,
} from "../../src/loop-station/model.js";
import {
  adoptRecording,
  digest,
} from "../../src/loop-station/recording-data.js";
import { adoptOverdub, overdubBase } from "../../src/loop-station/overdub.js";
import { alignRecordedClip } from "../../src/loop-station/phase-alignment.js";

export const canonicalFixtureRegistry = new InstrumentRegistry(catalog.banks);
export function fixturePCM() {
  return [0, 1].map((layer) =>
    Float32Array.from({ length: 240000 }, (_, i) =>
      i === 0 ? -0 : layer ? 0.03 * Math.cos(i / 31) : 0.05 * Math.sin(i / 19),
    ),
  );
}
export async function legacyContractFixtures() {
  const registry = canonicalFixtureRegistry;
  const v0 = {
    format: "perkusi-project",
    schemaVersion: 0,
    title: "Asli — irama 0",
    packId: originalRegistry.packId,
    packVersion: originalRegistry.version,
    bpm: 96,
    volume: 0.17,
    layers: Object.fromEntries(
      originalRegistry.roleOrder.map((r, i) => [
        r,
        { enabled: i % 2 === 0, variant: (i % 2) + 1 },
      ]),
    ),
    exportBars: 4,
  };
  const v1 = structuredClone(migrateProject(v0, originalRegistry));
  v1.title = "Master nol";
  v1.master.volume = 0;
  const v2 = newStudioProject("A dan B");
  v2.master.volume = 0.75;
  v2.timing.swing = 0.17;
  v2.timing.quantize = false;
  v2.patterns = [emptyPattern("p1", "A"), emptyPattern("p2", "B")];
  v2.patterns[0].steps.kick[1] = 0.75;
  v2.patterns[1].steps.snare[9] = 0.4;
  v2.chain = ["p1", "p2", "p1", "p2"];
  v2.activePattern = "p2";
  const v3 = compositionDemo("fusion");
  v3.master.volume = 0.17;
  v3.tracks[0].pan = -0.4;
  v3.instrument.pan = 0.3;
  v3.chain = ["p1", "p2", "p1", "p2"];
  v3.activePattern = "p2";
  v3.clips[0].volume = 0.7;
  v3.clips[1].pan = -0.2;
  const v4 = structuredClone(
    migrateToInstrumentProject(JSON.stringify(v3), registry),
  );
  v4.clock.lengthTicks = 16 * PPQ;
  v4.tuningConsent = true;
  const note = physicalFocus(registry, "peking", "pelog")[0];
  v4.banks = [{ id: note.bank.id, version: note.bank.version }];
  v4.events = [
    {
      id: "off-grid-strike",
      tick: 137,
      action: "strike",
      velocity: 0.65,
      bankId: note.bank.id,
      sampleId: note.descriptor.id,
    },
    {
      id: "off-grid-damp",
      tick: PPQ + 19,
      action: "damp",
      velocity: 0,
      bankId: note.bank.id,
      sampleId: note.descriptor.id,
    },
  ];
  v4.instrumentMix = [
    {
      bankId: note.bank.id,
      instrumentId: "peking",
      volume: 0.4,
      pan: -0.3,
      mute: false,
      solo: false,
    },
  ];
  const short = structuredClone(v4);
  short.clock.lengthTicks = 8 * PPQ;
  const pcm = fixturePCM(),
    hashes = await Promise.all(pcm.map((x) => digest(x.buffer)));
  const empty = structuredClone(emptyLoopProject(registry));
  empty.clock = { kind: "fixed-bar", sampleRate: 48000, framesPerBar: 120000 };
  const take = {
    frames: 120000,
    channels: 2,
    sampleRate: 48000,
    validBytes: 960000,
    partial: false,
  };
  const base = adoptRecording(
    empty,
    registry,
    "track-1",
    take,
    hashes[0],
  ).project;
  let v5 = adoptOverdub(
    base,
    registry,
    "track-1",
    take,
    hashes[1],
    overdubBase(base, "track-1"),
  ).project;
  v5 = alignRecordedClip(v5, "track-1", v5.tracks[0].clips[0].id, 137);
  v5 = alignRecordedClip(v5, "track-1", v5.tracks[0].clips[1].id, -211);
  v5 = structuredClone(
    assignSource(v5, registry, "track-2", JSON.stringify(v4), { loop: false }),
  );
  v5.title = "Dua lapis + skor";
  v5.master.volume = 1;
  v5.master.limiter = { version: 1, bypass: false, kind: "soft-knee-v1" };
  v5.tracks[0].eq = {
    version: 1,
    bypass: false,
    lowDb: -3,
    midDb: 2,
    highDb: 1,
  };
  v5.tracks[0].gain = 0.6;
  v5.tracks[0].pan = 0.25;
  const offset = structuredClone(v5);
  offset.master.volume = 0;
  delete offset.tracks[0].layering;
  offset.tracks[0].clips = [offset.tracks[0].clips[0]];
  delete offset.tracks[0].clips[0].phaseAlignment;
  Object.assign(offset.tracks[0].clips[0], {
    offsetFrames: 137,
    loop: false,
    lengthTicks: 2 * PPQ,
  });
  return new Map([
    ["schema0-beatbox", v0],
    ["schema1-zero-master", v1],
    ["schema2-rhythm-ab", v2],
    ["schema3-fifteen-lanes", v3],
    ["schema4-multibar", v4],
    ["schema4-independent-clocks", short],
    ["schema5-eq-overdub-alignment", v5],
    ["schema5-nonzero-offset", offset],
  ]);
}
