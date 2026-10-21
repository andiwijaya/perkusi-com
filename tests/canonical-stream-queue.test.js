import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { createCanonicalStreamQueue } from "../src/audio/canonical-stream-queue.js";
import {
  frameClockDescriptors,
  nativeWorkletFrame,
  FRAME_PERIOD as P,
} from "../src/audio/worklet-frame-clock.js";
import {
  fakeWorkletParams,
  nativeParameters,
} from "./helpers/worklet-frame-clock.js";
const flush = () => new Promise(setImmediate);

for (const kind of ["deadline", "api-error"])
  test(`host clock ${kind} reports through the queue immediately but retains PCM until actual closure`, async (t) => {
    let callback;
    t.mock.method(globalThis, "setInterval", (fn) => {
      callback = fn;
      return { unref() {} };
    });
    t.mock.method(globalThis, "clearInterval", () => {});
    const h = await host(),
      memory = new AudioMemory(),
      foreign = memory.reserve(313, "qa/foreign"),
      notifications = [];
    if (kind === "deadline") h.context.currentTime = (45 * P) / 48000;
    const q = createCanonicalStreamQueue({
      context: h.context,
      destination: { context: h.context },
      memory,
      nodeFactory: h.factory,
      produce: () => {},
    });
    q.faulted.then((e) => notifications.push(e.message));
    let done = false;
    q.done.then(
      () => (done = true),
      () => (done = true),
    );
    await q.ready;
    q.start();
    await q.armedReady;
    await flush();
    await flush();
    const held = memory.snapshot().bytes;
    assert(held > 313 + 16384);
    if (kind === "deadline") h.context.currentTime = (49 * P) / 48000;
    else {
      h.node.parameters.get("framePhase").linearRampToValueAtTime = () => {
        throw Error("QAClockExtensionFailure");
      };
      h.context.currentTime = (1.1 * P) / 48000;
    }
    callback();
    const error = await q.faulted,
      expected =
        kind === "deadline"
          ? "workletClockHorizonMissed"
          : "QAClockExtensionFailure";
    assert.equal(error.message, expected);
    assert.equal(q.snapshot().fault, expected);
    assert.equal(q.snapshot().stopping, true);
    assert.equal(memory.snapshot().bytes, held);
    assert.equal(done, false);
    callback();
    await flush();
    assert.deepEqual(notifications, [expected]);
    assert.equal(memory.snapshot().bytes, held);
    h.context.state = "closed";
    await q.dispose();
    await flush();
    assert.equal(memory.snapshot().bytes, 313);
    assert.equal(done, true);
    foreign.release();
  });

