import test from "node:test";
import assert from "node:assert/strict";
import { MicInput } from "../src/loop-station/mic-input.js";
import { WorkspaceAudioOwner } from "../src/loop-station/workspace-owner.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { Transport } from "../src/audio/transport.js";
import { emptyLoopProject } from "../src/loop-station/model.js";
import { SelectedRecorder } from "../src/loop-station/selected-recorder.js";
class Track extends EventTarget {
  readyState = "live";
  stops = 0;
  stop() {
    this.stops++;
    this.readyState = "ended";
  }
  getSettings() {
    return { channelCount: 1, sampleRate: 48000, deviceId: "PRIVATE" };
  }
}
class FakeNode extends EventTarget {
  constructor(context) {
    super();
    this.context = context;
    this.gain = {
      value: 1,
      setValueAtTime(v) {
        this.value = v;
      },
    };
    this.edges = new Set();
  }
  connect(n) {
    this.edges.add(n);
    return n;
  }
  disconnect() {
    this.edges.clear();
  }
}
function ownerFixture() {
  const context = Object.assign(new EventTarget(), {
    state: "running",
    sampleRate: 48000,
    currentTime: 0,
    audioWorklet: { addModule: async () => {} },
    createGain() {
      return new FakeNode(this);
    },
    createMediaStreamSource() {
      return new FakeNode(this);
    },
  });
  context.destination = new FakeNode(context);
  const memory = new AudioMemory(),
    transport = new Transport(),
    project = emptyLoopProject(),
    gain = new FakeNode(context),
    owner = new WorkspaceAudioOwner({ memory, getProject: () => project }),
    rootIntents = [];
  owner.engine = { context, transport, master: gain, output: gain, volume: 1 };
  owner.controller = {
    context,
    transport,
    rows: new Map(),
    master: gain,
    graphs: new Map([["track-1", { gain }]]),
    plan: { clock: { policy: { framesPerBar: 120000 } } },
    project,
    liveAdmission: () => ({ maxOwned: 0, maxPeak: 0 }),
  };
  owner.captureTrack = "track-1";
  owner.capture = {
    snapshot: () => ({ retained: [] }),
    retarget() {},
    rootIntent(kind) {
      rootIntents.push(kind);
      return Promise.resolve();
    },
    stopTrack: async () => {},
  };
  const track = new Track(),
    stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  globalThis.AudioWorkletNode = class extends FakeNode {
    constructor(c) {
      super(c);
      this.port = {
        postMessage: (d) => {
          if (d.type === "stop")
            queueMicrotask(() =>
              this.port.onmessage({ data: { type: "closed" } }),
            );
        },
        close() {},
      };
      queueMicrotask(() =>
        this.port.onmessage?.({
          data: {
            type: "meter",
            channels: 1,
            frame: 128,
            peak: 0.1,
            rms: 0.1,
            clips: 0,
            invalid: false,
          },
        }),
      );
    }
  };
  const recorder = new SelectedRecorder(owner);
  recorder.assignment = {
    format: "perkusi-mic-assignment",
    trackId: "track-1",
  };
  return { owner, recorder, rootIntents, track, stream, context, memory };
}
test("regression: normal Stop Mic must not fabricate micInputLost or a recorder error", async () => {
  const f = ownerFixture();
  f.recorder.source = await f.owner.enableMic("track-1", {
    provider: async () => f.stream,
    activation: () => true,
  });
  assert.equal(f.recorder.snapshot().state, "ready");
  await f.owner.stopMic();
  console.log(
    "STOP_EVIDENCE",
    JSON.stringify({
      lastFault: f.owner.lastFault,
      rootIntents: f.rootIntents,
      recorderState: f.recorder.snapshot().state,
      trackState: f.track.readyState,
      memoryBytes: f.memory.snapshot().bytes,
    }),
  );
  assert.equal(
    f.owner.lastFault,
    undefined,
    "a deliberate stop is not an input fault",
  );
  assert.deepEqual(f.rootIntents, []);
  assert.notEqual(f.recorder.snapshot().state, "error");
});
test("normal stop then deliberate re-enable stays ready; pending cancellation creates no false input fault", async () => {
  const f = ownerFixture();
  let grant;
  const pending = f.owner.enableMic("track-1", {
    activation: () => true,
    provider: () =>
      new Promise((r) => {
        grant = r;
      }),
  });
  await f.owner.stopMic();
  assert.equal(await pending, null);
  grant(f.stream);
  await new Promise((r) => setImmediate(r));
  assert.equal(f.track.readyState, "ended");
  assert.equal(f.owner.lastFault, undefined);
  for (let i = 0; i < 2; i++) {
    const track = new Track(),
      stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    f.recorder.source = await f.owner.enableMic("track-1", {
      activation: () => true,
      provider: async () => stream,
    });
    assert.equal(f.recorder.snapshot().state, "ready");
    assert.equal(f.owner.micPreparation, null);
    await f.owner.stopMic();
    assert.equal(track.readyState, "ended");
    assert.equal(f.owner.lastFault, undefined);
    assert.deepEqual(f.rootIntents, []);
    assert.notEqual(f.recorder.snapshot().state, "error");
  }
});
test("actual device ended invalidates source and dispatches real root capture barrier", async () => {
  const f = ownerFixture();
  const source = await f.owner.enableMic("track-1", {
    provider: async () => f.stream,
    activation: () => true,
  });
  f.track.readyState = "ended";
  f.track.dispatchEvent(new Event("ended"));
  await new Promise((r) => setImmediate(r));
  assert.equal(source.isCurrent(), false);
  assert.equal(f.owner.lastFault, "micInputLost");
  assert.deepEqual(f.rootIntents, ["micInputLost"]);
  assert.equal(f.track.readyState, "ended");
  await f.owner.stopMic();
  assert.equal(f.memory.snapshot().bytes, 0);
});
test("cancel then retry: an old late grant or rejection cannot reclaim a ready new epoch", async () => {
  for (const rejectOld of [false, true]) {
    const f = ownerFixture();
    let grant, reject;
    let calls = 0;
    const late = new Track();
    const mic = new MicInput(f.context, {
      activation: () => true,
      provider: () =>
        ++calls === 1
          ? new Promise((a, b) => {
              grant = a;
              reject = b;
            })
          : Promise.resolve(f.stream),
    });
    const old = mic.enable({ userGesture: true });
    mic.release();
    assert.equal(await old, false);
    assert.equal(await mic.enable({ userGesture: true }), true);
    if (rejectOld) reject(new DOMException("old denial", "NotAllowedError"));
    else grant({ getTracks: () => [late], getAudioTracks: () => [late] });
    await new Promise((r) => setImmediate(r));
    assert.equal(mic.state, "ready");
    assert.equal(f.track.readyState, "live");
    assert.equal(late.readyState, rejectOld ? "live" : "ended");
    mic.close();
    assert.equal(f.track.readyState, "ended");
  }
});
test("regression: scalar meter must preserve a clipping impulse between delivered receipts", async () => {
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
  globalThis.registerProcessor = (_, p) => (Processor = p);
  globalThis.currentFrame = 0;
  await import("../src/loop-station/mic-meter-worklet.js");
  const p = new Processor(),
    out = [[new Float32Array(128)]];
  const block = (frame, v) => {
    globalThis.currentFrame = frame;
    p.process([[new Float32Array(128).fill(v)]], out);
    assert(out[0][0].every((x) => x === 0));
  };
  block(0, 0);
  p.port.onmessage({ data: { type: "ack" } });
  block(128, 1.25);
  for (let n = 2; n <= 16; n++) block(n * 128, 0);
  console.log("METER_EVIDENCE", JSON.stringify(p.port.messages));
  assert(
    p.port.messages.some(
      (m) => m.type === "meter" && m.peak === 1.25 && m.clips >= 128,
    ),
    "a full clipped quantum must appear in a later scalar receipt",
  );
});
