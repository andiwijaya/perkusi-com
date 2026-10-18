import { loopCopy } from "../src/loop-station/copy.js";
import test from "node:test";
import assert from "node:assert/strict";
import catalog from "../internal/instrument-focus/registry-48000.json" with { type: "json" };
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import { physicalFocus } from "../src/gamelan/instrument-focus.js";
import { emptyInstrumentTake } from "../src/project/instrument-take.js";
import { PPQ } from "../src/project/instrument-project.js";
import { MasterClock } from "../src/loop-station/master-clock.js";
import {
  eightTrackProject,
  assignSource,
  replaceWorkingSource,
  LoopHistory,
} from "../src/loop-station/model.js";
import { validateLoopProject } from "../src/loop-station/project.js";
import { prepareLoopPlan, loopVoiceAt } from "../src/loop-station/plan.js";
import { LoopStationSession } from "../src/loop-station/session.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { Transport } from "../src/audio/transport.js";
const registry = new InstrumentRegistry(catalog.banks);
function score({
  instrument = "kendhang-ciblon",
  bpm = 96,
  at = 0,
  damp = null,
  bars = 1,
  legacy = false,
} = {}) {
  const p = structuredClone(emptyInstrumentTake(registry)),
    n = physicalFocus(registry, instrument, "pelog")[0];
  p.composition.timing.bpm = bpm;
  p.clock.lengthTicks = bars * 4 * PPQ;
  p.composition.master.volume = 0.35;
  p.banks = [{ id: n.bank.id, version: n.bank.version }];
  p.events = [
    {
      id: "s",
      tick: at,
      action: "strike",
      velocity: 0.2,
      bankId: n.bank.id,
      sampleId: n.descriptor.id,
    },
  ];
  if (damp !== null)
    p.events.push({
      ...p.events[0],
      id: "d",
      tick: damp,
      action: "damp",
      velocity: 0,
    });
  if (legacy) p.composition.patterns[0].steps.kick[0] = 0.2;
  return p;
}
function project(s = score(), tracks = 1) {
  let p = eightTrackProject(JSON.stringify(s), registry);
  for (let i = 0; i < tracks; i++)
    p = assignSource(p, registry, p.tracks[i].id, JSON.stringify(s));
  return p;
}
function cache() {
  let live = 0;
  return {
    get live() {
      return live;
    },
    trim() {},
    async acquire(bank, version, id) {
      const d = registry.sample(bank, version, id);
      live++;
      let held = true;
      return {
        buffer: {
          length: d.frames,
          sampleRate: 48000,
          numberOfChannels: d.channels,
          duration: d.frames / 48000,
        },
        metrics: { peak: 0.01 },
        release() {
          if (held) {
            held = false;
            live--;
          }
        },
      };
    },
  };
}
const param = () => ({
  value: 0,
  setValueAtTime(v) {
    this.value = v;
  },
  cancelScheduledValues() {},
  linearRampToValueAtTime(v) {
    this.value = v;
  },
});
function context() {
  const c = {
    state: "running",
    sampleRate: 48000,
    currentTime: 0,
    sources: [],
    closeCalls: 0,
    addEventListener() {},
    removeEventListener() {},
    createGain() {
      return {
        context: c,
        wallNow: () => c.currentTime * 1000,
        gain: param(),
        connect() {},
        disconnect() {},
      };
    },
    createStereoPanner() {
      return {
        context: c,
        wallNow: () => c.currentTime * 1000,
        pan: param(),
        connect() {},
        disconnect() {},
      };
    },
    createBufferSource() {
      const s = {
        context: c,
        wallNow: () => c.currentTime * 1000,
        playbackRate: param(),
        connect() {},
        disconnect() {},
        start(when, offset) {
          this.when = when;
          this.offset = offset;
          this.end = when + this.buffer.duration - offset;
        },
        stop(when) {
          this.end = Math.min(this.end, when);
          queueMicrotask(() => this.onended?.());
        },
      };
      c.sources.push(s);
      return s;
    },
    advance(time) {
      this.currentTime = time;
      for (const s of this.sources) if (s.end <= time) s.onended?.();
    },
  };
  return c;
}

