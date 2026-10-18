import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { Transport } from "../src/audio/transport.js";
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import {
  createLiveInstrumentInput,
  activateInstrumentMonitor,
  captureInputChannels,
} from "../src/loop-station/instrument-input.js";
import {
  drumBanks,
  isDrumAssignment,
  drumAttribution,
} from "../src/loop-station/drum-sources.js";
import { recordSource } from "../src/loop-station/record-sources.js";
import { WorkspaceAudioOwner } from "../src/loop-station/workspace-owner.js";
import { emptyLoopProject } from "../src/loop-station/model.js";
import {
  SessionTakes,
  liveAssignment,
} from "../src/loop-station/session-takes.js";
const bank = drumBanks[0];
const parameter = () => ({
  value: 1,
  events: [],
  setValueAtTime(v, t) {
    this.events.push(["set", v, t]);
  },
  linearRampToValueAtTime(v, t) {
    this.events.push(["ramp", v, t]);
  },
  cancelScheduledValues(t) {
    this.events.push(["cancel", t]);
  },
});
class NativeNode {
  constructor(context) {
    this.context = context;
    this.gain = parameter();
    this.offset = parameter();
    this.playbackRate = parameter();
    this.stops = [];
  }
  connect() {}
  disconnect() {}
  start(t) {
    this.when = t;
  }
  stop(t) {
    this.stops.push(t);
  }
  end() {
    this.onended?.();
  }
}
class Context extends EventTarget {
  sampleRate = 48000;
  currentTime = 0;
  state = "running";
  sources = [];
  createGain() {
    return new NativeNode(this);
  }
  createBufferSource() {
    const n = new NativeNode(this);
    this.sources.push(n);
    return n;
  }
  createConstantSource() {
    return this.createBufferSource();
  }
  async decodeAudioData(raw) {
    const d = new DataView(raw),
      length = d.getUint32(40, true) / 2,
      data = new Float32Array(length);
    for (let i = 0; i < length; i++)
      data[i] = d.getInt16(44 + i * 2, true) / 32768;
    return {
      length,
      numberOfChannels: 1,
      sampleRate: 48000,
      duration: length / 48000,
      getChannelData: () => data,
    };
  }
}
async function fixture(t, { monitor = true } = {}) {
  t.mock.method(
    globalThis,
    "fetch",
    async (path) => new Response(await readFile("." + path)),
  );
  const context = new Context(),
    memory = new AudioMemory(),
    transport = new Transport(),
    registry = new InstrumentRegistry(drumBanks);
  const source = await createLiveInstrumentInput({
    context,
    memory,
    transport,
    registry,
    framesPerBar: 120000,
    ...recordSource("drum-ruang"),
  });
  let admits = 0,
    refuse = false;
  if (monitor)
    activateInstrumentMonitor(source, {
      destination: context.createGain(),
      admitVoice: () => {
        if (refuse) throw Object.assign(Error(), { code: "voiceHeadroom" });
        admits++;
      },
    });
  return {
    source,
    context,
    memory,
    transport,
    admits: () => admits,
    refuse: () => {
      refuse = true;
    },
    async close() {
      const p = source.dispose();
      context.sources.forEach((n) => n.end());
      await p;
      assert.equal(memory.snapshot().bytes, 0);
    },
  };
}
test("producer carrier loss preserves its cause and holds shared containment until capture closes", async (t) => {
  const f = await fixture(t, { monitor: false }),
    project = emptyLoopProject(),
    master = f.context.createGain(),
    graph = { gain: f.context.createGain() },
    events = [];
  let closeCapture;
  const captureClosed = new Promise((r) => {
    closeCapture = r;
  });
  const owner = new WorkspaceAudioOwner({
    memory: f.memory,
    getProject: () => project,
  });
  owner.engine = {
    context: f.context,
    transport: f.transport,
    master,
    output: master,
    volume: 1,
  };
  owner.controller = {
    rows: new Map(),
    plan: {},
    project,
    graphs: new Map([["track-1", graph]]),
    liveAdmission: () => ({ maxOwned: 0, maxPeak: 0 }),
    playbackFault(fault) {
      events.push({ type: "controller-fault", fault });
      return owner.controllerFault(fault, () => {
        events.push({ type: "shared-containment" });
      });
    },
  };
  owner.capture = {
    rootIntent(kind, action, cause) {
      events.push({ type: "capture-terminal", kind, cause });
      action();
      return captureClosed;
    },
    stopTrack() {
      events.push({ type: "manual-track-stop" });
      return captureClosed;
    },
    snapshot: () => ({ retained: [] }),
  };
  await owner.installProducer("track-1", f.source, graph, owner.generation);
  f.context.sources[0].end();
  assert.equal(f.source.snapshot().fault.reason, "instrumentInputEnded");
  assert.equal(events[0].type, "controller-fault");
  assert.equal(events[0].fault.code, "instrumentInputLost");
  assert.equal(events[1].cause, "instrumentInputLost");
  assert.equal(
    events.some((e) => e.type === "shared-containment"),
    false,
  );
  closeCapture();
  await owner.controllerBarrier;
  await new Promise((r) => setImmediate(r));
  await owner.closeProducers();
  assert.equal(
    events.some((e) => e.type === "shared-containment"),
    true,
  );
  assert.equal(owner.producers.size, 0);
  assert.equal(f.memory.snapshot().bytes, 0);
});

