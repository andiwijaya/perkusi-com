import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { createCanonicalBundle } from "../src/project/canonical-package.js";
import { migrateLegacyMetadata } from "../src/project/canonical-metadata.js";
import { newComposition } from "../src/project/composition-model.js";
import { createCanonicalEditor } from "../src/studio/canonical-editor.js";
import {
  canonicalFixtureRegistry as registry,
  fixturePCM,
} from "./helpers/canonical-fixtures.js";

async function fixture(text = JSON.stringify(newComposition())) {
  const memory = new AudioMemory(),
    migrated = await migrateLegacyMetadata(text, { registry }),
    bundle = await createCanonicalBundle(migrated.project, {
      registry,
      memory,
      originals: migrated.originals,
      entries: new Map(
        migrated.project.assets.map((a, i) => [
          a.id,
          {
            blob: new Blob([fixturePCM()[i].buffer]),
            provenance:
              "Existing fixture PCM, RAM only; tempo-refusal metadata test.",
          },
        ]),
      ),
    }),
    editor = await createCanonicalEditor(bundle, { registry, memory });
  return {
    editor,
    async dispose() {
      await editor.dispose();
      bundle.dispose();
      assert.equal(memory.snapshot().bytes, 0);
    },
  };
}
test("ordinary musical-clock tempo/swing/kit edits validate, preserve originals, and undo as separate commands", async () => {
  const f = await fixture();
  try {
    const before = f.editor.snapshot().project,
      id = before.sourceDefs.find((d) => d.kind === "composition").id;
    await f.editor.setTempo(123);
    assert.equal(f.editor.snapshot().project.timing.bpm, 123);
    assert.equal(
      f.editor.snapshot().project.sourceDefs[0].programme.timing.bpm,
      123,
    );
    await f.editor.setSwing(id, 0.17);
    await f.editor.setKit(id, "arus");
    assert.equal(
      f.editor.snapshot().project.sourceDefs[0].programme.pack.id,
      "arus",
    );
    assert.deepEqual(f.editor.snapshot().project.origins, before.origins);
    await f.editor.undo();
    await f.editor.undo();
    await f.editor.undo();
    assert.deepEqual(f.editor.snapshot().project, before);
    const revision = f.editor.snapshot().revision;
    await assert.rejects(
      f.editor.setTempo(181),
      (e) => e.code === "invalidTempo",
    );
    await assert.rejects(
      f.editor.setSwing(id, 0.51),
      (e) => e.code === "invalidSwing",
    );
    assert.equal(f.editor.snapshot().revision, revision);
  } finally {
    await f.dispose();
  }
});
test("phrase and fixed-clock tempo refusal never rewrites source timing, PCM metadata or history", async () => {
  for (const path of [
    "tests/fixtures/v5-canonical/schema0-beatbox.perkusi.json",
    "tests/fixtures/v5-canonical/schema5-eq-overdub-alignment.perkusi.json",
  ]) {
    const f = await fixture(await readFile(path, "utf8"));
    try {
      const before = f.editor.snapshot();
      await assert.rejects(
        f.editor.setTempo(121),
        (e) => e.code === "recordedTempoLocked",
      );
      assert.equal(f.editor.snapshot().project, before.project);
      assert.equal(f.editor.snapshot().revision, before.revision);
    } finally {
      await f.dispose();
    }
  }
});
test("native creation/deletion is undoable, uses existing samples, and invalid events never promote", async () => {
  const f = await fixture(
    await readFile(
      "tests/fixtures/v5-canonical/schema4-multibar.perkusi.json",
      "utf8",
    ),
  );
  try {
    const before = f.editor.snapshot().project,
      d = before.sourceDefs.find((d) => d.kind === "instrument-events"),
      original = d.programme.events[0],
      event = {
        tick: 156,
        action: "strike",
        velocity: 0.65,
        bankId: original.bankId,
        sampleId: original.sampleId,
      };
    await f.editor.addNative(d.id, event);
    const added = f.editor.snapshot().project,
      created = added.sourceDefs
        .find((s) => s.id === d.id)
        .programme.events.find((e) => e.id.startsWith("edited-event-"));
    assert.equal(created.tick, 156);
    assert.deepEqual(added.origins, before.origins);
    assert.deepEqual(
      added.sourceDefs.find((s) => s.id === d.id).programme.banks,
      d.programme.banks,
    );
    await f.editor.deleteNative(d.id, created.id);
    assert.deepEqual(f.editor.snapshot().project, before);
    await f.editor.undo();
    assert.deepEqual(f.editor.snapshot().project, added);
    const revision = f.editor.snapshot().revision;
    await assert.rejects(
      f.editor.addNative(d.id, { ...event, sampleId: "not-a-recording" }),
    );
    await assert.rejects(f.editor.addNative(d.id, { ...event, tick: -1 }));
    assert.equal(f.editor.snapshot().revision, revision);
    assert.deepEqual(f.editor.snapshot().project, added);
  } finally {
    await f.dispose();
  }
});
