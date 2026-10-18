import test from "node:test";
import assert from "node:assert/strict";
import { createCanonicalStudioController } from "../src/studio/canonical-controller.js";
import { createCanonicalStudioOwner } from "../src/studio/canonical-owner.js";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { qaBuffer } from "./helpers/canonical-score-fixtures.js";

test("real Studio owner factory retains failed adapter-construction close for acknowledged cleanup retry", async () => {
  const memory = new AudioMemory(),
    foreign = memory.reserve(313, "foreign");
  let acknowledge = false,
    error;
  const context = {
    sampleRate: 48000,
    state: "running",
    createBuffer: qaBuffer,
    async close() {
      if (!acknowledge) throw Error("close failed");
      this.state = "closed";
    },
  };
  try {
    await createCanonicalStudioOwner({
      rate: 48000,
      memory,
      contextFactory: () => context,
      outputFactory: () => ({ context }),
      resolveUrl: null,
    });
  } catch (e) {
    error = e;
  }
  assert.equal(typeof error.cleanup, "function");
  assert.equal(memory.snapshot().bytes, 524601);
  acknowledge = true;
  await error.cleanup();
  assert.equal(memory.snapshot().bytes, 313);
  foreign.release();
});
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((a, b) => {
      resolve = a;
      reject = b;
    });
    return { promise, resolve, reject };
  },
  tick = () => new Promise((r) => setImmediate(r));
function fixture(observer = null) {
  const rows = [],
    states = [];
  const controller = createCanonicalStudioController({
    onChange: (s) => {
      states.push(s);
      observer?.(s, controller);
    },
    createOwner: async () => {
      const prepare = deferred(),
        resume = deferred(),
        done = deferred(),
        close = deferred(),
        row = {
          prepare,
          resume,
          done,
          close,
          documents: [],
          released: 0,
          starts: 0,
          closed: 0,
          exports: [],
        };
      rows.push(row);
      row.score = {
        playableVerified: true,
        admission: { maxOwned: 2, maxPeak: 0.2 },
        program: { rate: 48000, frames: 2048 },
        provenance: "trusted-test-factory",
        dispose() {
          row.released++;
        },
      };
      return {
        prepare: async (d) => {
          row.documents.push(d);
          await prepare.promise;
          return row.score;
        },
        resume: () => resume.promise,
        pause: async () => {},
        start() {
          row.starts++;
          return {
            done: done.promise,
            admission: row.score.admission,
            position: { frame: 137 },
          };
        },
        exportWav: (_, options) => {
          const x = deferred();
          row.exports.push({ ...x, options });
          return x.promise;
        },
        dispose: async () => {
          row.closed++;
          await close.promise;
        },
      };
    },
  });
  return { controller, rows, states };
}
for (const method of ["stop", "edited", "dispose"])
  test(`observer ${method} during initial Play transition wins before owner construction`, async () => {
    let once = false,
      acknowledgement;
    const f = fixture((s, c) => {
        if (!once && s.status === "preparing" && s.pendingOwners === 0) {
          once = true;
          acknowledgement = c[method]();
        }
      }),
      play = f.controller.play({ title: "outer" });
    await assert.rejects(play, (e) => e.code === "cancelled");
    await acknowledgement;
    await tick();
    assert.equal(f.rows.length, 0);
    assert.equal(f.controller.snapshot().pendingOwners, 0);
    assert.equal(f.controller.snapshot().capability, null);
    assert.equal(
      f.controller.snapshot().status,
      method === "dispose" ? "closed" : "idle",
    );
  });
