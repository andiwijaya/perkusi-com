import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { InstrumentSession } from "../src/audio/instrument-session.js";
import { Transport } from "../src/audio/transport.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { PPQ } from "../src/project/instrument-project.js";
import { shareInstrumentOutput } from "../src/project/instrument-share.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const until = async (fn) => {
  const limit = Date.now() + 3000;
  while (!fn()) {
    assert.ok(
      Date.now() < limit,
      "deterministic adapter did not reach boundary",
    );
    await pause(1);
  }
};
const param = () => ({
  value: 0,
  setValueAtTime() {},
  cancelScheduledValues() {},
  linearRampToValueAtTime() {},
});
const node = () => ({ gain: param(), connect() {}, disconnect() {} });
const pcm = (frames = 8, rate = 48000, level = 0.01) => ({
  length: frames,
  sampleRate: rate,
  numberOfChannels: 1,
  duration: frames / rate,
  getChannelData: () => new Float32Array(frames).fill(level),
});
const body = new Uint8Array(32).fill(17);
function catalog(rate, frames = 8) {
  const result = {
    banks: [
      {
        id: "cdm-pelog",
        version: "candidate-1.0.0",
        kind: "instrument-bank",
        setId: "qa",
        tradition: "qa",
        laras: "pelog",
        samples: [
          {
            id: "s1",
            instrumentId: "saron-barung",
            pitchId: "p1",
            articulation: "strike",
            assetPath: "/sounds/qa.wav",
            sha256: createHash("sha256").update(body).digest("hex"),
            sourceWorkId: "qa",
            licenseId: "qa",
            encodedBytes: 32,
            sampleRate: rate,
            channels: 1,
            frames,
            gainTrim: 1,
            voicePolicy: "polyphonic",
          },
        ],
      },
    ],
  };
  result.banks[0].samples.push({
    ...result.banks[0].samples[0],
    id: "s2",
    instrumentId: "bonang-barung",
    assetPath: "/sounds/qa-second.wav",
  });
  return result;
}
function fixture(t, { recordedSet = false, level = 0.01, frames = 8 } = {}) {
  const oldFetch = globalThis.fetch,
    oldOffline = globalThis.OfflineAudioContext;
  const controls = {
    contexts: [],
    sourceStarts: [],
    gains: [],
    closeGate: null,
    resumeGate: null,
    renderGate: null,
    renderEntered: false,
    closeFailure: false,
  };
  globalThis.fetch = async () => new Response(body.slice());
  globalThis.OfflineAudioContext = class {
    constructor(channels, frames, rate) {
      this.frames = frames;
      this.sampleRate = rate;
      this.destination = {};
    }
    createGain() {
      return node();
    }
    createBufferSource() {
      return {
        playbackRate: { value: 1 },
        connect() {},
        disconnect() {},
        start() {},
        stop() {},
      };
    }
    async decodeAudioData() {
      return pcm();
    }
    async startRendering() {
      controls.renderEntered = true;
      await controls.renderGate?.promise;
      return pcm(this.frames, this.sampleRate);
    }
  };
  const engineFactory = () => {
    const engine = {
      context: null,
      master: node(),
      transport: new Transport(),
      voices: new Set(),
      captures: new Set(),
      banks: [],
      volume: 0.65,
      playbackRequested: false,
      ensureContext() {
        if (!this.context) {
          const c = {
            state: "running",
            sampleRate: 48000,
            currentTime: 0,
            destination: {},
            closeCalls: 0,
            async resume() {
              if (controls.resumeFailure) {
                controls.resumeFailure = false;
                throw new DOMException(
                  "QA simulated audio activation denial",
                  "NotAllowedError",
                );
              }
              await controls.resumeGate?.promise;
            },
            async close() {
              this.closeCalls++;
              this.state = "closed";
              await controls.closeGate?.promise;
            },
            addEventListener() {},
            removeEventListener() {},
            createGain() {
              const gain = node();
              controls.gains.push(gain);
              return gain;
            },
            createBufferSource() {
              return {
                playbackRate: { value: 1 },
                connect() {},
                disconnect() {},
                start(when) {
                  controls.sourceStarts.push(when);
                },
                stop() {
                  queueMicrotask(() => this.onended?.());
                },
              };
            },
            async decodeAudioData() {
              return pcm(frames, 48000, level);
            },
          };
          this.context = c;
          controls.contexts.push(c);
        }
        return this.context;
      },
      setVolume(v) {
        this.volume = v;
      },
      pause() {
        this.playbackRequested = false;
        this.transport.pause(this.context?.currentTime ?? 0);
      },
      async dispose() {
        this.pause();
        if (controls.closeFailure) {
          controls.closeFailure = false;
          throw Object.assign(Error("QA close failure"), { code: "qaClose" });
        }
        await this.context?.close();
        this.context = null;
      },
    };
    return engine;
  };
  const catalogs = {
    44100: catalog(44100, frames),
    48000: catalog(48000, frames),
  };
  if (recordedSet)
    for (const cat of Object.values(catalogs))
      for (const bank of cat.banks) bank.setId = "cdm-porto-recorded-candidate";
  const session = new InstrumentSession({
    catalogs,
    engineFactory,
    renderYield: async () => {
      controls.renderEntered = true;
      await controls.renderGate?.promise;
    },
  });
  t.after(async () => {
    controls.closeGate?.resolve();
    controls.resumeGate?.resolve();
    controls.renderGate?.resolve();
    await session.dispose();
    globalThis.fetch = oldFetch;
    globalThis.OfflineAudioContext = oldOffline;
  });
  const record = async () => {
    await session.enable({ gesture: true });
    await session.startRecording();
    session.strike("cdm-pelog", "s1");
    session.audioContext.currentTime = 0.05;
    session.finishRecording();
  };
  return { session, controls, record };
}

