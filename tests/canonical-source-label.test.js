import test from "node:test";
import assert from "node:assert/strict";
import { canonicalSourceLabel } from "../src/studio/canonical-position-markers.js";
test("native markers and editor legends use authored/accompaniment/track names then readable bilingual fallback", () => {
  const source = {
      id: "opaque-native-8f",
      kind: "instrument-events",
      programme: { accompanimentRef: "child-opaque" },
    },
    child = {
      id: "child-opaque",
      kind: "composition",
      programme: { title: "Saron Barung" },
    },
    p = {
      sourceDefs: [source, child],
      tracks: [{ id: "track-1", name: "Part Gamelan" }],
      sections: [
        {
          placements: [
            {
              trackId: "track-1",
              sourceRef: { kind: "working", id: source.id },
            },
          ],
        },
      ],
    };
  assert.equal(canonicalSourceLabel(p, source), "Saron Barung");
  source.programme.title = "Current part";
  assert.equal(canonicalSourceLabel(p, source), "Current part");
  source.programme.title = " ";
  child.programme.title = "";
  assert.equal(canonicalSourceLabel(p, source), "Part Gamelan");
  p.tracks[0].name = " ";
  const before = JSON.stringify(p);
  assert.equal(canonicalSourceLabel(p, source), "Instrumen 1");
  assert.equal(canonicalSourceLabel(p, source, "en"), "Instrument 1");
  assert.equal(JSON.stringify(p), before);
});
