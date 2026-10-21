// C4 retained data/shared assertions; retired engine/UI scenarios separately archived.
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { previewOutputPath } from "../scripts/gamelan-preview-assets.mjs";
import { createEventTracker } from "../src/analytics.js";

test("Gamelan preview build refuses dist, qa root and traversal output before build cleanup", () => {
  const root = process.cwd();
  for (const path of [
    "dist",
    "qa-artifacts",
    "qa-artifacts/../dist",
    "../outside",
  ])
    assert.throws(() => previewOutputPath(root, path));
  assert.equal(
    previewOutputPath(root, "qa-artifacts/test-preview"),
    resolve(root, "qa-artifacts/test-preview"),
  );
});
test("V4 analytics accepts six aggregate milestones, discards private data, sanitizes failure categories and isolates failure", () => {
  const sent = [],
    track = createEventTracker(true, (...a) => sent.push(a)),
    privateData = {
      project: "private",
      sampleId: "fs-private",
      deviceId: "private",
      notes: [1],
    };
  for (const name of [
    "gamelan_open",
    "gamelan_first_note",
    "gamelan_demo_played",
    "gamelan_to_studio",
    "audio_export_succeeded",
  ])
    track(name, privateData);
  track("audio_export_failed", privateData);
  track("audio_export_failed", "memory");
  track("audio_export_failed", "private exception text");
  track("individual_note", privateData);
  assert.equal(sent.length, 8);
  assert.ok(sent.slice(0, 5).every((row) => Object.keys(row[2]).length === 0));
  assert.deepEqual(
    sent.slice(5).map((row) => row[2]),
    [{ category: "other" }, { category: "memory" }, { category: "other" }],
  );
  assert.doesNotThrow(() =>
    createEventTracker(true, () => {
      throw Error("blocked");
    })("gamelan_open"),
  );
  const denied = [];
  createEventTracker(false, (...a) => denied.push(a))("gamelan_open");
  assert.deepEqual(denied, []);
});