test("live containment fades active notes at a declared future frame, cancels unstarted notes, and holds pins until native ended", async (t) => {
  const f = await fixture(t);
  f.source.strike("ruang-kick", { when: 0.05, velocity: 0.5 });
  f.source.strike("ruang-snare", { when: 0.8, velocity: 0.5 });
  f.context.currentTime = 0.2;
  const held = f.memory.snapshot().bytes,
    active = f.context.sources[1],
    future = f.context.sources[2];
  const stopping = f.source.silence();
  assert(Math.abs(active.stops[0] - 0.254) < 1e-12);
  assert.equal(future.stops[0], 0.2);
  assert.equal(f.memory.snapshot().bytes, held);
  assert.equal(f.source.snapshot().accepting, false);
  active.end();
  future.end();
  await stopping;
  assert.equal(f.source.snapshot().accepting, true);
  await f.close();
});
test("drum identities are pinned complete same-kit mono sources, with original recipe/rights and exact bytes", async () => {
  const registry = new InstrumentRegistry(drumBanks);
  for (const b of drumBanks) {
    const s = recordSource(b.samples[0].instrumentId),
      a = liveAssignment(
        "track-1",
        registry,
        s.bankId,
        s.bankVersion,
        s.sampleIds,
      );
    assert.equal(a.sampleIds.length, 8);
    assert.ok(
      b.samples.every((d) => d.channels === 1 && d.sampleRate === 48000),
    );
    for (const d of b.samples)
      assert.equal(
        createHash("sha256")
          .update(await readFile("." + d.assetPath))
          .digest("hex"),
        d.sha256,
      );
    assert.match(drumAttribution(a), /original synthetic/);
    assert.match(drumAttribution(a), /sourceRecipeSha256/);
    assert.throws(
      () =>
        liveAssignment(
          "track-1",
          registry,
          b.id,
          b.version,
          s.sampleIds.slice(0, 2),
        ),
      (e) => e.code === "invalidCaptureSource",
    );
    const changed = structuredClone(b.samples);
    changed[0].gainTrim = 0.9;
    assert.throws(
      () => isDrumAssignment(b.id, b.version, s.sampleIds, changed),
      (e) => e.code === "invalidCaptureSource",
    );
  }
});
test("drum release retains natural tails, token owners, native pins and stereo bus identity", async (t) => {
  const f = await fixture(t),
    s = f.source,
    id = bank.samples[0].id;
  assert.equal(captureInputChannels(s, f.context, f.memory, f.transport), 2);
  assert.equal(s.producerVoices, 5);
  s.press("key:A", id, { when: 0.1 });
  s.press("pointer:1", id, { when: 0.1 });
  assert.equal(s.snapshot().voices.length, 1);
  s.release("key:A");
  s.release("pointer:1");
  assert.equal(s.snapshot().tokens.length, 0);
  assert.equal(s.snapshot().voices.length, 1);
  assert.equal(f.context.sources[1].stops.length, 0);
  assert.equal(s.snapshot().cache.activeScopes, 9);
  f.context.sources[1].end();
  assert.equal(s.snapshot().cache.activeScopes, 8);
  await f.close();
});
test("closed hat chokes open hat only, and source pins remain until native end", async (t) => {
  const f = await fixture(t),
    s = f.source;
  s.strike("ruang-open-hat", { when: 0.1 });
  s.strike("ruang-kick", { when: 0.1 });
  s.strike("ruang-closed-hat", { when: 0.2 });
  assert.deepEqual(
    f.context.sources[1].stops.map((t) => Math.round(t * 48000)),
    [9792],
  );
  assert.deepEqual(f.context.sources[2].stops, []);
  assert.equal(s.snapshot().voices.length, 3);
  assert.equal(s.snapshot().cache.activeScopes, 11);
  f.context.sources[1].end();
  assert.equal(s.snapshot().voices.length, 2);
  assert.equal(s.snapshot().cache.activeScopes, 10);
  await f.close();
});
test("four-voice and root-level refusals allocate nothing and do not steal/choke existing tails", async (t) => {
  const f = await fixture(t),
    s = f.source;
  for (const id of ["open-hat", "kick", "snare", "tom"])
    s.strike("ruang-" + id, { when: 0.1 });
  const before = s.snapshot(),
    nodes = f.context.sources.length;
  assert.throws(
    () => s.press("key:F", "ruang-closed-hat", { when: 0.2 }),
    (e) => e.code === "voiceLimit",
  );
  assert.deepEqual(s.snapshot(), before);
  assert.equal(f.context.sources.length, nodes);
  assert.equal(f.context.sources[1].stops.length, 0);
  f.context.sources[2].end();
  f.refuse();
  const next = s.snapshot();
  assert.throws(
    () => s.strike("ruang-closed-hat", { when: 0.2 }),
    (e) => e.code === "voiceHeadroom",
  );
  assert.deepEqual(s.snapshot(), next);
  await f.close();
});

