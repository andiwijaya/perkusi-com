import { createCanonicalLoopJob } from "../canonical-loop-job.js";
import {
  createAnchoredStreamQueue,
  installAnchoredStreamPlayer,
} from "./queue.mjs";
import { identity } from "./protocol.mjs";
import { fail } from "../../project/instrument-contract.js";

// Trusted factory option only; never inferred from a project, URL or storage.
// One owner/context, one generation, one main stream. No automatic fallback.
export function createExperimentalAnchoredOwner({
  session,
  memory,
  options,
} = {}) {
  if (options?.backend !== "anchored-r2-test")
    fail("experimentalStreamConfiguration");
  const fence = identity({
    runId: options.runId ?? crypto.randomUUID(),
    contextId: crypto.randomUUID(),
    nodeId: "main-stream",
    generation: options.generation,
  });
  let active = null,
    started = false,
    closed = false,
    installed = null,
    actions = Promise.resolve(),
    controlJob = null,
    controlState = null,
    controlFailure = null,
    pendingControl = null;
  const check = () => {
    if (closed || session.context.state === "closed") fail("cancelled");
    if (controlFailure) throw controlFailure;
  };
  const backend = Object.freeze({
    kind: "anchored-r2-test",
    name: "experimental-anchored-r2-continuous",
    createQueue: (args) =>
      createAnchoredStreamQueue({ ...args, identity: fence }),
  });
  function intent(options) {
    check();
    if (
      options?.audition ||
      options?.repeat !== true ||
      options?.whenFrame !== undefined
    )
      fail("experimentalStreamUnsupportedCombination");
  }
  function admit(score) {
    const placements = score.timeline.placements,
      allowed = new Set(["saron-barung", "slenthem"]);
    if (
      !score.playableVerified ||
      score.project.tracks.length > 2 ||
      !placements.length ||
      placements.length > 16 ||
      placements.some(
        (p) =>
          p.recording ||
          p.composition ||
          !p.native ||
          p.native.events.some((e) => !allowed.has(e.descriptor?.instrumentId)),
      ) ||
      placements.reduce((n, p) => n + (p.native?.voices.length ?? 0), 0) > 16 ||
      placements.reduce((n, p) => n + (p.native?.voices.length ?? 0), 0) === 0
    )
      fail("experimentalStreamProgrammeScope");
  }
  function action(method) {
    const job = active;
    const valid = () => {
      check();
      if (active !== job) fail("cancelled");
      const snapshot = job?.snapshot(),
        fault = snapshot?.fault ?? snapshot?.queue?.fault;
      if (fault) fail(fault);
      if (snapshot?.retired || snapshot?.queue?.closed) fail("cancelled");
    };
    // Only the identical tail operation coalesces: pause/resume/pause must
    // remain three ordered intentions. Never join an invalid generation.
    try {
      valid();
    } catch (error) {
      return Promise.reject(error);
    }
    if (pendingControl?.job === job && pendingControl.method === method)
      return pendingControl.promise;
    const task = actions.then(async () => {
      valid();
      if (job) await job.ready;
      valid();
      const target = method === "pause" ? "suspended" : "running";
      if (controlJob === job && controlState === target) {
        // A reached state is redundant only while the actual context agrees;
        // an external interruption/fault must never become successful no-op.
        if (session.context.state !== target)
          fail("experimentalStreamControlState");
        return;
      }
      await (job ? job[method]() : session[method]());
      valid();
      if (session.context.state !== target)
        fail("experimentalStreamControlState");
      controlJob = job;
      controlState = target;
    });
    const pending = { job, method, promise: task };
    pendingControl = pending;
    const clear = () => {
      if (pendingControl === pending) pendingControl = null;
    };
    task.then(clear, clear);
    actions = task.catch((error) => {
      controlFailure ??= error;
    });
    return task;
  }
  return Object.freeze({
    assertIntent: intent,
    async prepare(score, options) {
      intent(options);
      admit(score);
      if (started) fail("experimentalStreamNewOwnerRequired");
      installed ??= installAnchoredStreamPlayer(session.context);
      await installed;
      check();
    },
    start(score, options) {
      intent(options);
      admit(score);
      if (started) fail("experimentalStreamNewOwnerRequired");
      const job = createCanonicalLoopJob({
        score,
        memory,
        context: session.context,
        destination: options.destination,
        closeContext: () => session.dispose(),
        fromFrame: options.fromFrame ?? 0,
        signal: options.signal,
        streamBackend: backend,
      });
      started = true;
      active = job;
      controlJob = job;
      controlState = "running"; // Used only after job.ready accepts its anchor.
      job.faulted.then((error) => {
        controlFailure ??= error;
      });
      job.done.then(
        () => {
          if (active === job) active = null;
          if (controlJob === job) {
            controlJob = null;
            controlState = null;
          }
        },
        () => {
          if (active === job) active = null;
          if (controlJob === job) {
            controlJob = null;
            controlState = null;
          }
        },
      );
      return job;
    },
    pause: () => action("pause"),
    resume: () => action("resume"),
    async interrupt() {
      closed = true;
      active?.stop();
      await session.dispose();
    },
    snapshot: () => ({
      backend: backend.name,
      identity: fence,
      started,
      closed,
      active: active !== null,
    }),
  });
}
