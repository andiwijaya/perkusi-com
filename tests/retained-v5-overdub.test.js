// Retained shared/data assertions extracted before failed-feature retirement.
import test from "node:test";
import assert from "node:assert/strict";
import catalog from "../internal/instrument-focus/registry-48000.json" with { type: "json" };
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { digest } from "../src/loop-station/recording-data.js";
import {
  exportAudioBundle,
  importAudioBundle,
} from "../src/loop-station/audio-bundle.js";
import { twoLayerFixture } from "./helpers/retirement-data-fixtures.js";

const registry = new InstrumentRegistry(catalog.banks);

async function fixture() {
  const f = twoLayerFixture();
  const basePCM = new Float32Array(240000).fill(0.1);
  const newPCM = new Float32Array(240000).fill(-0.1);
  assert.equal(await digest(basePCM.buffer), f.baseHash);
  assert.equal(await digest(newPCM.buffer), f.layerHash);
  return {
    ...f,
    entries: new Map([
      [
        f.base.assetRefs[0].id,
        { blob: new Blob([basePCM.buffer]), provenance: "QA source base" },
      ],
      [
        f.candidate.ref.id,
        { blob: new Blob([newPCM.buffer]), provenance: "QA source layer" },
      ],
    ]),
  };
}

test("two-layer complete bundle/reload retains both exact PCM payloads and independent credits", async () => {
  const f = await fixture(),
    memory = new AudioMemory(),
    bundle = await exportAudioBundle(f.candidate.project, f.entries, {
      registry,
      memory,
    });
  const loaded = await importAudioBundle(bundle.blob, { registry, memory });
  assert.deepEqual(loaded.project, f.candidate.project);
  assert.equal(loaded.entries.size, 2);
  assert.equal(
    await digest(
      await loaded.entries.get(f.base.assetRefs[0].id).blob.arrayBuffer(),
    ),
    f.baseHash,
  );
  assert.equal(
    await digest(
      await loaded.entries.get(f.candidate.ref.id).blob.arrayBuffer(),
    ),
    f.layerHash,
  );
  assert.equal(
    loaded.entries.get(f.candidate.ref.id).provenance,
    "QA source layer",
  );
  loaded.release();
  bundle.release();
  assert.equal(memory.snapshot().bytes, 0);
});
