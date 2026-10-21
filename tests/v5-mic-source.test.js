import { fakeWorkletParams } from "./helpers/worklet-frame-clock.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  createMicSource,
  closeMicSource,
  micInputChannels,
  micAssignment,
  setMicMonitor,
} from "../src/loop-station/mic-source.js";
import { captureInputChannels } from "../src/loop-station/instrument-input.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { Transport } from "../src/audio/transport.js";
import { LoopClock } from "../src/loop-station/loop-clock.js";
import { PcmWindow } from "../src/loop-station/pcm-window.js";
import { WorkspaceAudioOwner } from "../src/loop-station/workspace-owner.js";
import { RootCaptureCoordinator } from "../src/loop-station/capture-coordinator.js";
import { TakePool } from "../src/loop-station/take-pool.js";
import { emptyLoopProject } from "../src/loop-station/model.js";
import { freezeCaptureProject } from "../src/loop-station/master-capture-clock.js";
const tick = () => new Promise((r) => setImmediate(r));

for (const boundary of ["worker-close", "context-close"])
  test(`host meter clock failure cancels monitoring and retains its own lease until ${boundary}`, async (t) => {
    let callback;
    t.mock.method(globalThis, "setInterval", (fn) => {
      callback = fn;
      return { unref() {} };
    });
    t.mock.method(globalThis, "clearInterval", () => {});
    const f = fixture(),
      foreign = f.memory.reserve(313, "foreign"),
      opening = createMicSource(f.options);
    await tick();
    f.meter.send({ type: "meter", channels: 1, frame: 128, peak: 0.2 });
    const source = await opening,
      faults = [],
      monitoring = setMicMonitor(source, new Node(f.context), true);
    let monitorResult;
    monitoring.then((v) => (monitorResult = v));
    source.onFault((f) => faults.push(f));
    f.meter.parameters.get("framePhase").linearRampToValueAtTime = () => {
      throw Error("QAHostMeterClockFailure");
    };
    const held = f.memory.snapshot().bytes;
    t.after(async () => {
      f.context.state = "closed";
      f.context.dispatchEvent(new Event("statechange"));
      await closeMicSource(source).catch(() => {});
      foreign.release();
    });
    f.context.currentTime = (1.1 * 1048576) / 48000;
    callback();
    await tick();
    assert.equal(faults.length, 1);
    assert.equal(source.snapshot().fault.reason, "micClockDiscontinuity");
    assert.equal(source.isCurrent(), false);
    assert.equal(source.monitoring, "disabled");
    assert.deepEqual(monitorResult, { cancelled: true });
    assert.equal(f.memory.snapshot().bytes, held);
    f.meter.port.postMessage = () => {};
    let closed = false;
    const closing = closeMicSource(source).then(() => (closed = true));
    await tick();
    assert.equal(closed, false);
    assert.equal(f.memory.snapshot().bytes, held);
    if (boundary === "worker-close") f.meter.send({ type: "closed" });
    else {
      f.context.state = "closed";
      f.context.dispatchEvent(new Event("statechange"));
    }
    await closing;
    callback();
    assert.equal(faults.length, 1);
    assert.equal(f.memory.snapshot().bytes, 313);
  });
class Node {
  constructor(context) {
    this.context = context;
    this.parameters = fakeWorkletParams();
    this.gain = { value: 1 };
    this.edges = new Set();
    this.port = {
      postMessage: (d) => {
        if (d.type === "stop")
          queueMicrotask(() => this.send({ type: "closed" }));
      },
      close: () => {
        this.portClosed = true;
      },
    };
  }
  connect(n) {
    this.edges.add(n);
    return n;
  }
  disconnect() {
    this.edges.clear();
  }
  send(data) {
    this.port.onmessage?.({ data });
  }
}
function fixture() {
  const context = Object.assign(new EventTarget(), {
    state: "running",
    sampleRate: 48000,
    currentTime: 0,
    audioWorklet: { addModule: async () => {} },
    createGain() {
      return new Node(this);
    },
  });
  context.destination = new Node(context);
  const memory = new AudioMemory(),
    transport = new Transport();
  const mic = {
    state: "ready",
    settings: { sampleRate: 44100, channelCount: 2 },
    muted: false,
    connectCapture(n) {
      this.input = n;
    },
    close() {
      this.state = "closed";
    },
  };
  let meter;
  const options = {
    context,
    memory,
    transport,
    mic,
    framesPerBar: 120000,
    nodeFactory: () => {
      meter = new Node(context);
      return meter;
    },
  };
  return {
    context,
    memory,
    transport,
    mic,
    options,
    get meter() {
      return meter;
    },
  };
}

