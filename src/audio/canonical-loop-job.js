import { createCanonicalLoopProgram } from "./canonical-loop-program.js";
import { createCanonicalStreamQueue } from "./canonical-stream-queue.js";
import { reserveCanonicalVoiceOwners } from "./canonical-voice-budget.js";
import { canonicalScoreFrame } from "./canonical-score.js";
import { fail, integer } from "../project/instrument-contract.js";
import { renderYield } from "./frame-dsp.js";

// Exclusive-session owner adapter. Notification never implies retirement:
// faults close the owned context, then drain the actual producer/queue before
// relinquishing original source loans, logical frontier and native allocations.
export function createCanonicalLoopJob({
  score,
  memory,
  context,
  destination,
  closeContext,
  fromFrame = 0,
  signal,
  streamBackend = null,
} = {}) {
  if (
    typeof closeContext !== "function" ||
    !integer(fromFrame, 0, score.timeline.bodyFrames - 1) ||
    (streamBackend !== null &&
      (streamBackend.kind !== "anchored-r2-test" ||
        typeof streamBackend.createQueue !== "function"))
  )
    fail("invalidCanonicalSession");
  const abort = new AbortController(),
    onAbort = () => abort.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) abort.abort();
  let loop,
    budget,
    queue,
    origin = null,
    finish = null,
    finishRequested = false,
    fault = null,
    closing = null,
    retiring = null,
    retired = false,
    resolveFault;
  const faulted = new Promise((resolve) => {
    resolveFault = resolve;
  });
  const check = () => {
    if (abort.signal.aborted) fail("cancelled");
  };
  function notify(error) {
    fault ??= error;
    resolveFault(fault);
  }
  function close() {
    if (!closing) {
      closing = Promise.resolve()
        .then(closeContext)
        .then(() => {
          if (context.state !== "closed") fail("canonicalContextStillOwned");
        });
      closing.catch(() => {
        closing = null;
      });
    }
    return closing;
  }
  async function bounded(promise, ms, code) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(Object.assign(Error(code), { code })),
            ms,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  const work = Promise.resolve().then(async () => {
    check();
    loop = createCanonicalLoopProgram(score, { memory });
    budget = reserveCanonicalVoiceOwners(memory, {
      count: loop.admission.maxOwned,
      peak: loop.admission.maxPeak,
      label: "continuous-song-source-frontier",
    });
    let skipLease;
    try {
      if (fromFrame) {
        skipLease = memory.reserve(
          32768,
          "canonical/seek-state-reconstruction",
        );
        const out = [new Float32Array(4096), new Float32Array(4096)];
        let n = 0;
        while (n < fromFrame) {
          check();
          const count = Math.min(4096, fromFrame - n),
            r = loop.renderInto(out.map((c) => c.subarray(0, count)));
          if (r.frames !== count) fail("canonicalLoopProducerCoordinates");
          n += count;
          if (n % 131072 === 0) await renderYield();
        }
      }
    } finally {
      skipLease?.release();
    }
    check();
    queue = (streamBackend?.createQueue ?? createCanonicalStreamQueue)({
      context,
      destination,
      memory,
      signal: abort.signal,
      ...(streamBackend ? { programmeOffset: fromFrame } : {}),
      produce: (out, { from }) => {
        check();
        const r = loop.renderInto(out);
        if (r.from !== from + fromFrame || r.frames !== out[0].length)
          fail("canonicalLoopProducerCoordinates");
      },
    });
    queue.faulted.then((error) => {
      notify(error);
      if (error.code !== "cancelled") void close().catch(() => {});
    });
    await bounded(queue.ready, 5000, "canonicalStreamReadyDeadline");
    check();
    if (streamBackend) {
      const acceptedOrigin = await bounded(
        Promise.resolve(queue.start()),
        1000,
        "canonicalStreamArmDeadline",
      );
      check();
      if (!integer(acceptedOrigin, 0, Number.MAX_SAFE_INTEGER))
        fail("canonicalLoopStartCoordinates");
      origin = acceptedOrigin;
    } else origin = queue.start();
    await bounded(queue.armedReady, 1000, "canonicalStreamArmDeadline");
    check();
    if (finishRequested) finishNow();
  });
  function finishNow() {
    finish = loop.finish();
    queue.finishAt(finish.frames - fromFrame);
    return finish;
  }
  async function retire() {
    if (retired) return;
    if (retiring) return retiring;
    retiring = (async () => {
      await work.catch(() => {});
      await queue?.dispose();
      loop?.dispose();
      budget?.release();
      signal?.removeEventListener("abort", onAbort);
      retired = true;
    })();
    retiring.catch(() => {
      retiring = null;
    });
    return retiring;
  }
  const done = (async () => {
    try {
      await work;
      const receipt = await queue.done;
      await retire();
      return receipt;
    } catch (error) {
      notify(error);
      await close();
      await retire();
      throw fault;
    }
  })();
  work.catch((error) => {
    notify(error);
    void close().catch(() => {});
  });
  done.catch(() => {});
  return Object.freeze({
    ready: work,
    done,
    faulted,
    continuous: true,
    backend: streamBackend?.name ?? "native-clock-bounded-continuous",
    fromFrame,
    get originFrame() {
      return origin;
    },
    get admission() {
      return loop?.admission ?? score.admission;
    },
    get cycle() {
      return origin === null
        ? 1
        : Math.floor(
            loop.clock.tick(
              Math.max(
                fromFrame,
                Math.round(context.currentTime * context.sampleRate) -
                  origin +
                  fromFrame,
              ),
            ) / loop.periodTicks,
          ) + 1;
    },
    get position() {
      if (origin === null) return null;
      const absolute = Math.max(
          fromFrame,
          Math.round(context.currentTime * context.sampleRate) -
            origin +
            fromFrame,
        ),
        tick = loop.clock.tick(absolute),
        cycle = Math.floor(tick / loop.periodTicks),
        frame = Math.min(
          score.program.frames - 1,
          loop.clock.frame(tick - cycle * loop.periodTicks),
        );
      const position = canonicalScoreFrame(score, frame);
      return Object.freeze({
        ...position,
        phases: loop.phasesAt(position.phases, absolute),
        absoluteFrame: absolute,
        cycle: cycle + 1,
        started: context.currentTime * context.sampleRate >= origin,
        ...(finish && absolute >= finish.bodyFrames
          ? {
              stage: "natural-tail",
              occurrences: [],
              nativePlacements: [],
              compositions: [],
            }
          : {}),
      });
    },
    finish() {
      if (finish || finishRequested) fail("canonicalNotReady");
      if (!queue || origin === null) {
        if (!streamBackend) fail("canonicalNotReady");
        check();
        finishRequested = true;
        return null;
      }
      return finishNow();
    },
    ...(streamBackend
      ? {
          async pause() {
            await work;
            check();
            await queue.pause();
            check();
          },
          async resume() {
            await work;
            check();
            await queue.resume();
            check();
          },
        }
      : {}),
    stop() {
      abort.abort();
      queue?.stop();
    },
    snapshot: () => ({
      queue: queue?.snapshot() ?? null,
      producer: loop?.snapshot() ?? null,
      retired,
      fault: fault?.code ?? fault?.message ?? null,
      finish,
    }),
    async dispose() {
      abort.abort();
      await close();
      await retire();
    },
  });
}