test("quiet trusted Gamelan audition applies fixed gain and counts it before the tenth overlapping strike", async (t) => {
  const { session, controls } = fixture(t, { recordedSet: true, level: 0.16 });
  await session.enable({ gesture: true });
  for (let n = 0; n < 9; n++) session.strike("cdm-pelog", "s1");
  assert(controls.gains.filter((g) => g.gain.value === 4).length >= 9);
  assert.throws(() => session.strike("cdm-pelog", "s1"), {
    code: "voiceHeadroom",
  });
});

test("explicit Stop resets resume/transport without altering events and refuses during a recording", async (t) => {
  const { session, record } = fixture(t);
  await record();
  const text = session.toJSON();
  await session.replay();
  session.audioContext.currentTime = session.snapshot().clock.origin + 0.01;
  session.pause();
  assert.equal(session.snapshot().canResume, true);
  session.stopPlayback();
  assert.equal(session.snapshot().canResume, false);
  assert.equal(session.snapshot().clock.beat, 0);
  assert.equal(session.snapshot().clock.running, false);
  assert.equal(session.toJSON(), text);
  await session.enable({ gesture: true });
  await session.startRecording();
  assert.throws(() => session.stopPlayback(), { code: "recordBusy" });
  session.finishRecording();
});

test("periodic replay advances fixed cycles and paused repeat resumes without rewriting the source", async (t) => {
  const { session, record, controls } = fixture(t);
  await record();
  const text = session.toJSON();
  controls.sourceStarts = [];
  await session.replay({ repeat: true });
  assert.equal(session.snapshot().repeating, true);
  assert.equal(controls.sourceStarts.length, 1);
  const origin = controls.sourceStarts[0];
  session.audioContext.currentTime = origin + 1.9;
  await until(() => controls.sourceStarts.length >= 2);
  assert.ok(Math.abs(controls.sourceStarts[1] - origin - 2.5) < 1 / 48000);
  session.audioContext.currentTime = origin + 2.1;
  session.pause();
  assert.equal(session.snapshot().canResume, true);
  await session.enable({ gesture: true });
  await session.replay({ resume: true });
  assert.equal(session.snapshot().repeating, true);
  assert.equal(session.toJSON(), text);
  session.stopPlayback();
  assert.equal(session.snapshot().repeating, false);
  assert.equal(session.snapshot().canResume, false);
  assert.equal(session.toJSON(), text);
});

