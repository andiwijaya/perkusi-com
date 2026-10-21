// Retained shared/data assertions extracted before failed-feature retirement.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  melodicBanks,
  melodicManifest,
} from "../src/loop-station/melodic-sources.js";

test("melodic sources retain CC0 original/derivative/license identity at both native profiles", async () => {
  for (const rate of [44100, 48000])
    for (const b of melodicBanks(rate))
      for (const s of b.samples) {
        const row = melodicManifest.assets.find(
          (a) => a.sampleId === s.id && a.profileRate === rate,
        );
        assert(row.commercialUse && row.rawRedistribution);
        assert.equal(row.license, "CC0-1.0");
        for (const [path, hash] of [
          [row.originalPath, row.originalSHA256],
          ["internal/loop-instruments/" + row.derivative.path, s.sha256],
          [row.licenseEvidencePath, row.licenseEvidenceSHA256],
        ])
          assert.equal(
            createHash("sha256")
              .update(await readFile(path))
              .digest("hex"),
            hash,
          );
      }
});
