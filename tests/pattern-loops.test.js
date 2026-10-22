import test from "node:test";
import assert from "node:assert/strict";
import {
  newComposition,
  withPatternLoops,
  patternClips,
  editCompositionClip,
  compositionDemo,
  mixedStudioView,
} from "../src/project/composition-model.js";
import { compositionRegistry } from "../src/project/studio-registry.js";
import {
  parseProject,
  serializeProject,
  validateProject,
} from "../src/project/schema.js";
import { CompositionStore } from "../src/project/composition-store.js";
import { ProjectHistory } from "../src/project/studio-model.js";
import {
  CompositionPlayback,
  CompositionBanks,
  createCompositionMixer,
  compositionExportExtras,
} from "../src/audio/composition.js";
import { createTrackMixer } from "../src/audio/sequencing.js";
import { Transport } from "../src/audio/transport.js";
import { disconnectVoice } from "../src/audio/voice.js";
import { studioExportBudget } from "../src/audio/studio-exporter.js";

function project() {
  const p = withPatternLoops(newComposition());
  p.timing.bpm = 96;
  p.patterns.push({ ...structuredClone(p.patterns[0]), id: "p2", name: "B" });
  p.chain = ["p1", "p2"];
  p.patterns[0].clips = [
    {
      role: "kick",
      variant: 1,
      enabled: true,
      volume: 0.5,
      pan: 0,
      mute: false,
      solo: false,
    },
    {
      role: "hum",
      variant: 1,
      enabled: true,
      volume: 0.4,
      pan: -0.5,
      mute: false,
      solo: false,
    },
  ];
  p.patterns[1].clips = [
    {
      role: "kick",
      variant: 1,
      enabled: true,
      volume: 0.35,
      pan: 0.5,
      mute: false,
      solo: false,
    },
    {
      role: "snare",
      variant: 2,
      enabled: true,
      volume: 0.4,
      pan: 0,
      mute: false,
      solo: false,
    },
  ];
  return p;
}
test("legacy clips migrate to independent pattern copies without modifying old original bytes", () => {
  const old = compositionDemo("fusion"),
    raw = JSON.stringify(old),
    p = withPatternLoops(old);
  assert.equal(p.loopScope, "pattern-v1");
  assert(!Object.hasOwn(p, "clips"));
  for (const a of p.patterns) assert.deepEqual(a.clips, old.clips);
  p.patterns[1].clips[0].volume = 0.17;
  assert.notEqual(p.patterns[0].clips[0].volume, 0.17);
  assert.equal(JSON.stringify(old), raw);
  assert.deepEqual(
    parseProject(
      serializeProject(old, compositionRegistry),
      compositionRegistry,
    ),
    old,
  );
});
test("all six loop controls edit only selected pattern; new JSON/storage retains every pattern", () => {
  const p = project(),
    a = structuredClone(p.patterns[0]);
  p.activePattern = "p2";
  for (const [field, value] of [
    ["enabled", true],
    ["variant", 2],
    ["volume", 0.25],
    ["pan", -0.5],
    ["mute", true],
    ["solo", true],
  ])
    editCompositionClip(p, "percussion-fx", field, value);
  assert.deepEqual(p.patterns[0], a);
  assert.deepEqual(
    patternClips(p).find((c) => c.role === "percussion-fx"),
    {
      role: "percussion-fx",
      variant: 2,
      enabled: true,
      volume: 0.25,
      pan: -0.5,
      mute: true,
      solo: true,
    },
  );
  const parsed = parseProject(
    serializeProject(p, compositionRegistry),
    compositionRegistry,
  );
  assert.deepEqual(parsed, p);
  const data = new Map(),
    storage = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => data.set(k, v),
    };
  const s = new CompositionStore(
    compositionRegistry,
    () => storage,
    () => "pattern-loops",
  );
  const id = s.save(p);
  assert.deepEqual(s.load(id), p);
  s.saveDraft(p);
  assert.deepEqual(s.readDraft(), p);
});
test("scope/shape/variant/tempo reject invalid new data without accepting ambiguous global defaults", () => {
  for (const change of [
    (p) => (p.loopScope = "pattern-v2"),
    (p) => (p.clips = []),
    (p) => (p.patterns[1].clips[0].variant = 3),
    (p) => p.patterns[0].clips.push({ ...p.patterns[0].clips[0] }),
    (p) => (p.timing.bpm = 120),
    (p) => (p.patterns[1].clips[0].url = "https://invalid.invalid"),
  ]) {
    const p = project();
    change(p);
    assert.throws(() => validateProject(p, compositionRegistry));
  }
});
class Param {
  value = 0;
  calls = [];
  setValueAtTime(v, t) {
    this.value = v;
    this.calls.push(["set", v, t]);
  }
  linearRampToValueAtTime(v, t) {
    this.calls.push(["ramp", v, t]);
  }
  setTargetAtTime(v, t) {
    this.calls.push(["target", v, t]);
  }
  cancelScheduledValues(t) {
    this.calls.push(["cancel", t]);
  }
  cancelAndHoldAtTime(t) {
    this.calls.push(["hold", t]);
  }
}
class Node {
  gain = new Param();
  pan = new Param();
  playbackRate = new Param();
  connect() {}
  disconnect() {
    this.disconnected = true;
  }
  start(when, offset = 0) {
    this.startArgs = [when, offset];
  }
  stop() {
    this.stopped = true;
  }
}
class Context {
  currentTime = 0;
  sources = [];
  constructor(rate) {
    this.sampleRate = rate;
  }
  createGain() {
    return new Node();
  }
  createStereoPanner() {
    return new Node();
  }
  createChannelMerger() {
    return new Node();
  }
  createBufferSource() {
    const n = new Node();
    this.sources.push(n);
    return n;
  }
}
function setup(rate = 48000) {
  const p = project(),
    context = new Context(rate),
    transport = new Transport({ bpm: 96 });
  transport.start(0.05);
  const engine = {
    transport,
    arrangement: true,
    voices: new Set(),
    stats: { created: 0 },
    record() {},
    removeVoice(v) {
      this.voices.delete(v);
      disconnectVoice(v);
    },
    mixer: createTrackMixer(context, new Node(), p.tracks),
  };
  const banks = {
    loop: (c) => ({
      stem: { id: c.role, gainTrim: 0.85 },
      buffer: { duration: 5, id: c.role + "-" + c.variant },
    }),
    instrument: {
      get: () => ({
        stem: { id: "d4", gainTrim: 0.6 },
        buffer: { duration: 0.4 },
      }),
    },
  };
  const playback = Object.assign(Object.create(CompositionPlayback.prototype), {
    project: p,
    engine,
    context,
    banks,
    mixer: createCompositionMixer(context, new Node(), p),
  });
  return { p, context, engine, playback, banks };
}
for (const rate of [44100, 48000])
  test(`${rate}: repeated A/B boundaries retain shared source, absolute two-bar phase and per-pattern mixer`, () => {
    const { playback: b, context: c } = setup(rate);
    b.start(0.05);
    const kick = c.sources.find((s) => s.buffer.id === "kick-1");
    assert.deepEqual(kick.startArgs, [0.05, 0]);
    for (let bar = 1; bar <= 8; bar++) {
      c.currentTime = bar * 2.5 - 0.05;
      b.step(bar * 16, 0.05 + bar * 2.5);
      b.step(bar * 16, 0.05 + bar * 2.5);
    }
    assert.equal(c.sources.filter((s) => s.buffer.id === "kick-1").length, 1);
    assert.equal(c.sources.filter((s) => s.buffer.id === "snare-2").length, 4);
    for (const n of c.sources.filter((s) => s.buffer.id === "snare-2"))
      assert.equal(Math.round(n.startArgs[1] * rate), Math.round(2.5 * rate));
    assert(
      b.mixer.nodes
        .get("clip-kick")
        .gain.gain.calls.some(
          (x) =>
            x[0] === "target" && x[1] === 0.35 && Math.abs(x[2] - 2.55) < 1e-9,
        ),
    );
    assert.equal(kick.loop, true);
  });