test("Gamelan playhead reads rendered time, not queued starts, and freezes/resumes/clears without score edits", async (t) => {
  const { session, record, controls } = fixture(t);
  await record();
  const before = session.toJSON();
  assert.equal(session.playhead().state, "stopped");
  await session.replay({ repeat: true });
  assert(controls.sourceStarts.length > 0);
  assert.equal(session.playhead().state, "waiting");
  assert.equal(session.playhead().step, null);
  const origin = session.snapshot().clock.origin;
  session.audioContext.currentTime = origin + 1.6;
  assert.equal(session.playhead().step, 10);
  session.pause();
  const paused = session.playhead();
  assert.equal(paused.state, "paused");
  session.audioContext.currentTime += 1;
  assert.deepEqual(session.playhead(), paused);
  await session.enable({ gesture: true });
  await session.replay({ resume: true });
  assert.equal(session.playhead().state, "waiting");
  session.audioContext.currentTime += 0.11;
  assert.equal(session.playhead().state, "playing");
  assert.equal(session.playhead().step, 10);
  session.stopPlayback();
  assert.equal(session.playhead().state, "stopped");
  assert.equal(session.playhead().step, null);
  assert.equal(session.toJSON(), before);
});

test("separated short attacks no longer refuse repeat by charging lookahead as simultaneous sound", async (t) => {
  const { session, controls } = fixture(t, { level: 0.9 });
  await session.enable({ gesture: true });
  const p = structuredClone(session.project);
  p.banks = [{ id: "cdm-pelog", version: "candidate-1.0.0" }];
  p.events = Array.from({ length: 14 }, (_, i) => ({
    id: "dense-" + i,
    tick: (i * PPQ) / 4,
    action: "strike",
    velocity: 1,
    bankId: "cdm-pelog",
    sampleId: "s1",
  }));
  session.importJSON(JSON.stringify(p));
  await session.enable({ gesture: true });
  const before = session.toJSON();
  await session.replay({ repeat: true });
  assert.equal(session.snapshot().replaying, true);
  assert.equal(session.snapshot().repeating, true);
  assert.equal(session.snapshot().error, null);
  assert(controls.sourceStarts.length > 0);
  assert.equal(session.toJSON(), before);
  session.stopPlayback();
  await session.closeAudio();
  assert.equal(session.memory.snapshot().bytes, 0);
});

test("genuinely loud periodic PCM still refuses before sources and permits safe Play once directly", async (t) => {
  const { session, controls } = fixture(t, { level: 0.9, frames: 48000 });
  const p = structuredClone(session.project);
  p.clock.lengthTicks = (PPQ * 6) / 25; // 150 ms cycle, full one-second sustain.
  p.banks = [{ id: "cdm-pelog", version: "candidate-1.0.0" }];
  p.events = [
    {
      id: "sustain",
      tick: 0,
      action: "strike",
      velocity: 1,
      bankId: "cdm-pelog",
      sampleId: "s1",
    },
  ];
  session.importJSON(JSON.stringify(p));
  await session.enable({ gesture: true });
  const before = session.toJSON();
  await assert.rejects(session.replay({ repeat: true }), {
    code: "voiceHeadroom",
  });
  assert.equal(controls.sourceStarts.length, 0);
  assert.equal(session.snapshot().voiceCount, 0);
  await session.enable({ gesture: true });
  await session.replay({ repeat: false });
  assert.equal(session.snapshot().replaying, true);
  assert.equal(session.snapshot().repeating, false);
  assert(controls.sourceStarts.length > 0);
  assert.equal(session.toJSON(), before);
  session.stopPlayback();
  await session.closeAudio();
  assert.equal(session.memory.snapshot().bytes, 0);
});

