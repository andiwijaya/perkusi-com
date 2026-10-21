// Retained shared/data assertions extracted before failed-feature retirement.
import test from "node:test";
import assert from "node:assert/strict";
import { canonicalLocalRoute } from "../src/studio/canonical-route.js";

test("legacy route helper compatibility across ID/EN aliases; normal app never activates Preview", () => {
  for (const route of [
    "/studio",
    "/studio/",
    "/studio/index.html",
    "/en/studio",
    "/en/studio/",
    "/en/studio/index.html",
  ]) {
    assert.equal(
      canonicalLocalRoute(true, "https://perkusi.com" + route, true, false),
      false,
    );
    assert.equal(
      canonicalLocalRoute(
        true,
        "https://perkusi.com" + route + "?workspace=legacy",
        true,
        false,
      ),
      false,
    );
    assert.equal(
      canonicalLocalRoute(
        true,
        "https://perkusi.com" + route + "?candidate=canonical",
        true,
        false,
      ),
      true,
    );
  }
});
