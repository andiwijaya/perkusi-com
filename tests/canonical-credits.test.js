import test from "node:test";
import assert from "node:assert/strict";
import { canonicalDocumentCredits } from "../src/project/canonical-credits.js";
import { canonicalRegisteredAssets } from "../src/audio/canonical-registered-assets.js";
import { createFlagshipDemo } from "../src/project/flagship-demo.js";

test("document credits use the ten actual flagship source receipts and retain native license provenance", async () => {
  const a = canonicalRegisteredAssets(48000, (d) => "/" + d.path),
    demo = await createFlagshipDemo(a.registry),
    catalog = [...a.catalog, ...a.nativeRights],
    credits = canonicalDocumentCredits(demo.canonical, catalog);
  assert.equal(credits.length, 10);
  assert.equal(
    credits.filter((r) => r.request.kind === "instrument").length,
    6,
  );
  assert.equal(
    credits.filter((r) => r.rights.licenseId === "cc-by-3-0").length,
    2,
  );
  assert(credits.every((r) => catalog.includes(r)));
  assert(
    credits.every((r) => r.rights.commercialUse && r.rights.rawRedistribution),
  );
  assert.equal(
    credits.some((r) => r.request.sampleId === "bass-e2"),
    false,
  );
});
