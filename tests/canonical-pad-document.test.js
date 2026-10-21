import test from "node:test";
import assert from "node:assert/strict";
import { canonicalPadDocument } from "../src/studio/canonical-pad-document.js";
import { canonicalRegisteredAssets } from "../src/audio/canonical-registered-assets.js";
import { createFlagshipDemo } from "../src/project/flagship-demo.js";
import { validateCanonicalMetadata } from "../src/project/canonical-metadata.js";
import { compileCanonicalTimeline } from "../src/project/canonical-timeline.js";
import { AudioMemory } from "../src/audio/audio-memory.js";

test("transient pad score preserves editor data, actual mix/kit and one hit without copying instruments or recordings", async () => {
  const registry = canonicalRegisteredAssets(
    48000,
    (d) => "/" + d.path,
  ).registry;
  const demo = await createFlagshipDemo(registry),
    p = structuredClone(demo.canonical),
    source = p.sourceDefs.find((d) => d.kind === "composition");
  p.master.volume = 1;
  const before = JSON.stringify(p),
    pad = await canonicalPadDocument(p, source.id, "kick", registry);
  await validateCanonicalMetadata(pad, registry);
  assert.equal(JSON.stringify(p), before);
  assert.equal(pad.master.volume, 1);
  assert.deepEqual(pad.sourceDefs[0].programme.pack, source.programme.pack);
  assert.equal(pad.sourceDefs.length, 1);
  assert.equal(pad.sourceDefs[0].kind, "composition");
  assert.equal(pad.assets.length, 0);
  const memory = new AudioMemory(),
    timeline = await compileCanonicalTimeline(pad, {
      registry,
      rate: 48000,
      memory,
    });
  try {
    const shots = timeline.placements.flatMap(
      (p) => p.composition?.shots ?? [],
    );
    assert.equal(shots.length, 1);
    assert.equal(shots[0].role, "kick");
  } finally {
    timeline.dispose();
    assert.equal(memory.snapshot().bytes, 0);
  }
  await assert.rejects(
    canonicalPadDocument(p, source.id, "unknown", registry),
    (e) => e.code === "invalidPattern",
  );
  const parent = p.sourceDefs.find((d) => d.id === source.parentId);
  if (parent) {
    parent.master = { binding: "local", volume: 0.23 };
    const inherited = await canonicalPadDocument(
      p,
      source.id,
      "kick",
      registry,
    );
    assert.equal(
      inherited.master.volume,
      0.23,
      "audition must respect the same inherited source master",
    );
  }
});
