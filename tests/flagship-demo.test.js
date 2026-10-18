import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { canonicalRegisteredAssets } from "../src/audio/canonical-registered-assets.js";
import { createFlagshipDemo } from "../src/project/flagship-demo.js";
import { compileCanonicalTimeline } from "../src/project/canonical-timeline.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { PPQ } from "../src/project/instrument-project.js";
const sha = (b) => createHash("sha256").update(b).digest("hex");
for (const rate of [44100, 48000])
  test(
    "recorded plucked catalog @" +
      rate +
      " keeps exact derivative/source/license evidence and resolves only trusted paths",
    async () => {
      const catalog = canonicalRegisteredAssets(rate, (d) => d.path),
        rows = catalog.nativeRights.filter((r) =>
          r.request.bankId.startsWith("freepats-"),
        );
      assert.equal(rows.length, 6);
      for (const row of rows) {
        const s = catalog.registry.sample(
            row.request.bankId,
            row.request.version,
            row.request.sampleId,
          ),
          rights = row.rights,
          bytes = await readFile(catalog.nativeURL(s.assetPath));
        assert.equal(bytes.length, s.encodedBytes);
        assert.equal(sha(bytes), s.sha256);
        assert.equal(rights.commercialUse, true);
        assert.equal(rights.rawRedistribution, true);
        assert.equal(rights.licenseId, "cc0-1-0");
        assert.equal(
          sha(await readFile(rights.originalPath)),
          rights.originalSHA256,
        );
        assert.equal(
          sha(await readFile(rights.licenseEvidencePath)),
          rights.licenseEvidenceSHA256,
        );
        assert.equal(Object.isFrozen(rights), true);
      }
      assert.throws(
        () => catalog.nativeURL("/arbitrary.wav"),
        (e) => e.code === "canonicalAssetUnavailable",
      );
    },
  );
test("original demo owns four distinct patterns/dynamics, eleven exact natural-tail events, tuning consent and original schema bytes", async () => {
  const catalog = canonicalRegisteredAssets(48000, (d) => d.path),
    a = await createFlagshipDemo(catalog.registry),
    b = await createFlagshipDemo(catalog.registry),
    en = await createFlagshipDemo(catalog.registry, "en");
  assert.deepEqual(a.legacy, b.legacy);
  assert.deepEqual(a.canonical, b.canonical);
  assert.equal(en.legacy.composition.title, "Evening Conversation");
  const p = a.legacy;
  assert.deepEqual(p.composition.chain, ["a", "b", "a2", "c"]);
  assert.deepEqual(
    p.composition.patterns.map((p) => p.name),
    ["A", "B", "A2", "C"],
  );
  assert.equal(p.composition.patterns[2].steps["closed-hat"][11], 0.14);
  assert.equal(p.events.length, 11);
  assert.ok(
    p.events.every(
      (e) => e.action === "strike" && e.velocity > 0 && e.velocity <= 1,
    ),
  );
  assert.equal(p.tuningConsent, true);
  assert.equal(p.clock.lengthTicks, 16 * PPQ);
  assert.equal(p.events.filter((e) => e.tick === 12 * PPQ).length, 3);
  assert.deepEqual(p.composition.patterns[3].steps.kick, [
    0.64,
    ...Array(15).fill(0),
  ]);
  const memory = new AudioMemory(),
    timeline = await compileCanonicalTimeline(a.canonical, {
      registry: catalog.registry,
      memory,
      rate: 48000,
      command: { kind: "once", bars: null, cycles: 1 },
    });
  assert.equal(timeline.bodyFrames, 480000);
  assert.equal(timeline.naturalEndFrame, 598753);
  assert.equal(timeline.proposedFrames, 598753);
  timeline.dispose();
  assert.equal(memory.snapshot().bytes, 0);
  for (const o of a.canonical.origins.filter((o) => o.kind === "file"))
    assert.equal(sha(a.originals.get(o.sha256)), o.sha256);
});