test("pending boundary cancellation removes future source and restores current fade before rescheduling", () => {
  const { playback: b, context: c, engine: e } = setup();
  b.start(0.05);
  c.currentTime = 2.4;
  b.step(16, 2.55);
  const future = c.sources.find((s) => s.buffer.id === "snare-2");
  b.cancelScheduled(2.4);
  assert(future.disconnected);
  assert(![...e.voices].some((v) => v.source === future));
  assert.equal(b.loopState.get("hum").voice.endTime, null);
  b.step(16, 2.55);
  assert.equal([...e.voices].filter((v) => v.id === "clip-snare").length, 1);
});
test("pattern-only resume uses selected pattern but preserves absolute phase; stop/restart begins phase zero", () => {
  const { playback: b, context: c, engine: e, p } = setup();
  e.arrangement = false;
  p.activePattern = "p2";
  e.transport.position = 4;
  e.transport.start(0.05);
  b.start(0.05);
  assert(
    c.sources.some((s) => s.buffer.id === "snare-2" && s.startArgs[1] === 2.5),
  );
  assert(!c.sources.some((s) => s.buffer.id === "hum-1"));
  for (const v of [...e.voices]) e.removeVoice(v);
  e.transport.reset();
  e.transport.start(1);
  b.start(1);
  assert.equal(c.sources.at(-1).startArgs[1], 0);
});
test("asset admission loads both enabled variants even when a later pattern disables the same identity", async () => {
  const p = project();
  p.patterns[1].clips.push({ ...p.patterns[0].clips[1], enabled: false });
  p.patterns[1].clips[0].variant = 2;
  const loaded = [];
  const bank = (v) => ({
    load: async (id) => loaded.push(v + "/" + id),
    get: () => ({ buffer: {} }),
  });
  const b = Object.assign(Object.create(CompositionBanks.prototype), {
    loops: [bank(1), bank(2)],
  });
  await b.load(p, {}, null);
  assert(loaded.includes("1/hum"));
  assert(loaded.includes("1/kick"));
  assert(loaded.includes("2/kick"));
});
test("offline chain uses same continuous source/phase policy and schedules drum solo mix for each sounding bar", () => {
  const { p, context, banks } = setup();
  p.activePattern = "p2";
  p.patterns[0].clips[0].solo = true;
  const voices = [],
    mixes = [];
  const extras = { banks };
  compositionExportExtras({}).schedule(context, new Node(), p, extras, voices, {
    update: (tracks, when) => mixes.push({ tracks, when }),
  });
  assert.equal(
    context.sources.filter((s) => s.buffer.id === "kick-1").length,
    1,
  );
  assert.equal(
    context.sources.find((s) => s.buffer.id === "snare-2").startArgs[1],
    2.5,
  );
  assert(mixes[0].tracks.every((t) => t.mute));
  assert(mixes[1].tracks.some((t) => !t.mute));
  assert.equal(mixes[1].when, 2.5);
  extras.mixer.dispose();
});
test("export audibility follows chain pattern, not the editor selection", () => {
  const p = project();
  p.chain = ["p2"];
  p.activePattern = "p1";
  p.patterns[0].clips[0].solo = true;
  p.patterns[1].clips = [];
  p.patterns[1].steps.kick[0] = 1;
  assert(mixedStudioView(p).tracks.every((t) => t.mute));
  const ext = compositionExportExtras({});
  assert.doesNotThrow(() =>
    studioExportBudget(p, compositionRegistry, 0, ext.budget(p)),
  );
});

