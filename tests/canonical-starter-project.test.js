import test from "node:test";
import assert from "node:assert/strict";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { canonicalRegisteredAssets } from "../src/audio/canonical-registered-assets.js";
import { createStarter, starterContent } from "../src/loop-station/starters.js";
import { createCanonicalDemo } from "../src/studio/canonical-demos.js";
import { canonicalStarterProject } from "../src/studio/canonical-starter-project.js";
import { migrateLegacyMetadata } from "../src/project/canonical-metadata.js";
import { compileCanonicalTimeline } from "../src/project/canonical-timeline.js";
import { PPQ } from "../src/project/instrument-project.js";
import { createCanonicalEditor } from "../src/studio/canonical-editor.js";
import { createCanonicalWorkflow } from "../src/studio/canonical-workflow.js";
import { canonicalCaptureProject } from "../src/studio/canonical-capture-material.js";
import { TakePool } from "../src/loop-station/take-pool.js";
import { adoptRecording, digest } from "../src/loop-station/recording-data.js";
import { exportAudioBundle } from "../src/loop-station/audio-bundle.js";
import {
  exportCanonicalPackage,
  importCanonicalPackage,
} from "../src/project/canonical-package.js";
const events = (t) =>
  t.events
    .filter((e) => e.kind === "native")
    .map((e) => {
      const copy = { ...e };
      for (const key of ["id", "placementId", "sourceId"]) delete copy[key];
      return copy;
    });
