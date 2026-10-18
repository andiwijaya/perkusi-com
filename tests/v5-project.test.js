import test from "node:test";
import assert from "node:assert/strict";
import { originalRegistry } from "../src/project/original-registry.js";
import { compositionRegistry } from "../src/project/studio-registry.js";
import { parseProject } from "../src/project/schema.js";
import { newStudioProject } from "../src/project/studio-model.js";
import { compositionDemo } from "../src/project/composition-model.js";
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import { instrumentDemo } from "../src/gamelan/instrument-demos.js";
import catalog from "../internal/instrument-focus/registry-48000.json" with { type: "json" };
import {
  migrateToLoopProject,
  parseLoopProject,
  validateLoopProject,
  MAX_LOOP_PROJECT_BYTES,
} from "../src/loop-station/project.js";
import { PPQ } from "../src/project/instrument-project.js";

const registry = new InstrumentRegistry(catalog.banks);
const beatbox = () => ({
  format: "perkusi-project",
  schemaVersion: 1,
  mode: "beatbox",
  title: "Ruang asli",
  pack: { id: originalRegistry.packId, version: originalRegistry.version },
  timing: { bpm: 96, meter: [4, 4] },
  master: { volume: 0.5 },
  tracks: originalRegistry.roleOrder.map((role) => ({
    role,
    enabled: true,
    variant: 2,
  })),
  export: { bars: 8 },
});
test("V1/V2/V3/V4 migration preserves exact source text and complete V4 musical identity without modifying legacy parsers", () => {
  const fixtures = [
    beatbox(),
    newStudioProject(),
    compositionDemo("fusion"),
    instrumentDemo("pelog-space", registry),
  ];
  for (const old of fixtures) {
    const text = JSON.stringify(old, null, 2).replaceAll("\n", "\r\n") + "\r\n";
    const p = migrateToLoopProject(text, registry);
    assert.equal(p.schemaVersion, 5);
    assert.equal(p.mode, "loop-station");
    assert.equal(p.origins[0].text, text);
    assert.deepEqual(JSON.parse(p.origins[0].text), old);
    assert.equal(p.master.volume, 1);
    assert.equal(p.tracks[0].gain, 1);
    assert.equal(p.tracks[0].clips[0].sourceId, p.origins[0].id);
    const reloaded = parseLoopProject(JSON.stringify(p), registry);
    assert.deepEqual(reloaded, p);
    assert.equal(Object.isFrozen(reloaded.tracks[0].clips[0]), true);
    assert.throws(() => parseProject(JSON.stringify(p), compositionRegistry));
    assert.deepEqual(old, JSON.parse(text));
  }
});
function recording() {
  return {
    format: "perkusi-project",
    schemaVersion: 5,
    mode: "loop-station",
    title: "Capture metadata",
    timing: { bpm: 96, meter: [4, 4] },
    master: { volume: 1 },
    origins: [],
    assetRefs: [
      {
        id: "recording-1",
        kind: "recording",
        sha256: "a".repeat(64),
        bytes: 480000,
        frames: 120000,
        channels: 1,
        sampleRate: 48000,
        encoding: "float32le",
        recordedBpm: 96,
      },
    ],
    tracks: [
      {
        id: "track-1",
        kind: "recording",
        gain: 1,
        pan: 0,
        mute: false,
        solo: false,
        clips: [
          {
            id: "clip-1",
            sourceId: "recording-1",
            startTick: 0,
            lengthTicks: 4 * PPQ,
            offsetFrames: 0,
            loop: true,
          },
        ],
      },
    ],
  };
}
test("schema5 stores bounded recording identity, not audio/path/base64; missing assets remain a storage integration responsibility", () => {
  const p = validateLoopProject(recording(), registry);
  assert.equal(p.assetRefs[0].bytes, 480000);
  for (const mutate of [
    (p) => (p.assetRefs[0].data = "base64-audio"),
    (p) => (p.assetRefs[0].id = "../recording.wav"),
    (p) => p.assetRefs[0].bytes++,
    (p) => (p.assetRefs[0].sha256 = "not-a-hash"),
    (p) => (p.tracks[0].clips[0].sourceId = "missing"),
    (p) => p.tracks.push(structuredClone(p.tracks[0])),
    (p) => (p.tracks[0].clips[0].offsetFrames = 120000),
    (p) => (p.tracks[0].gain = Infinity),
    (p) => (p.schemaVersion = 6),
  ]) {
    const bad = recording();
    mutate(bad);
    assert.throws(() => validateLoopProject(bad, registry));
  }
});
test("tempo changes cannot silently retime recorded clips or embedded official-loop compositions", () => {
  const p = recording();
  p.timing.bpm = 120;
  assert.throws(() => validateLoopProject(p, registry), /loopTempoLocked/);
  const old = structuredClone(
    migrateToLoopProject(JSON.stringify(beatbox()), registry),
  );
  old.timing.bpm = 120;
  assert.throws(() => validateLoopProject(old, registry), /loopTempoLocked/);
});
test("hostile accessors, giant metadata and unsupported nested versions fail before replacing any caller state", () => {
  const p = recording();
  let calls = 0;
  Object.defineProperty(p.tracks[0], "gain", {
    enumerable: true,
    get() {
      calls++;
      return 1;
    },
  });
  assert.throws(() => validateLoopProject(p, registry));
  assert.equal(calls, 0);
  assert.throws(() =>
    parseLoopProject(" ".repeat(MAX_LOOP_PROJECT_BYTES + 1), registry),
  );
  const valid = migrateToLoopProject(JSON.stringify(beatbox()), registry),
    before = JSON.stringify(valid);
  assert.throws(() =>
    migrateToLoopProject(
      JSON.stringify({ ...valid, schemaVersion: 99 }),
      registry,
    ),
  );
  assert.equal(JSON.stringify(valid), before);
});
