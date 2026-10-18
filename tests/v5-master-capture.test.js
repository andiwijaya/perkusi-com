import test from "node:test";
import assert from "node:assert/strict";
import catalog from "../internal/instrument-focus/registry-48000.json" with { type: "json" };
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import { Transport } from "../src/audio/transport.js";
import { MasterClock } from "../src/loop-station/master-clock.js";
import {
  MasterCaptureClock,
  freezeCaptureProject,
} from "../src/loop-station/master-capture-clock.js";
import { emptyLoopProject } from "../src/loop-station/model.js";
import { PcmWindow } from "../src/loop-station/pcm-window.js";
const registry = new InstrumentRegistry(catalog.banks);
function fixture(rate = 48000, bpm = 173) {
  const input = {
    ...structuredClone(emptyLoopProject(registry)),
    timing: { bpm, meter: [4, 4] },
  };
  const project = freezeCaptureProject(input, registry, rate),
    context = { sampleRate: rate, state: "running", currentTime: 0.137 },
    transport = new Transport({ bpm });
  transport.beatSeconds = 60 / new MasterClock(project, rate).effectiveBpm;
  transport.start(0.1);
  return {
    input,
    project,
    context,
    transport,
    clock: new MasterCaptureClock(context, transport, project, registry),
  };
}
test("frozen1/2/4/8bar capture plans share exact one-bar quantum across tempo/rate/count-in and distant epochs", () => {
  for (const rate of [44100, 48000])
    for (const bpm of [60, 73, 96, 127.3, 173, 180])
      for (const at of [0.137, 27.321, 300.123, 36000.891]) {
        const f = fixture(rate, bpm),
          before = JSON.stringify(f.input);
        f.context.currentTime = at;
        for (const countInBars of [0, 1, 2])
          for (const bars of [1, 2, 4, 8]) {
            const p = f.clock.plan({ bars, countInBars });
            assert.equal(
              p.endFrame - p.startFrame,
              bars * f.project.clock.framesPerBar,
            );
            assert.equal(
              p.startFrame - p.countInFrame,
              countInBars * f.project.clock.framesPerBar,
            );
            assert.equal(
              (p.startFrame - p.transportOriginFrame) % p.framesPerBar,
              0,
            );
            assert.equal(f.clock.frameAtBeat(p.startBeat), p.startFrame);
            assert.equal(f.clock.frameAtBeat(p.endBeat), p.endFrame);
            assert.ok(p.countInFrame > Math.ceil((at + 0.1) * rate));
            assert.equal(p.bpm, bpm);
            assert.equal(JSON.stringify(f.input), before);
          }
      }
});
test("old independently rounded two-bar capture differs at173BPM, canonical adapter prevents inconsistent subperiods", () => {
  const f = fixture();
  assert.equal(f.project.clock.framesPerBar, 66590);
  assert.equal(
    f.clock.plan({ bars: 2 }).endFrame - f.clock.plan({ bars: 2 }).startFrame,
    133180,
  );
  assert.equal(Math.round((8 * 60 * 48000) / 173), 133179);
  const before = JSON.stringify(f.project);
  assert.deepEqual(freezeCaptureProject(f.project, registry, 48000), f.project);
  assert.equal(JSON.stringify(f.project), before);
});
test("capture clock refuses unfrozen, changed-tempo/non-frame epoch, stopped/suspended or incompatible-rate state without mutating the owner", () => {
  const f = fixture(),
    origin = f.transport.origin;
  assert.throws(
    () => new MasterCaptureClock(f.context, f.transport, f.input, registry),
    { code: "captureClockNotFrozen" },
  );
  f.transport.beatSeconds = 60 / 96;
  assert.throws(() => f.clock.plan(), { code: "loopTempoLocked" });
  f.transport.beatSeconds = 60 / f.clock.master.effectiveBpm;
  f.transport.origin += 0.25 / 48000;
  assert.throws(() => f.clock.plan(), { code: "captureEpochMismatch" });
  f.transport.origin = origin;
  f.transport.running = false;
  assert.throws(() => f.clock.plan());
  f.transport.running = true;
  f.context.state = "suspended";
  assert.throws(() => f.clock.plan());
  f.context.state = "running";
  assert.throws(
    () =>
      new MasterCaptureClock(
        { ...f.context, sampleRate: 44100 },
        f.transport,
        f.project,
        registry,
      ),
    { code: "takeRateMismatch" },
  );
  assert.equal(f.transport.origin, origin);
});
test("malformed geometry/options and preexisting recording periods reject instead of silently freezing/repairing bytes", () => {
  const f = fixture(),
    p = structuredClone(f.input);
  p.assetRefs = [
    {
      id: "rec",
      kind: "recording",
      sha256: "a".repeat(64),
      bytes: 133179 * 4,
      frames: 133179,
      channels: 1,
      sampleRate: 48000,
      encoding: "float32le",
      recordedBpm: 173,
    },
  ];
  p.tracks[0].kind = "recording";
  p.tracks[0].clips = [
    {
      id: "rec-clip",
      sourceId: "rec",
      startTick: 0,
      lengthTicks: 8 * 960000,
      offsetFrames: 0,
      loop: true,
    },
  ];
  const before = JSON.stringify(p);
  assert.throws(() => freezeCaptureProject(p, registry, 48000), {
    code: "loopPeriodMismatch",
  });
  p.clock = f.project.clock;
  assert.throws(() => freezeCaptureProject(p, registry, 48000), {
    code: "loopPeriodMismatch",
  });
  p.clock = { kind: "musical" };
  assert.equal(JSON.stringify(p), before);
  for (const options of [
    { bars: 3 },
    { countInBars: 3 },
    { leadSeconds: 0 },
    { leadSeconds: NaN },
  ])
    assert.throws(() => f.clock.plan(options));
});
test("frozen capture PCM closes/repeats exact original samples at variable blocks and every supported bar length", () => {
  for (const rate of [44100, 48000])
    for (const bars of [1, 2, 4, 8]) {
      const f = fixture(rate),
        p = f.clock.plan({ bars, countInBars: 0 }),
        w = new PcmWindow({ ...p, channels: 1 }),
        length = p.endFrame - p.startFrame;
      let frame = p.startFrame - 17,
        n = 0;
      const sizes = [128, 192, 64, 1, 256];
      while (frame < p.endFrame + length + 1) {
        const size = sizes[n++ % sizes.length],
          input = Float32Array.from({ length: size }, (_, i) =>
            Math.fround((((frame + i) % 127) - 63) / 512),
          ),
          out = [new Float32Array(size)];
        w.consume([input], frame, size);
        w.render(out, frame, size);
        if (frame >= p.endFrame)
          for (let i = 0; i < size; i++)
            assert.equal(
              out[0][i],
              Math.fround(
                (((p.startFrame + ((frame + i - p.endFrame) % length)) % 127) -
                  63) /
                  512,
              ),
            );
        frame += size;
      }
      assert.equal(w.frames, length);
      assert.equal(w.reason, "complete");
      assert.equal(w.metadata().startFrame, p.startFrame);
    }
});
