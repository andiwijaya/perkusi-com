import test from "node:test";
import assert from "node:assert/strict";
import { InstrumentRegistry } from "../src/audio/instrument-registry.js";
import { instrumentVoice } from "../src/audio/instrument-voice.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { Transport } from "../src/audio/transport.js";
import { emptyLoopProject } from "../src/loop-station/model.js";
import { loopAdmission, prepareLoopPlan } from "../src/loop-station/plan.js";
import { adoptOverdub, overdubBase } from "../src/loop-station/overdub.js";
import { recordedLoopGeometry } from "../src/loop-station/recorded-loop.js";
import { LoopStationSession } from "../src/loop-station/session.js";
import { WorkspaceAudioOwner } from "../src/loop-station/workspace-owner.js";
import { finalMixProgram } from "../src/loop-station/final-program.js";
import { PPQ } from "../src/project/instrument-project.js";
const code = (value) => (e) => e.code === value;
const param = () => ({
  value: 1,
  calls: [],
  setValueAtTime(v, t) {
    this.calls.push(["set", v, t]);
    this.value = v;
  },
  linearRampToValueAtTime(v, t) {
    this.calls.push(["ramp", v, t]);
    this.value = v;
  },
  cancelScheduledValues(t) {
    this.calls.push(["cancel", t]);
  },
});
class FakeNode {
  constructor(context) {
    this.context = context;
    this.gain = param();
    this.pan = param();
    this.playbackRate = param();
    this.connections = new Set();
    this.stopCalls = [];
    this.disconnections = 0;
  }
  connect(n) {
    this.connections.add(n);
  }
  disconnect() {
    this.connections.clear();
    this.disconnections++;
  }
  start(when, offset = 0) {
    this.when = when;
    this.offset = offset;
    this.initialBuffer = this.buffer;
    this.nativeEnd = this.loop
      ? Infinity
      : when + this.buffer.duration - offset;
    if (this.context.failStart) throw Error("injected source.start failure");
  }
  stop(time = this.context.currentTime) {
    this.stopCalls.push(time);
    this.nativeEnd = Math.min(this.nativeEnd ?? Infinity, time);
  }
  end() {
    this.ended = true;
    this.onended?.();
  }
}
class FakeContext extends EventTarget {
  state = "running";
  currentTime = 0;
  sources = [];
  constructor(rate) {
    super();
    this.sampleRate = rate;
  }
  createGain() {
    return new FakeNode(this);
  }
  createStereoPanner() {
    return new FakeNode(this);
  }
  createBufferSource() {
    const n = new FakeNode(this);
    this.sources.push(n);
    return n;
  }
  advance(time) {
    this.currentTime = time;
    for (const s of this.sources)
      if (!s.ended && !this.holdEnded && s.nativeEnd <= time) s.end();
  }
  confirmClosed() {
    this.state = "closed";
    this.dispatchEvent(new Event("statechange"));
  }
}
async function fixture(
  t,
  {
    count = 1,
    bars = 1,
    rate = 48000,
    bpm = 96,
    loop = true,
    root = true,
    gain = 0.1,
    startBars = 0,
    channels = 2,
  } = {},
) {
  const registry = new InstrumentRegistry(),
    p = structuredClone(emptyLoopProject(registry)),
    P = Math.round((240 * rate) / bpm);
  p.clock = { kind: "fixed-bar", sampleRate: rate, framesPerBar: P };
  p.timing.bpm = bpm;
  for (const track of p.tracks) track.gain = gain;
  for (let i = 0; i < count; i++) {
    const id = "recording-" + (i + 1),
      frames = P * bars;
    p.assetRefs.push({
      id,
      kind: "recording",
      sha256: (i + 1).toString(16).padStart(64, "0"),
      bytes: frames * channels * 4,
      frames,
      channels,
      sampleRate: rate,
      encoding: "float32le",
      recordedBpm: bpm,
    });
    Object.assign(p.tracks[i], {
      kind: "recording",
      clips: [
        {
          id: "clip-" + (i + 1),
          sourceId: id,
          startTick: startBars * 4 * PPQ,
          lengthTicks: bars * 4 * PPQ,
          offsetFrames: 0,
          loop,
        },
      ],
    });
  }
  const context = new FakeContext(rate),
    memory = new AudioMemory(),
    foreign = memory.reserve(1234, "foreign-owner"),
    transport = new Transport({ bpm }),
    master = context.createGain(),
    owner = root
      ? new WorkspaceAudioOwner({ memory, getProject: () => p })
      : null;
  let releases = 0,
    acquisitions = 0;
  // Geometry-only fake buffers: no actual PCM/native allocation or decode. The
  // real ledger reserves their declared native byte geometry; source identity
  // is represented by the trusted resolver contract, not an invented audio hash.
  const buffers = new Map(),
    resolveRecording = async (ref) => {
      const lease = memory.reserve(ref.bytes, "model-recording-native-buffer");
      acquisitions++;
      const buffer = {
        length: ref.frames,
        numberOfChannels: ref.channels,
        sampleRate: ref.sampleRate,
        duration: ref.frames / ref.sampleRate,
      };
      buffers.set(ref.id, buffer);
      return {
        buffer,
        sha256: ref.sha256,
        peak: 0.05,
        release: () => {
          releases++;
          lease.release();
        },
      };
    };
  const controller = new LoopStationSession({
    context,
    transport,
    memory,
    registry,
    output: master,
    ownsTransport: true,
    resolveRecording,
    admission: owner,
    wallNow: () => context.currentTime * 1000,
  });
  if (owner)
    owner.attach(
      { context, transport, memory, master, output: master, volume: 1 },
      controller,
    );
  await controller.load(p);
  const f = {
    p,
    context,
    memory,
    foreign,
    transport,
    owner,
    controller,
    buffers,
    P,
    registry,
    resolveRecording,
    releases: () => releases,
    clip: () => controller.plan.tracks[0].clips[0],
  };
  t.after(async () => {
    clearInterval(controller.timer);
    context.confirmClosed();
    await controller.dispose();
    assert.equal(memory.snapshot().bytes, 1234);
    foreign.release();
    assert.equal(memory.snapshot().bytes, 0);
    assert.equal(releases, acquisitions);
  });
  return f;
}
test("qualified continuous period uses its certified single-reader peak, while a real overlapping reader still refuses at unchanged .95", async (t) => {
  const f = await fixture(t, { gain: 1 }),
    s = f.controller;
  assert.equal(s.liveAdmission().maxPeak, 0.05);
  assert(
    loopAdmission(s.plan).maxPeak > 0.05,
    "generic per-cycle path retains conservative overlap envelope",
  );
  f.owner.producers.set("track-8", {
    trackId: "track-8",
    prePeak: 0.45,
    voices: 5,
    futureBytes: 0,
  });
  f.owner.claims.add({
    trackId: "track-8",
    prePeak: 0.45,
    voices: 1,
    futureBytes: 0,
  });
  assert.equal(f.owner.check(s.plan, s.project).peak, 0.95);
  s.play();
  assert.equal(f.context.sources.length, 1);
  const bytes = f.memory.snapshot().bytes,
    nodes = f.context.sources.length,
    row = [...s.rows][0];
  assert.throws(
    () => s.startVoice(row.track, { ...row.spec }, 0.2, 0, row.clip),
    code("voiceHeadroom"),
  );
  assert.equal(f.context.sources.length, nodes);
  assert.equal(f.memory.snapshot().bytes, bytes);
  f.owner.producers.clear();
  f.owner.claims.clear();
});
const modelClaims = (f) => {
  f.owner.producers.set("track-8", {
    trackId: "track-8",
    prePeak: 0.344004631,
    voices: 5,
    futureBytes: 0,
  });
  f.owner.claims.add({
    trackId: "track-8",
    prePeak: 0.344004631,
    voices: 1,
    futureBytes: 0,
  });
};
const startExtra = (f) => {
  const s = f.controller,
    row = [...s.rows][0];
  s.startVoice(
    row.track,
    { ...row.spec },
    f.context.currentTime + 0.1,
    0,
    row.clip,
  );
  return [...s.rows].at(-1);
};

