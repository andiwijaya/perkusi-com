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

test("final Studio routes six aliases and older editor queries to one editor only on trusted hosts", () => {
  for (const origin of [
    "http://127.0.0.1:6104",
    "https://perkusi.com",
    "https://www.perkusi.com",
  ])
    for (const route of [
      "/studio",
      "/studio/",
      "/studio/index.html",
      "/en/studio",
      "/en/studio/",
      "/en/studio/index.html",
    ])
      for (const query of [
        "",
        "?workspace=legacy",
        "?workspace=gamelan",
        "?candidate=canonical",
      ])
        assert.equal(
          canonicalLocalRoute(true, origin + route + query, false, true),
          true,
        );
  for (const url of [
    "https://perkusi.com.evil.test/studio/",
    "http://perkusi.com/studio/",
    "https://foo.pages.dev/studio/",
    "http://127.0.0.1:6104/gamelan/",
  ])
    assert.equal(canonicalLocalRoute(true, url, false, true), false);
});
