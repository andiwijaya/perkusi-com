import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceAudioOwner } from "../src/loop-station/workspace-owner.js";
import { LoopStationSession } from "../src/loop-station/session.js";
import { MasterClock } from "../src/loop-station/master-clock.js";
import { SessionTakes } from "../src/loop-station/session-takes.js";
import { SelectedRecorder } from "../src/loop-station/selected-recorder.js";
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { Transport } from "../src/audio/transport.js";
import { validateLoopProject } from "../src/loop-station/project.js";

const tick = () => new Promise((r) => setImmediate(r));
const param = () => ({
  value: 1,
  setValueAtTime() {},
  linearRampToValueAtTime() {},
  cancelScheduledValues() {},
});
class Node extends EventTarget {
  constructor(context) {
    super();
    this.context = context;
    this.gain = param();
    this.pan = param();
    this.playbackRate = param();
    this.stops = [];
  }
  connect() {}
  disconnect() {}
  start() {
    this.context.onStart?.();
  }
  stop(time) {
    this.stops.push(time);
  }
}
class Context extends EventTarget {
  currentTime = 0;
  sampleRate = 48000;
  state = "running";
  sources = [];
  createGain() {
    return new Node(this);
  }
  createStereoPanner() {
    return new Node(this);
  }
  createBufferSource() {
    const n = new Node(this);
    this.sources.push(n);
    return n;
  }
  createBuffer(channels, length, sampleRate) {
    const a = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      length,
      numberOfChannels: channels,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: (ch) => a[ch],
      copyToChannel: (v, ch) => a[ch].set(v),
    };
  }
}
async function fixture() {
  const c = new Context(),
    memory = new AudioMemory(),
    foreign = memory.reserve(1234, "foreign-owner"),
    transport = new Transport(),
    output = c.createGain(),
    registry = new InstrumentRegistry();
  const project = validateLoopProject({
    format: "perkusi-project",
    schemaVersion: 5,
    mode: "loop-station",
    title: "Saved lifecycle races",
    timing: { bpm: 173, meter: [4, 4] },
    clock: { kind: "fixed-bar", sampleRate: 48000, framesPerBar: 66590 },
    master: { volume: 0.5 },
    origins: [],
    assetRefs: [],
    tracks: ["selected", "other"].map((id) => ({
      id,
      kind: "event",
      gain: 0.25,
      pan: 0,
      mute: false,
      solo: false,
      clips: [],
    })),
  });
  const owner = new WorkspaceAudioOwner({
    memory,
    getProject: () => s.project,
  });
  const s = new LoopStationSession({
    context: c,
    transport,
    memory,
    registry,
    output,
    admission: owner,
    ownsTransport: true,
  });
  s.project = project;
  s.plan = {
    project,
    clock: new MasterClock(project, 48000),
    tracks: project.tracks,
    trackDocuments: new Map(),
    release() {},
  };
  owner.attach({ context: c, transport, master: output, output, volume: 1 }, s);
  await owner.prepareInstrument("selected", {
    moduleURL: "https://qa.test/capture.js",
  });
  s.status = "playing";
  transport.start(0);
  const store = (owner.takeStore = new SessionTakes(owner)),
    recorder = new SelectedRecorder(owner);
  recorder.assignment = { trackId: "selected" };
  function make(trackId = "selected", saved = true) {
    const capacity = 66590,
      reservation = owner.pool.reserve({
        capacity,
        channels: 2,
        sampleRate: 48000,
      });
    const take = owner.pool.adopt(
      reservation,
      {
        capacity,
        channels: 2,
        sampleRate: 48000,
        startFrame: 0,
        frames: capacity,
        reason: "complete",
      },
      [
        new Float32Array(capacity).fill(0.1).buffer,
        new Float32Array(capacity).fill(0.2).buffer,
      ],
    );
    const token = {};
    owner.pool.pin(take.id, token);
    owner.capture.retained.set(take.id, {
      take,
      owner: token,
      record: { cleaned: true },
    });
    if (saved) store.save(take.id, trackId);
    return take;
  }
  async function playback(trackId = "selected") {
    const id = store.layers(trackId).at(-1),
      p = await owner.playSaved(id, trackId);
    c.currentTime = p.voice.when + 0.1;
    return p;
  }
  return {
    c,
    memory,
    owner,
    s,
    store,
    recorder,
    make,
    playback,
    async close() {
      const stopped = owner.stopSaved();
      for (const n of c.sources) n.onended?.();
      await stopped;
      await store.discard();
      for (const id of [...owner.capture.retained.keys()])
        owner.releaseTake(id);
      await owner.dispose();
      c.state = "closed";
      c.dispatchEvent(new Event("statechange"));
      await s.dispose();
      assert.equal(memory.snapshot().bytes, 1234);
      foreign.release();
      assert.equal(memory.snapshot().bytes, 0);
    },
  };
}

