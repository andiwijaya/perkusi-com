import {
  withUnitNativeClock,
  nativeParameters,
} from "./helpers/worklet-frame-clock.js";
import test from "node:test";
import assert from "node:assert/strict";
let Processor;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.port = {
      messages: [],
      postMessage(d) {
        this.messages.push(d);
      },
    };
  }
};
globalThis.registerProcessor = (name, p) => {
  assert.equal(name, "perkusi-mic-meter-v5");
  Processor = withUnitNativeClock(p);
};
globalThis.currentFrame = 0;
await import("../src/loop-station/mic-meter-worklet.js");

test("native monitor timing survives a stale global but refuses a repeated native block and closes with silent output", () => {
  const p = new Processor(),
    out = [[new Float32Array(128), new Float32Array(128)]];
  p.port.onmessage({
    data: { type: "monitor", id: 1, enabled: true, frame: 128 },
  });
  globalThis.currentFrame = 0;
  p.process(
    [[new Float32Array(128).fill(0.25)]],
    out,
    nativeParameters(0, 128),
  );
  assert(out[0].every((c) => c.every((x) => x === 0)));
  p.process(
    [[new Float32Array(128).fill(0.25)]],
    out,
    nativeParameters(128, 128),
  );
  assert(out[0].every((c) => c.every((x) => x === 0.0625)));
  assert.equal(
    p.port.messages.find((m) => m.type === "monitor-state").frame,
    128,
  );
  assert.equal(
    p.process(
      [[new Float32Array(128).fill(0.25)]],
      out,
      nativeParameters(128, 128),
    ),
    false,
  );
  assert(out[0].every((c) => c.every((x) => x === 0)));
  assert.deepEqual(p.port.messages.slice(-2), [
    { type: "clock-error" },
    { type: "closed" },
  ]);
});
test("real meter processor emits bounded scalar receipts with no live audio and sticky invalid/topology faults", () => {
  const p = new Processor(),
    out = [[new Float32Array(128).fill(0.8)]];
  for (let i = 0; i < 1000; i++) {
    globalThis.currentFrame = i * 128;
    p.process([[new Float32Array(128).fill(0.25)]], out);
    assert.equal(
      out[0][0].every((x) => x === 0),
      true,
    );
  }
  assert.equal(
    p.port.messages.length,
    1,
    "one in-flight receipt under main-thread stall",
  );
  assert.equal(p.port.messages[0].peak, 0.25);
  assert.equal(p.port.messages[0].rms, 0.25);
  globalThis.currentFrame += 128;
  p.process([[new Float32Array(128).fill(NaN), new Float32Array(128)]], out);
  p.port.onmessage({ data: { type: "ack" } });
  globalThis.currentFrame += 128;
  p.process([[new Float32Array(128)]], out);
  assert.equal(p.port.messages.at(-1).invalid, true);
  assert.equal(p.port.messages.at(-1).changed, true);
  p.port.onmessage({ data: { type: "stop" } });
  assert.equal(p.port.messages.at(-1).type, "closed");
  assert.equal(p.process([], out), false);
});

test("a clipped quantum between reports contributes to interval peak/RMS and a cumulative UI-visible clip count", () => {
  const p = new Processor(),
    out = [[new Float32Array(128)]];
  const block = (frame, value) => {
    globalThis.currentFrame = frame;
    p.process([[new Float32Array(128).fill(value)]], out);
    assert(out[0][0].every((v) => v === 0));
  };
  block(0, 0);
  p.port.onmessage({ data: { type: "ack" } });
  block(128, 1.25);
  for (let n = 2; n <= 16; n++) block(n * 128, 0);
  const clipped = p.port.messages.at(-1);
  assert.equal(clipped.peak, 1.25);
  assert.equal(clipped.clips, 128);
  assert.equal(clipped.intervalClips, 128);
  assert.equal(clipped.samples, 2048);
  assert(Math.abs(clipped.rms - 0.3125) < 1e-12);
  p.port.onmessage({ data: { type: "ack" } });
  for (let n = 17; n <= 32; n++) block(n * 128, 0);
  const quiet = p.port.messages.at(-1);
  assert.equal(quiet.peak, 0);
  assert.equal(quiet.rms, 0);
  assert.equal(quiet.intervalClips, 0);
  assert.equal(
    quiet.clips,
    128,
    "later UI polls cannot erase a previously unobserved clip",
  );
});

