import {
  frameClockDescriptors,
  nativeWorkletFrame,
} from "../src/audio/worklet-frame-clock.js";
import { nativeParameters } from "./helpers/worklet-frame-clock.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { softLimit } from "../src/loop-station/fx-model.js";

async function processors() {
  const classes = {},
    messages = [],
    scope = vm.createContext({
      Float32Array,
      frameClockDescriptors,
      nativeWorkletFrame,
      Math,
      currentFrame: 0,
      AudioWorkletProcessor: class {
        constructor() {
          this.port = { postMessage: (m) => messages.push(m) };
        }
      },
      registerProcessor: (name, type) =>
        (classes[name] =
          name === "canonical-programme-print"
            ? class extends type {
                process(
                  inputs,
                  outputs,
                  parameters = nativeParameters(
                    scope.currentFrame,
                    outputs[0][0].length,
                  ),
                ) {
                  return super.process(inputs, outputs, parameters);
                }
              }
            : type),
    });
  vm.runInContext(
    await readFile(
      new URL("../src/audio/canonical-print-processor.js", import.meta.url),
      "utf8",
    ).then((s) =>
      s.replace(
        /import\s*\{[\s\S]*?\}\s*from\s*"\.\/worklet-frame-clock\.js";/,
        "",
      ),
    ),
    scope,
  );
  return { classes, messages, scope };
}
test("actual shared-master kernel is Float32-exact to the existing portable soft knee including its linear region and high inputs", async () => {
  const f = await processors(),
    processor = new f.classes["canonical-shared-master"](),
    input = Float32Array.from({ length: 65537 }, (_, i) => (i / 65536) * 8 - 4),
    right = Float32Array.from(input, (x) => -x),
    out = [new Float32Array(input.length), new Float32Array(input.length)];
  processor.process([[input, right]], [out]);
  for (let i = 0; i < input.length; i++) {
    assert.equal(out[0][i], Math.fround(softLimit(input[i])));
    assert.equal(out[1][i], Math.fround(softLimit(right[i])));
    if (Math.abs(input[i]) <= 0.8) assert.equal(out[0][i], input[i]);
    assert(Math.abs(out[0][i]) <= 0.95);
  }
  assert(
    softLimit(0.6 + 0.3) < softLimit(0.6) + softLimit(0.3),
    "nonlinear master applies after the sum",
  );
});
test("print processor consumes one genuinely transferred stereo copy, preserves source PCM/seek and acknowledges complete delivery", async () => {
  const f = await processors(),
    original = [
      Float32Array.of(-0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7),
      Float32Array.of(0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1),
    ],
    left = new Float32Array(original[0]),
    right = new Float32Array(original[1]),
    packet = structuredClone(
      { type: "load", left, right },
      { transfer: [left.buffer, right.buffer] },
    ),
    p = new f.classes["canonical-programme-print"]({
      processorOptions: { frames: 8, origin: 128, from: 3 },
    });
  assert.equal(left.byteLength, 0);
  assert.equal(right.byteLength, 0);
  assert.equal(original[0].byteLength, 32);
  assert(Object.is(original[0][0], -0));
  p.port.onmessage({ data: packet });
  const before = [new Float32Array(128), new Float32Array(128)];
  assert.equal(p.process([], [before]), true);
  assert(before.every((c) => c.every((x) => x === 0)));
  f.scope.currentFrame = 128;
  const out = [new Float32Array(128), new Float32Array(128)];
  assert.equal(p.process([], [out]), false);
  for (let c = 0; c < 2; c++) {
    assert.deepEqual(out[c].slice(0, 5), original[c].slice(3));
    assert(out[c].slice(5).every((x) => x === 0));
  }
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].type, "ended");
  assert.equal(f.messages[0].frame, 133);
  assert.equal(f.messages[0].fault, null);
  assert.equal(p.left, null);
  assert.equal(p.right, null);
});
test("missing or malformed print delivery reports a fault rather than silently accepting a gap; stopping before origin needs no PCM", async () => {
  const f = await processors(),
    make = () =>
      new f.classes["canonical-programme-print"]({
        processorOptions: { frames: 8, origin: 128, from: 0 },
      }),
    out = () => [[new Float32Array(128), new Float32Array(128)]];
  f.scope.currentFrame = 128;
  const missing = make();
  assert.equal(missing.process([], out()), false);
  assert.equal(f.messages.at(-1).fault, "canonicalPrintNotReady");
  const bad = make();
  bad.port.onmessage({
    data: {
      type: "load",
      left: new Float32Array(7),
      right: new Float32Array(8),
    },
  });
  assert.equal(f.messages.at(-1).fault, "invalidCanonicalPrint");
  f.scope.currentFrame = 0;
  const stopped = make();
  stopped.port.onmessage({ data: { type: "stop", start: 0, end: 0 } });
  assert.equal(stopped.process([], out()), false);
  assert.equal(f.messages.at(-1).fault, null);
});
