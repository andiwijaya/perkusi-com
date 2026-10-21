// C4 retained data/shared assertions; retired engine/UI scenarios separately archived.
import test from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  unlinkSync,
  rmdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { creditsCopy } from "../src/gamelan/credits-copy.js";
import { candidateOutput } from "../scripts/gamelan-preview-assets.mjs";

test("Archived credits preserve ID/EN parity and honest provenance", () => {
  assert.deepEqual(
    Object.keys(creditsCopy.id).sort(),
    Object.keys(creditsCopy.en).sort(),
  );

  for (const locale of ["id", "en"]) {
    assert.ok(
      creditsCopy[locale].pending.length &&
        creditsCopy[locale].flacChanges.length,
    );
  }
});
test("One-command candidate build rejects default and any existing review output without mutating files", () => {
  const root = mkdtempSync(join(tmpdir(), "perkusi-candidate-output-")),
    qa = join(root, "qa-artifacts"),
    frozen = join(qa, "frozen-candidate"),
    checkpoint = join(frozen, "checkpoint.json"),
    before = Buffer.from('{"status":"accepted evidence"}\n');
  mkdirSync(qa);
  mkdirSync(frozen);
  writeFileSync(checkpoint, before);
  try {
    for (const path of [
      "dist",
      "qa-artifacts",
      "qa-artifacts/../dist",
      "../outside",
      "qa-artifacts/frozen-candidate",
    ])
      assert.throws(() => candidateOutput(root, path));
    assert.equal(
      candidateOutput(root, "qa-artifacts/fresh-candidate"),
      join(qa, "fresh-candidate"),
    );
    assert.deepEqual(readFileSync(checkpoint), before);
  } finally {
    unlinkSync(checkpoint);
    rmdirSync(frozen);
    rmdirSync(qa);
    rmdirSync(root);
  }
});
