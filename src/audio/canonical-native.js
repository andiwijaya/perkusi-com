import {
  retainCanonicalScore,
  canonicalVoiceAdmission,
  canonicalPlaybackView,
  canonicalScoreFrame,
} from "./canonical-score.js";
import { buildMixGraph } from "../loop-station/mix-graph.js";
import { startPlannedVoice } from "../loop-station/planned-voice.js";
import { canonicalNativeVoice } from "./canonical-native-voice.js";
import {
  reserveCanonicalVoiceOwners,
  canonicalAllocationScope,
} from "./canonical-voice-budget.js";
import { exportScoreChunks } from "../loop-station/score-export.js";
import { createProgrammeOutputStage } from "./programme-output.js";
import { fxBytes } from "../loop-station/fx-model.js";
import { installCanonicalPrintPlayer } from "./canonical-print-voice.js";
import { canonicalPrintData } from "./canonical-playback.js";
import { fail, integer } from "../project/instrument-contract.js";

const CONTEXT_BYTES = 524288,
  PROGRAMME_BYTES = 65537 * 8 + 8192;
const graphBytes = (score, programmeGain, count) =>
  4096 +
  score.project.tracks.length * 8192 +
  fxBytes(score.project) +
  (programmeGain === null ? 0 : PROGRAMME_BYTES) +
  count * 8192 +
  score.program.events.reduce(
    (n, e) => n + (e.spec.print ? e.spec.frames * 8 + 4096 : 0),
    0,
  );
const check = (signal) => {
  if (signal?.aborted) fail("cancelled");
};
function connectOutput(context, score, memory, destination, programmeGain) {
  const graph = buildMixGraph(context, score.project, memory, destination);
  let stage = null,
    lease = null;
  try {
    if (programmeGain !== null) {
      lease = memory.reserve(
        PROGRAMME_BYTES,
        "canonical/programme-native-curve",
      );
      graph.final.disconnect();
      stage = createProgrammeOutputStage(context, graph.final);
      stage.setProgrammeGain(programmeGain);
      stage.output.connect(destination);
    }
    return {
      graph,
      release() {
        stage?.dispose();
        lease?.release();
        graph.release();
      },
    };
  } catch (e) {
    stage?.dispose();
    lease?.release();
    graph.release();
    throw e;
  }
}

