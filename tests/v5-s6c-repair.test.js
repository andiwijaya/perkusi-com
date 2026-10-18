import test from "node:test";
import assert from "node:assert/strict";
import catalog from "../internal/instrument-focus/registry-48000.json" with { type: "json" };
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { Transport } from "../src/audio/transport.js";
import { LoopStationSession } from "../src/loop-station/session.js";
import { eightTrackDemo } from "../src/loop-station/demo.js";
const registry = new InstrumentRegistry(catalog.banks);
const parameter = () => ({
  value: 0,
  setValueAtTime(v) {
    this.value = v;
  },
  linearRampToValueAtTime(v) {
    this.value = v;
  },
  cancelScheduledValues() {},
});
function fixture(options = {}) {
  const memory = new AudioMemory(),
    foreign = memory.reserve(1234, "foreign"),
    sources = [];
  let released = 0;
  const context = {
    state: "running",
    sampleRate: 48000,
    currentTime: 0,
    addEventListener() {},
    removeEventListener() {},
    createGain() {
      return {
        context: this,
        gain: parameter(),
        connect() {},
        disconnect() {},
      };
    },
    createStereoPanner() {
      return { context: this, pan: parameter(), connect() {}, disconnect() {} };
    },
    createBufferSource() {
      const source = {
        playbackRate: parameter(),
        connect() {},
        disconnect() {},
        start() {},
        stop() {
          if (!options.holdEnded) queueMicrotask(() => this.onended?.());
        },
      };
      sources.push(source);
      return source;
    },
  };
  const cache = {
    trim() {},
    async acquire(bank, version, id) {
      const d = registry.sample(bank, version, id);
      return {
        buffer: {
          length: d.frames,
          sampleRate: 48000,
          numberOfChannels: d.channels,
          duration: d.frames / 48000,
        },
        metrics: { peak: 0.001 },
        release() {
          released++;
        },
      };
    },
  };
  const session = new LoopStationSession({
    context,
    wallNow: () => context.currentTime * 1000,
    memory,
    registry,
    cache,
    transport: new Transport(),
    output: context.createGain(),
    ownsTransport: true,
    ...options,
  });
  return {
    session,
    context,
    memory,
    sources,
    foreign,
    get released() {
      return released;
    },
    async cleanup() {
      session.stop();
      for (const s of sources) s.onended?.();
      context.state = "closed";
      await session.dispose();
      foreign.release();
      assert.equal(memory.snapshot().bytes, 0);
    },
  };
}
test("dispose installs terminal admission and one shared operation before any subscriber can reenter", async () => {
  const f = fixture(),
    s = f.session;
  let closing,
    shared,
    reentered = false,
    loadRejected;
  try {
    await s.load(eightTrackDemo(registry));
    s.subscribe(() => {
      if (!reentered && s.closing) {
        reentered = true;
        shared = s.dispose();
        assert.throws(() => s.play(), { code: "sessionDisposed" });
        loadRejected = assert.rejects(s.load(eightTrackDemo(registry)), {
          code: "sessionDisposed",
        });
        assert.throws(() => s.setMix(s.project), { code: "sessionDisposed" });
        assert.throws(() => s.playTrack(s.project.tracks[0].id), {
          code: "sessionDisposed",
        });
      }
    });
    closing = s.dispose();
    assert.equal(s.closing, true);
    assert.equal(s.dispose(), closing);
    assert.throws(() => s.play(), { code: "sessionDisposed" });
    assert.throws(() => s.setMix(s.project), { code: "sessionDisposed" });
    assert.throws(() => s.playTrack(s.project.tracks[0].id), {
      code: "sessionDisposed",
    });
    await assert.rejects(s.load(eightTrackDemo(registry)), {
      code: "sessionDisposed",
    });
    await closing;
    await loadRejected;
    assert.equal(shared, closing);
    assert.equal(reentered, true);
    assert.equal(s.status, "closed");
    assert.equal(s.timer, null);
    assert.equal(s.rows.size, 0);
    assert.equal(f.memory.snapshot().bytes, 1234);
    assert.equal(f.context.state, "running");
  } finally {
    await closing?.catch(() => {});
    await f.cleanup();
  }
});
test("disposal waits for earlier delayed preparation, rejects new work and releases late plan exactly once", async () => {
  let resolve,
    released = 0,
    finished = false;
  const gate = new Promise((r) => (resolve = r)),
    f = fixture({
      prepare: async () => {
        await gate;
        return {
          release() {
            released++;
          },
        };
      },
    }),
    s = f.session;
  try {
    const loading = s.load(eightTrackDemo(registry)),
      rejected = assert.rejects(loading, { code: "cancelled" });
    await Promise.resolve();
    const closing = s.dispose().then(() => (finished = true));
    await Promise.resolve();
    assert.equal(finished, false);
    const unexpected = s.load(eightTrackDemo(registry));
    void unexpected.catch(() => {});
    const admission = await Promise.race([
      unexpected.then(
        () => "accepted",
        (e) => e.code,
      ),
      new Promise((r) => setTimeout(() => r("admitted-and-waiting"), 30)),
    ]);
    assert.equal(admission, "sessionDisposed");
    resolve();
    await rejected;
    await closing;
    assert.equal(released, 1);
    assert.equal(finished, true);
    assert.equal(f.memory.snapshot().bytes, 1234);
  } finally {
    resolve();
    await f.cleanup();
  }
});
test("closing preserves pins until delayed ended and never releases the caller context or foreign lease", async () => {
  const f = fixture({ holdEnded: true }),
    s = f.session;
  try {
    await s.load(eightTrackDemo(registry));
    s.play();
    assert.ok(s.rows.size > 0);
    let finished = false;
    const closing = s.dispose();
    void closing.then(() => (finished = true));
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(finished, false);
    assert.ok(f.memory.snapshot().bytes > 1234);
    assert.throws(() => s.play(), { code: "sessionDisposed" });
    for (const source of f.sources) source.onended?.();
    await closing;
    assert.equal(f.memory.snapshot().bytes, 1234);
    assert.ok(f.released > 0);
    assert.equal(f.context.state, "running");
    assert.equal(s.timer, null);
  } finally {
    await f.cleanup();
  }
});
test("failed close remains terminal and can retry cleanup once caller confirms closed context", async () => {
  const f = fixture({ holdEnded: true }),
    s = f.session;
  try {
    await s.load(eightTrackDemo(registry));
    s.play();
    f.context.state = "suspended";
    await assert.rejects(s.dispose(), { code: "loopClosePending" });
    assert.throws(() => s.play(), { code: "sessionDisposed" });
    assert.equal(s.timer, null);
    assert.ok(s.rows.size > 0);
    assert.ok(f.memory.snapshot().bytes > 1234);
    f.context.state = "closed";
    await s.dispose();
    assert.equal(s.status, "closed");
    assert.equal(s.rows.size, 0);
    assert.equal(f.memory.snapshot().bytes, 1234);
  } finally {
    await f.cleanup();
  }
});