test("ACK stall keeps one immutable outstanding receipt while every later input quantum accumulates", () => {
  const p = new Processor(),
    out = [[new Float32Array(128)]];
  const block = (n, value) => {
    globalThis.currentFrame = n * 128;
    p.process([[new Float32Array(128).fill(value)]], out);
  };
  block(0, 0);
  for (let n = 1; n <= 32; n++) block(n, n === 1 ? 1.25 : 0);
  assert.equal(p.port.messages.length, 1);
  assert.equal(
    p.port.messages[0].peak,
    0,
    "the sent snapshot remains immutable",
  );
  p.port.onmessage({ data: { type: "ack" } });
  block(33, 0);
  const d = p.port.messages.at(-1);
  assert.equal(d.windowFrames, 33 * 128);
  assert.equal(d.samples, 33 * 128);
  assert.equal(d.peak, 1.25);
  assert.equal(d.clips, 128);
  assert(Math.abs(d.rms - 1.25 / Math.sqrt(33)) < 1e-12);
});

test("monitor applies at its native frame, gates overrange only in its output, duplicates mono and retains raw stats", () => {
  const p = new Processor(),
    out = [[new Float32Array(128), new Float32Array(128)]],
    input = new Float32Array(128).fill(0.5);
  p.port.onmessage({
    data: { type: "monitor", id: 1, enabled: true, frame: 64 },
  });
  globalThis.currentFrame = 0;
  p.process([[input]], out);
  for (const c of out[0])
    for (let n = 0; n < 128; n++) assert.equal(c[n], n < 64 ? 0 : 0.125);
  assert.deepEqual(
    p.port.messages.find((d) => d.type === "monitor-state"),
    { type: "monitor-state", id: 1, enabled: true, frame: 64 },
  );
  input[17] = 1.25;
  globalThis.currentFrame = 128;
  p.process([[input]], out);
  assert(out[0].every((c) => c.every((v) => v === 0)));
  assert.equal(input[17], 1.25);
  p.port.onmessage({ data: { type: "ack" } });
  globalThis.currentFrame = 256;
  p.process([[new Float32Array(128).fill(0.25)]], out);
  assert(out[0].every((c) => c.every((v) => v === 0.0625)));
  p.port.onmessage({
    data: { type: "monitor", id: 2, enabled: false, frame: 400 },
  });
  globalThis.currentFrame = 384;
  p.process([[input.fill(0.5)]], out);
  for (const c of out[0])
    for (let n = 0; n < 128; n++) assert.equal(c[n], n < 16 ? 0.125 : 0);
  assert.equal(
    p.port.messages.filter((d) => d.type === "monitor-state").at(-1).frame,
    400,
  );
});

test("monitor fault gate remains silent after topology or nonfinite loss, including before host ACK", () => {
  for (const bad of [
    [[new Float32Array(128).fill(NaN)]],
    [[new Float32Array(128), new Float32Array(128)]],
  ]) {
    const p = new Processor(),
      out = [[new Float32Array(128), new Float32Array(128)]];
    p.port.onmessage({
      data: { type: "monitor", id: 1, enabled: true, frame: 0 },
    });
    globalThis.currentFrame = 0;
    p.process([[new Float32Array(128).fill(0.25)]], out);
    globalThis.currentFrame = 128;
    p.process(bad, out);
    globalThis.currentFrame = 256;
    p.process([[new Float32Array(128).fill(0.25)]], out);
    assert(out[0].every((c) => c.every((v) => v === 0)));
  }
});
