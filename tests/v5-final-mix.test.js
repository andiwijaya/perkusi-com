import test from "node:test";
import assert from "node:assert/strict";
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import catalog from "../internal/instrument-focus/registry-48000.json" with { type: "json" };
import { emptyLoopProject } from "../src/loop-station/model.js";
import { validateLoopProject } from "../src/loop-station/project.js";
import {
  FLAT_EQ,
  BYPASS_LIMITER,
  eqBound,
  eqGains,
  hasEQ,
  softLimit,
  fxTailFrames,
} from "../src/loop-station/fx-model.js";
import { finalMixProgram } from "../src/loop-station/final-program.js";
import { MasterClock } from "../src/loop-station/master-clock.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { encodeFinalWav } from "../src/loop-station/final-wav.js";
import { loopAdmission } from "../src/loop-station/plan.js";
import { FinalMixExporter } from "../src/loop-station/final-export.js";
const registry = new InstrumentRegistry(catalog.banks);

test("final render owns its token before progress, rejects reentry, and honors immediate cancellation without allocating", async () => {
  const memory = new AudioMemory(),
    project = emptyLoopProject(registry);
  let allocations = 0,
    progress = 0;
  const exporter = new FinalMixExporter({
    memory,
    registry,
    documentStore: {},
    owner: {},
    contextFactory: () => {
      allocations++;
      throw Error("unexpected allocation");
    },
  });
  const first = exporter.render(project, {
    onProgress: () => {
      progress++;
      assert.throws(() => exporter.render(project), /finalMixBusy/);
      void exporter.cancel();
    },
  });
  assert.throws(() => exporter.render(project), /finalMixBusy/);
  await assert.rejects(first, /cancelled/);
  await exporter.cancel();
  assert.equal(progress, 1);
  assert.equal(allocations, 0);
  assert.equal(memory.snapshot().bytes, 0);
  const immediate = exporter.render(project);
  const cancelled = exporter.cancel();
  await assert.rejects(immediate, /cancelled/);
  await cancelled;
  assert.equal(exporter.pending, null);
  assert.equal(allocations, 0);
});
test("FX schema is additive, strict and preserves missing/default bypass parity", () => {
  const old = emptyLoopProject(registry);
  assert.deepEqual(validateLoopProject(old, registry), old);
  assert.equal(hasEQ(), false);
  assert.equal(eqBound(), 1);
  assert.equal(fxTailFrames(old, 48000), 0);
  const p = structuredClone(old);
  p.master.limiter = { ...BYPASS_LIMITER };
  p.tracks[0].eq = { ...FLAT_EQ, bypass: false };
  assert.deepEqual(validateLoopProject(p, registry), p);
  assert.equal(hasEQ(p.tracks[0].eq), false);
  for (const change of [
    (p) => (p.tracks[0].eq.lowDb = 7),
    (p) => (p.tracks[0].eq.version = 2),
    (p) => (p.master.limiter.kind = "lookahead"),
    (p) => (p.tracks[0].eq.feedback = 1),
  ]) {
    const n = structuredClone(p);
    change(n);
    assert.throws(() => validateLoopProject(n, registry));
  }
});
test("stable crossover impulse bound covers worst signed input and decays below threshold within declared100ms tail", () => {
  for (const rate of [44100, 48000])
    for (const lowDb of [-6, 0, 6])
      for (const midDb of [-6, 0, 6])
        for (const highDb of [-6, 0, 6]) {
          const eq = { version: 1, bypass: false, lowDb, midDb, highDb },
            g = eqGains(eq),
            bound = eqBound(eq),
            lo = Math.exp((-2 * Math.PI * 200) / rate),
            hi = Math.exp((-2 * Math.PI * 3000) / rate);
          let a = 0,
            b = 0,
            last = 0;
          for (let f = 0; f < 512 + Math.ceil(0.1 * rate); f++) {
            const x = f < 512 ? (f % 11 < 5 ? 0.2 : -0.2) : 0;
            a = (1 - lo) * x + lo * a;
            b = (1 - hi) * x + hi * b;
            last = g.high * x + g.upper * b + g.lower * a;
            assert.ok(Math.abs(last) <= bound * 0.2 + 1e-12);
          }
          assert.ok(Math.abs(last) < 1e-6);
        }
});
test("soft limiter preserves small values, is monotone and symmetric, and never grants admission credit for unsafe EQ", () => {
  assert.equal(softLimit(0.4), 0.4);
  assert.ok(softLimit(0.9) < 0.9);
  assert.ok(softLimit(0.9) > 0.8);
  let prior = -1;
  for (let i = 0; i <= 65536; i++) {
    const x = i / 32768 - 1,
      y = softLimit(x);
    assert.ok(y >= prior && Math.abs(y) <= 0.95);
    assert.equal(y, -softLimit(-x));
    prior = y;
  }
  const project = structuredClone(emptyLoopProject(registry));
  project.master.limiter = { ...BYPASS_LIMITER, bypass: false };
  project.tracks[0].eq = {
    ...FLAT_EQ,
    bypass: false,
    lowDb: 6,
    midDb: -6,
    highDb: 6,
  };
  const plan = {
    project,
    registry,
    clock: {
      rate: 48000,
      framesPerTick: 120000 / 3840000,
      frame: (tick) => (tick / 3840000) * 120000,
    },
    tracks: [
      {
        id: "track-1",
        clips: [
          {
            startTick: 0,
            lengthTicks: 3840000,
            loop: true,
            voices: [
              {
                frames: 120000,
                key: "a",
                tick: 0,
                dampTick: null,
                velocity: 1,
                scale: 4,
                pan: 0,
                peak: 0.3,
                buffer: { numberOfChannels: 2 },
              },
            ],
          },
        ],
      },
    ],
  };
  assert.throws(() => loopAdmission(plan, project), { code: "voiceHeadroom" });
});
test("final program uses exact bars, retains natural/FX tails and refuses silently truncating a recording cycle", () => {
  const project = structuredClone(emptyLoopProject(registry));
  project.clock = {
    kind: "fixed-bar",
    sampleRate: 48000,
    framesPerBar: 120000,
  };
  project.tracks[0].eq = { ...FLAT_EQ, bypass: false, lowDb: 1 };
  project.assetRefs = [{ id: "recording-1" }];
  const clip = {
    sourceId: "recording-1",
    startTick: 0,
    lengthTicks: 3840000,
    loop: true,
    voices: [
      {
        frames: 120000,
        key: "recording-1",
        tick: 0,
        dampTick: null,
        velocity: 1,
        scale: 4,
        pan: 0,
        peak: 0.01,
        buffer: { numberOfChannels: 2 },
      },
    ],
  };
  const plan = {
    project,
    registry,
    clock: new MasterClock(project, 48000),
    tracks: [{ id: "track-1", clips: [clip] }],
  };
  const p = finalMixProgram(plan, 4);
  assert.equal(p.events.length, 4);
  assert.equal(p.bodyFrames, 480000);
  assert.equal(p.tailFrames, 4800);
  assert.equal(p.frames, 484800);
  clip.lengthTicks *= 8;
  clip.voices[0].frames *= 8;
  assert.throws(() => finalMixProgram(plan, 4), {
    code: "finalMixPeriodMismatch",
  });
});
test("Float32 final stereo WAV encodes every output bit and credits, held through release", async () => {
  const memory = new AudioMemory(),
    channels = [
      new Float32Array([0.1, -0.2, -0, 0.3]),
      new Float32Array([-0.1, 0.2, 0.3, 0]),
    ],
    source = channels.map((a) => [...new Uint8Array(a.buffer)]),
    buffer = {
      length: 4,
      sampleRate: 48000,
      getChannelData: (c) => channels[c],
    },
    meta = { credits: "QA provenance", limiter: "bypass" };
  const result = await encodeFinalWav(buffer, meta, {
      memory,
      yieldTask: async () => {},
    }),
    data = await result.blob.arrayBuffer(),
    d = new DataView(data);
  assert.equal(d.getUint16(20, true), 3);
  assert.equal(d.getUint16(22, true), 2);
  assert.equal(d.getUint32(46, true), 4);
  assert.equal(d.getUint32(54, true), 32);
  for (let f = 0; f < 4; f++)
    for (let c = 0; c < 2; c++)
      assert.equal(
        d.getUint32(58 + (f * 2 + c) * 4, true),
        new DataView(channels[c].buffer).getUint32(f * 4, true),
      );
  assert.match(
    new TextDecoder().decode(new Uint8Array(data, 110)),
    /QA provenance/,
  );
  assert.deepEqual(
    channels.map((a) => [...new Uint8Array(a.buffer)]),
    source,
  );
  assert.ok(memory.snapshot().bytes > 0);
  result.release();
  result.release();
  assert.equal(memory.snapshot().bytes, 0);
});
test("final WAV rejects nonfinite/unsafe PCM and cancellation without clamping, output or a retained lease", async () => {
  for (const value of [NaN, 1, -0.951]) {
    const memory = new AudioMemory(),
      buffer = {
        length: 1,
        sampleRate: 48000,
        getChannelData: () => new Float32Array([value]),
      };
    await assert.rejects(encodeFinalWav(buffer, {}, { memory }), {
      code: "unsafeOutput",
    });
    assert.equal(memory.snapshot().bytes, 0);
  }
  const memory = new AudioMemory(),
    controller = new AbortController(),
    buffer = {
      length: 65536,
      sampleRate: 48000,
      getChannelData: () => new Float32Array(65536),
    };
  await assert.rejects(
    encodeFinalWav(
      buffer,
      {},
      {
        memory,
        signal: controller.signal,
        yieldTask: async () => controller.abort(),
      },
    ),
    { code: "cancelled" },
  );
  assert.equal(memory.snapshot().bytes, 0);
});