test("native audio resume rejection leaves a retryable state and the next trusted enable keeps the original project", async (t) => {
  const { session, controls } = fixture(t);
  controls.resumeFailure = true;
  const before = session.toJSON();
  await assert.rejects(
    session.enable({ gesture: true }).catch((error) => {
      const s = session.snapshot();
      t.diagnostic(
        JSON.stringify({
          status: s.status,
          error: s.error,
          playbackRequested: s.playbackRequested,
        }),
      );
      throw error;
    }),
    { code: "audioResumeFailed" },
  );
  assert.equal(session.snapshot().status, "error");
  assert.equal(session.snapshot().error, "audioResumeFailed");
  assert.equal(session.snapshot().playbackRequested, false);
  assert.equal(session.playhead().state, "stopped");
  assert.equal(controls.sourceStarts.length, 0);
  assert.equal(session.toJSON(), before);
  await session.enable({ gesture: true });
  assert.equal(session.snapshot().status, "ready");
  assert.equal(session.snapshot().error, null);
  assert.equal(controls.contexts.length, 1);
  assert.equal(session.toJSON(), before);
  await session.closeAudio();
  assert.equal(session.memory.snapshot().bytes, 0);
});

test("multi-instrument paused repeat transitions release previous replay leases as well as focus", async (t) => {
  const { session, record } = fixture(t);
  await record();
  const p = structuredClone(session.project);
  p.events.push({ ...p.events[0], id: "second", sampleId: "s2", tick: 960000 });
  session.importJSON(JSON.stringify(p));
  const text = session.toJSON();
  for (let i = 0; i < 3; i++) {
    await session.enable({ gesture: true });
    await session.replay({ repeat: true });
    session.audioContext.currentTime = session.snapshot().clock.origin + 0.1;
    session.pause();
  }
  await session.closeAudio();
  assert.equal(session.memory.snapshot().bytes, 0);
  assert.equal(session.toJSON(), text);
});

test("S3 export lock precedes async close and observer reentry; failures/cancel allow a later export", async (t) => {
  const { session, controls, record } = fixture(t);
  await record();
  const original = session.toJSON();
  controls.closeGate = deferred();
  let observerAttempt;
  const unsub = session.subscribe((s) => {
    if (s.exporting && !observerAttempt)
      observerAttempt = session.exportWav().then(
        () => "unexpected",
        (e) => e.code,
      );
  });
  const first = session.exportWav({ pauseAndRelease: true });
  assert.equal(session.snapshot().exporting, true);
  await assert.rejects(
    session.exportWav({ pauseAndRelease: true }),
    (e) => e.code === "exportBusy",
  );
  assert.equal(await observerAttempt, "exportBusy");
  unsub();
  controls.closeGate.resolve();
  await first;
  session.releaseExport();
  assert.equal(session.toJSON(), original);
  await session.enable({ gesture: true });
  controls.closeFailure = true;
  await assert.rejects(
    session.exportWav({ pauseAndRelease: true }),
    (e) => e.code === "qaClose",
  );
  assert.equal(session.snapshot().exporting, false);
  assert.equal(session.snapshot().owners.channels.export.generation, null);
  controls.renderEntered = false;
  controls.renderGate = deferred();
  const canceled = session.exportWav();
  const rejected = assert.rejects(canceled, (e) => e.code === "cancelled");
  await until(() => controls.renderEntered);
  session.cancelExport();
  const held = session.memory.snapshot().bytes;
  await pause(1);
  assert.equal(session.snapshot().exporting, true);
  assert.equal(session.memory.snapshot().bytes, held);
  controls.renderGate.resolve();
  await rejected;
  controls.renderGate = null;
  const next = await session.exportWav();
  assert.ok(next.frames > 0);
  session.releaseExport();
  assert.equal(session.toJSON(), original);
});

