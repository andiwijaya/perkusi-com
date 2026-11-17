import test from "node:test";
import assert from "node:assert/strict";
import {
  newComposition,
  withPatternLoops,
  studioView,
  reverseReasons,
} from "../src/project/composition-model.js";
import { compositionRegistry } from "../src/project/studio-registry.js";
import {
  parseProject,
  serializeProject,
  validateProject,
} from "../src/project/schema.js";
import { CompositionStore } from "../src/project/composition-store.js";
import {
  studioPlaybackKey,
  studioProjectSnapshot,
} from "../src/project/studio-playback-state.js";

test("saved playback mode and fixed level survive JSON, browser save and draft", () => {
  const p = withPatternLoops(newComposition());
  p.playback = { mode: "pattern", programmeGain: 3.75 };
  assert.deepEqual(
    parseProject(serializeProject(p, compositionRegistry), compositionRegistry),
    p,
  );
  assert.equal(Object.hasOwn(studioView(p), "playback"), false);
  const values = new Map(),
    storage = () => ({
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
    });
  const store = new CompositionStore(
    compositionRegistry,
    storage,
    () => "test-project",
  );
  const id = store.save(p);
  store.saveDraft(p);
  assert.deepEqual(store.load(id), p);
  assert.deepEqual(store.readDraft(), p);
});

test("names and editor selection preserve the heard chain level; unplayed sound edits do not", () => {
  const p = withPatternLoops(newComposition());
  const remembered = {
    key: studioPlaybackKey(p, true),
    gain: 4,
    arrangement: true,
  };
  const named = structuredClone(p);
  named.title = "New title";
  named.patterns[0].name = "New name";
  named.activePattern = "p2";
  assert.equal(
    studioProjectSnapshot(named, true, remembered).playback.programmeGain,
    4,
  );
  named.tracks[0].volume = 0.2;
  assert.deepEqual(studioProjectSnapshot(named, true, remembered).playback, {
    mode: "chain",
  });
  assert.deepEqual(studioProjectSnapshot(p, false, remembered).playback, {
    mode: "pattern",
  });
});

test("pattern preview level belongs to its selected pattern", () => {
  const p = withPatternLoops(newComposition());
  const remembered = {
    key: studioPlaybackKey(p, false),
    gain: 2,
    arrangement: false,
  };
  assert.equal(
    studioProjectSnapshot(p, false, remembered).playback.programmeGain,
    2,
  );
  p.activePattern = "p2";
  assert.deepEqual(studioProjectSnapshot(p, false, remembered).playback, {
    mode: "pattern",
  });
});

test("legacy projects remain valid and malformed playback metadata cannot enter a save", () => {
  const p = withPatternLoops(newComposition());
  assert.deepEqual(validateProject(p, compositionRegistry), p);
  for (const playback of [
    null,
    [],
    { mode: "other" },
    { mode: "chain", programmeGain: 0 },
    { mode: "chain", programmeGain: 17 },
    { mode: "chain", programmeGain: NaN },
    { mode: "chain", programmeGain: 2, extra: true },
  ])
    assert.throws(() =>
      validateProject({ ...p, playback }, compositionRegistry),
    );
  p.playback = { mode: "chain", programmeGain: 2 };
  assert(reverseReasons(p).includes("mix"));
});