test("same-role variant replacement crossfades at boundary without resetting phrase phase", () => {
  const { p, playback: b, context: c } = setup();
  p.patterns[1].clips[0].variant = 2;
  b.start(0.05);
  const first = b.loopState.get("kick").voice;
  c.currentTime = 2.4;
  b.step(16, 2.55);
  const replacement = b.loopState.get("kick").voice;
  assert.equal(replacement.source.buffer.id, "kick-2");
  assert(Math.abs(first.endTime - 2.554) < 1e-9);
  assert.equal(replacement.phase, 2.5);
  assert.equal(c.sources.filter((s) => s.buffer.id === "kick-2").length, 1);
  b.cancelScheduled(2.4);
  assert.equal(first.endTime, null);
  assert.equal(b.loopState.get("kick").voice, first);
  assert(replacement.source.disconnected);
});

test("pattern loop snapshots survive clear undo/redo without sharing another pattern", () => {
  const p = project(),
    before = structuredClone(p);
  const h = new ProjectHistory(p, (v) =>
    validateProject(v, compositionRegistry),
  );
  h.edit((v) => {
    v.patterns[0].clips = [];
  });
  assert.deepEqual(h.current.patterns[1], before.patterns[1]);
  assert(h.undo());
  assert.deepEqual(h.current, before);
  assert(h.redo());
  assert.deepEqual(h.current.patterns[0].clips, []);
  assert.deepEqual(h.current.patterns[1], before.patterns[1]);
});

test("boundary admission retains the64-voice guard and refuses before allocating any join", () => {
  const { playback: b, context: c, engine: e } = setup();
  for (let i = 0; i < 63; i++) e.voices.add({ id: "pressure-" + i });
  let paused = false;
  e.pause = () => {
    paused = true;
  };
  b.start(0.05);
  assert(paused);
  assert.equal(c.sources.length, 0);
  assert.equal(e.error, "audio-start: pattern-loop-voice-limit");
});
