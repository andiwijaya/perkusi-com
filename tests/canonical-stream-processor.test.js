import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import {
  frameClockDescriptors,
  nativeWorkletFrame,
} from "../src/audio/worklet-frame-clock.js";
import { nativeParameters } from "./helpers/worklet-frame-clock.js";

async function host() {
  let C;
  const messages = [],
    scope = vm.createContext({
      Float32Array,
      frameClockDescriptors,
      nativeWorkletFrame,
      AudioWorkletProcessor: class {
        constructor() {
          this.port = { postMessage: (m) => messages.push(m), close() {} };
        }
      },
      registerProcessor: (_, c) => {
        C = c;
      },
    });
  vm.runInContext(
    (
      await readFile(
        new URL("../src/audio/canonical-stream-processor.js", import.meta.url),
        "utf8",
      )
    ).replace(
      /import\s*\{[\s\S]*?\}\s*from\s*"\.\/worklet-frame-clock\.js";/,
      "",
    ),
    scope,
  );
  const p = new C();
  return {
    p,
    messages,
    send: (m) => p.port.onmessage?.({ data: m }),
    block(frame, size = 128) {
      const channels = [new Float32Array(size), new Float32Array(size)];
      const alive = p.process([], [channels], nativeParameters(frame, size));
      return { channels, alive };
    },
  };
}
const chunk = (id, from, left, right = new Float32Array(left)) =>
  structuredClone(
    { type: "chunk", id, from, left, right },
    { transfer: [left.buffer, right.buffer] },
  );

test("stream joins uneven transferred chunks without restarting its native frame clock, including signed zero", async () => {
  const h = await host(),
    cs = [new Float32Array(8493), new Float32Array(8493)];
  for (let i = 0; i < cs[0].length; i++) {
    cs[0][i] = i % 17 ? Math.fround(Math.sin(i) * 0.4) : -0;
    cs[1][i] = Math.fround(Math.cos(i) * 0.3);
  }
  let from = 0,
    id = 0;
  for (const n of [1, 127, 128, 2048, 4096, 2093]) {
    const a = cs[0].slice(from, from + n),
      b = cs[1].slice(from, from + n);
    h.send(chunk(id++, from, a, b));
    assert.equal(a.byteLength, 0);
    from += n;
  }
  h.send({ type: "end", frames: from });
  h.send({ type: "arm", origin: 257 });
  const rendered = [[], []];
  for (let f = 0; f < 9000; f += 128) {
    const r = h.block(f);
    for (let c = 0; c < 2; c++) rendered[c].push(...r.channels[c]);
    if (!r.alive) break;
  }
  for (let c = 0; c < 2; c++) {
    const actual = Float32Array.from(rendered[c]);
    assert(actual.slice(0, 257).every((n) => n === 0));
    assert.deepEqual(actual.slice(257, 257 + from), cs[c]);
    assert(actual.slice(257 + from).every((n) => n === 0));
  }
  assert.equal(h.messages.filter((m) => m.type === "consumed").length, id);
  assert.equal(h.messages.at(-1).fault, null);
  assert.equal(h.messages.at(-1).renderedFrames, from);
  assert.equal(h.messages.at(-1).frame, 257 + from);
  assert.equal(h.p.queue.length, 0);
});
test("unarmed queue stays idle; exact-boundary starvation is terminal, never padded or retried", async () => {
  const h = await host();
  h.send(chunk(0, 0, new Float32Array(128).fill(0.2)));
  assert(h.block(9999).channels[0].every((n) => n === 0));
  h.send({ type: "arm", origin: 128 });
  h.block(0);
  assert(h.block(128).alive);
  assert.equal(h.block(256).alive, false);
  assert.equal(h.messages.at(-1).fault, "canonicalStreamStarved");
  assert.equal(h.messages.at(-1).renderedFrames, 128);
  const before = h.messages.length;
  h.send(chunk(1, 128, new Float32Array(128)));
  assert.equal(h.block(384).alive, false);
  assert.equal(h.messages.length, before);
});
test("same native coordinates are required across chunks and stale/noncontiguous coordinates fail", async () => {
  for (const bad of [128, 0, 384]) {
    const h = await host();
    h.send(chunk(0, 0, new Float32Array(1024)));
    h.send({ type: "arm", origin: 128 });
    h.block(0);
    h.block(128);
    assert.equal(h.block(bad).alive, false);
    assert.equal(h.messages.at(-1).fault, "canonicalStreamClockDiscontinuity");
  }
  const h = await host();
  h.send(chunk(0, 0, new Float32Array(1024)));
  h.send({ type: "arm", origin: 128 });
  h.block(256);
  assert.equal(h.messages.at(-1).fault, "canonicalStreamStartMissed");
});
test("packet order/capacity/size, duplicate arm and unchanged safety bounds are enforced", async () => {
  for (const value of [NaN, Infinity, 0.951, -0.951]) {
    const h = await host();
    h.send(chunk(0, 0, Float32Array.of(value)));
    assert.equal(h.messages.at(-1).fault, "unsafeOutput");
  }
  for (const make of [
    () => chunk(1, 0, new Float32Array(128)),
    () => chunk(0, 1, new Float32Array(128)),
    () => chunk(0, 0, new Float32Array(4097)),
  ]) {
    const h = await host();
    h.send(make());
    assert.equal(h.messages.at(-1).fault, "canonicalStreamPacket");
  }
  const h = await host();
  for (let i = 0; i < 33; i++) h.send(chunk(i, i, Float32Array.of(0)));
  assert.equal(h.messages.at(-1).fault, "canonicalStreamPacket");
  assert.equal(h.p.queue.length, 0);
  const d = await host();
  d.send(chunk(0, 0, new Float32Array(128)));
  d.send({ type: "arm", origin: 128 });
  d.send({ type: "arm", origin: 256 });
  assert.equal(d.messages.at(-1).fault, "canonicalStreamArm");
});
test("Stop fades once across packet boundaries; immediate stop before arm releases all references", async () => {
  const h = await host();
  h.send(chunk(0, 0, new Float32Array(150).fill(0.5)));
  h.send(chunk(1, 150, new Float32Array(300).fill(0.5)));
  h.send({ type: "arm", origin: 128 });
  h.send({ type: "stop", start: 200, end: 400 });
  const out = [];
  for (let f = 0; f < 512; f += 128) out.push(...h.block(f).channels[0]);
  for (let f = 128; f < 400; f++)
    assert.equal(out[f], Math.fround(f < 200 ? 0.5 : (0.5 * (400 - f)) / 200));
  assert(out.slice(400).every((n) => n === 0));
  assert.equal(h.messages.at(-1).fault, null);
  assert.equal(h.messages.at(-1).frame, 400);
  const b = await host();
  b.send(chunk(0, 0, new Float32Array(128)));
  b.send({ type: "stop", immediate: true });
  assert.equal(b.messages.at(-1).renderedFrames, 0);
  assert.equal(b.p.queue.length, 0);
});