test("choke follows scheduled musical order and never damps an open hat struck after the closed hat", async (t) => {
  const f = await fixture(t),
    s = f.source;
  s.strike("ruang-closed-hat", { when: 0.2 });
  s.strike("ruang-open-hat", { when: 0.1 });
  s.strike("ruang-open-hat", { when: 0.3 });
  assert.deepEqual(
    f.context.sources[2].stops.map((t) => Math.round(t * 48000)),
    [9792],
  );
  assert.deepEqual(f.context.sources[3].stops, []);
  await f.close();
});

test("unsaved full/partial drum WAV uses the retained take source, even when another kit is currently prepared", () => {
  const registry = new InstrumentRegistry(drumBanks);
  for (const bank of drumBanks)
    for (const partial of [false, true]) {
      const memory = new AudioMemory(),
        pcm = [
          new Float32Array([0.1, -0.2, 0.05, 0]),
          new Float32Array([0.1, -0.2, 0.05, 0]),
        ],
        take = {
          id: "take-1",
          channels: 2,
          sampleRate: 48000,
          frames: 4,
          validBytes: 32,
          partial,
        };
      let released = false;
      const owner = {
        memory,
        pool: {
          describe: () => take,
          copyToAudioBuffer: () => ({
            buffer: { getChannelData: (c) => pcm[c] },
            release: () => {
              released = true;
            },
          }),
        },
        engine: { context: {} },
        controller: { registry },
        captureTrack: "track-3",
        capture: {
          retained: new Map([
            [
              take.id,
              {
                record: {
                  trackId: "track-3",
                  source: { descriptors: bank.samples },
                },
              },
            ],
          ]),
        },
        producers: new Map([
          [
            "track-3",
            {
              source: {
                descriptors: drumBanks.find((b) => b !== bank).samples,
              },
            },
          ],
        ]),
      };
      const store = new SessionTakes(owner),
        wav = store.wav(take.id),
        view = new DataView(wav.buffer);
      assert.equal(view.getUint16(20, true), 3);
      assert.equal(view.getUint32(54, true), 32);
      for (let f = 0; f < 4; f++)
        for (let c = 0; c < 2; c++)
          assert.equal(view.getFloat32(58 + (f * 2 + c) * 4, true), pcm[c][f]);
      const text = new TextDecoder().decode(
        new Uint8Array(wav.buffer, 58 + 32 + 20),
      );
      assert.match(text, /original synthetic Studio drums/);
      assert.match(text, /CC0-1.0/);
      assert.ok(text.includes('"bankId":"' + bank.id + '"'));
      assert.ok(text.includes('"trackId":"track-3"'));
      for (const d of bank.samples) assert.ok(text.includes(d.sha256));
      assert.equal(released, true);
      wav.release();
      assert.equal(memory.snapshot().bytes, 0);
    }
});