async function host() {
  let C,
    processor,
    node,
    nativeClosed = false;
  const outgoing = [],
    transfers = [],
    context = { sampleRate: 48000, currentTime: 0, state: "running" },
    scope = vm.createContext({
      Float32Array,
      frameClockDescriptors,
      nativeWorkletFrame,
      AudioWorkletProcessor: class {
        constructor() {
          this.port = {
            postMessage(m) {
              outgoing.push(m);
              setImmediate(() => node.port.onmessage?.({ data: m }));
            },
            close() {
              nativeClosed = true;
            },
          };
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
  const factory = () => {
    node = {
      parameters: fakeWorkletParams(),
      connect() {},
      disconnect() {},
      port: {
        postMessage(m, transfer = []) {
          const data = structuredClone(m, { transfer });
          if (m.type === "chunk")
            transfers.push([m.left.byteLength, m.right.byteLength]);
          setImmediate(() => {
            if (!nativeClosed) processor.port.onmessage?.({ data });
          });
        },
        close() {},
      },
    };
    processor = new C();
    return node;
  };
  return {
    context,
    factory,
    outgoing,
    transfers,
    get node() {
      return node;
    },
    get nativeClosed() {
      return nativeClosed;
    },
    step(frame, n = 128) {
      context.currentTime = frame / 48000;
      const channels = [new Float32Array(n), new Float32Array(n)];
      const alive = processor.process(
        [],
        [channels],
        nativeParameters(frame, n),
      );
      return { channels, alive };
    },
  };
}

test("actual stream queue hands off charged chunks and native closure; whole finite PCM equals producer across >16 chunks", async () => {
  const h = await host(),
    memory = new AudioMemory(),
    foreign = memory.reserve(313, "qa/foreign"),
    frames = 96373,
    expected = [new Float32Array(frames), new Float32Array(frames)];
  for (let i = 0; i < frames; i++) {
    expected[0][i] = i % 29 ? Math.fround(Math.sin(i) * 0.2) : -0;
    expected[1][i] = Math.fround(Math.cos(i) * 0.1);
  }
  const q = createCanonicalStreamQueue({
    context: h.context,
    destination: { context: h.context },
    memory,
    totalFrames: frames,
    nodeFactory: h.factory,
    produce: (channels, { from }) => {
      for (let c = 0; c < 2; c++)
        channels[c].set(expected[c].subarray(from, from + channels[c].length));
    },
  });
  await q.ready;
  assert(memory.snapshot().bytes > 313 + 16384);
  assert.equal(q.snapshot().receivedFrames, 65536);
  const origin = q.start(),
    actual = [new Float32Array(frames), new Float32Array(frames)];
  await flush();
  await flush();
  for (let f = 0; f < frames + 128; f += 128) {
    const r = h.step(origin + f);
    for (let c = 0; c < 2; c++)
      actual[c].set(
        r.channels[c].subarray(0, Math.min(128, Math.max(0, frames - f))),
        Math.min(f, frames),
      );
    if (f % 4096 === 0) {
      await flush();
      await flush();
    }
    if (!r.alive) break;
  }
  const receipt = await q.done;
  assert.equal(receipt.fault, null);
  assert.equal(receipt.renderedFrames, frames);
  assert.equal(receipt.frame, origin + frames);
  assert.equal(h.nativeClosed, true);
  assert.deepEqual(actual, expected);
  assert(h.transfers.every((x) => x[0] === 0 && x[1] === 0));
  assert.equal(q.snapshot().pendingChunks, 0);
  assert.equal(memory.snapshot().bytes, 313 + 16384);
  await q.dispose();
  await q.dispose();
  assert.equal(memory.snapshot().bytes, 313);
  foreign.release();
});

test("missing native close/consumed receipt keeps all ownership until actual context closure", async () => {
  const memory = new AudioMemory(),
    context = { sampleRate: 48000, currentTime: 0, state: "running" },
    messages = [];
  let node;
  const q = createCanonicalStreamQueue({
    context,
    destination: { context },
    memory,
    totalFrames: 8192,
    produce: () => {},
    nodeFactory: () =>
      (node = {
        parameters: fakeWorkletParams(),
        connect() {},
        disconnect() {},
        port: {
          postMessage(m) {
            messages.push(m);
          },
          close() {},
        },
      }),
  });
  await flush();
  await flush();
  assert.equal(q.snapshot().sentFrames, 8192);
  const before = memory.snapshot().bytes;
  q.stop();
  await assert.rejects(q.dispose(), { code: "canonicalStreamStillOwned" });
  assert.equal(memory.snapshot().bytes, before);
  assert(messages.some((m) => m.type === "stop"));
  context.state = "closed";
  await q.dispose();
  assert.equal(memory.snapshot().bytes, 0);
  assert.equal(q.snapshot().receipt.type, "context-closed");
  assert.equal(node.port.onmessage, null);
});

test("aborted inflight producer keeps its own arrays charged until it actually returns even after context closure", async () => {
  const memory = new AudioMemory(),
    context = { sampleRate: 48000, currentTime: 0, state: "running" },
    a = new AbortController();
  let resume;
  const q = createCanonicalStreamQueue({
    context,
    destination: { context },
    memory,
    totalFrames: 4096,
    signal: a.signal,
    produce: () =>
      new Promise((r) => {
        resume = r;
      }),
    nodeFactory: () => ({
      port: { postMessage() {}, close() {} },
      disconnect() {},
    }),
  });
  await flush();
  const bytes = memory.snapshot().bytes;
  assert(bytes > 16384);
  a.abort();
  context.state = "closed";
  let disposed = false;
  const cleanup = q.dispose().then(() => {
    disposed = true;
  });
  await flush();
  assert.equal(disposed, false);
  assert.equal(memory.snapshot().bytes, bytes);
  resume();
  await cleanup;
  assert.equal(memory.snapshot().bytes, 0);
  await assert.rejects(q.done, { code: "cancelled" });
});

test("forged close and duplicate consumption cannot free a live native allocation", async () => {
  const memory = new AudioMemory(),
    context = { sampleRate: 48000, currentTime: 0, state: "running" };
  let node;
  const q = createCanonicalStreamQueue({
    context,
    destination: { context },
    memory,
    totalFrames: 8192,
    produce: () => {},
    nodeFactory: () =>
      (node = { port: { postMessage() {}, close() {} }, disconnect() {} }),
  });
  await flush();
  await flush();
  const bytes = memory.snapshot().bytes;
  node.port.onmessage({
    data: {
      type: "closed",
      renderedFrames: 8192,
      acceptedChunks: 2,
      consumedChunks: 9,
    },
  });
  assert.equal(q.snapshot().fault, "canonicalStreamReceipt");
  assert.equal(memory.snapshot().bytes, bytes);
  await assert.rejects(q.dispose(), { code: "canonicalStreamStillOwned" });
  context.state = "closed";
  await q.dispose();
  assert.equal(memory.snapshot().bytes, 0);
  await assert.rejects(q.done, { code: "canonicalStreamReceipt" });
});

test("unchanged .95 guard reports a real native terminal failure and retains node ticket until disposal", async () => {
  const h = await host(),
    memory = new AudioMemory();
  const q = createCanonicalStreamQueue({
    context: h.context,
    destination: { context: h.context },
    memory,
    totalFrames: 4096,
    nodeFactory: h.factory,
    produce: (cs) => cs[0].fill(0.96),
  });
  await assert.rejects(q.ready, { code: "unsafeOutput" });
  await assert.rejects(q.done, { code: "unsafeOutput" });
  assert.equal(h.nativeClosed, true);
  assert.equal(memory.snapshot().bytes, 16384);
  await q.dispose();
  assert.equal(memory.snapshot().bytes, 0);
});

test("after-ready processorerror notifies immediately, while actual context close and producer drain still control retirement", async () => {
  const h = await host(),
    memory = new AudioMemory(),
    foreign = memory.reserve(313, "qa/foreign");
  let calls = 0,
    unblock;
  const q = createCanonicalStreamQueue({
    context: h.context,
    destination: { context: h.context },
    memory,
    nodeFactory: h.factory,
    produce: () =>
      ++calls <= 16
        ? undefined
        : new Promise((resolve) => {
            unblock = resolve;
          }),
  });
  await q.ready;
  q.start();
  await flush();
  assert.equal(calls, 17);
  let retired = false;
  q.done
    .finally(() => {
      retired = true;
    })
    .catch(() => {});
  const held = memory.snapshot().bytes;
  h.node.onprocessorerror();
  const error = await q.faulted;
  assert.equal(error.code, "canonicalStreamProcessorFault");
  assert.equal(retired, false);
  assert.equal(
    memory.snapshot().bytes,
    held,
    "notification alone retires no native or producer allocation",
  );
  // Model a terminated native processor, which cannot deliver the requested
  // Stop/closed receipt. The real owner must close its exclusive context.
  h.node.port.onmessage = null;
  h.context.state = "closed";
  let disposed = false;
  const cleanup = q.dispose().then(() => {
    disposed = true;
  });
  await flush();
  assert.equal(disposed, false);
  assert(memory.snapshot().bytes >= 313 + 16384 + 4096 * 8);
  unblock();
  await cleanup;
  await assert.rejects(q.done, { code: "canonicalStreamProcessorFault" });
  assert.equal(memory.snapshot().bytes, 313);
  foreign.release();
});