test("S3 disposing is a synchronous terminal gate, shared promise and retains unresolved render ownership", async (t) => {
  const { session, controls, record } = fixture(t);
  await record();
  const original = session.toJSON();
  controls.renderGate = deferred();
  const exporting = session.exportWav();
  const rejected = assert.rejects(exporting, (e) => e.code === "cancelled");
  await until(() => controls.renderEntered);
  const first = session.dispose();
  assert.equal(session.dispose(), first);
  assert.equal(session.snapshot().disposing, true);
  const created = controls.contexts.length;
  for (const action of [
    () => session.enable({ gesture: true }),
    () =>
      session.setFocus({
        instrument: "saron-barung",
        laras: "pelog",
        ensemble: false,
      }),
    () => session.startRecording(),
    () => session.replay(),
    () => session.legacyGuide(true),
    () => session.exportWav(),
  ])
    await assert.rejects(action(), (e) => e.code === "sessionDisposed");
  assert.throws(
    () => session.clearRecording(),
    (e) => e.code === "sessionDisposed",
  );
  assert.throws(
    () => session.setTempo(100),
    (e) => e.code === "sessionDisposed",
  );
  await until(() => session.snapshot().contextState === "absent");
  assert.ok(session.memory.snapshot().bytes > 0);
  assert.equal(controls.contexts.length, created);
  let completed = false;
  first.then(() => (completed = true));
  await pause(1);
  assert.equal(completed, false);
  controls.renderGate.resolve();
  await rejected;
  await first;
  assert.equal(session.snapshot().disposed, true);
  assert.equal(session.snapshot().disposing, false);
  assert.equal(session.memory.snapshot().bytes, 0);
  assert.equal(session.snapshot().owners.disposed, true);
  assert.equal(session.snapshot().contextState, "absent");
  assert.equal(session.toJSON(), original);
  assert.deepEqual(
    controls.contexts.map((c) => c.closeCalls),
    [1],
  );
  assert.equal(session.dispose(), first);
  await session.dispose();
});

test("S3 already pending native resume cannot rearm after synchronous disposal", async (t) => {
  const { session, controls } = fixture(t);
  controls.resumeGate = deferred();
  const enabled = session.enable({ gesture: true });
  const rejected = assert.rejects(enabled, (e) =>
    ["cancelled", "sessionDisposed"].includes(e.code),
  );
  const disposal = session.dispose();
  await disposal;
  controls.resumeGate.resolve();
  await rejected;
  assert.equal(controls.contexts.length, 1);
  assert.equal(controls.contexts[0].closeCalls, 1);
  assert.equal(session.memory.snapshot().bytes, 0);
  assert.equal(session.snapshot().playbackRequested, false);
});

test("S3 cold/paused enable refuses export before allocating or changing readiness and recovers after cancel/failure", async (t) => {
  const { session, controls, record } = fixture(t);
  await record();
  await session.closeAudio();
  const before = session.toJSON(),
    contexts = controls.contexts.length;
  controls.renderGate = deferred();
  const exporting = session.exportWav();
  const canceled = assert.rejects(exporting, (e) => e.code === "cancelled");
  await until(() => controls.renderEntered);
  await assert.rejects(
    session.enable({ gesture: true }),
    (e) => e.code === "exportBusy",
  );
  assert.equal(controls.contexts.length, contexts);
  assert.equal(session.snapshot().contextState, "absent");
  assert.equal(session.snapshot().status, "needsAudio");
  assert.equal(session.toJSON(), before);
  session.cancelExport();
  controls.renderGate.resolve();
  await canceled;
  controls.renderGate = null;
  await session.enable({ gesture: true });
  assert.equal(session.snapshot().status, "ready");
  session.pause();
  controls.renderEntered = false;
  controls.renderGate = deferred();
  const pausedExport = session.exportWav({ pauseAndRelease: true });
  await until(() => controls.renderEntered);
  const count = controls.contexts.length;
  await assert.rejects(
    session.enable({ gesture: true }),
    (e) => e.code === "exportBusy",
  );
  assert.equal(controls.contexts.length, count);
  controls.renderGate.resolve();
  await pausedExport;
  session.releaseExport();
  controls.renderGate = null;
  await session.enable({ gesture: true });
  assert.equal(session.snapshot().status, "ready");
  assert.equal(session.toJSON(), before);
});

