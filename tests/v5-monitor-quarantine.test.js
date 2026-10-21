import test from "node:test";
import assert from "node:assert/strict";
import {
  createMicSource,
  closeMicSource,
  setMicMonitor,
} from "../src/loop-station/mic-source.js";
import { CaptureSession } from "../src/loop-station/capture-session.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { TakePool } from "../src/loop-station/take-pool.js";
import { Transport } from "../src/audio/transport.js";
import { LoopClock } from "../src/loop-station/loop-clock.js";
import {
  fakeWorkletParams,
  nativeParameters,
} from "./helpers/worklet-frame-clock.js";

// Actual processors and owners, modeled ports/routing/context only. No native
// browser, microphone, hardware audibility or latency claim.
const processors = new Map();
globalThis.sampleRate = 48000;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.messages = [];
    this.port = {
      postMessage: (d, transfer = []) =>
        this.messages.push(structuredClone(d, { transfer })),
    };
  }
};
globalThis.registerProcessor = (name, C) => processors.set(name, C);
await import("../src/loop-station/mic-meter-worklet.js");
await import("../src/loop-station/capture-worklet.js");

class Route extends EventTarget {
  constructor(context) {
    super();
    this.context = context;
    this.gain = { value: 1 };
    this.edges = new Set();
  }
  connect(n) {
    this.edges.add(n);
    return n;
  }
  disconnect(n) {
    if (n) this.edges.delete(n);
    else this.edges.clear();
  }
}
class WorkerNode extends Route {
  constructor(context, name, options) {
    super(context);
    this.parameters = fakeWorkletParams();
    this.commands = [];
    this.processor = new (processors.get(name))(options);
    this.port = {
      postMessage: (d) => {
        const message = structuredClone(d);
        this.commands.push(message);
        this.processor.port.onmessage({ data: message });
      },
      close: () => {
        this.port.closed = true;
      },
    };
  }
  deliver(includeClosed = false) {
    for (let i = 0; i < this.processor.messages.length;) {
      const d = this.processor.messages[i];
      if (d.type === "closed" && !includeClosed) {
        i++;
        continue;
      }
      this.processor.messages.splice(i, 1);
      this.port.onmessage?.({ data: d });
    }
  }
  render(frame, input) {
    const output = [new Float32Array(128), new Float32Array(128)];
    this.active = this.processor.process(
      [input],
      [output],
      nativeParameters(frame, 128),
    );
    return output;
  }
}
const tick = () => new Promise(setImmediate);
const cases = [
  ["host-clock", "active", "prefix"],
  ["host-clock", "pending", "prefix"],
  ["host-clock", "active", "full"],
  ["host-clock", "pending", "full"],
  ["invalidate", "active", "prefix"],
  ["invalidate", "pending", "full"],
  ["abort", "active", "prefix"],
  ["abort", "pending", "full"],
];
for (const [cause, monitorPhase, captureKind] of cases)
  test(`${cause} quarantines ${monitorPhase} monitor without discarding ${captureKind} capture or early retirement`, async (t) => {
    const rate = 48000,
      base = 2 * 1048576,
      probe = base - 5760;
    let clockCallback;
    t.mock.method(globalThis, "setInterval", (fn) => {
      clockCallback = fn;
      return { unref() {} };
    });
    t.mock.method(globalThis, "clearInterval", () => {});
    const context = Object.assign(new EventTarget(), {
      state: "running",
      sampleRate: rate,
      currentTime: (base - 8192) / rate,
      audioWorklet: { addModule: async () => {} },
      createGain() {
        return new Route(this);
      },
    });
    context.destination = new Route(context);
    const memory = new AudioMemory(),
      foreign = memory.reserve(313, "foreign"),
      transport = new Transport(),
      pool = new TakePool(memory),
      abort = new AbortController();
    transport.start(0);
    let meter,
      captureNode,
      source,
      session,
      cleanup,
      closeSettled = false;
    const mic = {
      state: "ready",
      muted: false,
      settings: {},
      closes: 0,
      connectCapture(n) {
        this.bus = n;
      },
      close() {
        this.closes++;
        this.state = "closed";
      },
    };
    t.after(async () => {
      session?.stop("userStop");
      captureNode?.deliver(true);
      context.state = "closed";
      context.dispatchEvent(new Event("statechange"));
      await session?.closed;
      if (source) await closeMicSource(source).catch(() => {});
      await cleanup;
      if (session?.take) pool.release(session.take.id);
      foreign.release();
      assert.equal(memory.snapshot().bytes, 0);
    });
    const opening = createMicSource({
      context,
      memory,
      transport,
      mic,
      signal: abort.signal,
      framesPerBar: 120000,
      nodeFactory(c, o) {
        return (meter = new WorkerNode(c, "perkusi-mic-meter-v5", o));
      },
    });
    await tick();
    meter.render(probe, [new Float32Array(128).fill(0.25)]);
    meter.deliver();
    context.currentTime = (probe + 128) / rate;
    source = await opening;
    const raw = await source.prepare({ context, memory, transport });
    session = await CaptureSession.open({
      clock: new LoopClock(context, transport),
      memory,
      pool,
      destination: new Route(context),
      moduleURL: "https://qa.test/capture.js",
      replay: false,
      channels: 1,
      plan: { sampleRate: rate, startFrame: base - 256, endFrame: base + 256 },
      nodeFactory(c, o) {
        return (captureNode = new WorkerNode(c, "perkusi-loop-capture-v5", o));
      },
    });
    raw.input.connect(session.input);
    const monitorDestination = new Route(context),
      faults = [],
      notificationRoutes = [];
    const startCleanup = (reason) => {
      session.stop(reason);
      cleanup = session.closed
        .then(() => closeMicSource(source))
        .then(() => {
          closeSettled = true;
        });
    };
    source.onFault((f) => {
      faults.push(f);
      notificationRoutes.push({
        disconnected: !meter.edges.has(monitorDestination),
        captureConnected: raw.input.edges.has(session.input),
      });
      startCleanup("inputLost");
    });
    let monitorResult;
    const enable = () =>
      setMicMonitor(source, monitorDestination, true).then((v) => {
        monitorResult = v;
      });
    if (monitorPhase === "active") enable();
    const faultFrame = captureKind === "full" ? base + 256 : base;
    for (let frame = probe + 128; frame < faultFrame; frame += 128) {
      context.currentTime = frame / rate;
      if (monitorPhase === "pending" && frame === base - 128) enable();
      const input = [new Float32Array(128).fill(frame < base ? 0.25 : 0.5)];
      meter.render(frame, input);
      meter.deliver();
      captureNode.render(frame, input);
      assert(input[0].every((v) => v === (frame < base ? 0.25 : 0.5)));
    }
    await tick();
    assert.equal(
      source.monitoring,
      monitorPhase === "active" ? "enabled" : "disabled",
    );
    assert.equal(
      meter.processor.monitorEnabled === true,
      monitorPhase === "active",
    );
    const command = meter.commands.find((m) => m.type === "monitor"),
      held = memory.snapshot().bytes;
    context.currentTime = faultFrame / rate;
    if (cause === "host-clock") {
      meter.parameters.get("framePhase").linearRampToValueAtTime = () => {
        throw Error("QAMonitorClockFailure");
      };
      clockCallback();
    } else if (cause === "invalidate") source.invalidate("inputLost");
    else {
      abort.abort();
      startCleanup("userStop");
    }
    await tick();
    assert.equal(source.monitoring, "disabled");
    assert.equal(source.isCurrent(), false);
    if (monitorPhase === "pending")
      assert.deepEqual(monitorResult, { cancelled: true });
    assert.equal(faults.length, cause === "abort" ? 0 : 1);
    assert(
      notificationRoutes.every((v) => v.disconnected && v.captureConnected),
    );
    assert.equal(mic.closes, 0);
    assert.equal(context.state, "running");
    assert.equal(closeSettled, false);
    assert.equal(memory.snapshot().bytes, held);
    assert.equal(meter.port.closed, undefined);
    assert(raw.input.edges.has(meter));
    assert(raw.input.edges.has(session.input));
    assert.equal(
      meter.edges.has(monitorDestination),
      false,
      "disconnect only the optional output before owner capture barrier",
    );
    assert.equal(
      meter.edges.size,
      1,
      "zero sink retained; raw capture bus is untouched",
    );
    const out = meter.render(faultFrame, [new Float32Array(128).fill(0.25)]);
    assert(
      out.every((c) =>
        c.every((v) => !meter.edges.has(monitorDestination) || v === 0),
      ),
    );
    assert.equal(meter.active, true);
    // The pending native Enable and its late ACK may still run internally.
    // Neither can reconnect the contained destination or revive host state.
    meter.processor.port.onmessage({ data: command });
    let internalOutput = 0;
    for (
      let frame = faultFrame + 128;
      frame <= Math.max(faultFrame + 512, command.frame + 256);
      frame += 128
    ) {
      const input = [new Float32Array(128).fill(0.25)],
        silent = meter.render(frame, input);
      for (const c of silent)
        for (const v of c)
          internalOutput = Math.max(internalOutput, Math.abs(v));
      assert(
        silent.every((c) =>
          c.every((v) => !meter.edges.has(monitorDestination) || v === 0),
        ),
        "monitor destination remains silent after quarantine",
      );
      assert(input[0].every((v) => v === 0.25));
      meter.deliver();
    }
    assert(
      internalOutput > 0,
      "real processor still receives healthy input; only monitor destination is contained",
    );
    meter.port.onmessage({
      data: {
        type: "monitor-state",
        id: command.id,
        enabled: true,
        frame: command.frame + 4096,
      },
    });
    assert.equal(source.monitoring, "disabled");
    assert.equal(meter.edges.has(monitorDestination), false);
    assert.throws(() => setMicMonitor(source, monitorDestination, true), {
      code: "recordBusy",
    });
    assert.equal(meter.processor.monitorCommand, null);
    assert.equal(
      meter.processor.stopped,
      undefined,
      "monitor quarantine is not a capture/worker stop",
    );
    assert.equal(mic.closes, 0);
    assert.equal(memory.snapshot().bytes, held);
    captureNode.deliver(true);
    const take = await session.ready;
    await session.closed;
    await tick();
    assert.equal(take.frames, captureKind === "full" ? 512 : 256);
    assert.equal(take.partial, captureKind !== "full");
    assert.equal(
      take.reason,
      captureKind === "full"
        ? "complete"
        : cause === "abort"
          ? "userStop"
          : "inputLost",
    );
    assert.equal(
      closeSettled,
      false,
      "producer still waits for its real closed receipt",
    );
    assert.equal(mic.closes, 1);
    assert.equal(meter.port.closed, undefined);
    assert.equal(memory.snapshot().bytes, 55296 + 2048 + 313);
    const copy = pool.copyPCM(take.id);
    try {
      const pcm = new Float32Array(copy.buffer);
      assert(pcm.subarray(0, 256).every((v) => v === 0.25));
      assert(pcm.subarray(256).every((v) => v === 0.5));
    } finally {
      copy.release();
    }
    meter.deliver(true);
    await cleanup;
    assert.equal(memory.snapshot().bytes, 2048 + 313);
    assert.equal(meter.port.closed, true);
    assert.equal(context.state, "running");
    clockCallback();
  });