test("absolute event grid has no accumulated rounded-cycle drift; fixed-bar windows share one admitted quantum", () => {
  for (const rate of [44100, 48000])
    for (const bpm of [60, 96, 127.3, 173, 180]) {
      const clock = new MasterClock({ timing: { bpm } }, rate);
      for (const tick of [0, PPQ / 4, 4 * PPQ, 999999 * 4 * PPQ]) {
        const exact = BigInt(Math.round(bpm * 10)),
          num = BigInt(tick) * 60n * BigInt(rate) * 10n,
          den = exact * BigInt(PPQ);
        assert.equal(clock.frame(tick), Number((num + den / 2n) / den));
      }
      const fixed = new MasterClock(
        { timing: { bpm }, clock: clock.freezeBar() },
        rate,
      );
      for (const n of [1, 2, 4, 8, 10000])
        assert.equal(fixed.frame(n * 4 * PPQ), n * fixed.policy.framesPerBar);
      assert.throws(
        () =>
          new MasterClock(
            { timing: { bpm }, clock: clock.freezeBar() },
            rate === 48000 ? 44100 : 48000,
          ),
        { code: "takeRateMismatch" },
      );
    }
});

test("working edits preserve exact imported origin and do not consume slots; rejected history is atomic", () => {
  let p = project(),
    text = p.origins[0].text;
  const id = p.sources[0].id,
    h = new LoopHistory(p, registry);
  for (let i = 0; i < 36; i++)
    h.commit((p) => {
      const s = JSON.parse(p.sources[0].text);
      s.events[0].velocity = 0.1 + i / 100;
      return replaceWorkingSource(p, registry, id, JSON.stringify(s));
    });
  assert.equal(h.project.origins[0].text, text);
  assert.equal(h.project.origins.length, 1);
  assert.equal(h.project.sources.length, 1);
  assert.equal(h.undoStack.length, 32);
  const before = JSON.stringify(h.project);
  assert.throws(() =>
    h.commit((p) => ({ ...p, timing: { ...p.timing, bpm: 181 } })),
  );
  assert.equal(JSON.stringify(h.project), before);
  h.undo();
  h.redo();
  assert.equal(JSON.stringify(h.project), before);
  assert.deepEqual(
    validateLoopProject(JSON.parse(before), registry),
    h.project,
  );
});

test("event-only absolute-cycle tail/damp preserves full source lengths", async () => {
  const memory = new AudioMemory(),
    c = cache(),
    s = score({
      instrument: "saron-barung",
      bpm: 173,
      at: (15 * PPQ) / 4,
      damp: PPQ / 4,
      legacy: false,
    });
  let busReleased = 0;
  const plan = await prepareLoopPlan(project(s), {
    registry,
    rate: 48000,
    cache: c,
    memory,
    prepareLegacy: async () => ({
      buffer: { length: 400000, duration: 400000 / 48000 },
      frames: 400000,
      peak: 0.01,
      release() {
        busReleased++;
      },
    }),
  });
  const clip = plan.tracks[0].clips[0],
    v = clip.voices[0],
    spec = loopVoiceAt(plan.clock, clip, v, 100000);
  assert.equal(
    spec.startFrame,
    Math.round(((100000 * 4 + 3.75) * 60 * 48000) / 173),
  );
  assert.equal(
    spec.dampFrame,
    Math.round(((100001 * 4 + 0.25) * 60 * 48000) / 173),
  );
  assert.equal(spec.naturalEndFrame - spec.startFrame, v.frames);

  plan.release();
  plan.release();
  assert.equal(c.live, 0);
  assert.equal(busReleased, 0);
  assert.equal(memory.snapshot().bytes, 0);
});

test("eight tracks share buffers; per-track Stop never resets Transport or stops foreign rows, resume is quantized", async () => {
  const c = context(),
    transport = new Transport();
  transport.start(0.1);
  const origin = transport.origin,
    cacheProvider = cache(),
    memory = new AudioMemory(),
    session = new LoopStationSession({
      context: c,
      wallNow: () => c.currentTime * 1000,
      transport,
      memory,
      registry,
      cache: cacheProvider,
      output: c.createGain(),
    });
  await session.load(project(score(), 8));
  assert.equal(cacheProvider.live, 1);
  session.play();
  assert.equal(session.rows.size, 8);
  assert.equal(session.graphs.get("track-1").gain.channelCountMode, "explicit");
  assert.equal(session.graphs.get("track-1").gain.channelCount, 2);
  const foreign = [...session.rows].filter((r) => r.track !== "track-1");
  session.stopTrack("track-1");
  await Promise.resolve();
  assert.equal(session.rows.size, 7);
  assert.ok(foreign.every((r) => session.rows.has(r)));
  assert.equal(transport.origin, origin);
  assert.equal(transport.running, true);
  session.playTrack("track-1");
  const cur = session.cursors.find((c) => c.track === "track-1");
  assert.ok(cur.cycle <= 1);
  assert.equal(cur.notBefore, 120000);
  session.pause();
  await Promise.resolve();
  assert.equal(transport.running, true);
  await session.dispose();
  assert.equal(c.closeCalls, 0);
  assert.equal(memory.snapshot().bytes, 0);
  assert.equal(cacheProvider.live, 0);
});