test("clock installation refusal still consumes the real close receipt and releases preparation exactly", async () => {
  const f = fixture();
  await assert.rejects(
    createMicSource({
      ...f.options,
      nodeFactory() {
        const n = new Node(f.context);
        n.parameters.clear();
        return n;
      },
    }),
    /workletClockStartMissed/,
  );
  assert.equal(f.mic.state, "closed");
  assert.equal(f.memory.snapshot().bytes, 0);
});

test("native meter clock fault cancels pending monitor, invalidates only its epoch and preserves truthful input loss", async () => {
  const f = fixture(),
    pending = createMicSource(f.options);
  await tick();
  f.meter.send({ type: "meter", channels: 1, peak: 0.2 });
  const source = await pending,
    monitor = setMicMonitor(source, new Node(f.context), true);
  f.meter.send({ type: "clock-error" });
  assert.deepEqual(await monitor, { cancelled: true });
  assert.equal(source.monitoring, "disabled");
  assert.equal(source.isCurrent(), false);
  assert.equal(source.snapshot().fault.reason, "micClockDiscontinuity");
  await closeMicSource(source);
  assert.equal(f.memory.snapshot().bytes, 0);
});
for (const channels of [1, 2])
  test(`actual ${channels}channel probe brands only the same owner; hardware settings do not rewrite channels/rate; monitoring stays zero`, async () => {
    const f = fixture(),
      pending = createMicSource(f.options);
    await tick();
    assert.equal(f.memory.snapshot().bytes, 55296);
    assert.equal(f.mic.input.channelCountMode, "max");
    f.meter.send({
      type: "meter",
      channels,
      frame: 128,
      peak: 0,
      rms: 0,
      clips: 0,
      invalid: false,
    });
    const source = await pending;
    assert.equal(
      captureInputChannels(source, f.context, f.memory, f.transport),
      channels,
    );
    assert.equal(source.sampleRate, 48000);
    assert.equal(source.snapshot().settings.sampleRate, 44100);
    assert.equal(source.monitoring, "disabled");
    assert.equal([...f.meter.edges][0].gain.value, 0);
    assert.throws(() =>
      captureInputChannels({ ...source }, f.context, f.memory, f.transport),
    );
    assert.throws(() =>
      micInputChannels(source, f.context, new AudioMemory(), f.transport),
    );
    const lease = await source.prepare({
      context: f.context,
      memory: f.memory,
      transport: f.transport,
    });
    assert.equal(lease.input, f.mic.input);
    await lease.release();
    assert.equal(
      f.mic.state,
      "ready",
      "per-capture lease does not release the live owner",
    );
    await closeMicSource(source);
    await closeMicSource(source);
    assert.equal(f.mic.state, "closed");
    assert.equal(f.memory.snapshot().bytes, 0);
    assert.equal(f.meter.portClosed, true);
  });
for (const channels of [0, 3])
  test(`unsupported actual topology${channels} refuses and releases all owned nodes`, async () => {
    const f = fixture(),
      p = createMicSource(f.options);
    const refused = assert.rejects(p, { code: "micChannelsUnsupported" });
    await tick();
    f.meter.send({ type: "meter", channels });
    await refused;
    assert.equal(f.memory.snapshot().bytes, 0);
    assert.equal(f.mic.state, "closed");
  });
