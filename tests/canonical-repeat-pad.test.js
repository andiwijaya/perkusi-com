import test from "node:test";
import assert from "node:assert/strict";
import { createCanonicalStudioController } from "../src/studio/canonical-controller.js";
const tick = () => new Promise((r) => setImmediate(r));
function gate() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const owners = [],
    states = [];
  const controller = createCanonicalStudioController({
    onChange: (s) => states.push(s),
    createOwner: async () => {
      const owner = { scores: [], jobs: [], closed: 0, pauses: 0, resumes: 0 };
      owners.push(owner);
      return {
        prepare: async (doc) => {
          const score = {
            document: structuredClone(doc),
            playableVerified: true,
            admission: { maxOwned: 1, maxPeak: 0.2 },
            program: { rate: 48000, frames: 48000 },
            disposed: 0,
            dispose() {
              this.disposed++;
            },
          };
          owner.scores.push(score);
          return score;
        },
        resume: async () => {
          owner.resumes++;
        },
        pause: async () => {
          owner.pauses++;
        },
        start: (score) => {
          const done = gate(),
            job = {
              score,
              done: done.promise,
              finish: done.resolve,
              fail: done.reject,
            };
          owner.jobs.push(job);
          return job;
        },
        exportWav: async (score) => score.document,
        dispose: async () => {
          owner.closed++;
          for (const job of owner.jobs) job.finish({ closed: true });
        },
      };
    },
  });
  return { controller, owners, states };
}
test("continuous repeat reuses one admitted owner only after full native completion; turning off lets the current tail finish", async () => {
  const f = fixture(),
    doc = { title: "kept", origins: [1] };
  f.controller.setRepeat(true);
  await f.controller.play(doc);
  const o = f.owners[0];
  assert.equal(o.jobs.length, 1);
  assert.equal(f.controller.snapshot().cycle, 1);
  await tick();
  assert.equal(
    o.jobs.length,
    1,
    "never schedules another cycle before complete natural-tail acknowledgement",
  );
  o.jobs[0].finish({ naturalTailComplete: true });
  await tick();
  assert.equal(o.jobs.length, 2);
  o.jobs[1].finish({ naturalTailComplete: true });
  await tick();
  assert.equal(o.jobs.length, 3);
  assert.equal(f.owners.length, 1);
  assert.equal(o.scores.length, 1);
  assert.equal(o.jobs[2].score, o.jobs[0].score);
  f.controller.setRepeat(false);
  await tick();
  assert.equal(o.jobs.length, 3);
  o.jobs[2].finish({ naturalTailComplete: true });
  await tick();
  assert.equal(f.controller.snapshot().status, "ended");
  assert.equal(o.closed, 1);
  assert.deepEqual(doc, { title: "kept", origins: [1] });
});
test("Stop defeats a queued repeat, and Play after Stop starts exactly one new owner", async () => {
  const f = fixture();
  f.controller.setRepeat(true);
  await f.controller.play({ title: "song" });
  const o = f.owners[0];
  o.jobs[0].finish({ naturalTailComplete: true });
  await f.controller.stop();
  await tick();
  assert.equal(o.jobs.length, 1);
  assert.equal(f.controller.snapshot().pendingOwners, 0);
  await f.controller.play({ title: "song" });
  assert.equal(f.owners.length, 2);
  assert.equal(f.owners[1].jobs.length, 1);
  await f.controller.stop();
});
test("Pause/resume during repeated playback retains the same cycle/owner and no reprepare", async () => {
  const f = fixture();
  f.controller.setRepeat(true);
  await f.controller.play({ title: "song" });
  const o = f.owners[0];
  await f.controller.pause();
  assert.equal(f.controller.snapshot().status, "paused");
  assert.equal(o.jobs.length, 1);
  await f.controller.resume();
  assert.equal(f.controller.snapshot().status, "playing");
  assert.equal(o.scores.length, 1);
  o.jobs[0].finish({ naturalTailComplete: true });
  await tick();
  assert.equal(o.jobs.length, 2);
  await f.controller.stop();
});
test("pad prepare is silent; audition and song share the same owner and keep project/export separate", async () => {
  const f = fixture(),
    doc = { title: "song", notes: [1, 2] };
  await f.controller.play(doc, { prepareOnly: true });
  const o = f.owners[0];
  assert.equal(o.jobs.length, 0);
  assert.equal(f.controller.snapshot().status, "prepared");
  const pad = await f.controller.audition({ title: "one pad" });
  assert.equal(o.jobs.length, 1);
  assert.equal(f.owners.length, 1);
  assert.deepEqual(await f.controller.exportWav(), doc);
  await f.controller.startPrepared();
  assert.equal(o.jobs.length, 2);
  assert.equal(o.jobs[1].score, o.scores[0]);
  assert.equal(o.jobs[0].score, o.scores[1]);
  pad.finish({ naturalTailComplete: true });
  await tick();
  assert.equal(o.scores[1].disposed, 1);
  assert.deepEqual(doc, { title: "song", notes: [1, 2] });
  await f.controller.stop();
});
test("a late pad natural tail survives song completion; Stop still closes all and no stale pad can restart", async () => {
  const f = fixture();
  await f.controller.play({ title: "song" });
  const o = f.owners[0],
    pad = await f.controller.audition({ title: "pad" });
  o.jobs[0].finish({ naturalTailComplete: true });
  await tick();
  assert.equal(o.closed, 0);
  assert.equal(f.controller.snapshot().finishing, true);
  await assert.rejects(
    f.controller.audition({ title: "late" }),
    (e) => e.code === "canonicalNotReady",
  );
  pad.finish({ naturalTailComplete: true });
  await tick();
  assert.equal(o.closed, 1);
  assert.equal(f.controller.snapshot().status, "ended");
  assert.equal(f.controller.snapshot().pendingOwners, 0);
});
test("pause blocks pad admission; invalid toggle and calls after disposal cannot create owners", async () => {
  const f = fixture();
  await f.controller.play({ title: "song" });
  await f.controller.pause();
  await assert.rejects(f.controller.audition({ title: "pad" }));
  assert.equal(f.owners[0].scores.length, 1);
  assert.throws(() => f.controller.setRepeat(1));
  await f.controller.dispose();
  assert.throws(() => f.controller.setRepeat(true));
  assert.equal(f.controller.snapshot().pendingOwners, 0);
});
