import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalLocalBuild,
  canonicalLocalRoute,
  canonicalStudioHref,
} from "../src/studio/canonical-route.js";

test("normal and production Studio never opt into canonical storage by URL alone", () => {
  for (const base of [
    "http://127.0.0.1:6020",
    "http://localhost:6020",
    "http://[::1]:6020",
  ])
    for (const path of ["/studio/", "/en/studio/"]) {
      assert.equal(canonicalLocalBuild(false, base + path), false);
      assert.equal(
        canonicalLocalRoute(false, base + path + "?candidate=canonical"),
        false,
      );
      assert.equal(canonicalLocalRoute(true, base + path), false);
      assert.equal(
        canonicalLocalRoute(true, base + path + "?candidate=canonical"),
        true,
      );
      assert.equal(
        canonicalLocalRoute(
          true,
          base + path + "?candidate=canonical&workspace=gamelan",
        ),
        false,
      );
    }
  for (const host of [
    "perkusi.com",
    "www.perkusi.com",
    "localhost.example",
    "192.168.1.2",
  ])
    assert.equal(
      canonicalLocalRoute(
        true,
        "https://" + host + "/studio/?candidate=canonical",
      ),
      false,
    );
  assert.equal(
    canonicalLocalRoute(true, "http://localhost/gamelan/?candidate=canonical"),
    false,
  );
});

test("explicit entry carries the chosen ID/EN locale and canonical opt-in", () => {
  assert.equal(canonicalStudioHref(), "/studio/?candidate=canonical&lang=id");
  assert.equal(
    canonicalStudioHref("en"),
    "/en/studio/?candidate=canonical&lang=en",
  );
});