test("only resolver-qualified complete recording periods get one live slot; flags/clones and changed geometry fail closed", async (t) => {
  const f = await fixture(t),
    s = f.controller,
    c = f.clip();
  assert.equal(recordedLoopGeometry(c, s.plan.clock).periodFrames, 120000);
  assert.equal(loopAdmission(s.plan).maxOwned, 2);
  assert.equal(s.liveAdmission().maxOwned, 1);
  assert.equal(s.liveAdmission().maxPeak, .05*f.p.tracks[0].gain);
  const clone = { ...c, loopFrames: 120000, persistent: true };
  const spoof = {
    ...s.plan,
    tracks: s.plan.tracks.map((r, i) => (i ? r : { ...r, clips: [clone] })),
  };
  assert.equal(recordedLoopGeometry(clone, s.plan.clock), null);
  assert.equal(loopAdmission(spoof,spoof.project,{recordedLoops:true}).maxPeak,loopAdmission(s.plan).maxPeak);
  assert.equal(
    loopAdmission(spoof, spoof.project, { recordedLoops: true }).maxOwned,
    2,
  );
  c.lengthTicks *= 2;
  assert.throws(() => s.liveAdmission(), code("loopPeriodMismatch"));
  c.lengthTicks /= 2;
  c.voices[0].loopFrames = 120000;
  assert.throws(() => s.liveAdmission(), code("loopPeriodMismatch"));
  delete c.voices[0].loopFrames;
});
test("seven real prepared-plan paths with modeled buffers plus drum/capture reserve13 within16 without per-cycle source growth", async (t) => {
  const f = await fixture(t, { count: 7 }),
    s = f.controller;
  assert.equal(loopAdmission(s.plan).maxOwned, 14);
  assert.equal(s.liveAdmission().maxOwned, 7);
  modelClaims(f);
  assert.equal(f.owner.check(s.plan, s.project).voices, 13);
  s.play();
  assert.equal(s.rows.size, 7);
  const bytes = f.memory.snapshot().bytes;
  for (const time of [0.1, 1, 2.49, 2.6, 5.1, 40, 300]) {
    f.context.advance(time);
    s.pump();
    assert.equal(s.status, "playing");
    assert.equal(s.rows.size, 7);
    assert.equal(f.context.sources.length, 7);
    assert.equal(f.memory.snapshot().bytes, bytes);
  }
  for (const n of f.context.sources) {
    assert.equal(n.loop, true);
    assert.equal(n.loopStart, 0);
    assert.equal(n.loopEnd, 2.5);
    assert.equal(n.offset, 0);
    assert.equal(n.playbackRate.value, 1);
    assert.equal(
      n.initialBuffer,
      f.buffers.get(
        s.plan.tracks[f.context.sources.indexOf(n)].clips[0].sourceId,
      ),
    );
  }
});
test("eight prepared recordings with modeled overdub producer/capture fit14; renders and extra owners still refuse", async (t) => {
  const f = await fixture(t, { count: 8 }),
    s = f.controller;
  assert.equal(loopAdmission(s.plan).maxOwned, 16);
  modelClaims(f);
  assert.equal(f.owner.check(s.plan, s.project).voices, 14);
  s.play();
  assert.equal(s.rows.size, 8);
  assert.equal(f.owner.check(s.plan, s.project).voices, 14);
  const before = f.memory.snapshot().bytes,
    nodes = f.context.sources.length;
  f.owner.renders.add({ voices: 2 });
  assert.equal(f.owner.check(s.plan, s.project).voices, 16);
  f.owner.renders.add({ voices: 1 });
  assert.throws(() => f.owner.check(s.plan, s.project), code("voiceLimit"));
  assert.equal(f.memory.snapshot().bytes, before);
  assert.equal(f.context.sources.length, nodes);
  f.owner.renders.clear();
});
test("a real metadata overdub adopts a ninth clip on eight tracks and reloads through live preparation without weakening offline admission", async (t) => {
  const f = await fixture(t, { count: 8 }),
    s = f.controller,
    original = structuredClone(f.p),
    target = f.p.tracks[7].id,
    base = overdubBase(f.p, target),
    adopted = adoptOverdub(
      f.p,
      f.registry,
      target,
      {
        partial: false,
        frames: f.P,
        sampleRate: 48000,
        channels: 2,
        validBytes: f.P * 2 * 4,
      },
      "9".padStart(64, "0"),
      base,
    );
  assert.deepEqual(f.p, original);
  assert.equal(adopted.project.tracks.length, 8);
  assert.equal(adopted.project.assetRefs.length, 9);
  assert.equal(adopted.project.tracks.flatMap((r) => r.clips).length, 9);
  assert.deepEqual(
    adopted.project.tracks[7].clips[0],
    original.tracks[7].clips[0],
  );
  assert.deepEqual(adopted.project.assetRefs.slice(0, 8), original.assetRefs);
  const before = f.memory.snapshot().bytes;
  await assert.rejects(
    prepareLoopPlan(adopted.project, {
      registry: f.registry,
      rate: 48000,
      memory: f.memory,
      resolveRecording: f.resolveRecording,
    }),
    code("voiceLimit"),
  );
  assert.equal(f.memory.snapshot().bytes, before);
  assert.equal(f.releases(), 9);
  s.play();
  assert.equal(s.rows.size, 8);
  s.stop();
  f.context.advance(0.1);
  assert.equal(s.rows.size, 0);
  f.owner.getProject = () => adopted.project;
  await s.load(adopted.project);
  assert.equal(f.releases(), 17);
  assert.equal(s.liveAdmission().maxOwned, 9);
  assert.equal(f.owner.check(s.plan, s.project).voices, 9);
  assert.throws(() => loopAdmission(s.plan), code("voiceLimit"));
  assert.throws(() => finalMixProgram(s.plan, 4), code("voiceLimit"));
  s.play();
  assert.equal(s.rows.size, 9);
  assert.equal(f.context.sources.length, 17);
  const bytes = f.memory.snapshot().bytes;
  for (const time of [1, 5, 40]) {
    f.context.advance(time);
    s.pump();
    assert.equal(s.status, "playing");
    assert.equal(s.rows.size, 9);
    assert.equal(f.context.sources.length, 17);
    assert.equal(f.memory.snapshot().bytes, bytes);
  }
  assert.equal(
    [...s.rows].find((r) => r.clip.sourceId === adopted.ref.id).voice.source
      .buffer,
    f.buffers.get(adopted.ref.id),
  );
});
test("ending and prospective native rows consume transient slots until onended; seventeenth root voice refuses atomically", async (t) => {
  const f = await fixture(t, { count: 7 }),
    s = f.controller;
  modelClaims(f);
  s.play();
  f.context.advance(0.2);
  f.context.holdEnded = true;
  const extras = [];
  for (let i = 0; i < 3; i++) {
    const r = startExtra(f);
    r.stopping = true;
    r.voice.stop();
    extras.push(r);
  }
  assert.equal(s.rows.size, 10);
  assert.equal(f.owner.check(s.plan, s.project).voices, 16);
  f.context.advance(1);
  assert.equal(s.rows.size, 10);
  const bytes = f.memory.snapshot().bytes,
    nodes = f.context.sources.length;
  assert.throws(() => startExtra(f), code("voiceLimit"));
  assert.equal(s.rows.size, 10);
  assert.equal(f.context.sources.length, nodes);
  assert.equal(f.memory.snapshot().bytes, bytes);
  assert.equal(f.releases(), 0);
  extras[0].voice.source.end();
  assert.equal(f.owner.check(s.plan, s.project).voices, 15);
  const next = startExtra(f);
  next.stopping = true;
  next.voice.stop();
  assert.equal(f.owner.check(s.plan, s.project).voices, 16);
  for (const r of [...extras.slice(1), next]) r.voice.source.end();
  assert.equal(s.rows.size, 7);
  assert.equal(f.owner.check(s.plan, s.project).voices, 13);
});
test("transient peak and prospective memory remain charged; stale-plan ownership cannot disappear from admission", async (t) => {
  const f = await fixture(t, { gain: 1 }),
    s = f.controller;
  s.play();
  const row = [...s.rows][0],
    bytes = f.memory.snapshot().bytes,
    nodes = f.context.sources.length;
  assert.throws(
    () => s.startVoice(row.track, { ...row.spec, peak: 1 }, 0.2, 0, row.clip),
    code("voiceHeadroom"),
  );
  assert.equal(f.context.sources.length, nodes);
  assert.equal(f.memory.snapshot().bytes, bytes);
  const filler = f.memory.reserve(
    f.memory.snapshot().maxBytes - bytes - 8191,
    "prospective-memory-pressure",
  );
  assert.throws(() => startExtra(f), code("combinedMemoryLimit"));
  assert.equal(f.context.sources.length, nodes);
  assert.equal(f.memory.snapshot().bytes, f.memory.snapshot().maxBytes - 8191);
  filler.release();
  assert.equal(f.memory.snapshot().bytes, bytes);
  const incoming = {
    ...s.plan,
    tracks: s.plan.tracks.map((t, i) =>
      i ? t : { ...t, clips: [{ ...t.clips[0] }] },
    ),
  };
  assert.throws(() => f.owner.bounds(incoming, s.project), code("recordBusy"));
  assert.equal(s.rows.size, 1);
  assert.equal(f.releases(), 0);
});
test("pause/resume and stopped-track rejoin use absolute modulo phase and refuse overlapping restart", async (t) => {
  const f = await fixture(t, { bars: 2 }),
    s = f.controller;
  s.play();
  f.context.advance(1.35);
  s.pause();
  assert.equal(s.offset, 60000);
  assert.equal(s.rows.size, 1);
  assert.throws(() => s.play({ resume: true }), code("recordBusy"));
  assert.equal(f.releases(), 0);
  f.context.advance(1.4);
  assert.equal(s.rows.size, 0);
  s.play({ resume: true });
  let n = f.context.sources.at(-1);
  assert.equal(n.offset, 1.25);
  assert.equal(n.loopEnd, 5);
  assert.ok(Math.abs(n.when - 1.5) < 1e-12);
  f.context.advance(1.6);
  s.stopTrack("track-1");
  assert.throws(() => s.playTrack("track-1"), code("recordBusy"));
  f.context.advance(1.7);
  s.playTrack("track-1");
  assert.equal(f.context.sources.length, 2);
  f.context.advance(2.1);
  s.pump();
  n = f.context.sources.at(-1);
  assert.equal(n.offset, 2.5);
  assert.ok(Math.abs(n.when - 2.75) < 1e-12);
  assert.equal(n.loop, true);
});
test("fixed-bar rate/length model uses exact complete periods and integer modulo offsets", async (t) => {
  for (const rate of [44100, 48000])
    for (const bpm of [96, 173])
      for (const bars of [1, 2, 4, 8]) {
        const f = await fixture(t, { rate, bpm, bars }),
          s = f.controller,
          period = f.P * bars;
        s.offset = f.P * 17 + 37;
        s.play({ resume: true });
        const n = f.context.sources[0];
        assert.equal(n.loopEnd, period / rate);
        assert.ok(
          Math.abs(n.offset - ((f.P * 17 + 37) % period) / rate) < 1e-12,
        );
        assert.equal(n.playbackRate.value, 1);
        assert.equal(s.rows.size, 1);
        s.stop();
      }
});
test("finite live preview schedules one exact reader but reports unverified completion; offline final specs stay per-cycle", async (t) => {
  for (const bars of [4, 8]) {
    const f = await fixture(t),
      s = f.controller,
      program = finalMixProgram(s.plan, bars);
    assert.equal(program.events.length, bars);
    assert.equal(program.admission.maxOwned, 2);
    assert.ok(program.events.every((e) => e.spec.loopFrames === undefined));
    s.play({ bars });
    const n = f.context.sources[0],
      end = s.transport.origin + program.bodyFrames / 48000;
    assert.equal(n.loop, true);
    assert.equal(n.stopCalls.length, 1);
    assert.equal(n.stopCalls[0], end);
    f.context.advance(end);
    s.pump();
    assert.equal(s.rows.size, 0);
    assert.equal(s.status, "error");
    assert.equal(s.error, "recordingLoopCompletionUnverified");
    assert.equal(f.releases(), 0);
  }
});
test("a coarse scheduled finite end reports unverified coverage without guessing an early-loss time", async (t) => {
  const f = await fixture(t),
    s = f.controller;
  s.play({ bars: 4 });
  const n = f.context.sources[0],
    end = n.stopCalls[0];
  f.context.currentTime = end - 0.002;
  n.end();
  assert.equal(s.error, "recordingLoopCompletionUnverified");
  assert.equal(s.rows.size, 0);
  s.pump();
  assert.equal(s.status, "error");
  f.context.advance(end);
  s.pump();
  assert.equal(s.status, "error");
  assert.equal(s.error, "recordingLoopCompletionUnverified");
});