const trace = (step, data) => {
  if (process.env.STARTER_TRACE) console.error(step, data ?? "");
};
for (const rate of [48000])
  for (const recipe of starterContent)
    test(`starter ${recipe.id} at ${rate}: unchanged native event timeline/originals; capture add/undo/portable reopen`, async () => {
      const memory = new AudioMemory(),
        registry = canonicalRegisteredAssets(
          rate,
          (d) => "/" + d.path,
        ).registry,
        old = await migrateLegacyMetadata(
          JSON.stringify(createStarter(recipe.id, registry)),
          { registry },
        ),
        bundle = await createCanonicalDemo("starter:" + recipe.id, {
          registry,
          memory,
        }),
        before = bundle.project,
        raw = bundle.project.origins
          .filter((o) => o.kind === "file")
          .map((o) => bundle.originals.get(o.sha256).arrayBuffer()),
        originalBefore = await Promise.all(raw);
      trace("created", recipe.id);
      assert.equal(before.tracks.length, recipe.lanes.length);
      assert.equal(before.transport.kind, "chain");
      assert.equal(before.sections[0].lengthTicks, 16 * PPQ);
      assert.deepEqual(before.master, old.project.master);
      for (const d of before.sourceDefs.filter(
        (d) => d.kind === "instrument-events",
      )) {
        assert.deepEqual(
          d,
          old.project.sourceDefs.find((x) => x.id === d.id),
        );
        const child = before.sourceDefs.find(
          (c) => c.id === d.programme.accompanimentRef,
        );
        if (
          before.sections.some((s) =>
            s.placements.some((a) => a.sourceRef.id === d.id),
          )
        )
          assert.equal(
            child.programme.chain.length * 4 * PPQ,
            d.programme.clock.lengthTicks,
          );
        else
          assert.deepEqual(
            child,
            old.project.sourceDefs.find((x) => x.id === child.id),
          );
      }
      const oldTimeline = await compileCanonicalTimeline(old.project, {
          registry,
          rate,
          memory,
          command: { kind: "window", bars: 4, cycles: 1 },
        }),
        currentTimeline = await compileCanonicalTimeline(before, {
          registry,
          rate,
          memory,
          command: { kind: "once", bars: null, cycles: 1 },
        });
      try {
        trace("compiled", [
          oldTimeline.events.length,
          currentTimeline.events.length,
        ]);
        assert.equal(currentTimeline.bodyFrames, oldTimeline.bodyFrames);
        assert.equal(
          currentTimeline.naturalEndFrame,
          oldTimeline.naturalEndFrame,
        );
        assert.ok(oldTimeline.events.some((e) => e.kind === "native"));
        assert.deepEqual(events(currentTimeline), events(oldTimeline));
        trace("compared");
      } finally {
        oldTimeline.dispose();
        currentTimeline.dispose();
      }
      const editor = await createCanonicalEditor(bundle, { registry, memory }),
        workflow = createCanonicalWorkflow({
          editor,
          registry,
          memory,
          storage: { close() {} },
        }),
        p = canonicalCaptureProject(before, registry, { rate }),
        pool = new TakePool(memory),
        n = p.clock.framesPerBar;
      trace("capture-frames", n);
      assert.ok(Number.isInteger(n) && n > 0 && n < 1000000);
      const cs = [0, 1].map((c) =>
          Float32Array.from({ length: n }, (_, f) =>
            f === 0 ? -0 : 0.02 * Math.sin(f / (c ? 37 : 23)),
          ),
        ),
        take = pool.adopt(
          pool.reserve({ capacity: n, channels: 2, sampleRate: rate }),
          {
            capacity: n,
            frames: n,
            channels: 2,
            sampleRate: rate,
            startFrame: 0,
            reason: "complete",
          },
          cs.map((c) => new Float32Array(c).buffer),
        ),
        pcm = pool.copyPCM(take.id),
        adopted = adoptRecording(
          p,
          registry,
          "track-1",
          take,
          await digest(pcm.buffer),
        ),
        packed = await exportAudioBundle(
          adopted.project,
          new Map([
            [
              adopted.ref.id,
              {
                blob: new Blob([pcm.buffer]),
                provenance: "Synthetic QA starter take; no device",
              },
            ],
          ]),
          { registry, memory },
        );
      pcm.release();
      pool.release(take.id);
      trace("packed", packed.blob.size);
      let output, reopened;
      try {
        await workflow.importFile(packed.blob, {
          mode: "add",
          freezeRecordingClock: true,
        });
        trace("imported");
        const after = editor.snapshot().project;
        assert.equal(after.tracks.length, recipe.lanes.length + 1);
        assert.equal(after.assets.length, 1);
        assert.equal(after.timing.clock.kind, "fixed-bar");
        assert.deepEqual(
          after.sourceDefs
            .slice(0, before.sourceDefs.length)
            .map((d) => d.programme),
          before.sourceDefs.map((d) => d.programme),
        );
        await editor.undo();
        assert.deepEqual(editor.snapshot().project, before);
        await editor.redo();
        trace("undo-redo");
        assert.deepEqual(editor.snapshot().project, after);
        output = await exportCanonicalPackage(editor.snapshot().bundle, {
          memory,
        });
        reopened = await importCanonicalPackage(output.blob, {
          registry,
          memory,
        });
        trace("reopened");
        assert.deepEqual(reopened.project, after);
        const entry = reopened.entries.get(after.assets[0].id);
        const received = new Float32Array(await entry.blob.arrayBuffer());
        assert.deepEqual(received.subarray(0, n), cs[0]);
        assert.deepEqual(received.subarray(n), cs[1]);
        for (const [i, o] of before.origins
          .filter((o) => o.kind === "file")
          .entries())
          assert.deepEqual(
            await reopened.originals.get(o.sha256).arrayBuffer(),
            originalBefore[i],
          );
      } finally {
        reopened?.dispose();
        output?.release();
        packed.release();
        await workflow.dispose();
        await editor.dispose();
        bundle.dispose();
      }
      assert.equal(memory.snapshot().bytes, 0);
    });
test("starter working-copy preparation refuses audio-bearing accompaniment instead of trimming or rewriting it", async () => {
  const registry = canonicalRegisteredAssets(
      48000,
      (d) => "/" + d.path,
    ).registry,
    old = await migrateLegacyMetadata(
      JSON.stringify(createStarter(starterContent[0].id, registry)),
      { registry },
    );
  for (const kind of ["step", "clip", "note"]) {
    const p = structuredClone(old.project),
      parent = p.sourceDefs.find(
        (d) => d.id === p.sections[0].placements[0].sourceRef.id,
      ),
      d = p.sourceDefs.find((d) => d.id === parent.programme.accompanimentRef),
      a = d.programme.patterns[0];
    if (kind === "step") a.steps.kick[0] = 1;
    if (kind === "clip") a.beatbox[0].enabled = true;
    if (kind === "note") a.notes[0] = { pitch: "d4", velocity: 0.5 };
    const before = JSON.stringify(p);
    assert.throws(
      () => canonicalStarterProject(p),
      (e) => e.code === "invalidStarterGeometry",
    );
    assert.equal(JSON.stringify(p), before);
  }
});
