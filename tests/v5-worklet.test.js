import { nativeParameters } from "./helpers/worklet-frame-clock.js";
import test from "node:test";
import assert from "node:assert/strict";

// Execute the actual product processor with transfer detachment and an audio
// clock. This is a deterministic unit harness, not native/hardware evidence.
let Processor;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.port = {
      messages: [],
      postMessage(data, transfer = []) {
        this.messages.push(structuredClone(data, { transfer }));
      },
    };
  }
};
globalThis.sampleRate = 48000;
globalThis.registerProcessor = (name, constructor) => {
  assert.equal(name, "perkusi-loop-capture-v5");
  Processor = class extends constructor {
    process(
      inputs,
      outputs,
      parameters = nativeParameters(
        globalThis.currentFrame,
        outputs[0][0].length,
      ),
    ) {
      return super.process(inputs, outputs, parameters);
    }
  };
};
await import("../src/loop-station/capture-worklet.js");

test("stale global metadata cannot repeat native input; a repeated native timeline still terminates exact partial capture", () => {
  const make = () =>
    new Processor({
      processorOptions: {
        startFrame: 0,
        endFrame: 512,
        channels: 1,
        sampleRate: 48000,
        replay: false,
      },
    });
  const run = (p, frame, nativeFrame = frame) => {
    globalThis.currentFrame = 0; // Deliberately stale on every callback.
    const input = Float32Array.from(
      { length: 128 },
      (_, i) => (frame + i) / 1024,
    );
    p.process(
      [[input]],
      [[new Float32Array(128)]],
      nativeParameters(nativeFrame, 128),
    );
  };
  const healthy = make();
  for (const frame of [0, 128, 256, 384]) run(healthy, frame);
  assert.equal(healthy.window.reason, "complete");
  assert.deepEqual(
    healthy.window.data[0],
    Float32Array.from({ length: 512 }, (_, i) => i / 1024),
  );
  const repeated = make();
  run(repeated, 0);
  run(repeated, 128, 0);
  assert.equal(repeated.window.reason, "frameGap");
  assert.equal(repeated.window.frames, 128);
  assert.equal(repeated.captureFault.observedFrame, 0);
});

for (const delta of [128, -128])
  test(`first capture fault ${delta} is atomic through later callbacks and delayed ACK, with exact recoverable prefix`, () => {
    const p = new Processor({
      processorOptions: {
        startFrame: 115287,
        endFrame: 220014,
        channels: 2,
        sampleRate: 48000,
        replay: false,
      },
    });
    const process = (frame) => {
      globalThis.currentFrame = frame;
      const output = [[new Float32Array(128), new Float32Array(128)]];
      p.process(
        [[new Float32Array(128).fill(0.2), new Float32Array(128).fill(-0.1)]],
        output,
      );
      assert(output[0].every((c) => c.every((x) => x === 0)));
    };
    for (let frame = 115200; frame < 199040; frame += 128) process(frame);
    process(199040 + delta);
    const first = structuredClone(p.captureFault);
    assert.equal(first.expectedFrame, 199040);
    assert.equal(first.observedFrame, 199040 + delta);
    assert.equal(first.previousFrame, 198912);
    assert.equal(first.previousBlockSize, 128);
    assert.equal(first.capturedFrames, 83753);
    for (const frame of [199296, 199424]) process(frame);
    assert.deepEqual(p.captureFault, first);
    let cursor = 0,
      frames = 0;
    while (cursor < p.port.messages.length) {
      const m = p.port.messages[cursor++];
      if (m.type === "pcm") {
        assert.equal(m.offset, frames);
        frames += m.frames;
        assert(
          new Float32Array(m.buffers[0]).every((x) => x === Math.fround(0.2)),
        );
        assert(
          new Float32Array(m.buffers[1]).every((x) => x === Math.fround(-0.1)),
        );
        p.port.onmessage({ data: { type: "ack", sequence: m.sequence } });
      }
    }
    assert.equal(frames, 83753);
    const complete = p.port.messages.find((m) => m.type === "complete"),
      closed = p.port.messages.find((m) => m.type === "closed");
    assert.equal(complete.reason, "frameGap");
    assert.deepEqual(complete.captureFault, first);
    assert.deepEqual(closed.captureFault, first);
    assert.equal(closed.lastProcessFrame, 199424);
  });

for (const channels of [1, 2])
  test(`record-only processor preserves ${channels}-channel input exactly, stays silent and closes only after transfer ACK`, () => {
    const startFrame = 101,
      endFrame = 12101,
      p = new Processor({
        processorOptions: {
          startFrame,
          endFrame,
          channels,
          sampleRate: 48000,
          replay: false,
        },
      }),
      expected = (f, c) =>
        f === 101 ? -0 : Math.fround((((f * (c + 1)) % 31) - 15) / 16),
      copied = Array.from(
        { length: channels },
        () => new Float32Array(endFrame - startFrame),
      );
    let frame = 0,
      n = 0;
    while (frame < 30000) {
      const size = [64, 128, 192, 256][n++ % 4];
      globalThis.currentFrame = frame;
      const output = [
        Array.from({ length: channels }, () => new Float32Array(size).fill(9)),
      ];
      p.process(
        [
          Array.from({ length: channels }, (_, c) =>
            Float32Array.from({ length: size }, (_, i) =>
              expected(frame + i, c),
            ),
          ),
        ],
        output,
      );
      assert(output[0].every((c) => c.every((x) => x === 0)));
      assert(p.pending.size <= 2);
      frame += size;
    }
    assert.equal(
      p.closed,
      false,
      "unacknowledged PCM still owns the processor",
    );
    assert.equal(
      p.port.messages.filter((m) => m.type === "complete").length,
      0,
    );
    let cursor = 0;
    while (cursor < p.port.messages.length) {
      const m = p.port.messages[cursor++];
      if (m.type === "pcm") {
        for (let c = 0; c < channels; c++)
          copied[c].set(new Float32Array(m.buffers[c]), m.offset);
        p.port.onmessage({ data: { type: "ack", sequence: m.sequence } });
      }
    }
    for (let c = 0; c < channels; c++)
      assert.deepEqual(
        copied[c],
        Float32Array.from({ length: endFrame - startFrame }, (_, f) =>
          expected(startFrame + f, c),
        ),
      );
    const complete = p.port.messages.filter((m) => m.type === "complete");
    assert.equal(complete.length, 1);
    assert.equal(complete[0].reason, "complete");
    assert.equal(p.port.messages.at(-1).type, "closed");
    assert.equal(p.window, null);
  });

