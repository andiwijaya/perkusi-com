// Retained shared/data assertions extracted before failed-feature retirement.
import test from "node:test";
import assert from "node:assert/strict";
import { newComposition } from "../src/project/composition-model.js";
import {
  legacyCycleGeometry,
  renderLegacyCycles,
} from "../src/audio/legacy-cycles.js";
import { reference } from "./helpers/legacy-continuous-reference.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { prepareLegacyContinuous } from "../src/audio/legacy-bus.js";
import { readFile } from "node:fs/promises";

function fixture(rate, loop = false, bpm = 96) {
  const p = newComposition();
  p.timing.bpm = bpm;
  p.master.volume = 0.31;
  p.patterns[0].steps.kick[1] = 0.4;
  p.patterns[0].steps.kick[15] = 0.7;
  p.patterns[0].notes[2] = { pitch: "d4", velocity: 0.3 };
  p.patterns[0].notes[15] = { pitch: "g4", velocity: 0.5 };
  p.tracks[0].pan = -0.3;
  p.tracks[0].volume = 0.6;
  const context = {
      createBuffer(channels, length, sampleRate) {
        const data = Array.from(
          { length: channels },
          () => new Float32Array(length),
        );
        return {
          numberOfChannels: channels,
          length,
          sampleRate,
          duration: length / sampleRate,
          getChannelData: (c) => data[c],
        };
      },
    },
    make = (seconds, channels = 1) => {
      const b = context.createBuffer(
        channels,
        Math.round(seconds * rate),
        rate,
      );
      for (let c = 0; c < channels; c++)
        for (let i = 0; i < b.length; i++)
          b.getChannelData(c)[i] = Math.fround(
            (0.15 + Math.sin(i * 0.013 + c) * 0.1) * (1 - i / b.length),
          );
      return { buffer: b, stem: { gainTrim: 0.5 } };
    },
    entry = make(1),
    loopEntry = make(5, 2),
    bank = { get: () => entry },
    period = (240 / bpm) * rate,
    groups = [
      {
        gain: 0.6,
        pan: -0.3,
        trim: 0.5,
        channels: 1,
        events: [1, 15].map((step, i) => ({
          at: Math.round((step * period) / 16),
          velocity: i ? 0.7 : 0.4,
          left: entry.buffer.getChannelData(0),
          right: entry.buffer.getChannelData(0),
        })),
      },
    ];
  groups.push({
    gain: p.instrument.volume,
    pan: p.instrument.pan,
    trim: 0.5,
    channels: 1,
    events: [2, 15].map((step, i) => ({
      at: Math.round((step * period) / 16),
      velocity: i ? 0.5 : 0.3,
      left: entry.buffer.getChannelData(0),
      right: entry.buffer.getChannelData(0),
    })),
  });
  let extras = { banks: { instrument: { get: () => entry } } };
  if (loop) {
    p.clips = [
      {
        role: "vocal-bass",
        enabled: true,
        variant: 1,
        volume: 0.4,
        pan: 0.2,
        mute: false,
        solo: false,
      },
    ];
    extras = {
      banks: { loop: () => loopEntry, instrument: { get: () => entry } },
    };
    groups.splice(1, 0, {
      gain: 0.4,
      pan: 0.2,
      trim: 0.5,
      channels: 2,
      loop: true,
      left: loopEntry.buffer.getChannelData(0),
      right: loopEntry.buffer.getChannelData(1),
    });
  }
  return {
    context,
    project: p,
    bank,
    extras,
    rate,
    periodFrames: period,
    yieldTask: async () => {},
    groups,
    period,
  };
}

for (const rate of [44100, 48000])
  for (const loops of [false, true])
    for (const bpm of loops ? [96] : [60, 96, 180])
      test(`continuous ${rate} bpm=${bpm} original-loop=${loops}: full first/steady/terminal chronology without boundary fade`, async () => {
        const f = fixture(rate, loops, bpm),
          before = f.bank.get().buffer.getChannelData(0).slice(),
          r = await renderLegacyCycles(f),
          cycles = 5,
          expected = reference({
            rate,
            period: f.period,
            cycles,
            master: f.project.master.volume,
            groups: f.groups,
          }),
          actual = [
            new Float32Array(expected[0].length),
            new Float32Array(expected[0].length),
          ];
        for (let cycle = 0; cycle < cycles; cycle++) {
          const state =
              r.states[cycle === 0 ? 0 : 1 + ((cycle - 1) % r.phases)],
            n = cycle === cycles - 1 ? state.frames : r.periodFrames;
          for (let c = 0; c < 2; c++)
            actual[c].set(
              state.buffer.getChannelData(c).subarray(0, n),
              cycle * f.period,
            );
        }
        let error = 0;
        for (let c = 0; c < 2; c++)
          for (let n = 0; n < expected[c].length; n++)
            error = Math.max(error, Math.abs(actual[c][n] - expected[c][n]));
        assert.ok(error < 2e-6, `all-frame maxerror ${error}`);
        assert.ok(
          actual[0].subarray(cycles * f.period).some((x) => Math.abs(x) > 1e-5),
        );
        assert.notEqual(
          r.states[0].buffer.getChannelData(0)[0],
          r.states[1].buffer.getChannelData(0)[0],
        );
        assert.deepEqual(f.bank.get().buffer.getChannelData(0), before);
        assert.ok(r.maxLogicalVoices <= 16);
        assert.equal(r.states.length, loops ? 3 : 2);
      });