test("finite native early end fails closed before its scheduled Stop and keeps the prepared source pinned", async (t) => {
  const f = await fixture(t, { count: 2, root: false }),
    s = f.controller;
  s.play({ bars: 4 });
  const originalPlan = s.plan,
    source = f.context.sources[0],
    scheduledStop = source.stopCalls[0];
  assert.ok(scheduledStop > 10);
  source.stop(0.8); // Native loss: no row.stopping or controller Stop.
  f.context.advance(0.8);
  assert.equal(s.status, "error");
  assert.equal(s.error, "recordingLoopCompletionUnverified");
  assert.equal(s.plan, originalPlan);
  assert.equal(f.releases(), 0);
  assert.equal(s.rows.size, 1);
  f.context.advance(0.9);
  assert.equal(s.rows.size, 0);
  s.pump();
  assert.equal(f.context.sources.length, 2);
});

test("finite completion never claims success from callback time for small loss, delayed delivery, or coarse healthy labels", async (t) => {
  for (const scenario of [
    ...[1, 64, 128, 129].map((loss) => ({ loss, delay: 0 })),
    { loss: 441600, delay: 441856 },
    ...[1, 128, 129, 4800].map((coarse) => ({ loss: 0, coarse })),
  ]) {
    const f = await fixture(t, { count: 2 }),
      s = f.controller;
    s.play({ bars: 4 });
    const [source, foreign] = f.context.sources,
      expectedFrame = Math.round(source.stopCalls[0] * 48000);
    if (scenario.loss) source.stop((expectedFrame - scenario.loss) / 48000);
    f.context.holdEnded = true;
    f.context.currentTime =
      (expectedFrame -
        scenario.loss +
        (scenario.delay ?? 0) -
        (scenario.coarse ?? 0)) /
      48000;
    source.end();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(s.status, "error");
    assert.equal(s.error, "recordingLoopCompletionUnverified");
    assert.equal(f.owner.lastFault, "recordingLoopCompletionUnverified");
    foreign.end();
    s.pump();
    assert.equal(s.status, "error");
    assert.equal(f.releases(), 0);
  }
});

