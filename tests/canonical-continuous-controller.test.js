import test from "node:test";
import assert from "node:assert/strict";
import { createCanonicalStudioController } from "../src/studio/canonical-controller.js";
const tick = () => new Promise(setImmediate);
function gate() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  promise.catch(() => {});
  return { promise, resolve, reject };
}
function fixture(blocked = false) {
  const owners = [];
  const controller = createCanonicalStudioController({
    createOwner: async () => {
      const row = { starts: [], interrupts: 0, closed: 0, jobs: [] };
      owners.push(row);
      return {
        prepare: async (doc) => ({
          document: structuredClone(doc),
          playableVerified: true,
          admission: { maxOwned: 1, maxPeak: 0.2 },
          program: { rate: 48000, frames: 1200 },
          timeline: { bodyFrames: 1000 },
          dispose() {},
        }),
        resume: async () => {},
        pause: async () => {},
        start: (_, options) => {
          const ready = gate(),
            done = gate(),
            fault = gate(),
            job = {
              ready: ready.promise,
              done: done.promise,
              faulted: fault.promise,
              continuous: options.repeat,
              finishCount: 0,
              finish() {
                this.finishCount++;
              },
              readyGate: ready,
              doneGate: done,
              faultGate: fault,
            };
          row.starts.push(options);
          row.jobs.push(job);
          if (!blocked) ready.resolve();
          return job;
        },
        interrupt: async () => {
          row.interrupts++;
          for (const j of row.jobs)
            j.readyGate.reject(
              Object.assign(Error("cancelled"), { code: "cancelled" }),
            );
        },
        dispose: async () => {
          row.closed++;
          for (const j of row.jobs) j.doneGate.resolve();
        },
      };
    },
  });
  return { controller, owners };
}
test("continuous production capability stays one job; finish-off drains that job without finite restarts", async () => {
  const f = fixture();
  f.controller.setRepeat(true);
  await f.controller.play({ title: "song" });
  const o = f.owners[0],
    j = o.jobs[0];
  assert.equal(o.starts[0].repeat, true);
  f.controller.setRepeat(false);
  assert.equal(j.finishCount, 1);
  assert.equal(f.controller.snapshot().finishing, true);
  assert.throws(() => f.controller.setRepeat(true), {
    code: "canonicalRepeatFinishing",
  });
  j.doneGate.resolve();
  await tick();
  assert.equal(o.jobs.length, 1);
  assert.equal(f.controller.snapshot().status, "ended");
  assert.equal(f.controller.snapshot().pendingOwners, 0);
});
test("after-ready processor fault promptly interrupts and retires the owner without creating a replacement loop", async () => {
  const f = fixture();
  f.controller.setRepeat(true);
  await f.controller.play({ title: "song" });
  const o = f.owners[0];
  o.jobs[0].faultGate.resolve(
    Object.assign(Error("processor"), {
      code: "canonicalStreamProcessorFault",
    }),
  );
  await tick();
  assert.equal(f.controller.snapshot().status, "error");
  assert.equal(f.controller.snapshot().error, "canonicalStreamProcessorFault");
  assert.equal(o.interrupts, 1);
  assert.equal(o.closed, 1);
  assert.equal(f.controller.snapshot().pendingOwners, 0);
});
test("Stop interrupts the exclusive context before waiting for a missing ready receipt", async () => {
  const f = fixture(true);
  f.controller.setRepeat(true);
  const playing = f.controller.play({ title: "song" });
  await tick();
  assert.equal(f.owners[0].jobs.length, 1);
  await f.controller.stop();
  await assert.rejects(playing, { code: "cancelled" });
  assert.equal(f.owners[0].interrupts, 1);
  assert.equal(f.controller.snapshot().pendingOwners, 0);
});
test("seek rebuilds the same document and preserves paused intent until explicit Resume", async () => {
  const f = fixture(),
    doc = { title: "song", original: [1, 2] };
  f.controller.setRepeat(true);
  await f.controller.play(doc);
  await f.controller.pause();
  await f.controller.seek(123);
  assert.equal(f.controller.snapshot().status, "paused");
  assert.equal(f.owners[0].closed, 1);
  assert.equal(f.owners[1].starts.length, 0);
  assert.equal(f.controller.position().frame, 123);
  assert.equal(f.controller.position().started, false);
  await f.controller.resume();
  assert.equal(f.controller.snapshot().status, "playing");
  assert.equal(f.owners[1].starts[0].fromFrame, 123);
  assert.equal(f.owners[1].starts[0].repeat, true);
  assert.deepEqual(doc, { title: "song", original: [1, 2] });
  await assert.rejects(
    Promise.resolve().then(() => f.controller.seek(1000)),
    { code: "canonicalNotReady" },
  );
  await f.controller.stop();
});