test("paused tails reconstruct offsets, late callback stops without catch-up, disposed pending load cannot revive", async () => {
  const c = context(),
    memory = new AudioMemory(),
    provider = cache(),
    session = new LoopStationSession({
      context: c,
      wallNow: () => c.currentTime * 1000,
      transport: new Transport(),
      memory,
      registry,
      cache: provider,
      output: c.createGain(),
      ownsTransport: true,
    });
  await session.load(project(score({ instrument: "saron-barung", damp: PPQ })));
  session.play();
  c.advance(0.25);
  session.pause();
  await Promise.resolve();
  session.play({ resume: true });
  assert.ok(c.sources.some((s) => s.offset > 0));
  c.advance(10);
  session.pump();
  assert.equal(session.error, "replayLate");
  assert.equal(session.status, "error");
  await Promise.resolve();
  await session.dispose();
  assert.equal(memory.snapshot().bytes, 0);
  let resolve,
    enter,
    released = 0;
  const gate = new Promise((r) => (resolve = r)),
    entered = new Promise((r) => (enter = r)),
    pending = new LoopStationSession({
      context: c,
      wallNow: () => c.currentTime * 1000,
      transport: new Transport(),
      memory,
      registry,
      cache: provider,
      output: c.createGain(),
      prepare: async () => {
        enter();
        await gate;
        return {
          release() {
            released++;
          },
        };
      },
    });
  const loading = pending.load(project());
  await entered;
  pending.stop();
  resolve();
  await assert.rejects(loading, { code: "cancelled" });
  assert.equal(pending.status, "stopped");
  assert.equal(released, 1);
  await pending.dispose();
});

test("failed preparation releases only new resources and malformed/missing recording never activates partial audio", async () => {
  const c = cache(),
    memory = new AudioMemory();
  let p = structuredClone(project());
  p.assetRefs = [
    {
      id: "rec",
      kind: "recording",
      sha256: "a".repeat(64),
      bytes: 480000,
      frames: 120000,
      channels: 1,
      sampleRate: 48000,
      encoding: "float32le",
      recordedBpm: 96,
    },
  ];
  p.tracks[1].kind = "recording";
  p.tracks[1].clips = [
    {
      id: "rec-clip",
      sourceId: "rec",
      startTick: 0,
      lengthTicks: 4 * PPQ,
      offsetFrames: 0,
      loop: true,
    },
  ];
  await assert.rejects(
    prepareLoopPlan(p, { registry, rate: 48000, cache: c, memory }),
    { code: "missingRecording" },
  );
  assert.equal(c.live, 0);
  assert.equal(memory.snapshot().bytes, 0);
  p.clock = { kind: "fixed-bar", sampleRate: 48000, framesPerBar: 120000 };
  assert.throws(() =>
    validateLoopProject(
      { ...p, clock: { ...p.clock, framesPerBar: 120001 } },
      registry,
    ),
  );
  let reads = 0;
  const hostile = {
    get format() {
      reads++;
      return "perkusi-project";
    },
  };
  assert.throws(() => validateLoopProject(hostile, registry));
  assert.equal(reads, 0);
});

test("live gain/solo refusal preserves previous mix and no partial gain automation", async () => {
  const c = context(),
    memory = new AudioMemory(),
    provider = cache(),
    session = new LoopStationSession({
      context: c,
      wallNow: () => c.currentTime * 1000,
      transport: new Transport(),
      memory,
      registry,
      cache: provider,
      output: c.createGain(),
      ownsTransport: true,
    });
  await session.load(project());
  session.play();
  const before = JSON.stringify(session.project),
    invalid = structuredClone(session.project);
  invalid.tracks[0].gain = 2;
  assert.throws(() => session.setMix(invalid));
  assert.equal(JSON.stringify(session.project), before);
  const muted = structuredClone(session.project);
  muted.tracks[0].mute = true;
  session.setMix(muted);
  assert.equal(session.graphs.get("track-1").gain.gain.value, 0);
  assert.equal(session.status, "playing");
  session.stop();
  await Promise.resolve();
  await session.dispose();
  assert.equal(memory.snapshot().bytes, 0);
});

