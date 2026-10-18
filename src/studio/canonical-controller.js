import {
  canonicalData,
  canonicalFrozenCopy,
} from "../project/canonical-data.js";
import { fail } from "../project/instrument-contract.js";

// Injected only. Owns admitted capabilities, never the editor document/history.
// A factory must retain its real resources until its dispose acknowledges close.
export function createCanonicalStudioController({
  createOwner,
  onChange = () => {},
} = {}) {
  if (typeof createOwner !== "function") fail("invalidCanonicalController");
  let generation = 0,
    current = null,
    closed = false,
    status = "idle",
    error = null;
  const owners = new Set(),
    retiring = new Set();
  const snapshot = () =>
    Object.freeze({
      generation,
      status,
      error,
      capability: current?.capability ?? null,
      pendingOwners: owners.size,
      closed,
    });
  const emit = () => {
    try {
      onChange(snapshot());
    } catch {
      /* Observer cannot change ownership. */
    }
  };
  const valid = (i) =>
    !closed && generation === i.id && current === i && !i.abort.signal.aborted;
  const check = (i) => {
    if (!valid(i)) fail("cancelled");
  };
  function retire(i) {
    if (i.retirement) return i.retirement;
    i.abort.abort();
    i.retirement = (async () => {
      await i.work?.catch(() => {});
      await Promise.allSettled([...i.actions]);
      let fault;
      try {
        i.score?.dispose();
      } catch (e) {
        fault = e;
      }
      try {
        if (i.owner) await i.owner.dispose();
        else await i.constructionCleanup?.();
      } catch (e) {
        fault ??= e;
      }
      if (fault) throw fault;
      owners.delete(i);
    })();
    retiring.add(i.retirement);
    i.retirement.then(
      () => {
        retiring.delete(i.retirement);
        emit();
      },
      (e) => {
        retiring.delete(i.retirement);
        i.retirement = null;
        error = e.code ?? e.message;
        status = "cleanup-pending";
        emit();
      },
    );
    return i.retirement;
  }
  function invalidate(next) {
    const invalidatedGeneration = ++generation;
    const old = current;
    current = null;
    status = next;
    error = null;
    if (old) {
      old.abort.abort();
      retire(old);
    }
    emit();
    return invalidatedGeneration;
  }
  async function drain() {
    const results = await Promise.allSettled([...owners].map(retire));
    const fault = results.find((r) => r.status === "rejected");
    if (fault) throw fault.reason;
  }
  function action(name) {
    const i = current;
    if (!i?.capability || !valid(i))
      return Promise.reject(Error("canonicalNotReady"));
    const task = (async () => {
      check(i);
      await i.owner[name]();
      check(i);
      status = name === "pause" ? "paused" : "playing";
      emit();
      check(i);
    })();
    i.actions.add(task);
    task.then(
      () => i.actions.delete(task),
      (e) => {
        i.actions.delete(task);
        if (valid(i)) {
          invalidate("error");
          error = e.code ?? e.message;
          emit();
        }
      },
    );
    return task;
  }
  return Object.freeze({
    snapshot,
    play(value, { command, fromFrame = 0 } = {}) {
      if (closed) fail("canonicalControllerClosed");
      if (status === "cleanup-pending") fail("canonicalCleanupPending");
      // Snapshot before the first await; caller's document remains authoritative.
      canonicalData(value);
      canonicalData(command ?? null);
      const document = canonicalFrozenCopy(value),
        intentCommand = canonicalFrozenCopy(
          command ?? { kind: "once", bars: null, cycles: 1 },
        );
      const intentGeneration = invalidate("preparing");
      // Observer notifications can synchronously Stop/edit/dispose or start a
      // newer Play. This call must never borrow that later transaction's ID.
      if (closed || generation !== intentGeneration || current !== null)
        return Promise.reject(
          Object.assign(Error("cancelled"), { code: "cancelled" }),
        );
      const i = {
        id: intentGeneration,
        abort: new AbortController(),
        owner: null,
        score: null,
        capability: null,
        job: null,
        work: null,
        retirement: null,
        actions: new Set(),
      };
      owners.add(i);
      current = i;
      i.work = Promise.resolve().then(async () => {
        check(i);
        i.owner = await createOwner({
          signal: i.abort.signal,
          generation: i.id,
        });
        check(i);
        i.score = await i.owner.prepare(document, {
          signal: i.abort.signal,
          command: intentCommand,
        });
        check(i);
        const a = i.score.admission;
        if (
          !i.score.playableVerified ||
          !a ||
          !Number.isInteger(a.maxOwned) ||
          a.maxOwned < 0 ||
          a.maxOwned > 16 ||
          !Number.isFinite(a.maxPeak) ||
          a.maxPeak < 0 ||
          a.maxPeak > 0.95
        )
          fail("canonicalNotAdmitted");
        await i.owner.resume();
        check(i);
        i.job = i.owner.start(i.score, { fromFrame, signal: i.abort.signal });
        i.job.done.then(
          () => {
            if (valid(i)) invalidate("ended");
          },
          (e) => {
            if (valid(i)) {
              invalidate("error");
              error = e.code ?? e.message;
              emit();
            }
          },
        );
        check(i);
        i.capability = Object.freeze({
          generation: i.id,
          admission: i.job.admission ?? a,
          rate: i.score.program.rate,
          frames: i.score.program.frames,
          provenance: i.score.provenance,
        });
        status = "playing";
        error = null;
        emit();
        check(i);
        return i.capability;
      });
      i.work.catch((e) => {
        if (typeof e.cleanup === "function") i.constructionCleanup = e.cleanup;
        if (valid(i)) {
          current = null;
          status = "error";
          error = e.code ?? e.message;
          emit();
        }
        retire(i);
      });
      emit();
      return i.work;
    },
    pause: () => action("pause"),
    resume: () => action("resume"),
    position() {
      return current?.job?.position ?? null;
    },
    exportWav({ signal, onProgress } = {}) {
      const i = current;
      if (!i?.capability || !valid(i)) fail("canonicalNotReady");
      // Export owns an independent retained score/abort. Play/Stop cannot cancel it.
      return i.owner.exportWav(i.score, { signal, onProgress });
    },
    stop() {
      invalidate("idle");
      return drain();
    },
    edited() {
      invalidate("idle");
      return drain();
    },
    dispose() {
      closed = true;
      invalidate("closed");
      return drain();
    },
  });
}