test("observer newer Play retains its own generation and cannot be overwritten by outer Play", async () => {
  let once = false,
    newer;
  const f = fixture((s, c) => {
      if (!once && s.status === "preparing" && s.pendingOwners === 0) {
        once = true;
        newer = c.play({ title: "newer" });
      }
    }),
    outer = f.controller.play({ title: "outer" });
  await assert.rejects(outer, (e) => e.code === "cancelled");
  await tick();
  assert.equal(f.rows.length, 1);
  const row = f.rows[0];
  assert.equal(row.documents[0].title, "newer");
  row.prepare.resolve();
  row.resume.resolve();
  const capability = await newer;
  assert.equal(capability.generation, 2);
  assert.equal(f.controller.snapshot().capability, capability);
  assert.equal(row.starts, 1);
  row.close.resolve();
  await f.controller.stop();
  assert.equal(f.controller.snapshot().pendingOwners, 0);
});
test("observer Stop after intent registration acknowledges only after that exact intent settles", async () => {
  let once = false,
    acknowledgement;
  const f = fixture((s, c) => {
      if (!once && s.status === "preparing" && s.pendingOwners === 1) {
        once = true;
        acknowledgement = c.stop();
      }
    }),
    play = f.controller.play({});
  await assert.rejects(play, (e) => e.code === "cancelled");
  await acknowledgement;
  await tick();
  assert.equal(f.rows.length, 0);
  assert.equal(f.controller.snapshot().pendingOwners, 0);
});
async function admit(
  f,
  document = { title: "original", origins: [{ id: "untouched" }] },
) {
  const task = f.controller.play(document);
  await tick();
  const row = f.rows.at(-1);
  row.prepare.resolve();
  row.resume.resolve();
  const cap = await task;
  return { row, cap };
}
test("controller publishes only after prepare/resume/start and snapshots without touching document/history/origins", async () => {
  const f = fixture(),
    document = { title: "original", origins: [{ id: "untouched" }] },
    task = f.controller.play(document);
  document.title = "owner edit";
  await tick();
  const row = f.rows[0];
  assert.equal(f.controller.snapshot().capability, null);
  assert.equal(row.documents[0].title, "original");
  assert.ok(Object.isFrozen(row.documents[0].origins[0]));
  assert.equal(Object.isFrozen(document), false);
  row.prepare.resolve();
  await tick();
  assert.equal(row.starts, 0);
  row.resume.resolve();
  const cap = await task;
  assert.equal(cap.admission.maxOwned, 2);
  assert.equal(f.controller.position().frame, 137);
  assert.equal(document.title, "owner edit");
  const stop = f.controller.stop();
  assert.equal(f.controller.snapshot().capability, null);
  await tick();
  assert.equal(row.closed, 1);
  assert.equal(row.released, 1);
  row.close.resolve();
  await stop;
  assert.equal(f.controller.snapshot().pendingOwners, 0);
});
test("replacement invalidates first and late preparation cannot publish/start or close a newer owner", async () => {
  const f = fixture(),
    a = f.controller.play({ title: "a" });
  await tick();
  const old = f.rows[0],
    b = f.controller.play({ title: "b" });
  await tick();
  const next = f.rows[1];
  next.prepare.resolve();
  next.resume.resolve();
  const cap = await b;
  old.prepare.resolve();
  old.resume.resolve();
  await assert.rejects(a, (e) => e.code === "cancelled");
  await tick();
  assert.equal(old.starts, 0);
  assert.equal(old.released, 1);
  assert.equal(f.controller.snapshot().capability, cap);
  old.close.resolve();
  await tick();
  assert.equal(next.closed, 0);
  next.close.resolve();
  await f.controller.dispose();
  assert.equal(f.controller.snapshot().pendingOwners, 0);
});
test("stop/dispose during pending resume keeps ownership until resume and actual close settle", async () => {
  const f = fixture(),
    task = f.controller.play({});
  await tick();
  const row = f.rows[0];
  row.prepare.resolve();
  await tick();
  let settled = false;
  const close = f.controller.dispose().then(() => (settled = true));
  await tick();
  assert.equal(settled, false);
  assert.equal(row.closed, 0);
  row.resume.resolve();
  await assert.rejects(task);
  await tick();
  assert.equal(row.starts, 0);
  assert.equal(row.closed, 1);
  assert.equal(settled, false);
  row.close.resolve();
  await close;
  assert.equal(settled, true);
  assert.throws(
    () => f.controller.play({}),
    (e) => e.code === "canonicalControllerClosed",
  );
});
test("admission failure leaves input intact and drains only the failed owner", async () => {
  const f = fixture(),
    document = { history: ["kept"], origins: [1] },
    before = JSON.stringify(document),
    task = f.controller.play(document);
  await tick();
  const row = f.rows[0];
  row.score.admission = { maxOwned: 17, maxPeak: 0.1 };
  row.prepare.resolve();
  await assert.rejects(task, (e) => e.code === "canonicalNotAdmitted");
  await tick();
  assert.equal(row.starts, 0);
  assert.equal(JSON.stringify(document), before);
  row.close.resolve();
  await f.controller.stop();
  assert.equal(f.controller.snapshot().pendingOwners, 0);
});
test("independent exports preserve separate abort signals across edit invalidation", async () => {
  const f = fixture(),
    { row } = await admit(f),
    a = new AbortController(),
    b = new AbortController(),
    x = f.controller.exportWav({ signal: a.signal }),
    y = f.controller.exportWav({ signal: b.signal });
  a.abort();
  assert.equal(row.exports[0].options.signal.aborted, true);
  assert.equal(row.exports[1].options.signal.aborted, false);
  const edit = f.controller.edited();
  assert.equal(b.signal.aborted, false);
  row.exports[0].reject(Error("cancelled"));
  await assert.rejects(x);
  row.exports[1].resolve("second export");
  assert.equal(await y, "second export");
  row.close.resolve();
  await edit;
});
test("failed actual close remains owned and explicit stop retries cleanup", async () => {
  const f = fixture(),
    { row } = await admit(f),
    close = f.controller.stop();
  row.close.reject(Error("close failed"));
  await assert.rejects(close);
  await tick();
  assert.equal(f.controller.snapshot().status, "cleanup-pending");
  assert.equal(f.controller.snapshot().pendingOwners, 1);
  // An injected owner must itself support retries; replace only its close gate.
  row.close.promise = Promise.resolve();
  await f.controller.stop();
  assert.equal(row.closed, 2);
  assert.equal(f.controller.snapshot().pendingOwners, 0);
});
test("dispose before factory scheduling creates no context and stale capability observer cannot return success", async () => {
  const f = fixture(),
    task = f.controller.play({});
  const close = f.controller.dispose();
  await assert.rejects(task);
  await close;
  assert.equal(f.rows.length, 0);
});

test("controller retains a failed-construction cleanup capability until an acknowledged retry", async () => {
  let acknowledged = false,
    attempts = 0;
  const error = Object.assign(Error("construction failed"), {
    cleanup: async () => {
      attempts++;
      if (!acknowledged) throw Error("close still failed");
    },
  });
  const controller = createCanonicalStudioController({
    createOwner: async () => {
      throw error;
    },
  });
  await assert.rejects(controller.play({}), /construction failed/);
  await tick();
  assert.equal(controller.snapshot().status, "cleanup-pending");
  assert.equal(controller.snapshot().pendingOwners, 1);
  assert.equal(attempts, 1);
  acknowledged = true;
  await controller.stop();
  assert.equal(attempts, 2);
  assert.equal(controller.snapshot().pendingOwners, 0);
});