test("overlapping long-tail eight-track admission refuses atomically and releases all shared source leases", async () => {
  const provider = cache(),
    memory = new AudioMemory(),
    p = project(score({ instrument: "gong-ageng" }), 8),
    text = JSON.stringify(p);
  await assert.rejects(
    prepareLoopPlan(p, { registry, rate: 48000, cache: provider, memory }),
    { code: "voiceLimit" },
  );
  assert.equal(provider.live, 0);
  assert.equal(memory.snapshot().bytes, 0);
  assert.equal(JSON.stringify(p), text);
});

test("Resume keeps explicitly stopped tracks stopped and disposal waits for stale preparation release", async () => {
  const c = context(),
    memory = new AudioMemory(),
    provider = cache(),
    session = new LoopStationSession({
      context: c,
      wallNow: () => c.currentTime * 1000,
      transport: new Transport(),
      memory,
      registry,
      cache: provider,
      output: c.createGain(),
      ownsTransport: true,
    });
  await session.load(project(score(), 2));
  session.play();
  session.stopTrack("track-1");
  await Promise.resolve();
  c.advance(0.3);
  session.pause();
  await Promise.resolve();
  session.play({ resume: true });
  assert.equal(session.stoppedTracks.has("track-1"), true);
  assert.ok([...session.rows].every((r) => r.track !== "track-1"));
  session.stop();
  await Promise.resolve();
  await session.dispose();
  let resolve,
    released = false,
    finished = false;
  const gate = new Promise((r) => (resolve = r)),
    late = new LoopStationSession({
      context: c,
      wallNow: () => c.currentTime * 1000,
      transport: new Transport(),
      memory,
      registry,
      cache: provider,
      output: c.createGain(),
      prepare: async () => {
        await gate;
        return {
          release() {
            released = true;
          },
        };
      },
    });
  const loading = late.load(project());
  const rejected = assert.rejects(loading, { code: "cancelled" });
  await Promise.resolve();
  const closing = late.dispose().then(() => (finished = true));
  await Promise.resolve();
  assert.equal(finished, false);
  resolve();
  await rejected;
  await closing;
  assert.equal(released, true);
  assert.equal(memory.snapshot().bytes, 0);
});

test("old schema5 clip IDs cannot collide with auto-filled track slots; first imported score supplies an empty project tempo", () => {
  const p = structuredClone(project());
  p.tracks = [p.tracks[0]];
  p.tracks[0].id = "custom";
  p.tracks[0].clips[0].id = "track-1";
  const opened = eightTrackProject(JSON.stringify(p), registry);
  assert.equal(opened.tracks.length, 8);
  assert.equal(opened.tracks[1].id, "track-2");
  let empty = structuredClone(opened);
  empty.tracks.forEach((t) => (t.clips = []));
  empty = assignSource(
    empty,
    registry,
    empty.tracks[0].id,
    JSON.stringify(score({ bpm: 173 })),
  );
  assert.equal(empty.timing.bpm, 173);
  assert.equal(empty.origins[0].text, p.origins[0].text);
});

test("borrowed running Transport refuses a different tempo and joins its current bar without rewinding foreign time", async () => {
  const c = context(),
    memory = new AudioMemory(),
    provider = cache(),
    transport = new Transport({ bpm: 96 });
  transport.start(0);
  c.currentTime = 1;
  const s = new LoopStationSession({
    context: c,
    wallNow: () => c.currentTime * 1000,
    transport,
    memory,
    registry,
    cache: provider,
    output: c.createGain(),
  });
  await s.load(project());
  s.play();
  assert.equal(s.offset, 120000);
  assert.equal(transport.origin, 0);
  assert.equal(transport.running, true);
  assert.equal(s.rows.size, 0);
  s.pause();
  await s.dispose();
  const other = new LoopStationSession({
    context: c,
    wallNow: () => c.currentTime * 1000,
    transport,
    memory,
    registry,
    cache: provider,
    output: c.createGain(),
  });
  await other.load(project(score({ bpm: 173 })));
  assert.throws(() => other.play(), { code: "loopTempoLocked" });
  assert.equal(transport.beatSeconds, 60 / 96);
  assert.equal(other.rows.size, 0);
  await other.dispose();
  assert.equal(memory.snapshot().bytes, 0);
});