test("resumed finite seek keeps completion ambiguous after early loss delivered beyond the remaining deadline", async (t) => {
  const f = await fixture(t, { count: 2 }),
    s = f.controller;
  s.play({ bars: 4 });
  s.pause();
  f.context.advance(0.2);
  assert.equal(s.rows.size, 0);
  s.offset = 2 * f.P + 37;
  s.play({ resume: true });
  const [source, foreign] = f.context.sources.slice(-2),
    declaredEnd = source.stopCalls[0];
  assert.equal(source.offset, 37 / 48000);
  source.stop(declaredEnd - 1);
  f.context.holdEnded = true;
  f.context.currentTime = declaredEnd + 0.1;
  source.end();
  await new Promise((resolve) => setImmediate(resolve));
  foreign.end();
  s.pump();
  assert.equal(s.error, "recordingLoopCompletionUnverified");
  assert.equal(s.status, "error");
  assert.equal(f.releases(), 0);
});
test("non-loop recordings and unqualified event-style clones keep their original finite/per-cycle renderer", async (t) => {
  const f = await fixture(t, { loop: false }),
    s = f.controller;
  assert.equal(recordedLoopGeometry(f.clip(), s.plan.clock), null);
  s.play();
  assert.equal(f.context.sources[0].loop, false);
  const g = await fixture(t),
    c = g.controller,
    clip = { ...g.clip() };
  c.plan = {
    ...c.plan,
    tracks: c.plan.tracks.map((r, i) => (i ? r : { ...r, clips: [clip] })),
  };
  assert.equal(c.liveAdmission().maxOwned, 2);
  c.play();
  assert.equal(g.context.sources[0].loop, false);
  g.context.advance(1.9);
  c.pump();
  assert.equal(g.context.sources.length, 2);
  assert.ok(g.context.sources.every((n) => !n.loop));
});
test("unexpected persistent end faults playback and preserves original plan while controlled native endings release only their node groups", async (t) => {
  const f = await fixture(t, { count: 2, root: false }),
    s = f.controller;
  s.play();
  f.context.advance(1);
  f.context.sources[0].end();
  assert.equal(s.status, "error");
  assert.equal(s.error, "recordingLoopEnded");
  assert.equal(s.rows.size, 1);
  assert.equal(f.releases(), 0);
  assert.ok(f.context.sources[1].stopCalls.length);
  f.context.advance(1.1);
  assert.equal(s.rows.size, 0);
  s.pump();
  assert.equal(f.context.sources.length, 2);
  assert.equal(f.releases(), 0);
});
test("future Stop/suspend/dispose holds leases until native end or caller-confirmed closure and never revives after late callbacks", async (t) => {
  const f = await fixture(t),
    s = f.controller;
  s.play();
  const n = f.context.sources[0];
  s.stop();
  assert.equal(n.stopCalls[0], 0);
  assert.equal(s.rows.size, 1);
  assert.equal(f.releases(), 0);
  f.context.state = "suspended";
  await assert.rejects(s.dispose(), code("loopClosePending"));
  assert.equal(s.closing, true);
  assert.equal(f.releases(), 0);
  assert.throws(() => s.play(), code("sessionDisposed"));
  f.context.confirmClosed();
  await s.dispose();
  assert.equal(s.rows.size, 0);
  assert.equal(f.releases(), 1);
  assert.equal(f.memory.snapshot().bytes, 1234);
  n.end();
  assert.equal(s.status, "closed");
  assert.equal(f.context.sources.length, 1);
});
test("invalid loop region and native start failure allocate no surviving group, and ordinary sources retain loop=false", async (t) => {
  const context = new FakeContext(48000),
    buffer = {
      length: 128,
      sampleRate: 48000,
      numberOfChannels: 2,
      duration: 128 / 48000,
    };
  assert.throws(
    () =>
      instrumentVoice(context, context.createGain(), buffer, 0.1, 1, {
        loopFrames: 127,
      }),
    code("invalidInstrumentVoice"),
  );
  assert.throws(
    () =>
      instrumentVoice(context, context.createGain(), buffer, 0.1, 1, {
        loopFrames: 128,
        offset: buffer.duration - 1e-16,
      }),
    code("invalidInstrumentVoice"),
  );
  assert.equal(context.sources.length, 0);
  const f = await fixture(t, { root: false }),
    s = f.controller;
  f.context.failStart = true;
  s.play();
  assert.equal(s.status, "error");
  assert.equal(s.rows.size, 0);
  assert.equal(f.context.sources[0].buffer, null);
  assert.ok(f.context.sources[0].disconnections);
  assert.equal(f.releases(), 0);
  assert.equal(
    f.memory
      .snapshot()
      .owners.some((x) => x.label === "loop-event-voice/group-pan"),
    false,
  );
  f.context.failStart = false;
  s.stop();
  s.play();
  assert.equal(s.rows.size, 1);
  assert.equal(f.context.sources.length, 2);
});

