import test from "node:test";
import assert from "node:assert/strict";
import { createEventTracker } from "../src/analytics.js";
import { createPlaybackMilestones } from "../src/beatbox/playback-milestones.js";

const snapshot = (overrides = {}) => ({
  status: "playing",
  contextState: "running",
  currentTime: 1,
  origin: 0.05,
  resources: { voices: 1 },
  stems: { kick: { active: true } },
  ...overrides,
});

test("success requires running playback and an active voice past its initial start", () => {
  const sent = [];
  const observe = createPlaybackMilestones((...args) => sent.push(args));
  for (const state of [
    snapshot({ status: "loading" }),
    snapshot({ status: "error" }),
    snapshot({ contextState: "suspended" }),
    snapshot({ contextState: "interrupted" }),
    snapshot({ resources: { voices: 0 } }),
    snapshot({
      stems: {
        kick: { active: false, state: "error" },
        hat: { active: false, state: "ready" },
      },
    }),
    snapshot({ currentTime: 0.01 }),
  ])
    observe(state);
  assert.deepEqual(sent, []);
  observe(snapshot());
  assert.deepEqual(sent, [["audio_started"], ["first_layer_enabled"]]);
});

test("failed start leaves success eligible; retry, repeated renders, pause and resume do not duplicate it", () => {
  const sent = [];
  const observe = createPlaybackMilestones((...args) => sent.push(args));
  const silent = snapshot({
    resources: { voices: 0 },
    stems: { kick: { active: false } },
  });
  for (let i = 0; i < 20; i++) observe(silent);
  observe(snapshot());
  observe(snapshot({ status: "paused" }));
  const three = snapshot({
    resources: { voices: 3 },
    stems: {
      kick: { active: true },
      hat: { active: true },
      bass: { active: true },
    },
  });
  for (let i = 0; i < 20; i++) {
    observe(snapshot());
    observe(three);
  }
  observe(snapshot({ status: "idle" }));
  observe(three);
  assert.deepEqual(sent, [
    ["audio_started"],
    ["first_layer_enabled"],
    ["three_layers_reached"],
  ]);
});

test("playback milestones pass names only to the existing anonymous event contract", () => {
  const sent = [];
  const observe = createPlaybackMilestones(
    createEventTracker(true, (...args) => sent.push(args)),
  );
  observe(
    snapshot({
      privatePattern: [1, 2],
      deviceId: "must-not-send",
      resources: { voices: 3 },
      stems: {
        kick: { active: true, file: "private" },
        hat: { active: true },
        bass: { active: true },
      },
    }),
  );
  assert.deepEqual(
    sent,
    ["audio_started", "first_layer_enabled", "three_layers_reached"].map(
      (name) => ["event", name, {}],
    ),
  );
});

test("analytics accepts only six anonymous milestones and a validated language", () => {
  const sent = [];
  const track = createEventTracker(true, (...args) => sent.push(args));
  for (const name of [
    "playground_open",
    "audio_started",
    "first_layer_enabled",
    "three_layers_reached",
    "audio_error",
  ])
    track(name, { pattern: [1, 2], deviceId: "forbidden" });
  track("language_changed", "en");
  track("language_changed", { composition: "forbidden" });
  track("composition", "id");
  assert.equal(sent.length, 7);
  assert(sent.slice(0, 5).every((args) => Object.keys(args[2]).length === 0));
  assert.deepEqual(sent[5], ["event", "language_changed", { language: "en" }]);
  assert.deepEqual(sent[6][2], {});
});
test("disabled and broken analytics cannot interrupt the caller", () => {
  let calls = 0;
  const track = createEventTracker(false, () => calls++);
  track("audio_started");
  assert.equal(calls, 0);
  assert.doesNotThrow(() =>
    createEventTracker(true, () => {
      throw new Error("blocked analytics");
    })("audio_started"),
  );
});