test("global Stop refuses new replay and waits actual ended for its existing loop", async () => {
  const f = await fixture();
  try {
    const take = f.make(),
      p = await f.playback();
    let done = false;
    const stopping = f.owner
      .run("stop", () => f.s.stop())
      .then(() => {
        done = true;
      });
    await assert.rejects(f.recorder.playSaved(), { code: "recordBusy" });
    await tick();
    assert.equal(done, false);
    assert.equal(f.s.status, "playing");
    assert.equal(p.voice.source.stops.length, 1);
    assert.ok(p.copy.buffer);
    assert.equal(f.owner.pool.snapshot()[0].pins, 2);
    p.voice.source.onended();
    await stopping;
    assert.equal(f.owner.playbacks.size, 0);
    assert.equal(f.s.status, "stopped");
    assert.equal(f.owner.engine.transport.running, false);
    assert.equal(f.owner.pool.describe(take.id).id, take.id);
  } finally {
    await f.close();
  }
});

for (const operation of ["undo", "redo", "discard"])
  test(`${operation} holds original and playback copy through ended, and refuses new replay/save/source`, async () => {
    const f = await fixture();
    try {
      const a = f.make(),
        b = f.make();
      if (operation === "redo") await f.store.undo("selected");
      const p = await f.playback(),
        pending = f.make("selected", false);
      let done = false;
      const mutation = (
        operation === "discard"
          ? f.store.discard()
          : f.store[operation]("selected")
      ).then(() => {
        done = true;
      });
      await assert.rejects(f.recorder.playSaved(), { code: "recordBusy" });
      assert.throws(() => f.store.save(pending.id, "selected"), {
        code: "recordBusy",
      });
      await assert.rejects(f.owner.assignInstrument("selected", {}), {
        code: "recordBusy",
      });
      await tick();
      assert.equal(done, false);
      assert.equal(f.store.saved.size, 2);
      assert.ok(p.copy.buffer);
      assert.equal(f.owner.pool.snapshot().find((x) => x.id === a.id).pins, 2);
      assert.equal(
        f.owner.pool.snapshot().find((x) => x.id === pending.id).pins,
        1,
      );
      p.voice.source.onended();
      await mutation;
      assert.equal(f.owner.playbacks.size, 0);
      assert.equal(f.owner.savedBarriers.size, 0);
      assert.equal(f.owner.engine.transport.running, true);
      if (operation === "discard") {
        assert.equal(f.store.saved.size, 0);
        assert.deepEqual(
          f.owner.pool.snapshot().map((x) => x.id),
          [pending.id],
        );
      } else {
        assert.deepEqual(f.store.layers("selected"), [
          operation === "undo" ? a.id : b.id,
        ]);
        assert.equal(
          f.owner.pool.snapshot().find((x) => x.id === a.id).pins,
          2,
        );
      }
    } finally {
      await f.close();
    }
  });

test("selected Stop keeps admission blocked through native ended without resetting shared Transport", async () => {
  const f = await fixture();
  try {
    f.make();
    const p = await f.playback();
    let done = false;
    const stopping = f.recorder.stop().then(() => {
      done = true;
    });
    await assert.rejects(f.recorder.playSaved(), { code: "recordBusy" });
    await tick();
    assert.equal(done, false);
    assert.ok(p.copy.buffer);
    p.voice.source.onended();
    await stopping;
    assert.equal(f.owner.playbacks.size, 0);
    assert.equal(f.owner.engine.transport.running, true);
    assert.equal(f.owner.pool.snapshot()[0].pins, 2);
  } finally {
    await f.close();
  }
});

test("track history operation preserves another track's saved loop and owner", async () => {
  const f = await fixture();
  try {
    f.make();
    f.make("other");
    const p = await f.playback("other");
    await f.store.undo("selected");
    assert.equal(f.owner.playbacks.size, 1);
    assert.equal(p.voice.source.loop, true);
    assert.deepEqual(p.voice.source.stops, []);
    assert.equal(f.owner.engine.transport.running, true);
    assert.ok(p.copy.buffer);
    assert.equal(f.owner.pool.snapshot().length, 2);
  } finally {
    await f.close();
  }
});