test("future recording starts retain scheduling deadline checks instead of skipping a late first onset", async (t) => {
  const f = await fixture(t, { startBars: 2 }),
    s = f.controller;
  s.play();
  assert.equal(s.rows.size, 0);
  f.context.advance(4.4);
  s.pump();
  assert.equal(s.rows.size, 1);
  assert.equal(f.context.sources[0].when, 5.1);
  assert.equal(f.context.sources[0].offset, 0);
  const g = await fixture(t, { startBars: 2, root: false }),
    c = g.controller;
  c.play();
  g.context.advance(5.12);
  c.pump();
  assert.equal(c.status, "error");
  assert.equal(c.error, "replayLate");
  assert.equal(g.context.sources.length, 0);
  assert.equal(g.releases(), 0);
});
test("ordinary finite rows beyond their grace remain charged and malformed transient peak is refused before allocation", async (t) => {
  const f = await fixture(t, { loop: false }),
    s = f.controller;
  s.play();
  const row = [...s.rows][0];
  assert.equal(loopAdmission(s.plan).maxOwned, 1);
  f.context.holdEnded = true;
  for (let i = 0; i < 2; i++)
    s.startVoice(row.track, { ...row.spec }, 0.2, 0, row.clip);
  assert.equal(s.rows.size, 3);
  assert.equal(s.liveAdmission().maxOwned, 3);
  const bytes = f.memory.snapshot().bytes,
    nodes = f.context.sources.length;
  assert.throws(
    () => s.startVoice(row.track, { ...row.spec, peak: NaN }, 0.2, 0, row.clip),
    code("invalidLoopPlan"),
  );
  assert.equal(f.memory.snapshot().bytes, bytes);
  assert.equal(f.context.sources.length, nodes);
});
test("unexpected reader end enters the root capture boundary before stopping a foreign row", async (t) => {
  const f = await fixture(t, { count: 2 }),
    s = f.controller,
    retained = { id: "original-retained-take" };
  let resolve,
    seen = 0;
  const gate = new Promise((r) => (resolve = r));
  f.owner.capture = {
    retained: new Map([[retained.id, retained]]),
    rootIntent(kind) {
      assert.equal(kind, "controller-fault");
      seen++;
      return gate;
    },
  };
  s.play();
  f.context.advance(1);
  f.context.sources[0].end();
  assert.equal(f.owner.lastFault, "recordingLoopEnded");
  assert.equal(seen, 1);
  assert.equal(s.status, "error");
  assert.equal(f.context.sources[1].stopCalls.length, 0);
  assert.equal(f.owner.capture.retained.get(retained.id), retained);
  assert.equal(f.releases(), 0);
  assert.equal(
    f.transport.running,
    true,
    "capture barrier still owns the running boundary",
  );
  const pendingBeat = f.transport.beatsAt(1);
  assert.ok(f.transport.beatsAt(1.5) > pendingBeat);
  resolve();
  await new Promise((r) => setImmediate(r));
  assert.ok(f.context.sources[1].stopCalls.length);
  assert.equal(f.owner.boundaries.size, 0);
  assert.equal(f.transport.running, false);
  assert.equal(f.transport.beatsAt(2), f.transport.beatsAt(3));
  f.context.advance(1.1);
  assert.equal(s.rows.size, 0);
  assert.equal(f.owner.capture.retained.get(retained.id), retained);
  assert.equal(f.releases(), 0);
  f.context.advance(2);
  s.play();
  assert.equal(s.error, null);
  assert.equal(f.transport.running, true);
  assert.equal(f.transport.origin, 2.1);
});