test("S3 memory trim nested admission uses a fresh monotonic retry ID", () => {
  const memory = new AudioMemory({ maxBytes: 80 }),
    old = memory.reserve(64, "old");
  let nested;
  memory.registerTrimmer({}, () => {
    old.release();
    nested = memory.reserve(8, "nested");
  });
  const outer = memory.reserve(32, "outer");
  assert.equal(memory.snapshot().bytes, 40);
  assert.equal(memory.snapshot().history.sequenceFloor, 4);
  outer.release();
  nested.release();
  assert.equal(memory.snapshot().bytes, 0);
});
test("S3 Studio transition pauses shared context without altering take, refuses active capture/export and terminal state", async (t) => {
  const { session, controls, record } = fixture(t);
  await record();
  const before = session.toJSON(),
    context = session.audioContext,
    created = controls.contexts.length;
  await session.prepareStudio();
  assert.equal(session.audioContext, context);
  assert.equal(controls.contexts.length, created);
  assert.equal(session.toJSON(), before);
  assert.equal(session.snapshot().playbackRequested, false);
  await session.enable({ gesture: true });
  await session.startRecording();
  await assert.rejects(session.prepareStudio(), (e) => e.code === "recordBusy");
  assert.equal(session.snapshot().recording, true);
  session.finishRecording();
  controls.renderGate = deferred();
  const exporting = session.exportWav();
  const rejected = assert.rejects(exporting, (e) => e.code === "cancelled");
  await until(() => controls.renderEntered);
  await assert.rejects(session.prepareStudio(), (e) => e.code === "recordBusy");
  session.cancelExport();
  controls.renderGate.resolve();
  await rejected;
  await session.dispose();
  await assert.rejects(
    session.prepareStudio(),
    (e) => e.code === "sessionDisposed",
  );
  assert.equal(session.memory.snapshot().bytes, 0);
});

test("V4 session disposal waits for an in-flight share even after explicit output release", async (t) => {
  const { session, record } = fixture(t);
  await record();
  const output = await session.exportWav(),
    gate = deferred(),
    entered = deferred();
  const sharing = shareInstrumentOutput(output, {
    memory: session.memory,
    download: () => assert.fail(),
    navigator: {
      canShare: () => true,
      share: async () => {
        entered.resolve();
        await gate.promise;
      },
    },
  });
  await entered.promise;
  session.releaseExport();
  let done = false;
  const disposal = session.dispose().then(() => {
    done = true;
  });
  await until(() => session.snapshot().contextState === "absent");
  await pause(5);
  assert.equal(done, false);
  assert.ok(session.memory.snapshot().bytes > 0);
  gate.resolve();
  assert.equal(await sharing, "shared");
  await disposal;
  assert.equal(session.memory.snapshot().bytes, 0);
});

test("V4 live play-along mute changes are atomic, preserve events/focus, refuse live pan and clear stale groups", async (t) => {
  const { session, record } = fixture(t);
  await record();
  const events = session.project.events,
    group = {
      bankId: "cdm-pelog",
      instrumentId: "saron-barung",
      solo: false,
      volume: 1,
      pan: 0,
      mute: false,
    };
  await session.replay({ playAlong: true });
  assert.equal(session.snapshot().notes.length, 1);
  for (let i = 0; i < 12; i++)
    session.setInstrumentGroupMix({ ...group, mute: !!(i % 2) });
  assert.deepEqual(session.project.events, events);
  const before = session.toJSON();
  assert.throws(
    () => session.setInstrumentGroupMix({ ...group, pan: 0.5 }),
    (e) => e.code === "recordBusy",
  );
  assert.equal(session.toJSON(), before);
  session.strike("cdm-pelog", "s1", 0.1);
  session.pause();
  await session.enable({ gesture: true });
  await session.replay({ resume: true, playAlong: true });
  assert.equal(session.snapshot().notes.length, 1);
  session.clearRecording();
  assert.deepEqual(session.project.instrumentMix, []);
  assert.deepEqual(session.project.events, []);
  await session.dispose();
  assert.equal(session.memory.snapshot().bytes, 0);
});

test("repeat fails closed after a missed scheduling horizon without catching up late hits or changing the project", async (t) => {
  const { session, record, controls } = fixture(t);
  await record();
  const text = session.toJSON();
  controls.sourceStarts = [];
  await session.replay({ repeat: true });
  const origin = controls.sourceStarts[0];
  session.audioContext.currentTime = origin + 10;
  await until(() => !session.snapshot().repeating);
  assert.equal(session.snapshot().error, "replayLate");
  assert.equal(controls.sourceStarts.length, 1);
  assert.equal(session.toJSON(), text);
  session.stopPlayback();
  await session.closeAudio();
  assert.equal(session.memory.snapshot().bytes, 0);
});