test("legacy one-shot remains complete and Repeat selects the separate tail-preserving preparation", async () => {
  const provider = cache(),
    memory = new AudioMemory(),
    original = score({ legacy: true }),
    p = project(original);
  assert.equal(p.tracks[0].clips[0].loop, false);
  let releases = 0;
  const plan = await prepareLoopPlan(p, {
    registry,
    rate: 48000,
    cache: provider,
    memory,
    prepareLegacy: async () => ({
      buffer: { length: 400000, duration: 400000 / 48000 },
      frames: 400000,
      peak: 0.01,
      release() {
        releases++;
      },
    }),
  });
  assert.equal(
    plan.tracks[0].clips[0].voices.find((v) => v.key.startsWith("legacy/"))
      .frames,
    400000,
  );
  plan.release();
  assert.equal(releases, 1);
  const cyclic = structuredClone(p);
  cyclic.tracks[0].clips[0].loop = true;
  const before = JSON.stringify(cyclic);
  const repeated = await prepareLoopPlan(cyclic, {
    registry,
    rate: 48000,
    cache: provider,
    memory,
    prepareLegacy: async () =>
      assert.fail("Repeat must not use finite faded export"),
    prepareContinuous: async (source, options) => {
      assert.equal(options.periodFrames, 120000);
      assert.equal(source.composition.timing.bpm, 96);
      return {
        buffer: { length: 140000 },
        frames: 140000,
        peak: 0.01,
        periodFrames: 120000,
        cycle: () => ({ buffer: { length: 140000 }, frames: 140000 }),
        release() {
          releases++;
        },
      };
    },
  });
  assert.equal(
    repeated.tracks[0].clips[0].voices.find((v) => v.cycles).cycles
      .periodFrames,
    120000,
  );
  repeated.release();
  assert.equal(releases, 2);
  assert.equal(provider.live, 0);
  assert.equal(memory.snapshot().bytes, 0);
  assert.equal(JSON.stringify(cyclic), before);
});

test("legacy zero-tick bus starts before a later event; the cursor never misses it or stops late", async () => {
  const c = context(),
    memory = new AudioMemory(),
    provider = cache(),
    original = score({ legacy: true, bars: 2, at: 4 * PPQ }),
    p = project(original),
    bus = { length: 240000, duration: 5 },
    session = new LoopStationSession({
      context: c,
      wallNow: () => c.currentTime * 1000,
      transport: new Transport(),
      memory,
      registry,
      cache: provider,
      output: c.createGain(),
      ownsTransport: true,
      prepare: (value, options) =>
        prepareLoopPlan(value, {
          ...options,
          prepareLegacy: async () => ({
            buffer: bus,
            frames: bus.length,
            peak: 0.01,
            release() {},
          }),
        }),
    });
  await session.load(p);
  assert.deepEqual(
    session.plan.tracks[0].clips[0].voices.map((v) => v.tick),
    [0, 4 * PPQ],
  );
  session.play();
  assert.equal(c.sources.length, 1);
  assert.equal(c.sources[0].buffer, bus);
  for (let time = 0.1; time < 4; time += 0.1) {
    c.advance(time);
    session.pump();
    assert.equal(session.error, null);
  }
  assert.equal(c.sources.length, 2);
  session.stop();
  await Promise.resolve();
  await session.dispose();
  assert.equal(provider.live, 0);
  assert.equal(memory.snapshot().bytes, 0);
});

test("a completed finite track reports Finished while another track keeps repeating", async () => {
  const c = context(),
    memory = new AudioMemory(),
    provider = cache(),
    p = structuredClone(project(score(), 2));
  p.tracks[0].clips[0].loop = false;
  const s = new LoopStationSession({
    context: c,
    wallNow: () => c.currentTime * 1000,
    transport: new Transport(),
    memory,
    registry,
    cache: provider,
    output: c.createGain(),
    ownsTransport: true,
  });
  await s.load(p);
  s.play();
  c.advance(1.2);
  assert.equal(s.snapshot().tracks[0].status, "finished");
  assert.equal(s.snapshot().tracks[1].status, "playing");
  assert.equal(s.snapshot().tracks[2].status, "stopped");
  await s.dispose();
  assert.equal(memory.snapshot().bytes, 0);
});

test("Loop Station ID/EN leaf keys and human-facing messages remain complete", () => {
  const leaves = (o, path = "") =>
    Object.entries(o).flatMap(([k, v]) =>
      typeof v === "string" ? [[path + k, v]] : leaves(v, path + k + "."),
    );
  const id = leaves(loopCopy.id),
    en = leaves(loopCopy.en);
  assert.deepEqual(id.map(([k]) => k).sort(), en.map(([k]) => k).sort());
  assert.ok([...id, ...en].every(([, v]) => v.trim().length));
});