test("global Stop waits an already pending disposition and its original/copy lifecycle", async () => {
  const f = await fixture();
  try {
    f.make();
    const p = await f.playback();
    let disposed = false,
      stopped = false;
    const discard = f.store.discard().then(() => {
      disposed = true;
    });
    const stop = f.owner
      .run("stop", () => f.s.stop())
      .then(() => {
        stopped = true;
      });
    await tick();
    assert.equal(disposed, false);
    assert.equal(stopped, false);
    assert.equal(f.owner.pool.snapshot()[0].pins, 2);
    p.voice.source.onended();
    await Promise.all([discard, stop]);
    assert.equal(f.owner.pool.snapshot().length, 0);
    assert.equal(f.owner.playbacks.size, 0);
    assert.equal(f.owner.savedBarriers.size, 0);
  } finally {
    await f.close();
  }
});

test("root Stop reentry from native start cancels the newly assigned voice and awaits its ended", async () => {
  const f = await fixture();
  try {
    f.make();
    let stop,
      done = false;
    f.c.onStart = () => {
      f.c.onStart = null;
      stop = f.owner
        .run("stop", () => f.s.stop())
        .then(() => {
          done = true;
        });
    };
    const play = f.recorder.playSaved();
    const refused = assert.rejects(play, { code: "recordBusy" });
    await tick();
    assert.equal(done, false);
    const p = [...f.owner.playbacks][0];
    assert.ok(p.copy.buffer);
    assert.equal(p.voice.source.stops.length, 1);
    p.voice.source.onended();
    await Promise.all([refused, stop]);
    assert.equal(f.owner.playbacks.size, 0);
    assert.equal(f.owner.pool.snapshot()[0].pins, 2);
  } finally {
    await f.close();
  }
});

test("failed history mutation clears its barrier and permits a later explicit replay", async () => {
  const f = await fixture();
  try {
    f.make();
    await assert.rejects(f.store.undo("missing"), { code: "invalidLoopTrack" });
    assert.equal(f.owner.savedBarriers.size, 0);
    const p = await f.playback();
    assert.equal(p.voice.source.loop, true);
  } finally {
    await f.close();
  }
});

test("pending source assignment blocks replay/history and root Stop waits its cancellation", async () => {
  const f = await fixture();
  const original = f.owner.closeProducers;
  let resolve;
  try {
    f.make();
    const gate = new Promise((r) => {
      resolve = r;
    });
    f.owner.closeProducers = () => gate;
    const assignment = f.owner.assignInstrument("selected", {});
    const refused = assert.rejects(assignment, { code: "cancelled" });
    await tick();
    await assert.rejects(f.recorder.playSaved(), { code: "recordBusy" });
    await assert.rejects(f.store.undo("selected"), { code: "recordBusy" });
    let done = false;
    const stop = f.owner
      .run("stop", () => f.s.stop())
      .then(() => {
        done = true;
      });
    await tick();
    assert.equal(done, false);
    resolve();
    await Promise.all([refused, stop]);
    assert.equal(f.owner.playbacks.size, 0);
    assert.equal(f.owner.pool.snapshot()[0].pins, 2);
  } finally {
    resolve?.();
    f.owner.closeProducers = original;
    await f.close();
  }
});

test("recorder discard holds its command guard across stop and library disposition", async () => {
  const f = await fixture();
  try {
    f.make();
    const p = await f.playback();
    const discard = f.recorder.discardAll();
    assert.equal(f.recorder.busy, true);
    assert.throws(() => f.recorder.save(), { code: "recordBusy" });
    assert.throws(() => f.recorder.playSaved(), { code: "recordBusy" });
    await assert.rejects(f.recorder.prepare("selected"), {
      code: "recordBusy",
    });
    await assert.rejects(f.recorder.discardAll(), { code: "recordBusy" });
    assert.equal(f.owner.pool.snapshot()[0].pins, 2);
    p.voice.source.onended();
    await discard;
    assert.equal(f.recorder.busy, false);
    assert.equal(f.owner.pool.snapshot().length, 0);
    assert.equal(f.owner.playbacks.size, 0);
    assert.equal(f.owner.engine.transport.running, true);
  } finally {
    await f.close();
  }
});
