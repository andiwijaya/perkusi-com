import {
  canonicalData,
  canonicalFrozenCopy,
} from "../project/canonical-data.js";
import { fail, integer } from "../project/instrument-contract.js";
import { canonicalPadWhenFrame } from "./canonical-pad-time.js";

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
    repeatEnabled = false,
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
      repeatEnabled,
      cycle: current?.job?.cycle ?? current?.cycle ?? 0,
      finishing: current?.finishing ?? false,
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
      // Close an exclusive native context before awaiting a worklet ready/ACK
      // action. Source/adapter retirement still waits for producer work below.
      // A failed early close is retried by the ordinary owned dispose path.
      try {
        await i.owner?.interrupt?.();
      } catch {
        /* actual dispose retries */
      }
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
      for (const a of i.auxiliary ?? []) {
        try {
          a.score.dispose();
          i.auxiliary.delete(a);
        } catch (e) {
          fault ??= e;
        }
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
  async function startJob(i, fromFrame = 0) {
    check(i);
    const job = i.owner.start(i.score, {
      fromFrame,
      signal: i.abort.signal,
      repeat: repeatEnabled,
    });
    i.job = job;
    job.faulted?.then((e) => {
      if (valid(i) && i.job === job) {
        invalidate("error");
        error = e.code ?? e.message;
        emit();
      }
    });
    await job.ready;
    check(i);
    i.cycle = (i.cycle ?? 0) + 1;
    job.done.then(
      () => {
        if (!valid(i) || i.job !== job) return;
        if (!repeatEnabled || job.continuous) {
          i.finishing = true;
          emit();
          void Promise.allSettled(
            [...i.auxiliary].map((a) => a.job?.done),
          ).then(() => {
            if (valid(i)) invalidate("ended");
          });
          return;
        }
        // Native done acknowledges the complete programme, natural tails and
        // graph/voice release. Reuse the admitted score only after that boundary.
        try {
          void startJob(i).catch((e) => {
            if (valid(i)) {
              invalidate("error");
              error = e.code ?? e.message;
              emit();
            }
          });
          emit();
        } catch (e) {
          if (valid(i)) {
            invalidate("error");
            error = e.code ?? e.message;
            emit();
          }
        }
      },
      (e) => {
        if (valid(i) && i.job === job) {
          invalidate("error");
          error = e.code ?? e.message;
          emit();
        }
      },
    );
  }
  const api = Object.freeze({
    snapshot,
    setRepeat(enabled) {
      if (closed) fail("canonicalControllerClosed");
      if (typeof enabled !== "boolean") fail("invalidCanonicalRepeat");
      if (
        enabled &&
        current?.job &&
        !current.job.continuous &&
        ["playing", "paused", "prepared"].includes(status)
      )
        fail("canonicalRepeatNeedsRestart");
      if (enabled && current?.finishing) fail("canonicalRepeatFinishing");
      repeatEnabled = enabled;
      if (!enabled && current?.job?.continuous && !current.finishing) {
        current.job.finish();
        current.finishing = true;
      }
      emit();
    },
    play(
      value,
      {
        command,
        fromFrame = 0,
        prepareOnly = false,
        pausedIntent = false,
      } = {},
    ) {
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
        document,
        intentCommand,
        fromFrame,
        id: intentGeneration,
        abort: new AbortController(),
        owner: null,
        score: null,
        capability: null,
        job: null,
        work: null,
        retirement: null,
        actions: new Set(),
        auxiliary: new Set(),
        finishing: false,
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
          repeat: repeatEnabled,
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
        if (prepareOnly && pausedIntent) {
          await i.owner.pause();
          check(i);
        }
        if (!prepareOnly) await startJob(i, fromFrame);
        check(i);
        i.capability = Object.freeze({
          generation: i.id,
          admission: i.job?.admission ?? a,
          rate: i.score.program.rate,
          frames: i.score.program.frames,
          bodyFrames:
            i.score.timeline?.bodyFrames ??
            i.score.program.bodyFrames ??
            i.score.program.frames,
          provenance: i.score.provenance,
        });
        status = prepareOnly
          ? pausedIntent
            ? "paused"
            : "prepared"
          : "playing";
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
    async startPrepared() {
      const i = current;
      if (
        !i?.capability ||
        !valid(i) ||
        !["prepared", "paused"].includes(status) ||
        i.job
      )
        fail("canonicalNotReady");
      const task = (async () => {
        await i.owner.resume();
        check(i);
        await startJob(i, i.fromFrame);
        status = "playing";
        emit();
        check(i);
        return i.capability;
      })();
      i.actions.add(task);
      try {
        return await task;
      } catch (e) {
        if (valid(i)) {
          error = e.code ?? e.message;
          status = "error";
          emit();
        }
        throw e;
      } finally {
        i.actions.delete(task);
      }
    },
    async audition(value, { quantize = false, swing = 0 } = {}) {
      if (typeof quantize !== "boolean") fail("invalidCanonicalPadGrid");
      const i = current;
      if (
        !i?.capability ||
        !valid(i) ||
        i.finishing ||
        !["playing", "prepared"].includes(status)
      )
        fail("canonicalNotReady");
      const document = canonicalFrozenCopy(value);
      const task = (async () => {
        const score = await i.owner.prepare(document, {
          signal: i.abort.signal,
          command: { kind: "once", bars: null, cycles: 1 },
          audition: true,
        });
        const a = { score, job: null };
        i.auxiliary.add(a);
        try {
          check(i);
          if (i.finishing || !["playing", "prepared"].includes(status))
            fail("canonicalNotReady");
          const admission = score.admission;
          if (
            !score.playableVerified ||
            !admission ||
            !Number.isInteger(admission.maxOwned) ||
            admission.maxOwned < 0 ||
            admission.maxOwned > 16 ||
            !Number.isFinite(admission.maxPeak) ||
            admission.maxPeak < 0 ||
            admission.maxPeak > 0.95
          )
            fail("canonicalNotAdmitted");
          a.job = i.owner.start(score, {
            signal: i.abort.signal,
            audition: true,
            whenFrame:
              quantize && status === "playing" && i.job
                ? canonicalPadWhenFrame({
                    timing: i.score.timeline.project.timing,
                    rate: i.score.program.rate,
                    swing,
                    nowFrame: Math.ceil(
                      i.owner.context.currentTime * i.score.program.rate,
                    ),
                    originFrame: i.job.originFrame,
                    fromFrame: i.job.fromFrame,
                  })
                : null,
          });
          const cleanup = () => {
            score.dispose();
            i.auxiliary.delete(a);
          };
          a.job.done.then(cleanup, cleanup).catch((e) => {
            if (valid(i)) {
              error = e.code ?? e.message;
              status = "cleanup-pending";
              emit();
            }
          });
          return a.job;
        } catch (e) {
          score.dispose();
          i.auxiliary.delete(a);
          throw e;
        }
      })();
      i.actions.add(task);
      try {
        return await task;
      } finally {
        i.actions.delete(task);
      }
    },
    pause: () => action("pause"),
    resume: () => (current?.job ? action("resume") : api.startPrepared()),
    seek(frame) {
      const i = current;
      if (
        !i?.capability ||
        !valid(i) ||
        !["playing", "paused"].includes(status) ||
        !integer(frame, 0, i.capability.bodyFrames - 1)
      )
        fail("canonicalNotReady");
      const pausedIntent = status === "paused";
      return api.play(i.document, {
        command: i.intentCommand,
        fromFrame: frame,
        prepareOnly: pausedIntent,
        pausedIntent,
      });
    },
    position() {
      if (current?.job) return current.job.position ?? null;
      if (!current?.capability || !["prepared", "paused"].includes(status))
        return null;
      return {
        ...(current.owner.position?.(current.score, current.fromFrame) ?? {
          frame: current.fromFrame,
          stage: "body",
          occurrences: [],
          nativePlacements: [],
          compositions: [],
        }),
        started: false,
      };
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
  return api;
}
