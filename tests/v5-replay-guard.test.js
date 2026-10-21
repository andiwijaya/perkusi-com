import { nativeParameters } from "./helpers/worklet-frame-clock.js";
import test from "node:test";
import assert from "node:assert/strict";

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
globalThis.registerProcessor = (_, value) => {
  Processor = class extends value {
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
const value = (f, c = 0) =>
  (((f * 65537 + c * 104729) % 8388593) - 4194296) / 8388608;
const input = (f, size, channels = 2) =>
  Array.from({ length: channels }, (_, c) =>
    Float32Array.from({ length: size }, (_, i) => value(f + i, c)),
  );
const make = (startFrame = 101, endFrame = 523) =>
  new Processor({
    processorOptions: { startFrame, endFrame, sampleRate: 48000, channels: 2 },
  });
function block(p, frame, size = 128, data = input(frame, size)) {
  globalThis.currentFrame = frame;
  const output = [
    new Float32Array(size).fill(9),
    new Float32Array(size).fill(9),
  ];
  p.process([data], [output]);
  return output;
}
function capture(p) {
  let frame = 0;
  while (p.window.reason !== "complete") {
    block(p, frame);
    frame += 128;
  }
  return frame;
}
function drain(p) {
  const data = [[], []];
  let i = 0;
  while (i < p.port.messages.length) {
    const m = p.port.messages[i++];
    if (m.type === "pcm") {
      for (let c = 0; c < 2; c++)
        data[c].push(...new Float32Array(m.buffers[c]));
      p.port.onmessage({ data: { type: "ack", sequence: m.sequence } });
    }
  }
  return data;
}

test("healthy variable-size replay preserves exact same-block handoff and absent input is valid", () => {
  for (const end of [512, 523]) {
    const p = make(101, end);
    let f = 0,
      n = 0;
    while (f < end + 2 * (end - 101) + 256) {
      const size = [64, 128, 192, 256][n++ % 4];
      const out = block(
        p,
        f,
        size,
        p.window.reason === "complete" ? [] : input(f, size),
      );
      for (let c = 0; c < 2; c++)
        for (let i = 0; i < size; i++)
          assert.equal(
            out[c][i],
            f + i < end ? 0 : value(101 + ((f + i - end) % (end - 101)), c),
          );
      f += size;
    }
    assert.equal(
      p.port.messages.filter((m) => m.type === "playback-error").length,
      0,
    );
    const data = drain(p);
    for (let c = 0; c < 2; c++)
      assert.deepEqual(data[c], Array.from(input(101, end - 101)[c]));
    p.port.onmessage({ data: { type: "stop" } });
    assert.equal(p.closed, true);
  }
});

for (const end of [512, 523])
  for (const late of [false, true]) {
    test(`first bad replay block is wholly silent and terminal, end=${end} late=${late}`, () => {
      const cases = [
        "duplicate",
        "backward",
        "forward",
        "negative",
        "fractional",
        "nan",
        "unsafe",
        "zero-size",
        "large-size",
      ];
      for (const kind of cases)
        for (const size of [64, 128, 192, 256]) {
          const p = make(101, end);
          let next = capture(p),
            previous = next - 128;
          if (late)
            for (let i = 0; i < 3; i++) {
              block(p, next, size, []);
              previous = next;
              next += size;
            }
          let frame = next,
            actualSize = size;
          if (kind === "duplicate") frame = previous;
          if (kind === "backward") frame = previous - 128;
          if (kind === "forward") frame += size;
          if (kind === "negative") frame = -1;
          if (kind === "fractional") frame += 0.5;
          if (kind === "nan") frame = NaN;
          if (kind === "unsafe") frame = Number.MAX_SAFE_INTEGER - 63;
          if (kind === "zero-size") actualSize = 0;
          if (kind === "large-size") actualSize = 16385;
          const out = block(p, frame, actualSize, []);
          assert.ok(
            out.every((a) => a.every((v) => v === 0)),
            kind,
          );
          assert.equal(
            p.port.messages.filter((m) => m.type === "playback-error").length,
            1,
            kind,
          );
          assert.equal(p.window.reason, "complete");
          for (let i = 0; i < 3; i++)
            assert.ok(
              block(p, next + i * size, size, []).every((a) =>
                a.every((v) => v === 0),
              ),
            );
          const data = drain(p);
          for (let c = 0; c < 2; c++)
            assert.deepEqual(data[c], Array.from(input(101, end - 101)[c]));
          assert.equal(
            p.port.messages.filter((m) => m.type === "complete").length,
            1,
          );
          assert.equal(
            p.port.messages.find((m) => m.type === "complete").reason,
            "complete",
          );
          assert.equal(
            p.port.messages.filter((m) => m.type === "closed").length,
            1,
          );
          assert.ok(
            block(p, next + 1000, size, []).every((a) =>
              a.every((v) => v === 0),
            ),
          );
          assert.equal(
            p.port.messages.filter((m) => m.type === "playback-error").length,
            1,
          );
        }
    });
  }

test("fault with two chunks in flight drains final short chunk before complete/closed, without changing original", () => {
  const p = make(101, 12101),
    next = capture(p);
  assert.equal(p.pending.size, 2);
  block(p, next - 128, 128, []);
  assert.equal(p.closed, false);
  assert.equal(p.port.messages.filter((m) => m.type === "complete").length, 0);
  const original = drain(p);
  for (let c = 0; c < 2; c++)
    assert.deepEqual(original[c], Array.from(input(101, 12000)[c]));
  const types = p.port.messages.map((m) => m.type);
  assert.ok(types.indexOf("playback-error") < types.indexOf("complete"));
  assert.ok(types.indexOf("complete") < types.indexOf("closed"));
  assert.equal(p.pending.size, 0);
});

test("replay fault during final chunk or after completion receipt emits one fault and retains successful capture", () => {
  for (const phase of ["final-chunk", "after-complete"]) {
    const p = make(101, 12101),
      next = capture(p);
    if (phase === "final-chunk") {
      p.port.onmessage({ data: { type: "ack", sequence: 0 } });
      assert.ok(p.pending.has(2));
    } else drain(p);
    assert.ok(
      block(p, next - 128, 128, []).every((a) => a.every((v) => v === 0)),
    );
    drain(p);
    assert.equal(
      p.port.messages.filter((m) => m.type === "playback-error").length,
      1,
    );
    assert.equal(
      p.port.messages.filter((m) => m.type === "complete").length,
      1,
    );
    assert.equal(
      p.port.messages.find((m) => m.type === "complete").reason,
      "complete",
    );
    assert.equal(p.closed, true);
  }
});

test("recording keeps missing input/channel/PCM and real or repeated-frame refusals; silence/overrange survives", () => {
  for (const kind of [
    "inputLost",
    "channelsChanged",
    "invalidPCM",
    "forward",
    "duplicate",
  ]) {
    const p = make(0, 1024);
    block(p, 0);
    block(p, 128);
    let frame = 256,
      data = input(256, 128);
    if (kind === "inputLost") data = [];
    if (kind === "channelsChanged") data = input(256, 128, 1);
    if (kind === "invalidPCM") data[0][3] = NaN;
    if (kind === "forward") frame = 384;
    if (kind === "duplicate") frame = 128;
    block(p, frame, 128, data);
    assert.equal(p.window.frames, 256);
    assert.equal(
      p.window.reason,
      ["forward", "duplicate"].includes(kind) ? "frameGap" : kind,
    );
    assert.equal(
      p.port.messages.filter((m) => m.type === "playback-error").length,
      0,
    );
    const original = drain(p);
    for (let c = 0; c < 2; c++)
      assert.deepEqual(original[c], Array.from(input(0, 256)[c]));
  }
  const p = make(0, 256),
    data = [new Float32Array(256), new Float32Array(256).fill(2.25)];
  block(p, 0, 256, data);
  const original = drain(p);
  assert.deepEqual(original[0], Array(256).fill(0));
  assert.deepEqual(original[1], Array(256).fill(2.25));
  // Plausible labels cannot reveal unknown content loss; the independent coded
  // oracle must reject it. No product padding or cursor hides this limitation.
  const gap = make(0, 256);
  block(gap, 0);
  block(gap, 128, 128, input(256, 128));
  const lost = drain(gap);
  assert.notDeepEqual(lost[0], Array.from(input(0, 256)[0]));
});