test("reader fault containment leaves a caller-owned clock running", async (t) => {
  const f = await fixture(t, { count: 2, root: false }),
    s = f.controller;
  s.ownsTransport = false;
  f.transport.start(0.1);
  s.play();
  f.context.advance(1);
  f.context.sources[0].end();
  assert.equal(s.status, "error");
  assert.equal(f.transport.running, true);
  assert.ok(f.transport.beatsAt(2) > f.transport.beatsAt(1));
});

test("full mono and stereo recording periods retain source channel geometry without a second decoded copy", async (t) => {
  for (const channels of [1, 2]) {
    const f = await fixture(t, { channels }),
      s = f.controller;
    const before = f.memory.snapshot().bytes;
    s.play();
    const n = f.context.sources[0];
    assert.equal(n.initialBuffer.numberOfChannels, channels);
    assert.equal(n.initialBuffer, f.buffers.get("recording-1"));
    assert.equal(n.loop, true);
    assert.equal(
      f.memory
        .snapshot()
        .owners.filter((x) => x.label === "model-recording-native-buffer")
        .length,
      1,
    );
    f.context.advance(20);
    s.pump();
    assert.equal(f.context.sources.length, 1);
    assert.ok(f.memory.snapshot().bytes > before);
    assert.equal(f.releases(), 0);
  }
});