// Caller-supplied factory must construct a NEW context owned exclusively here.
// No ambient/preview context is accepted, no microphone/device API is used.
export async function createCanonicalNativeSession({
  rate,
  memory,
  contextFactory,
  outputFactory,
  signal,
  printFactory = null,
} = {}) {
  if (
    ![44100, 48000].includes(rate) ||
    typeof contextFactory !== "function" ||
    typeof outputFactory !== "function"
  )
    fail("invalidCanonicalSession");
  check(signal);
  const contextLease = memory.reserve(
    CONTEXT_BYTES,
    "canonical/owned-realtime-context",
  );
  let context;
  try {
    context = contextFactory(rate);
    if (context.sampleRate !== rate) fail("takeRateMismatch");
    const printVoice =
      printFactory ?? (await installCanonicalPrintPlayer(context));
    check(signal);
    const output = await outputFactory(context);
    check(signal);
    if (output?.context !== context) fail("invalidCanonicalSession");
    return new NativeSession(context, output, memory, contextLease, printVoice);
  } catch (cause) {
    const error =
      cause instanceof Error
        ? cause
        : Object.assign(Error("canonicalInitializationFailed"), { cause });
    let pendingClose = null;
    const cleanup = () => {
      if (!pendingClose) {
        pendingClose = (async () => {
          if (context && context.state !== "closed") await context.close();
          if (context && context.state !== "closed")
            fail("canonicalContextStillOwned");
          contextLease.release();
        })();
        pendingClose.catch(() => {
          pendingClose = null;
        });
      }
      return pendingClose;
    };
    const cleanupPromise = cleanup();
    try {
      await cleanupPromise;
    } catch (cleanupError) {
      Object.assign(error, { cleanup, cleanupPromise, cleanupError });
    }
    throw error;
  }
}
class NativeSession {
  #jobs = new Set();
  #rows = new Set();
  #closed = false;
  #closing = null;
  #timer = null;
  constructor(context, output, memory, lease, printVoice) {
    this.context = context;
    this.output = output;
    this.memory = memory;
    this.lease = lease;
    this.printVoice = printVoice;
    this.createMaster = printVoice?.createMaster;
  }
  fail(error) {
    for (const job of this.#jobs) {
      job.error ??= error;
      this.#stop(job);
    }
  }
  get snapshot() {
    return Object.freeze({
      jobs: this.#jobs.size,
      voices: this.#rows.size,
      closed: this.#closed,
      state: this.context.state,
    });
  }
  setOutput(output) {
    if (
      this.#closed ||
      this.#jobs.size ||
      this.#rows.size ||
      output?.context !== this.context
    )
      fail("invalidCanonicalSessionOutput");
    this.output = output;
  }
  start(
    score,
    {
      fromFrame = 0,
      whenFrame = null,
      programmeGain = null,
      sharedMaster = false,
      signal,
    } = {},
  ) {
    if (this.#closed) fail("canonicalSessionClosed");
    check(signal);
    const originalScore = score;
    const releaseScore = retainCanonicalScore(originalScore, this.memory);
    try {
      score = canonicalPlaybackView(originalScore, fromFrame, { sharedMaster });
    } catch (e) {
      releaseScore();
      throw e;
    }
    if (
      score.program.rate !== this.context.sampleRate ||
      !integer(fromFrame, 0, score.program.frames - 1)
    ) {
      releaseScore();
      fail("invalidCanonicalSession");
    }
    const rate = this.context.sampleRate;
    let native = null,
      jobLease = null,
      publishedJob = null,
      budget = null,
      allocations = null;
    try {
      let now = Math.round(this.context.currentTime * rate);
      if (score.program.events.length > 16)
        fail("canonicalLiveNeedsCheckpoints");
      if (score.program.events.some((e) => e.spec.print) && !this.printVoice)
        fail("canonicalPrintUnavailable");
      let origin = whenFrame;
      if (
        origin !== null &&
        !integer(origin, now + Math.ceil(0.02 * rate), Number.MAX_SAFE_INTEGER)
      )
        fail("invalidCanonicalSession");
      const relative = score.program.events
        .filter((e) => e.spec.endFrame > fromFrame)
        .map((e) => ({
          ...e,
          spec: {
            ...e.spec,
            // Reserve the complete simultaneous voice/peak frontier before
            // graph construction. Its bound is independent of absolute time.
            startFrame: 0,
            endFrame: score.program.frames - fromFrame,
          },
        }));
      budget = reserveCanonicalVoiceOwners(this.memory, {
        count: relative.length,
        peak: canonicalVoiceAdmission(relative, score.project, rate).maxPeak,
        label: "native-live-job",
      });
      allocations = canonicalAllocationScope(
        this.memory,
        8192 + graphBytes(score, programmeGain, relative.length),
        "canonical/complete-live-graph-and-nodes",
      );
      jobLease = allocations.memory.reserve(8192, "canonical/live-job-control");
      native = connectOutput(
        this.context,
        score,
        allocations.memory,
        this.output,
        programmeGain,
      );
      // The running audio clock advances during graph construction (notably
      // native EQ setup). Choose the default anchor only after those effects
      // exist; an explicit caller anchor must still be safely in the future.
      now = Math.round(this.context.currentTime * rate);
      origin ??= Math.ceil((now + 0.08 * rate) / 128) * 128;
      if (
        !integer(origin, now + Math.ceil(0.02 * rate), Number.MAX_SAFE_INTEGER)
      )
        fail("invalidCanonicalSession");
      for (const e of relative) {
        e.spec.startFrame = origin;
        e.spec.endFrame = origin + score.program.frames - fromFrame;
      }
      const foreign = [];
      for (const j of this.#jobs)
        if (!j.stopped) for (const r of j.intervals) foreign.push(r);
      for (const row of this.#rows)
        if (
          row.job.stopped ||
          row.job.origin +
            row.job.score.program.frames -
            row.job.fromFrame +
            Math.ceil(0.45 * rate) <=
            now
        )
          foreign.push({
            startFrame: now,
            endFrame: row.job.stopped
              ? Math.max(
                  now + 1,
                  Math.ceil(row.voice.end * rate) + Math.ceil(0.45 * rate),
                )
              : origin + score.program.frames,
            peak: row.peak,
          });
      const nativeAdmission = canonicalVoiceAdmission(
        relative,
        score.project,
        rate,
        foreign,
      );
      let resolve, reject, reportFault;
      const faulted = new Promise((r) => {
        reportFault = r;
      });
      const done = new Promise((a, b) => {
        resolve = a;
        reject = b;
      });
      const job = {
        score,
        origin,
        fromFrame,
        next: 0,
        rows: new Set(),
        native,
        jobLease,
        releaseScore,
        budget,
        allocations,
        done,
        resolve,
        reject,
        reportFault,
        stopped: false,
        error: null,
        finished: false,
        signal,
        abort: null,
        intervals: relative.map((e) => ({
          startFrame: e.spec.startFrame - Math.ceil(0.75 * rate),
          endFrame: e.spec.endFrame + Math.ceil(0.45 * rate),
          peak: canonicalVoiceAdmission([e], score.project, rate).maxPeak,
        })),
      };
      job.abort = () => this.#stop(job, new Error("cancelled"));
      signal?.addEventListener("abort", job.abort, { once: true });
      this.#jobs.add(job);
      publishedJob = job;
      try {
        this.#tick();
      } catch (e) {
        this.#stop(job, e);
      }
      if (!this.#timer)
        this.#timer = setInterval(() => {
          try {
            this.#tick();
          } catch (e) {
            for (const j of this.#jobs) this.#stop(j, e);
          }
        }, 20);
      return Object.freeze({
        originFrame: origin,
        admission: nativeAdmission,
        backend: "immutable-native-16",
        programmeBackend: score.backend ?? "native-readers",
        fromFrame,
        done,
        faulted,
        stop: () => this.#stop(job),
        get voices() {
          return job.rows.size;
        },
        get position() {
          const frame = Math.min(
            originalScore.program.frames,
            Math.max(
              fromFrame,
              Math.round(job.native.graph.master.context.currentTime * rate) -
                origin +
                fromFrame,
            ),
          );
          return Object.freeze({
            ...canonicalScoreFrame(originalScore, frame),
            started:
              Math.round(job.native.graph.master.context.currentTime * rate) >=
              origin,
          });
        },
      });
    } catch (e) {
      if (publishedJob) this.#stop(publishedJob, e);
      else {
        native?.release();
        budget?.release();
        jobLease?.release();
        allocations?.release();
        releaseScore();
      }
      throw e;
    }
  }
  #stop(job, error = null) {
    if (job.finished || job.stopped) return;
    job.stopped = true;
    job.error ??= error;
    if (job.error) job.reportFault(job.error);
    job.releaseAfterFrame =
      Math.round((this.context.currentTime + 0.02) * this.context.sampleRate) +
      job.score.program.tailFrames;
    for (const row of job.rows)
      try {
        row.voice.stop();
      } catch (error) {
        job.error ??= error;
      }
    this.#finish(job);
  }
  #finish(job) {
    if (job.finished || [...job.rows].some((r) => !r.ended)) return;
    const rate = this.context.sampleRate,
      frame = Math.round(this.context.currentTime * rate);
    if (!this.#closed && job.stopped && frame < job.releaseAfterFrame) return;
    if (
      !this.#closed &&
      !job.stopped &&
      frame < job.origin + job.score.program.frames - job.fromFrame
    )
      return;
    if (
      !job.stopped &&
      job.next < job.score.program.events.length &&
      !this.#closed
    )
      return;
    job.finished = true;
    for (const row of job.rows) {
      row.voice.dispose();
      this.#rows.delete(row);
    }
    job.rows.clear();
    job.signal?.removeEventListener("abort", job.abort);
    job.native.release();
    job.budget.release();
    job.jobLease.release();
    job.allocations.release();
    try {
      job.releaseScore();
    } catch (error) {
      job.error ??= error;
    }
    this.#jobs.delete(job);
    if (job.error) job.reject(job.error);
    else
      job.resolve({
        frames: job.score.program.frames - job.fromFrame,
        stopped: job.stopped,
      });
    if (!this.#jobs.size && this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }
  #tick() {
    const rate = this.context.sampleRate,
      now = Math.round(this.context.currentTime * rate);
    for (const job of this.#jobs) {
      if (job.stopped) {
        this.#finish(job);
        continue;
      }
      const events = job.score.program.events;
      while (job.next < events.length && !job.initialized) {
        const e = events[job.next++],
          s = e.spec;
        if (s.endFrame <= job.fromFrame) continue;
        const from = Math.max(s.startFrame, job.fromFrame),
          whenFrame = job.origin + from - job.fromFrame;
        if (whenFrame < now - 1) fail("canonicalScheduleMissed");
        if (this.#rows.size >= 16) fail("voiceLimit");
        const row = {
          job,
          voice: null,
          startFrame: whenFrame,
          endFrame: job.origin + s.endFrame - job.fromFrame,
          peak: canonicalVoiceAdmission([e], job.score.project, rate).maxPeak,
        };
        this.#rows.add(row);
        job.rows.add(row);
        try {
          const ended = () => {
            row.ended = true;
            if (row.voice?.fault) {
              job.error ??= row.voice.fault;
              this.#stop(job);
            }
            this.#finish(job);
          };
          row.voice = s.print
            ? this.printVoice(
                job.native.graph.graphs.get(e.trackId).gain,
                s,
                whenFrame / rate,
                from,
                job.allocations.memory,
                ended,
                (error) => this.#stop(job, error),
              )
            : canonicalNativeVoice(
                this.context,
                job.native.graph.graphs.get(e.trackId).gain,
                s,
                whenFrame / rate,
                from,
                job.allocations.memory,
                ended,
              );
          if (row.voice.fault) throw row.voice.fault;
        } catch (error) {
          if (!row.voice) {
            this.#rows.delete(row);
            job.rows.delete(row);
          }
          throw error;
        }
      }
      job.initialized = true;
      this.#finish(job);
    }
  }
  async pause() {
    if (this.#closed) fail("canonicalSessionClosed");
    await this.context.suspend();
  }
  async resume() {
    if (this.#closed) fail("canonicalSessionClosed");
    await this.context.resume();
    this.#tick();
  }
  dispose() {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    for (const j of this.#jobs) this.#stop(j);
    this.#closing = (async () => {
      if (this.context.state !== "closed") await this.context.close();
      if (this.context.state !== "closed") fail("canonicalContextStillOwned");
      for (const r of [...this.#rows]) r.ended = true;
      for (const j of [...this.#jobs]) this.#finish(j);
      this.lease.release();
    })();
    this.#closing.catch(() => {
      this.#closing = null;
    });
    return this.#closing;
  }
}

export async function renderCanonicalNativeOffline(
  score,
  { memory, contextFactory, programmeGain = null, signal, fromFrame = 0 } = {},
) {
  const releaseScore = retainCanonicalScore(score, memory);
  let held = null,
    native = null,
    context = null,
    started = false,
    complete = false;
  const voices = [];
  let budget = null;
  let allocations = null;
  try {
    check(signal);
    score = canonicalPlaybackView(score, fromFrame);
    if (!integer(fromFrame, 0, score.program.frames - 1))
      fail("invalidCanonicalSession");
    const frames = score.program.frames - fromFrame;
    // Bounded initial native backend. More than16 total owners needs the later
    // checkpoint scheduler, never unrestricted offline source preallocation.
    if (score.program.events.length > 16)
      fail("canonicalOfflineNeedsCheckpoints");
    const selected = score.program.events.filter(
      (e) => e.spec.endFrame > fromFrame,
    );
    budget = reserveCanonicalVoiceOwners(memory, {
      count: selected.length,
      peak: selected.reduce(
        (n, e) =>
          n +
          canonicalVoiceAdmission([e], score.project, score.program.rate)
            .maxPeak,
        0,
      ),
      label: "native-offline-job",
    });
    if (selected.length === 1 && selected[0].spec.print)
      return await renderPrintedOffline(score, selected[0].spec.print, {
        memory,
        contextFactory,
        programmeGain,
        signal,
        fromFrame,
      });
    held = memory.reserve(
      CONTEXT_BYTES + frames * 16,
      "canonical/offline-context-output-views",
    );
    context = contextFactory(2, frames, score.program.rate);
    if (context.sampleRate !== score.program.rate) fail("takeRateMismatch");
    allocations = canonicalAllocationScope(
      memory,
      graphBytes(score, programmeGain, selected.length),
      "canonical/complete-offline-graph-and-nodes",
    );
    native = connectOutput(
      context,
      score,
      allocations.memory,
      context.destination,
      programmeGain,
    );
    for (const e of score.program.events) {
      check(signal);
      if (e.spec.endFrame <= fromFrame) continue;
      const from = Math.max(fromFrame, e.spec.startFrame);
      voices.push(
        startPlannedVoice(
          context,
          native.graph.graphs.get(e.trackId).gain,
          e.spec,
          (from - fromFrame) / score.program.rate,
          from,
          allocations.memory,
        ),
      );
    }
    started = true;
    const buffer = await context.startRendering();
    check(signal);
    complete = true;
    const lease = held;
    held = null;
    lease.resize(frames * 16);
    return Object.freeze({ buffer, dispose: () => lease.release() });
  } finally {
    if (context && !started) {
      for (const v of voices) v.stop();
      try {
        await context.startRendering();
      } catch {
        /* Await failed owner too. */
      }
    }
    for (const v of voices) v.disconnect();
    native?.release();
    allocations?.release();
    held?.release();
    budget?.release();
    releaseScore();
    void complete;
  }
}

async function renderPrintedOffline(
  score,
  token,
  { memory, contextFactory, programmeGain, signal, fromFrame },
) {
  const data = canonicalPrintData(token),
    frames = data.frames - fromFrame,
    rate = data.rate;
  const held = memory.reserve(
    frames * 16 + 4096,
    "canonical/native-print-offline-result",
  );
  let complete = false;
  try {
    const output = data.createBuffer(2, frames, rate);
    for (let at = 0; at < frames; at += 32768) {
      check(signal);
      const n = Math.min(32768, frames - at),
        spec = {
          buffer: null,
          frames: n,
          startFrame: 0,
          naturalEndFrame: n,
          endFrame: n,
          dampFrame: null,
          velocity: 1,
          scale: 4,
          pan: 0,
          peak: 0,
        };
      const simple = {
        project: score.project,
        program: { events: [{ spec }] },
      };
      const scope = canonicalAllocationScope(
        memory,
        CONTEXT_BYTES + n * 32 + graphBytes(simple, programmeGain, 1),
        "canonical/native-print-window",
      );
      let context = null,
        native = null,
        voice = null,
        pcm = null,
        started = false;
      try {
        pcm = scope.memory.reserve(
          CONTEXT_BYTES + n * 32,
          "canonical/native-window-input-output",
        );
        const input = data.createBuffer(2, n, rate);
        for (let c = 0; c < 2; c++)
          input
            .getChannelData(c)
            .set(data.channels[c].subarray(fromFrame + at, fromFrame + at + n));
        spec.buffer = input;
        context = contextFactory(2, n, rate);
        if (context.sampleRate !== rate) fail("takeRateMismatch");
        native = connectOutput(
          context,
          simple,
          scope.memory,
          context.destination,
          programmeGain,
        );
        voice = startPlannedVoice(
          context,
          native.graph.graphs.get(score.project.tracks[0].id).gain,
          spec,
          0,
          0,
          scope.memory,
        );
        started = true;
        const chunk = await context.startRendering();
        check(signal);
        for (let c = 0; c < 2; c++)
          output.getChannelData(c).set(chunk.getChannelData(c), at);
      } finally {
        if (context && !started) {
          voice?.stop();
          try {
            await context.startRendering();
          } catch {
            /* Failed native window remains unpublished. */
          }
        }
        voice?.disconnect();
        native?.release();
        pcm?.release();
        scope.release();
      }
    }
    check(signal);
    complete = true;
    return Object.freeze({
      buffer: output,
      dispose: () => held.release(),
      backend: "native-printed-windows",
    });
  } finally {
    if (!complete) held.release();
  }
}

async function canonicalScoreOutput(
  score,
  { memory, context, signal, onProgress } = {},
  measureOnly = false,
) {
  const release = retainCanonicalScore(score, memory),
    meta = {
      format: "perkusi-canonical-score",
      title: score.timeline.project.title,
      provenance: score.provenance,
      sources: score.sourceCredits,
      render: {},
    };
  try {
    const output = await exportScoreChunks(
      { project: score.project },
      score.program,
      meta,
      {
        memory,
        context,
        signal,
        onProgress,
        releaseSources: release,
        measureOnly,
      },
    );
    return Object.freeze({
      output,
      calibration: meta.render.programmeCalibration,
      metadata: meta,
    });
  } finally {
    release();
  }
}

export function exportCanonicalScoreWav(score, options) {
  return canonicalScoreOutput(score, options, false);
}

export function measureCanonicalScore(score, options) {
  return canonicalScoreOutput(score, options, true);
}
