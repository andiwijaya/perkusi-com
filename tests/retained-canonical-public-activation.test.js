// Retained shared/data assertions extracted before failed-feature retirement.
import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalLocalRoute,
  canonicalLocalSession,
  canonicalLegacyHref,
  canonicalRecoveryHref,
} from "../src/studio/canonical-route.js";

test("legacy route helper compatibility only: origin opt-in and fallback; normal app activation remains disabled", () => {
  for (const prefix of [
    "https://perkusi.com",
    "https://www.perkusi.com",
    "http://127.0.0.1:6031",
  ])
    for (const path of ["/studio/", "/en/studio/"]) {
      assert.equal(canonicalLocalRoute(false, prefix + path, true), false);
      assert.equal(
        canonicalLocalRoute(
          false,
          prefix + path + "?candidate=canonical",
          true,
        ),
        true,
      );
      assert.equal(
        canonicalLocalRoute(
          false,
          prefix + path + "?candidate=canonical&workspace=legacy",
          true,
        ),
        false,
      );
    }
  for (const prefix of [
    "http://perkusi.com",
    "https://perkusi.com.example",
    "https://localhost.example",
    "https://192.168.1.2",
  ])
    assert.equal(
      canonicalLocalRoute(false, prefix + "/studio/?candidate=canonical", true),
      false,
    );
  assert.equal(
    canonicalLocalRoute(
      false,
      "https://perkusi.com/studio/?candidate=canonical",
      false,
    ),
    false,
  );
  assert.equal(
    canonicalLocalSession(
      false,
      "https://perkusi.com/loop-station/?candidate=canonical",
      true,
    ),
    true,
  );
  assert.equal(
    canonicalLegacyHref("en"),
    "/en/studio/?workspace=legacy&lang=en",
  );
  assert.equal(canonicalRecoveryHref(), "/studio/recovery/?lang=id");
});
