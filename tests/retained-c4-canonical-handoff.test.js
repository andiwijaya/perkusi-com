// C4 retained data/shared assertions; retired engine/UI scenarios separately archived.
import test from "node:test";
import assert from "node:assert/strict";
import { canonicalLocalSession } from "../src/studio/canonical-route.js";

test("producer opt-in stays development-local and explicit on all workspace routes", () => {
  for (const path of ["/gamelan/", "/loop-station/", "/studio/"]) {
    assert.equal(
      canonicalLocalSession(
        true,
        "http://127.0.0.1:6021" + path + "?candidate=canonical",
      ),
      true,
    );
    assert.equal(
      canonicalLocalSession(
        false,
        "http://127.0.0.1:6021" + path + "?candidate=canonical",
      ),
      false,
    );
    assert.equal(
      canonicalLocalSession(
        true,
        "https://perkusi.com" + path + "?candidate=canonical",
      ),
      false,
    );
    assert.equal(
      canonicalLocalSession(true, "http://127.0.0.1:6021" + path),
      false,
    );
  }
});
