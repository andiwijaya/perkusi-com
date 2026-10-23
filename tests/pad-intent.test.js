import test from "node:test";
import assert from "node:assert/strict";
import { AudioEngine } from "../src/audio/engine.js";
import { CompositionPlayback } from "../src/audio/composition.js";
import {
  newComposition,
  withPatternLoops,
} from "../src/project/composition-model.js";
import { withKendhang } from "../src/project/kendhang.js";
import { withBass } from "../src/project/bass.js";
import { withGuitar } from "../src/project/guitar.js";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
const pack = {
  schemaVersion: 1,
  id: "pad-intent",
  bpm: 96,
  beatsPerBar: 4,
  bars: 2,
  stems: [
    { id: "kick", url: "kick.wav", licenseId: "synthetic-test", gainTrim: 0.1 },
  ],
};
const families = [
  ["drum", "kick"],
  ["bilah", "d4"],
  ["kendhang", "tak"],
  ["bass", "e1"],
  ["guitar", "b2"],
];
function setup(family, warm = false) {
  const resume = deferred(),
    counts = { fetch: 0, decode: 0, mixNodes: 0, voices: 0 };
  const context = {
    state: "suspended",
    currentTime: 0,
    resume: () => resume.promise,
  };
  const project = withGuitar(
    withBass(withKendhang(withPatternLoops(newComposition("Pad intent")))),
  );
  const entry = {
    stem: { id: family === "drum" ? "kick" : "d4" },
    buffer: warm ? {} : null,
  };
  const bank = {
    get: () => entry,
    load: async () => {
      counts.fetch++;
      counts.decode++;
      entry.buffer = {};
    },
  };
  const engine = new AudioEngine(pack);
  engine.context = context;
  engine.master = {};
  engine.ensureContext = () => context;
  engine.sequence = {};
  engine.playableEntry = () => (entry.buffer ? entry : null);
  engine.variants = new Map([["kick", new Map([[1, { bank }]])]]);
  engine.addShot = () => {
    counts.voices++;
  };
  const playback = Object.assign(Object.create(CompositionPlayback.prototype), {
    engine,
    project,
    mixer: null,
    context: null,
    banks: { instrument: bank, kendhang: bank, bass: bank, guitar: bank },
  });
  // A stale intent must return before even attempting to allocate mixer nodes.
  context.createGain = () => {
    counts.mixNodes++;
    throw Error("unexpected mixer admission");
  };
  return { engine, context, playback, resume, counts, entry, bank, project };
}
const fire = (f, family, pitch) =>
  family === "drum"
    ? f.engine.triggerPad(pitch)
    : f.playback.pad(pitch, family);

for (const [family, pitch] of families)
  for (const warm of [false, true])
    for (const action of ["Stop", "replace", "dispose", "context replacement"])
      for (const settlement of ["resolve", "reject"])
        test(`${family} ${warm ? "warm" : "cold"}: ${action} fences delayed resume ${settlement} before admission`, async () => {
          const f = setup(family, warm),
            before = JSON.stringify(f.project),
            pending = fire(f, family, pitch);
          if (action === "dispose") {
            f.engine.disposed = true;
            f.engine.operation++;
          } else if (action === "context replacement") f.engine.context = {};
          else f.engine.rewind(); // Stop and project replacement both invalidate operation.
          if (settlement === "resolve") {
            f.context.state = "running";
            f.resume.resolve();
          } else f.resume.reject(Error("late resume rejection"));
          await pending;
          assert.deepEqual(f.counts, {
            fetch: 0,
            decode: 0,
            mixNodes: 0,
            voices: 0,
          });
          assert.equal(JSON.stringify(f.project), before);
        });

for (const [family, pitch] of families)
  test(`${family}: current resume rejection stays visible to its caller`, async () => {
    const f = setup(family),
      p = fire(f, family, pitch);
    f.resume.reject(Error("current resume rejection"));
    await assert.rejects(p, /current resume rejection/);
    assert.deepEqual(f.counts, { fetch: 0, decode: 0, mixNodes: 0, voices: 0 });
  });

test("old stopped resume cannot admit work or cancel a fresh drum intent", async () => {
  const f = setup("drum"),
    old = fire(f, "drum", "kick");
  f.engine.rewind();
  f.context.state = "running";
  await fire(f, "drum", "kick");
  assert.deepEqual(f.counts, { fetch: 1, decode: 1, mixNodes: 0, voices: 1 });
  f.resume.resolve();
  await old;
  assert.deepEqual(f.counts, { fetch: 1, decode: 1, mixNodes: 0, voices: 1 });
});

test("pending native decode remains reserved after pad Stop until true settlement", async () => {
  const native = deferred();
  let decodes = 0;
  const context = {
    state: "running",
    currentTime: 0,
    decodeAudioData: () => {
      decodes++;
      return native.promise;
    },
  };
  const engine = new AudioEngine(pack, {
    bankOptions: {
      fetcher: async () => ({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(1),
      }),
    },
  });
  engine.context = context;
  engine.ensureContext = () => context;
  engine.sequence = {};
  const pending = engine.triggerPad("kick");
  await flush();
  assert.equal(decodes, 1);
  engine.rewind();
  await pending;
  assert.equal(engine.bank.loadingResources()[0].nativeDecodes, 1);
  assert.equal(engine.voices.size, 0);
  native.resolve({});
  await flush();
  assert.equal(engine.bank.loadingResources()[0].nativeDecodes, 0);
  assert.equal(engine.bank.get("kick").buffer, null);
});