test("unsupported fractional periods refuse; source is untouched and cancellation waits on its real render yield", async () => {
  const f = fixture(48000),
    before = JSON.stringify(f.project);
  f.project.timing.bpm = 173;
  assert.throws(() => legacyCycleGeometry(f.project, 48000, 66590), {
    code: "legacyLoopClockUnsupported",
  });
  f.project.timing.bpm = 96;
  assert.equal(JSON.stringify(f.project), before);
  const abort = new AbortController();
  let resume, entered;
  const gate = new Promise((r) => (resume = r)),
    ready = new Promise((r) => (entered = r));
  const job = renderLegacyCycles({
    ...f,
    signal: abort.signal,
    yieldTask: async () => {
      entered();
      await gate;
    },
  });
  await ready;
  abort.abort();
  let done = false;
  const rejected = assert
    .rejects(job, (e) => e.code === "cancelled")
    .then(() => (done = true));
  await Promise.resolve();
  assert.equal(done, false);
  resume();
  await rejected;
});

test("continuous preparation uses real licensed assets, refuses pressure before fetch and retains cancelled ownership until native close", async (t) => {
  const f = fixture(48000),
    memory = new AudioMemory(),
    prior = globalThis.fetch;
  let fetches = 0,
    unblock,
    closeStarted,
    blockRender,
    renderStarted;
  const closeGate = new Promise((r) => (unblock = r)),
    closing = new Promise((r) => (closeStarted = r)),
    renderGate = new Promise((r) => (blockRender = r)),
    rendering = new Promise((r) => (renderStarted = r));
  globalThis.fetch = async (url) => {
    fetches++;
    return new Response(await readFile(new URL(".." + url, import.meta.url)));
  };
  t.after(() => {
    globalThis.fetch = prior;
    unblock();
    blockRender();
  });
  const context = {
    ...f.context,
    state: "suspended",
    sampleRate: 48000,
    async startRendering() {
      closeStarted();
      await closeGate;
      context.state = "closed";
    },
  };
  const large = structuredClone(f.project);
  large.timing.bpm = 60;
  large.chain = Array(8).fill("p1");
  await assert.rejects(
    prepareLegacyContinuous(
      { composition: large },
      {
        memory,
        rate: 48000,
        periodFrames: 32 * 48000,
        contextFactory: () =>
          assert.fail("must refuse before native allocation"),
      },
    ),
    (e) => e.code === "combinedMemoryLimit",
  );
  assert.equal(fetches, 0);
  const foreign = memory.reserve(63 * 1024 * 1024, "preserved foreign owner");
  await assert.rejects(
    prepareLegacyContinuous(
      { composition: f.project },
      {
        memory,
        rate: 48000,
        periodFrames: f.period,
        contextFactory: () => context,
      },
    ),
    (e) => e.code === "combinedMemoryLimit",
  );
  assert.equal(fetches, 0);
  foreign.release();
  const abort = new AbortController();
  const job = prepareLegacyContinuous(
    { composition: f.project },
    {
      memory,
      rate: 48000,
      periodFrames: f.period,
      signal: abort.signal,
      contextFactory: () => context,
      yieldTask: async () => {
        renderStarted();
        await renderGate;
      },
    },
  );
  const checked = assert.rejects(job, (e) => e.code === "cancelled");
  await rendering;
  abort.abort();
  assert.ok(memory.snapshot().bytes > 0);
  blockRender();
  await closing;
  assert.ok(memory.snapshot().bytes > 0);
  assert.equal(context.state, "suspended");
  unblock();
  await checked;
  assert.equal(memory.snapshot().bytes, 0);
  assert.equal(context.state, "closed");
  assert.equal(memory.snapshot().globalDecodes.nativeDecodes, 0);
});

test("legacy internal source polyphony over16 refuses rather than hiding overlap in one prepared bus", async () => {
  const f = fixture(48000);
  for (const track of f.project.tracks)
    f.project.patterns[0].steps[track.role] = Array.from(
      { length: 16 },
      (_, i) => ([1, 15].includes(i) ? 0.4 : 0),
    );
  // One early and one late shot per role: lengthen QA-only source so both
  // choke-release voices overlap at the new attack, including the Bilah group.
  const long = f.context.createBuffer(1, 4 * 48000, 48000);
  long.getChannelData(0).fill(0.01);
  const e = { buffer: long, stem: { gainTrim: 0.2 } };
  f.bank = { get: () => e };
  f.extras = { banks: { instrument: { get: () => e } } };
  f.project.patterns[0].notes[1] = { pitch: "d4", velocity: 0.2 };
  f.project.patterns[0].notes[2] = null;
  await assert.rejects(renderLegacyCycles(f), (e) => e.code === "voiceLimit");
});
