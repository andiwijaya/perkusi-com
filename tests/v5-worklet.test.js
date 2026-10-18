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
  Processor = constructor;
};
await import("../src/loop-station/capture-worklet.js");

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
