// Retained shared/data assertions extracted before failed-feature retirement.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { canonicalRegisteredAssets } from "../src/audio/canonical-registered-assets.js";

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
