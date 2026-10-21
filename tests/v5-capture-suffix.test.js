import { fakeWorkletParams } from "./helpers/worklet-frame-clock.js";
import test from "node:test";
import assert from "node:assert/strict";
import { CaptureSession } from "../src/loop-station/capture-session.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { TakePool } from "../src/loop-station/take-pool.js";
import { LoopClock } from "../src/loop-station/loop-clock.js";
import { Transport } from "../src/audio/transport.js";
function fixture(channels = 2) {
  const context = Object.assign(new EventTarget(), {
      state: "running",
      sampleRate: 48000,
      currentTime: 0,
      audioWorklet: { addModule: async () => {} },
    }),
    memory = new AudioMemory(),
    pool = new TakePool(memory),
    transport = new Transport();
  const node = Object.assign(new EventTarget(), {
    parameters: fakeWorkletParams(),
    connect() {},
    disconnect() {},
    port: {
      sent: [],
      postMessage(m) {
        this.sent.push(m);
      },
      close() {},
    },
  });
  const plan = { sampleRate: 48000, startFrame: 1000, endFrame: 25000 };
  const options = {
    clock: new LoopClock(context, transport),
    memory,
    pool,
    destination: { context },
    moduleURL: "/capture.js",
    plan,
    channels,
    nodeFactory: () => node,
  };
  return {
    context,
    memory,
    pool,
    node,
    plan,
    options,
    state(s) {
      context.state = s;
      context.dispatchEvent(new Event("statechange"));
    },
    send(d) {
      node.port.onmessage({ data: d });
    },
    pcm(sequence, offset, frames) {
      return {
        type: "pcm",
        sequence,
        offset,
        frames,
        buffers: Array.from(
          { length: channels },
          (_, c) =>
            Float32Array.from(
              { length: frames },
              (_, n) => (((offset + n) % 37) - 18 + c) / 64,
            ).buffer,
        ),
      };
    },
  };
}
for (const terminal of ["worker", "context"])
  test(`suspend receives contiguous late PCM then ${terminal} boundary publishes one immutable truthful partial`, async () => {
    const f = fixture(),
      s = await CaptureSession.open(f.options),
      foreign = f.memory.reserve(64, "foreign");
    f.send(f.pcm(0, 0, 127));
    f.state("suspended");
    let ready = false;
    void s.ready.then(() => {
      ready = true;
    });
    await Promise.resolve();
    assert.equal(ready, false);
    assert.equal(s.take, undefined);
    const held = f.memory.snapshot().bytes;
    f.send(f.pcm(1, 127, 3968));
    assert.equal(s.acknowledgedFrames, 4095);
    assert.equal(
      f.memory.snapshot().bytes,
      held,
      "no extra reservation/copy for suffix",
    );
    if (terminal === "worker") {
      f.send({
        type: "complete",
        ...f.plan,
        capacity: 24000,
        channels: 2,
        frames: 4095,
        reason: "userStop",
        blockSizes: [128],
      });
      assert.equal(s.outcome.workerReason, "userStop");
      assert.equal(s.outcome.workerFlushConfirmed, true);
      f.send({ type: "closed" });
    } else f.state("closed");
    const take = await s.ready;
    await s.closed;
    assert.equal(take.frames, 4095);
    assert.equal(take.reason, "suspended");
    assert.equal(take.partial, true);
    assert.equal(s.outcome.workerFlushConfirmed, terminal === "worker");
    const copy = f.pool.copyPCM(take.id),
      actual = new Float32Array(copy.buffer);
    for (let c = 0; c < 2; c++)
      for (let n = 0; n < 4095; n++)
        assert.equal(actual[c * 4095 + n], ((n % 37) - 18 + c) / 64);
    copy.release();
    f.pool.release(take.id);
    assert.equal(f.memory.snapshot().bytes, 64);
    foreign.release();
  });
test("suspend then resume never revives recording; complete-sized data remains partial under interruption", async () => {
  const f = fixture(1),
    s = await CaptureSession.open(f.options);
  f.state("suspended");
  f.state("running");
  let offset = 0,
    sequence = 0;
  while (offset < 24000) {
    const n = Math.min(4096, 24000 - offset);
    f.send(f.pcm(sequence++, offset, n));
    offset += n;
  }
  f.send({
    type: "complete",
    ...f.plan,
    capacity: 24000,
    channels: 1,
    frames: 24000,
    reason: "complete",
    blockSizes: [128],
  });
  const t = await s.ready;
  assert.equal(t.frames, 24000);
  assert.equal(t.partial, true);
  assert.equal(t.reason, "suspended");
  assert.equal(s.state, "closing");
  f.send({ type: "closed" });
  await s.closed;
  f.pool.release(t.id);
});
for (const fault of ["sequence", "offset", "channels", "nan"])
  test(`late ${fault} receipt is not ACKed or repaired; accepted prefix and worker charge persist until termination`, async () => {
    const f = fixture(),
      s = await CaptureSession.open(f.options);
    f.send(f.pcm(0, 0, 128));
    f.state("suspended");
    const d = f.pcm(1, 128, 128);
    if (fault === "sequence") d.sequence = 7;
    if (fault === "offset") d.offset = 127;
    if (fault === "channels") d.buffers.pop();
    if (fault === "nan") new Float32Array(d.buffers[0])[10] = NaN;
    f.send(d);
    const t = await s.ready;
    assert.equal(t.frames, 128);
    assert.equal(t.reason, "protocolError");
    assert.deepEqual(
      f.node.port.sent.filter((x) => x.type === "ack"),
      [{ type: "ack", sequence: 0 }],
    );
    assert(f.memory.snapshot().bytes > t.bytes);
    f.state("closed");
    await s.closed;
    assert.equal(f.memory.snapshot().bytes, t.bytes);
    f.pool.release(t.id);
  });