test("processor rejects an invalid replay mode before accepting input", () => {
  assert.throws(
    () =>
      new Processor({
        processorOptions: {
          startFrame: 128,
          endFrame: 512,
          channels: 1,
          sampleRate: 48000,
          replay: "false",
        },
      }),
    /invalidReplayMode/,
  );
});

test("bounded transfer backpressure cannot move record-to-repeat boundary; actual processor supports changing blocks", () => {
  const startFrame = 101,
    endFrame = 12101,
    channels = 1;
  const p = new Processor({
    processorOptions: { startFrame, endFrame, channels, sampleRate: 48000 },
  });
  const expected = (f) => Math.fround(((f % 31) - 15) / 16);
  let frame = 0,
    n = 0;
  while (frame < 30000) {
    const size = [64, 128, 192, 256][n++ % 4];
    globalThis.currentFrame = frame;
    const output = [[new Float32Array(size)]];
    p.process(
      [[Float32Array.from({ length: size }, (_, i) => expected(frame + i))]],
      output,
    );
    for (let i = 0; i < size; i++)
      assert.equal(
        output[0][0][i],
        frame + i < endFrame
          ? 0
          : expected(startFrame + ((frame + i - endFrame) % 12000)),
      );
    assert.ok(p.pending.size <= 2);
    frame += size;
  }
  assert.equal(
    p.port.messages.filter((m) => m.type === "pcm").length,
    2,
    "main thread has acknowledged nothing; only two chunks are queued",
  );
  let cursor = 0;
  const copied = new Float32Array(12000);
  while (cursor < p.port.messages.length) {
    const m = p.port.messages[cursor++];
    if (m.type === "pcm") {
      copied.set(new Float32Array(m.buffers[0]), m.offset);
      p.port.onmessage({ data: { type: "ack", sequence: m.sequence } });
    }
  }
  const complete = p.port.messages.filter((m) => m.type === "complete");
  assert.equal(complete.length, 1);
  assert.equal(complete[0].frames, 12000);
  assert.deepEqual(
    complete[0].blockSizes.sort((a, b) => a - b),
    [64, 128, 192, 256],
  );
  for (let i = 0; i < copied.length; i++)
    assert.equal(copied[i], expected(startFrame + i));
  p.port.onmessage({ data: { type: "stop", reason: "userStop" } });
  assert.equal(p.port.messages.at(-1).type, "closed");
  assert.equal(p.port.messages.at(-1).nextOutputFrame, frame);
  assert.equal(p.port.messages.at(-1).startFrame, startFrame);
  assert.equal(p.port.messages.at(-1).endFrame, endFrame);
  assert.equal(p.window, null);
});

test("actual processor reports early stop prefix and never emits live input to output", () => {
  const p = new Processor({
    processorOptions: {
      startFrame: 0,
      endFrame: 48000,
      channels: 1,
      sampleRate: 48000,
    },
  });
  globalThis.currentFrame = 0;
  const output = [[new Float32Array(256)]];
  p.process([[new Float32Array(256).fill(1.25)]], output);
  assert.ok(output[0][0].every((v) => v === 0));
  p.port.onmessage({ data: { type: "stop", reason: "inputLost" } });
  const m = p.port.messages.find((m) => m.type === "pcm");
  assert.equal(m.frames, 256);
  assert.ok(new Float32Array(m.buffers[0]).every((v) => v === 1.25));
  p.port.onmessage({ data: { type: "ack", sequence: m.sequence } });
  const complete = p.port.messages.find((m) => m.type === "complete");
  assert.equal(complete.reason, "inputLost");
  assert.equal(complete.frames, 256);
  assert.equal(p.port.messages.at(-1).type, "closed");
  assert.equal(p.port.messages.at(-1).nextOutputFrame, 256);
});

test("close before the first process reports no native output frontier and cannot invent writes", () => {
  const p = new Processor({
    processorOptions: {
      startFrame: 128,
      endFrame: 512,
      channels: 2,
      sampleRate: 48000,
    },
  });
  p.port.onmessage({ data: { type: "stop", reason: "userStop" } });
  const closed = p.port.messages.at(-1);
  assert.equal(closed.type, "closed");
  assert.equal(closed.nextOutputFrame, null);
  assert.equal(closed.lastProcessFrame, null);
  assert.equal(p.window, null);
  globalThis.currentFrame = 0;
  const out = [[new Float32Array(128), new Float32Array(128)]];
  assert.equal(p.process([], out), false);
  assert(out[0].every((a) => a.every((v) => v === 0)));
});
