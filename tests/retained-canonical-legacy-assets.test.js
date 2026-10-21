// Retained shared/data assertions extracted before failed-feature retirement.
import test from "node:test";
import assert from "node:assert/strict";
import { canonicalRegisteredAssets } from "../src/audio/canonical-registered-assets.js";

test("registered adapter metadata resolves exact trusted catalogs without eager fetch or URL substitution", () => {
  for (const rate of [44100, 48000]) {
    const paths = [],
      catalog = canonicalRegisteredAssets(rate, (d) => {
        paths.push(d.path);
        return "/assets/" + d.path;
      });
    assert.equal(catalog.catalog.length, 41);
    // Original 48kHz drum kits are also trusted capture inputs; no 44.1kHz
    // drum profile is invented or substituted.
    assert.equal(catalog.nativeRights.length, rate === 48000 ? 124 : 108);
    assert.ok(paths.every((p) => p.startsWith("internal/")));
    assert.throws(
      () => catalog.nativeURL("/arbitrary.wav"),
      (e) => e.code === "canonicalAssetUnavailable",
    );
    assert.throws(
      () => catalog.legacyURL("0".repeat(64)),
      (e) => e.code === "canonicalAssetUnavailable",
    );
  }
});

test("registered decode profile is explicit and cannot change encoded hash, trim or other profiles", () => {
  const key =
      "e1329cb03a568b5c2790a626f0e89c3af1d8a1304a954e45f4f8997aa8199298",
    a = canonicalRegisteredAssets(44100, (d) => d.path),
    b = canonicalRegisteredAssets(44100, (d) => d.path, {
      [key + "@44100"]: 28664,
    }),
    get = (x) => x.catalog.find((e) => e.descriptor.contentHash === key);
  assert.equal(get(a).descriptor.frames, 28665);
  assert.equal(get(b).descriptor.frames, 28664);
  assert.equal(get(a).descriptor.gainTrim, get(b).descriptor.gainTrim);
  assert.equal(get(a).descriptor.contentHash, get(b).descriptor.contentHash);
  assert.equal(
    get(
      canonicalRegisteredAssets(48000, (d) => d.path, {
        [key + "@44100"]: 28664,
      }),
    ).descriptor.frames,
    31200,
  );
});
