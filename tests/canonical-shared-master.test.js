import test from "node:test";
import assert from "node:assert/strict";
import { AudioMemory } from "../src/audio/audio-memory.js";
import {
  prepareCanonicalScore,
  prepareCanonicalPlayback,
  canonicalPlaybackView,
} from "../src/audio/canonical-score.js";
import { canonicalPrintData } from "../src/audio/canonical-playback.js";
import {
  canonicalScoreFixture,
  qaBuffer,
} from "./helpers/canonical-score-fixtures.js";
import { reviewSequence } from "./helpers/canonical-finish-fixtures.js";
import { renderPortableMix } from "../src/loop-station/portable-mix.js";
import { BYPASS_LIMITER } from "../src/loop-station/fx-model.js";

test("shared-master live view preserves every event/gain/tail and the original export policy", async () => {
  const memory = new AudioMemory(),
    foreign = memory.reserve(313, "foreign"),
    f = await canonicalScoreFixture(48000, memory, qaBuffer, {
      profile: "single",
    });
  f.canonical.master.limiter.bypass = false;
  const before = JSON.stringify(f.canonical),
    score = await prepareCanonicalScore(f.canonical, {
      ...f,
      rate: 48000,
      memory,
      createBuffer: qaBuffer,
      sharedMaster: true,
    });
  try {
    const view = canonicalPlaybackView(score, 0, { sharedMaster: true });
    assert.equal(view.project.master.limiter.bypass, true);
    assert.equal(score.project.master.limiter.bypass, false);
    assert.equal(
      canonicalPlaybackView(score).project.master.limiter.bypass,
      false,
    );
    assert.equal(view.project.master.volume, score.project.master.volume);
    assert.equal(view.program, score.program);
    assert.equal(view.project.tracks, score.project.tracks);
    assert.equal(JSON.stringify(f.canonical), before);
  } finally {
    score.dispose();
  }
  assert.equal(memory.snapshot().bytes, 313);
  foreign.release();
});
test("long shared-master print keeps original admission and full EQ/tail history; independent normal print stays available", async () => {
  const memory = new AudioMemory(),
    foreign = memory.reserve(313, "foreign"),
    f = await reviewSequence(48000, memory, qaBuffer, "single");
  f.canonical.master.limiter.bypass = false;
  const before = JSON.stringify(f.canonical),
    score = await prepareCanonicalScore(f.canonical, {
      ...f,
      rate: 48000,
      memory,
      createBuffer: qaBuffer,
      sharedMaster: true,
      yieldTask: async () => {},
    });
  try {
    assert.equal(score.program.events.length, 17);
    assert(score.admission.maxOwned <= 16);
    assert(score.admission.maxPeak <= 0.95);
    const view = canonicalPlaybackView(score, 0, { sharedMaster: true }),
      data = canonicalPrintData(view.program.events[0].spec.print);
    assert.equal(view.program.frames, score.program.frames);
    assert.equal(data.frames, score.program.frames);
    assert.throws(
      () => canonicalPlaybackView(score),
      (e) => e.code === "canonicalPlaybackNotPrepared",
    );
    let at = 0;
    await renderPortableMix(
      { createBuffer: qaBuffer },
      {
        ...score.project,
        master: { ...score.project.master, limiter: BYPASS_LIMITER },
      },
      score.program,
      {
        analysisOnly: true,
        boundedSourceViews: true,
        yieldTask: async () => {},
        onChunk(channels) {
          for (let c = 0; c < 2; c++)
            for (let i = 0; i < channels[c].length; i++)
              assert.equal(channels[c][i], data.channels[c][at + i]);
          at += channels[0].length;
        },
      },
    );
    assert.equal(at, score.program.frames);
    await prepareCanonicalPlayback(score, {
      memory,
      createBuffer: qaBuffer,
      yieldTask: async () => {},
    });
    const normal = canonicalPlaybackView(score);
    assert.notEqual(
      normal.program.events[0].spec.print,
      view.program.events[0].spec.print,
    );
    assert.equal(normal.program.frames, view.program.frames);
    assert.equal(JSON.stringify(f.canonical), before);
  } finally {
    score.dispose();
  }
  assert.equal(memory.snapshot().bytes, 313);
  foreign.release();
});