test("topology/nonfinite loss invalidates the exact epoch without changing the preceding meter or borrowed graph", async () => {
  for (const fault of [
    { channels: 2, changed: true },
    { channels: 1, invalid: true },
  ]) {
    const f = fixture(),
      p = createMicSource(f.options);
    await tick();
    f.meter.send({ type: "meter", channels: 1, peak: 0.2 });
    const s = await p;
    const errors = [];
    s.onFault((e) => errors.push(e));
    f.meter.send({ type: "meter", ...fault });
    assert.equal(s.isCurrent(), false);
    assert.equal(s.generation, 1);
    assert.equal(errors[0].code, "micInputLost");
    assert.throws(() =>
      captureInputChannels(s, f.context, f.memory, f.transport),
    );
    await closeMicSource(s);
    assert.equal(f.memory.snapshot().bytes, 0);
  }
});
test("canceling the channel probe settles without a hardware grant or leaked ledger", async () => {
  const f = fixture(),
    abort = new AbortController(),
    p = createMicSource({ ...f.options, signal: abort.signal });
  const refusal = assert.rejects(p, { code: "captureCancelled" });
  await tick();
  abort.abort();
  await refusal;
  assert.equal(f.memory.snapshot().bytes, 0);
});

test("a real branded mic reaches root arm/preparation with replay ceiling and closes before its live owner", async () => {
  const f = fixture(),
    p = createMicSource(f.options);
  await tick();
  f.meter.send({ type: "meter", channels: 1, peak: 0.2 });
  const source = await p;
  const output = f.context.createGain(),
    pool = new TakePool(f.memory),
    project = freezeCaptureProject(emptyLoopProject(), undefined, 48000),
    engine = {
      context: f.context,
      transport: f.transport,
      master: output,
      disposed: false,
    };
  let opened, finishReady, finishClosed;
  const coordinator = new RootCaptureCoordinator({
    enabled: true,
    moduleURL: "/capture.js",
    root: {
      engine,
      transport: f.transport,
      memory: f.memory,
      pool,
      output,
      project,
      headroom: () => ({ peak: 0, voices: 1 }),
    },
    openSession: async (options) => {
      opened = options;
      const s = {
        state: "armed",
        input: new Node(f.context),
        ready: new Promise((r) => {
          finishReady = r;
        }),
        closed: new Promise((r) => {
          finishClosed = r;
        }),
        playbackFault: new Promise(() => {}),
        stop() {
          this.state = "closed";
          finishReady(null);
          finishClosed();
        },
      };
      return s;
    },
  });
  f.transport.start(0);
  const h = coordinator.arm("track-1", { source, bars: 1, countInBars: 1 });
  await h.prepared;
  assert.equal(opened.channels, 1);
  assert.equal(opened.replayPeakLimit, 0.5);
  assert.equal(opened.plan.endFrame - opened.plan.startFrame, 120000);
  await h.stop();
  assert.equal(f.mic.state, "ready");
  await coordinator.dispose();
  await closeMicSource(source);
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("Stop Mic waits for capture close before releasing its device and preserves foreign producers", async () => {
  const owner = new WorkspaceAudioOwner({
      memory: new AudioMemory(),
      getProject: () => null,
    }),
    events = [];
  let resolve;
  const closed = new Promise((r) => {
    resolve = r;
  });
  const row = {
      trackId: "track-1",
      source: { kind: "original-microphone-input" },
    },
    foreign = { source: { kind: "live-stereo-instrument" } };
  owner.producers.set("track-1", row);
  owner.producers.set("track-2", foreign);
  owner.micInput = {
    state: "ready",
    close() {
      events.push("device-close");
    },
  };
  owner.capture = {
    stopTrack(id) {
      events.push("capture-stop:" + id);
      return closed;
    },
  };
  owner.closeProducer = async (r) => {
    events.push("source-close");
    owner.producers.delete(r.trackId);
  };
  const stop = owner.stopMic();
  await tick();
  assert.deepEqual(events, ["capture-stop:track-1"]);
  resolve();
  await stop;
  assert.deepEqual(events, [
    "capture-stop:track-1",
    "source-close",
    "device-close",
  ]);
  assert.equal(owner.producers.get("track-2"), foreign);
  assert.equal(micAssignment("track-1").origin, "original-local-input");
});

test("optional monitor reserves root headroom before submission, holds disable until native receipt, closes pending without false fault", async () => {
  const f = fixture(),
    p = createMicSource(f.options);
  await tick();
  f.meter.send({ type: "meter", channels: 1, peak: 0.2 });
  const source = await p;
  const project = emptyLoopProject(),
    owner = new WorkspaceAudioOwner({
      memory: f.memory,
      getProject: () => project,
    }),
    graph = new Node(f.context);
  const row = {
    trackId: "track-1",
    source,
    gain: graph,
    prePeak: 0,
    voices: 1,
    futureBytes: 0,
  };
  owner.producers.set("track-1", row);
  owner.engine = { context: f.context };
  owner.controller = {
    plan: {},
    project,
    graphs: new Map([["track-1", graph]]),
  };
  const commands = [];
  f.meter.port.postMessage = (d) => {
    if (d.type === "monitor") commands.push(d);
    if (d.type === "stop")
      queueMicrotask(() => f.meter.send({ type: "closed" }));
  };
  let refuse = true;
  owner.check = () => {
    assert.equal(row.prePeak, 0.125);
    if (refuse)
      throw Object.assign(Error("voiceHeadroom"), { code: "voiceHeadroom" });
  };
  await assert.rejects(owner.setMicMonitoring("track-1", true), {
    code: "micHeadphonesRequired",
  });
  await assert.rejects(
    owner.setMicMonitoring("track-1", true, { headphonesConfirmed: true }),
    { code: "voiceHeadroom" },
  );
  assert.equal(row.prePeak, 0);
  assert.equal(commands.length, 0);
  refuse = false;
  const enabled = owner.setMicMonitoring("track-1", true, {
    headphonesConfirmed: true,
  });
  assert.equal(row.prePeak, 0.125);
  assert.equal(source.monitoring, "disabled");
  await assert.rejects(owner.setMicMonitoring("track-1", false), {
    code: "recordBusy",
  });
  f.meter.send({
    type: "monitor-state",
    id: commands[0].id,
    enabled: true,
    frame: commands[0].frame,
  });
  await enabled;
  assert.equal(source.monitoring, "enabled");
  const disabled = owner.setMicMonitoring("track-1", false);
  assert.equal(row.prePeak, 0.125);
  f.meter.send({
    type: "monitor-state",
    id: commands[1].id,
    enabled: false,
    frame: commands[1].frame,
  });
  await disabled;
  assert.equal(row.prePeak, 0);
  assert.throws(() => setMicMonitor({ ...source }, graph, true), {
    code: "invalidCaptureSource",
  });
  const faults = [];
  source.onFault((e) => faults.push(e));
  const pending = owner.setMicMonitoring("track-1", true, {
    headphonesConfirmed: true,
  });
  await closeMicSource(source);
  assert.deepEqual(await pending, { cancelled: true });
  assert.deepEqual(faults, []);
  assert.equal(f.memory.snapshot().bytes, 0);
});

test("selected-track Stop releases an optionally monitored mic only after capture closed", async () => {
  const owner = new WorkspaceAudioOwner({
      memory: new AudioMemory(),
      getProject: () => null,
    }),
    events = [];
  let done;
  const closed = new Promise((r) => (done = r));
  owner.producers.set("track-1", {
    source: {
      kind: "original-microphone-input",
      silence() {
        throw Error("must release mic owner");
      },
    },
  });
  owner.controller = { stopTrack: (id) => events.push("track:" + id) };
  owner.capture = { stopTrack: () => closed };
  owner.stopMic = async () => events.push("mic-close");
  const stopped = owner.stopTrack("track-1");
  await tick();
  assert.deepEqual(events, ["track:track-1"]);
  done();
  await stopped;
  assert.deepEqual(events, ["track:track-1", "mic-close"]);
});

for (const expired of [false, true])
  test(`mic cleanup ${expired ? "expired timeout" : "pending close"} keeps reservations until actual closed context, then root recovery releases the producer`, async (t) => {
    const f = fixture(),
      p = createMicSource(f.options);
    await tick();
    f.meter.send({ type: "meter", channels: 1, peak: 0.2 });
    const source = await p;
    const owner = new WorkspaceAudioOwner({
      memory: f.memory,
      getProject: () => null,
    });
    owner.engine = { context: f.context };
    owner.micInput = f.mic;
    const row = {
      trackId: "track-1",
      source,
      gain: new Node(f.context),
      nodeLease: f.memory.reserve(4096, "test-owned-route"),
    };
    owner.producers.set("track-1", row);
    f.meter.port.postMessage = () => {};
    const baseline = f.memory.snapshot().bytes;
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const close = owner.closeProducer(row);
    if (expired) {
      const refused = assert.rejects(close, { code: "micCleanupUnconfirmed" });
      t.mock.timers.tick(3000);
      await refused;
      assert.equal(row.closeFailed, true);
    }
    await assert.rejects(owner.retryCleanupAfterContextClose(), {
      code: "captureCleanupUnconfirmed",
    });
    assert.equal(f.memory.snapshot().bytes, baseline);
    assert.equal(owner.producers.size, 1);
    f.context.state = "closed";
    f.context.dispatchEvent(new Event("statechange"));
    if (!expired) await close;
    await owner.retryCleanupAfterContextClose();
    assert.equal(owner.producers.size, 0);
    assert.equal(f.memory.snapshot().bytes, 0);
    t.mock.timers.reset();
  });
test("mono/stereo at both rates:1/2/4/8bar count-in, original silence/overrange and exact repeat policy", () => {
  for (const sampleRate of [44100, 48000])
    for (const channels of [1, 2])
      for (const bars of [1, 2, 4, 8]) {
        const context = { sampleRate, currentTime: 0, state: "running" },
          transport = new Transport();
        transport.start(0);
        const plan = new LoopClock(context, transport).plan({
          bars,
          countInBars: 1,
        });
        const w = new PcmWindow({ ...plan, channels, replayPeakLimit: 0.5 });
        for (
          let frame = plan.startFrame - 128;
          frame < plan.endFrame;
          frame += 128
        )
          w.consume(
            Array.from({ length: channels }, (_, ch) =>
              Float32Array.from(
                { length: 128 },
                (_, i) => (((frame + i) % 17) - 8) / 64 + ch / 32,
              ),
            ),
            frame,
            128,
          );
        assert.equal(w.frames, plan.endFrame - plan.startFrame);
        assert.equal(w.reason, "complete");
        const out = Array.from(
          { length: channels },
          () => new Float32Array(128),
        );
        w.render(out, plan.endFrame, 128);
        for (let ch = 0; ch < channels; ch++)
          assert.deepEqual(out[ch], w.data[ch].subarray(0, 128));
      }
  for (const value of [0, 1.25, -1.5]) {
    const w = new PcmWindow({
      startFrame: 0,
      endFrame: 128,
      channels: 1,
      sampleRate: 48000,
      replayPeakLimit: 0.5,
    });
    w.consume([new Float32Array(128).fill(value)], 0, 128);
    assert.equal(w.data[0][127], value);
    assert.equal(w.reason, value ? "unsafeReplay" : "complete");
    const out = [new Float32Array(128)];
    w.render(out, 128, 128);
    assert.equal(
      out[0].every((n) => n === 0),
      true,
    );
  }
});
