import { Transport } from "../audio/transport.js";
import { AudioMemory } from "../audio/audio-memory.js";
import {
  STOPPED_POSITION,
  musicalPosition,
} from "../audio/playback-position.js";
import { startPlannedVoice } from "./planned-voice.js";
import { buildMixGraph } from "./mix-graph.js";
import { finalMixProgram } from "./final-program.js";
import { prepareLoopPlan, loopAdmission, loopVoiceAt } from "./plan.js";
import { recordedLoopGeometry } from "./recorded-loop.js";
import {
  prepareFiniteReaders,
  finiteReaderOutcome,
  isFiniteReaderVoice,
  softFinitePreparationFailure,
} from "./finite-reader.js";
import { validateLoopProject } from "./project.js";
import { PPQ } from "../project/instrument-project.js";
import { fail } from "../project/instrument-contract.js";
import {
  MixAutomation,
  MIX_LEAD_SECONDS,
  MIX_RAMP_SECONDS,
  MIX_GRACE_FRAMES,
} from "./mix-automation.js";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Root may own Transport; track operations never mutate it or close the caller context.
export class LoopStationSession {
  #initializingMix = false;
  #finiteReaders = null;
  #finiteEpoch = null;
  #finiteCompletion = null;
  #finiteReceipts = [];
  #finiteTail = null;
  #tailDrain = false;
  #finiteCohort = null;
  #positionBounds = new WeakMap();
  constructor({
    context,
    transport,
    memory,
    registry,
    cache,
    output,
    ownsTransport = false,
    prepare = prepareLoopPlan,
    admission = null,
    resolveRecording = null,
    wallNow = () => performance.now(),
    finiteReaderModuleURL = null,
    finiteReaderNodeFactory,
    finiteTailNodeFactory,
  }) {
    if (
      !(transport instanceof Transport) ||
      !(memory instanceof AudioMemory) ||
      output?.context !== context ||
      typeof wallNow !== "function"
    )
      fail("invalidLoopClock");
    Object.assign(this, {
      context,
      transport,
      memory,
      registry,
      cache,
      output,
      ownsTransport,
      preparePlan: prepare,
      admission,
      resolveRecording,
      wallNow,
      finiteReaderModuleURL,
      finiteReaderNodeFactory,
      finiteTailNodeFactory,
    });
    this.project = null;
    this.plan = null;
    this.finite = null;
    this.rows = new Set();
    this.graphs = new Map();
    this.finiteGraphBundle = null;
    this.mixAutomation = new MixAutomation();
    this.mixSequence = 0;
    this.mixProposals = new WeakSet();
    this.scheduledMix = null;
    this.applyingMix = null;
    this.mixProgramFault = null;
    this.cursors = [];
    this.listeners = new Set();
    this.loads = new Set();
    this.generation = 0;
    this.offset = 0;
    this.status = "stopped";
    this.error = null;
    this.timer = null;
    this.stoppedTracks = new Set();
    this.disposed = false;
    this.closing = false;
    this.disposal = null;
    this.highWater = 0;
    this.onState = () => {
      if (context.state !== "running") {
        if (this.#finiteCohort && this.admission && this.status === "playing")
          this.playbackFault({
            code:
              context.state === "closed" ? "contextClosed" : "contextSuspended",
          });
        else if (!this.#finiteCohort || this.status !== "error") this.pause();
      }
    };
    context.addEventListener("statechange", this.onState);
  }
  subscribe(fn) {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }
  notify() {
    for (const f of this.listeners) {
      try {
        f(this.snapshot());
      } catch {
        /* UI never owns resources. */
      }
    }
  }
  playhead() {
    const plan = this.plan;
    if (
      !plan ||
      this.closing ||
      this.disposed ||
      !["playing", "paused"].includes(this.status)
    )
      return STOPPED_POSITION;
    let bounds = this.#positionBounds.get(plan);
    if (!bounds) {
      bounds = { body: 0, repeats: false };
      for (const t of plan.tracks)
        for (const c of t.clips) {
          bounds.body = Math.max(
            bounds.body,
            plan.clock.frame(c.startTick + c.lengthTicks),
          );
          bounds.repeats ||= c.loop;
        }
      this.#positionBounds.set(plan, bounds);
    }
    const playing = this.status === "playing",
      start = this.transport.origin + this.offset / this.context.sampleRate,
      waiting = playing && this.context.currentTime < start,
      frame = playing
        ? Math.max(
            this.offset,
            Math.floor(
              (this.context.currentTime - this.transport.origin) *
                this.context.sampleRate,
            ),
          )
        : this.offset,
      end =
        this.finite?.bodyFrames ?? (bounds.repeats ? Infinity : bounds.body),
      tail = end > 0 && frame >= end,
      p = musicalPosition(tail ? end - 1 : frame, plan.clock.framesPerTick);
    return {
      ...p,
      frame,
      state:
        !playing || this.context.state !== "running"
          ? "paused"
          : waiting
            ? "waiting"
            : tail
              ? "tail"
              : "playing",
      ...(tail ? { step: null, phase: 1 } : waiting ? { step: null } : {}),
    };
  }
  snapshot() {
    return {
      finiteCompletion: this.#finiteCompletion
        ? {
            ...this.#finiteCompletion,
            receipts: [...this.#finiteReceipts],
            graph: this.#finiteTail?.snapshot() ?? null,
          }
        : null,
      finitePreparation: {
        state: this.#finiteReaders ? "prepared" : "unavailable",
        reason: this.finiteReaderUnavailable ?? null,
      },
      finiteCaptureBridge: !!this.#finiteCohort,
      finite: this.finite
        ? {
            bars: this.finite.bars,
            bodyFrames: this.finite.bodyFrames,
            naturalEnd: this.finite.naturalEnd,
            tailFrames: this.finite.tailFrames,
            frames: this.finite.frames,
          }
        : null,
      status: this.status,
      error: this.error,
      offsetFrame: this.offset,
      owned: this.rows.size,
      maxOwned: this.highWater,
      tracks:
        this.project?.tracks.map((t) => ({
          id: t.id,
          status: this.trackStatus(t),
          mute: t.mute,
          solo: t.solo,
        })) ?? [],
      memory: this.memory.snapshot(),
    };
  }
  trackStatus(track) {
    if (!track.clips.length || this.stoppedTracks.has(track.id))
      return "stopped";
    const cursors = this.cursors.filter((c) => c.track === track.id);
    if (
      this.status === "playing" &&
      cursors.length &&
      cursors.every((c) => c.done) &&
      ![...this.rows].some((r) => r.track === track.id)
    )
      return "finished";
    return this.status;
  }
  load(project) {
    const promise = this.prepareProject(project);
    this.loads.add(promise);
    const done = () => this.loads.delete(promise);
    void promise.then(done, done);
    return promise;
  }
  async prepareProject(project) {
    if (this.closing || this.disposed) fail("sessionDisposed");
    this.stop();
    const generation = ++this.generation,
      controller = new AbortController();
    this.loading = controller;
    this.status = "loading";
    this.error = null;
    this.notify();
    let incoming, finiteReaders;
    try {
      await this.waitVoices();
      if (controller.signal.aborted || generation !== this.generation)
        fail("cancelled");
      this.reclaimOptionalFinitePreparation("loadReplacement");
      this.#finiteTail = null;
      this.#finiteCompletion = null;
      this.#finiteReceipts = [];
      incoming = await this.preparePlan(project, {
        registry: this.registry,
        rate: this.context.sampleRate,
        cache: this.cache,
        memory: this.memory,
        signal: controller.signal,
        resolveRecording: this.resolveRecording,
        recordedLoops: true,
      });
      if (
        controller.signal.aborted ||
        generation !== this.generation ||
        this.closing ||
        this.disposed
      )
        fail("cancelled");
      this.admission?.admitOrdinary(incoming, incoming.project);
      // Only optional availability/capacity may fall back. A known bad native
      // PCM copy must never be committed or replayed through another backend.
      this.finiteReaderUnavailable = null;
      try {
        finiteReaders = await prepareFiniteReaders(
          incoming,
          this.context,
          this.memory,
          this.finiteReaderModuleURL,
          this.finiteReaderNodeFactory,
          controller.signal,
        );
      } catch (e) {
        if (controller.signal.aborted) fail("cancelled");
        if (!softFinitePreparationFailure(e)) throw e;
        this.finiteReaderUnavailable = e.code;
      }
      if (
        controller.signal.aborted ||
        generation !== this.generation ||
        this.closing ||
        this.disposed
      )
        fail("cancelled");
      this.#finiteReaders?.release();
      this.plan?.release();
      this.releaseGraphs();
      this.plan = incoming;
      this.#finiteReaders = finiteReaders;
      finiteReaders = null;
      this.#finiteCompletion = null;
      this.#finiteReceipts = [];
      incoming = null;
      this.project = this.plan.project;
      this.stoppedTracks.clear();
      this.status = "stopped";
      this.notify();
    } catch (e) {
      finiteReaders?.release();
      incoming?.release();
      if (generation === this.generation) {
        this.error = e.code ?? "audioFailed";
        this.status = "error";
        this.notify();
      }
      throw e;
    } finally {
      if (this.loading === controller) this.loading = null;
    }
  }
  releaseGraphs() {
    this.releaseFiniteGraph();
    if (this.graphBundle) {
      this.graphBundle.release();
      this.graphBundle = null;
    } else {
      for (const g of this.graphs.values()) {
        g.gain.disconnect();
        g.pan.disconnect();
        g.lease.release();
      }
      this.master?.disconnect();
      this.masterLease?.release();
    }
    this.graphs.clear();
    this.master = null;
    this.masterLease = null;
    this.mixAutomation.clear();
    this.mixProposals = new WeakSet();
    this.scheduledMix = null;
    this.applyingMix = null;
    this.mixProgramFault = null;
  }
  releaseFiniteGraph() {
    this.finiteGraphBundle?.release();
    this.finiteGraphBundle = null;
  }
  canBridgeCapture(trackId) {
    return !!(
      this.ownsTransport &&
      this.#finiteReaders?.readerCount === 2 &&
      this.#finiteReaders.tailFrames === 4800 &&
      this.#finiteReaders.supportsMix(this.project) &&
      this.project?.tracks.some((t) => t.id === trackId && !t.clips.length)
    );
  }
  hasFiniteCaptureCohort(ticket) {
    return (
      !!ticket &&
      this.#finiteCohort === ticket &&
      this.status === "playing" &&
      !this.closing &&
      !this.disposed
    );
  }
  graph() {
    if (this.master) return;
    try {
      this.graphBundle = buildMixGraph(
        this.context,
        this.project,
        this.memory,
        this.output,
      );
      this.master = this.graphBundle.master;
      this.masterLease = this.graphBundle.masterLease;
      this.graphs = this.graphBundle.graphs;
      // Immediate programs are a graph-construction capability, never edits.
      this.#initializingMix = true;
      try {
        this.applyMix(this.project, true);
      } finally {
        this.#initializingMix = false;
      }
    } catch (e) {
      this.releaseGraphs();
      throw e;
    }
  }
  prepareMixProgram(instant = false) {
    if (this.#finiteTail && this.status === "playing") fail("recordBusy");
    if (this.closing || this.disposed) fail("sessionDisposed");
    if (this.mixProgramFault || typeof instant !== "boolean")
      fail("mixProgramLate");
    const rate = this.context.sampleRate,
      requestedFrame = Math.round(this.context.currentTime * rate),
      startFrame = instant
        ? requestedFrame
        : Math.max(
            requestedFrame + Math.ceil(MIX_LEAD_SECONDS * rate),
            this.scheduledMix?.startFrame ?? 0,
          ),
      endFrame =
        startFrame + (instant ? 0 : Math.round(MIX_RAMP_SECONDS * rate)),
      program = Object.freeze({
        sequence: this.mixSequence + 1,
        generation: this.generation,
        requestedFrame,
        requestedWall: this.wallNow(),
        rate,
        startFrame,
        endFrame,
        graceFrame: endFrame + MIX_GRACE_FRAMES,
        instant,
      });
    this.mixProposals.add(program);
    return program;
  }
  checkMixDeadline(program) {
    if (
      !program.instant &&
      (Math.round(this.context.currentTime * program.rate) >=
        program.startFrame ||
        (this.context.state === "running" &&
          this.wallNow() - program.requestedWall >=
            ((program.startFrame - program.requestedFrame) / program.rate) *
              1000))
    )
      fail("mixProgramLate");
  }
  checkMixProgram(program, instant = false) {
    if (
      this.mixProgramFault ||
      !this.mixProposals.has(program) ||
      program.sequence !== this.mixSequence + 1 ||
      program.generation !== this.generation ||
      typeof instant !== "boolean" ||
      program.instant !== instant ||
      program.rate !== this.context.sampleRate ||
      program.endFrame !==
        program.startFrame +
          (instant ? 0 : Math.round(MIX_RAMP_SECONDS * program.rate)) ||
      program.graceFrame !== program.endFrame + MIX_GRACE_FRAMES ||
      (!instant && this.#initializingMix) ||
      (instant
        ? !this.#initializingMix ||
          this.scheduledMix !== null ||
          this.rows.size !== 0 ||
          program.startFrame !== program.requestedFrame ||
          program.requestedFrame !==
            Math.round(this.context.currentTime * program.rate)
        : program.startFrame <
          program.requestedFrame + Math.ceil(MIX_LEAD_SECONDS * program.rate))
    )
      fail("mixProgramLate");
    this.checkMixDeadline(program);
    this.mixAutomation.check(
      this.graphs,
      this.master,
      program.startFrame / program.rate,
    );
  }
  failMixProgram(error, program) {
    // An accepted native submission cannot be rolled back atomically. Retain
    // its safety envelope and cancel capture before stopping shared playback.
    this.mixProgramFault = { program, code: error.code ?? "audioFailed" };
    this.error = this.mixProgramFault.code;
    clearInterval(this.timer);
    this.timer = null;
    this.status = "error";
    this.admission?.mixScheduleFault(program);
    const close = async () => {
      this.pause();
      if (this.ownsTransport) this.transport.pause(this.context.currentTime);
      await this.waitVoices();
      this.admission?.finishMixScheduleFault(program);
      this.status = "error";
      this.notify();
    };
    if (this.admission) this.admission.controllerFault(error, close);
    else void close().catch(() => {});
    this.notify();
  }
  applyMix(
    project,
    instant = false,
    program = this.prepareMixProgram(instant),
  ) {
    this.checkMixProgram(program, instant);
    this.applyingMix = program;
    try {
      this.mixAutomation.apply(
        project,
        this.graphs,
        this.master,
        program.startFrame / program.rate,
        instant,
      );
      this.checkMixDeadline(program);
      this.scheduledMix = program;
      this.mixSequence = program.sequence;
      return program;
    } catch (error) {
      this.failMixProgram(error, program);
      throw error;
    } finally {
      this.applyingMix = null;
    }
  }
  setMix(project, program) {
    if (this.closing || this.disposed) fail("sessionDisposed");
    program ??= this.prepareMixProgram();
    const valid = validateLoopProject(project, this.registry);
    if (!this.plan || this.status === "loading") fail("recordBusy");
    const strip = (p) =>
      JSON.stringify({
        ...p,
        master: { ...p.master, volume: 0 },
        tracks: p.tracks.map((t) => ({
          ...t,
          gain: 0,
          pan: 0,
          mute: false,
          solo: false,
        })),
      });
    if (strip(valid) !== strip(this.project)) fail("recordBusy");
    this.liveAdmission(this.plan, valid);
    this.checkMixProgram(program, false);
    this.admission?.admitOrdinary(this.plan, valid, { mix: true, program });
    try {
      this.applyMix(valid, false, program);
    } catch (error) {
      if (!this.mixProgramFault) this.failMixProgram(error, program);
      throw error;
    }
    this.project = valid;
    this.notify();
    return valid;
  }
  play({ resume = false, bars } = {}) {
    if (this.closing || this.disposed) fail("sessionDisposed");
    if (this.mixProgramFault) fail("mixProgramLate");
    if (
      this.disposed ||
      !this.plan ||
      this.loading ||
      this.context.state !== "running"
    )
      fail("instrumentNotReady");
    if (this.status === "playing") return;
    if (this.rows.size || this.tailPending()) fail("recordBusy");
    const finite = resume
      ? this.finite
      : bars === undefined
        ? null
        : finalMixProgram(this.plan, bars, { backend: "live-readers" });
    const isolated =
      !finite ||
      (!this.admission?.claims.size &&
        !this.admission?.producers.size &&
        !this.admission?.playbacks.size &&
        !this.admission?.capture?.snapshot().owners.length &&
        !this.admission?.capture?.snapshot().retained.length);
    const cohort =
      !isolated &&
      finite &&
      this.admission?.finiteCaptureCohort?.(this, this.plan, this.project);
    let candidate = !!(
      finite &&
      this.#finiteReaders &&
      finite.tailFrames === this.#finiteReaders.tailFrames &&
      !(resume && finite.tailFrames && this.offset > 0) &&
      this.#finiteReaders.supportsMix(this.project) &&
      (isolated || cohort)
    );
    if (!candidate)
      this.reclaimOptionalFinitePreparation("unusedForRequestedMode");
    this.liveAdmission(this.plan, this.project);
    try {
      this.admission?.admitOrdinary(this.plan, this.project);
    } catch (e) {
      if (cohort) throw e;
      if (e.code !== "combinedMemoryLimit" || !this.#finiteReaders) throw e;
      this.reclaimOptionalFinitePreparation(e.code);
      candidate = false;
      this.admission?.admitOrdinary(this.plan, this.project);
    }
    if (!this.ownsTransport) {
      if (
        !this.transport.running ||
        Math.abs(
          this.transport.beatSeconds - 60 / this.plan.clock.effectiveBpm,
        ) > 1e-10
      )
        fail("loopTempoLocked");
      if (this.transport.origin < this.context.currentTime + 0.02) {
        const current = Math.max(
          0,
          Math.round(
            (this.context.currentTime + 0.1 - this.transport.origin) *
              this.context.sampleRate,
          ),
        );
        this.offset = this.plan.clock.frame(this.plan.clock.nextBar(current));
      } else this.offset = 0;
    }
    if (this.finiteGraphBundle) this.releaseFiniteGraph();
    else if (this.#finiteTail) this.releaseGraphs();
    this.finite = finite;
    this.#finiteEpoch = null;
    this.#finiteReceipts = [];
    this.#finiteCompletion = null;
    this.#finiteTail = null;
    this.#finiteCohort = null;
    this.#tailDrain = false;
    if (candidate) {
      if (resume && this.offset >= this.finite.bodyFrames)
        fail("recordingLoopCompletionUnverified");
      try {
        this.#finiteEpoch = this.#finiteReaders.begin();
        this.#finiteCompletion = {
          state: "pending",
          epoch: this.#finiteEpoch.epoch,
          readers: this.#finiteReaders.readerCount,
          tailFrames: this.#finiteReaders.tailFrames,
        };
      } catch (e) {
        if (cohort) throw e;
        if (e.code !== "combinedMemoryLimit") throw e;
        this.reclaimOptionalFinitePreparation(e.code);
        this.admission?.admitOrdinary(this.plan, this.project);
      }
    }
    try {
      // Reset native IIR history before every isolated EQ epoch, including
      // pause/resume; an old graph cannot supply an unbound residual tail.
      if (this.#finiteEpoch && finite.tailFrames && !cohort)
        this.releaseGraphs();
      this.graph();
      if (this.#finiteEpoch && cohort) {
        this.finiteGraphBundle = buildMixGraph(
          this.context,
          this.project,
          this.memory,
          this.output,
        );
        this.#finiteCohort = cohort;
      }
    } catch (e) {
      this.#finiteEpoch?.abortUnstarted();
      this.#finiteEpoch = null;
      this.releaseFiniteGraph();
      this.#finiteCohort = null;
      if (cohort) throw e;
      if (e.code !== "combinedMemoryLimit" || !this.#finiteReaders) throw e;
      this.reclaimOptionalFinitePreparation(e.code);
      this.#finiteCompletion = null;
      this.admission?.admitOrdinary(this.plan, this.project);
      this.graph();
    }
    this.error = null;
    if (!resume && this.ownsTransport) this.offset = 0;
    const rate = this.context.sampleRate;
    if (this.ownsTransport) {
      this.transport.beatSeconds = 60 / this.plan.clock.effectiveBpm;
      this.transport.position = this.plan.clock.tick(this.offset) / PPQ;
      this.transport.start(
        Math.ceil((this.context.currentTime + 0.1) * rate) / rate,
      );
      this.transport.origin =
        Math.ceil((this.context.currentTime + 0.1) * rate) / rate -
        this.offset / rate;
    } else if (!this.transport.running) fail("invalidLoopClock");
    this.status = "playing";
    if (this.#finiteEpoch && finite.tailFrames) {
      const startFrame = Math.round(this.transport.origin * rate) + this.offset;
      this.#finiteTail = this.#finiteEpoch.openTail({
        startFrame,
        bodyEndFrame:
          Math.round(this.transport.origin * rate) + finite.naturalEnd,
        endFrame: Math.round(this.transport.origin * rate) + finite.frames,
        input: (this.finiteGraphBundle ?? this.graphBundle).final,
        output: this.output,
        nodeFactory: this.finiteTailNodeFactory,
        onFault: (e) => this.playbackFault(e),
        onRelease: () => {
          this.finishVerifiedFinite();
          this.notify();
        },
      });
    }
    if (!resume) this.stoppedTracks.clear();
    this.resetCursors();
    this.timer = setInterval(() => this.pump(), 25);
    this.pump();
    this.notify();
  }
  resetCursors() {
    this.cursors = [];
    for (const t of this.plan.tracks)
      for (const c of t.clips) {
        const tick = this.plan.clock.tick(this.offset),
          back =
            Math.ceil(
              (c.maxTailFrames + Math.ceil(0.02 * this.context.sampleRate)) /
                Math.max(1, c.lengthTicks * this.plan.clock.framesPerTick),
            ) + 1,
          cycle = c.loop
            ? Math.max(
                0,
                Math.floor((tick - c.startTick) / c.lengthTicks) - back,
              )
            : 0;
        this.cursors.push({
          track: t.id,
          clip: c,
          cycle,
          index: 0,
          done: !c.voices.length,
          notBefore: this.offset,
        });
      }
  }
  liveAdmission(plan = this.plan, project = this.project, { pendingRow } = {}) {
    return loopAdmission(plan, project, {
      recordedLoops: true,
      rows: pendingRow ? [...this.rows, pendingRow] : [...this.rows],
    });
  }
  pump() {
    if (this.status !== "playing" || this.closing || this.disposed) return;
    try {
      const rate = this.context.sampleRate,
        horizon =
          (this.context.currentTime + 0.75 - this.transport.origin) * rate;
      let scheduled = 0,
        changed = false;
      for (const cursor of this.cursors) {
        if (cursor.done || this.stoppedTracks.has(cursor.track)) continue;
        const recording = recordedLoopGeometry(cursor.clip, this.plan.clock);
        if (recording) {
          const from = Math.max(cursor.notBefore, recording.startFrame);
          if (this.finite && from >= this.finite.bodyFrames) {
            cursor.done = true;
            changed = true;
            continue;
          }
          if (from >= horizon) continue;
          const when = this.transport.origin + from / rate;
          if (when < this.context.currentTime - 0.01) fail("replayLate");
          const spec = {
            ...recording.voice,
            startFrame: recording.startFrame,
            endFrame: this.finite?.bodyFrames ?? Infinity,
            dampFrame: null,
            loopFrames: recording.periodFrames,
            ...(this.finite ? { stopFrame: this.finite.bodyFrames } : {}),
          };
          this.startVoice(cursor.track, spec, when, from, cursor.clip);
          cursor.done = true; // the native reader owns every later cycle
          changed = true;
          continue;
        }
        while (!cursor.done) {
          const v = loopVoiceAt(
              this.plan.clock,
              cursor.clip,
              cursor.clip.voices[cursor.index],
              cursor.cycle,
              !!this.finite &&
                this.plan.clock.frame(
                  cursor.clip.startTick +
                    (cursor.cycle + 1) * cursor.clip.lengthTicks,
                ) >= this.finite.bodyFrames,
            ),
            from = Math.max(cursor.notBefore, v.startFrame);
          if (this.finite && v.startFrame >= this.finite.bodyFrames) {
            cursor.done = true;
            changed = true;
            break;
          }
          if (from >= horizon) break;
          cursor.index++;
          changed = true;
          if (cursor.index === cursor.clip.voices.length) {
            cursor.index = 0;
            if (cursor.clip.loop) cursor.cycle++;
            else cursor.done = true;
          }
          if (v.endFrame <= cursor.notBefore) continue;
          const when = this.transport.origin + from / rate;
          if (when < this.context.currentTime - 0.01) fail("replayLate");
          if (++scheduled > 4096) fail("voiceLimit");
          this.startVoice(cursor.track, v, when, from, cursor.clip);
        }
      }
      if (changed) this.notify();
      if (
        this.cursors.every((c) => c.done) &&
        !this.rows.size &&
        !this.#finiteCompletion &&
        !this.admission?.keepTransportRunning() &&
        (!this.finite ||
          (this.context.currentTime - this.transport.origin) * rate >=
            this.finite.frames)
      ) {
        this.pause();
        this.offset = 0;
        this.status = "stopped";
        this.notify();
      }
    } catch (e) {
      this.playbackFault(e);
    }
  }
  playbackFault(e) {
    this.error = e.code ?? "audioFailed";
    if (this.#finiteCompletion?.state === "pending")
      this.#finiteCompletion = {
        ...this.#finiteCompletion,
        state: this.error === "recordingLoopEnded" ? "fault" : "unverified",
        error: this.error,
      };
    this.#finiteEpoch?.abortUnstarted();
    const contain = () => {
      this.pause();
      // Error was published before the capture barrier. pause() must not use
      // that status to decide whether our now-contained clock should freeze.
      if (this.ownsTransport && this.transport.running) {
        this.offset = Math.max(
          0,
          Math.round(
            (this.context.currentTime - this.transport.origin) *
              this.context.sampleRate,
          ),
        );
        this.transport.pause(this.context.currentTime);
      }
      this.status = "error";
      this.notify();
    };
    if (this.admission) {
      clearInterval(this.timer);
      this.timer = null;
      this.status = "error";
      const barrier = this.admission.controllerFault(e, contain);
      this.notify();
      return barrier;
    }
    this.status = "error";
    contain();
  }
  hasFiniteWitnessReaders() {
    return (
      this.tailPending() ||
      [...this.rows].some((r) => isFiniteReaderVoice(r.voice))
    );
  }
  tailPending() {
    const s = this.#finiteTail?.snapshot();
    return !!s && !s.released;
  }
  reclaimOptionalFinitePreparation(reason = "unusedForRequestedMode") {
    if (!this.#finiteReaders) return;
    if (this.rows.size || this.status === "playing" || this.tailPending())
      fail("recordBusy");
    // release() independently refuses live/unconfirmed epochs; never a trimmer
    // for a worker, source/reference plan, or another owner's allocation.
    this.#finiteReaders.release();
    this.#finiteReaders = null;
    this.finiteReaderUnavailable = reason;
  }
  finishVerifiedFinite() {
    if (
      this.status !== "playing" ||
      this.rows.size ||
      this.#finiteCompletion?.state !== "pending" ||
      this.#finiteReceipts.length !== this.#finiteCompletion.readers ||
      this.#finiteReceipts.some((r) => r.kind !== "verified") ||
      (this.#finiteTail && this.#finiteTail.snapshot().kind !== "verified")
    )
      return;
    this.#finiteCompletion = { ...this.#finiteCompletion, state: "verified" };
    clearInterval(this.timer);
    this.timer = null;
    const keepRunning =
      !!this.#finiteCohort && this.admission?.keepTransportRunning();
    if (this.ownsTransport && !keepRunning)
      this.transport.pause(
        (this.#finiteTail?.snapshot().identity.endFrame ??
          Math.max(...this.#finiteReceipts.map((r) => r.identity.endFrame))) /
          this.context.sampleRate,
      );
    this.offset = 0;
    this.status = keepRunning ? "playing" : "stopped";
  }
  startVoice(track, v, when, from, clip) {
    if (this.rows.size >= 16) fail("voiceLimit");
    const row = { track, clip, spec: v, voice: null, stopping: false };
    this.liveAdmission(this.plan, this.project, { pendingRow: row });
    this.admission?.runtimeVoice(row);
    const release = () => {
      this.rows.delete(row);
      if (isFiniteReaderVoice(row.voice)) {
        const outcome = finiteReaderOutcome(row.voice);
        this.#finiteReceipts.push(outcome);
        if (this.#tailDrain && !this.rows.size && this.tailPending()) {
          const ends = this.#finiteReceipts.map(
            (r) => r.body?.lastWriteFrameExclusive,
          );
          if (ends.length && ends.every(Number.isSafeInteger))
            this.#finiteTail.drain(Math.max(...ends) + 4800);
          else this.#finiteTail.fade();
          this.#tailDrain = false;
        }
        if (
          !row.stopping &&
          this.status === "playing" &&
          this.context.state !== "closed"
        ) {
          if (outcome.kind === "verified") this.finishVerifiedFinite();
          else
            this.playbackFault({
              code: outcome.fault ?? "recordingLoopCompletionUnverified",
            });
        }
        this.notify();
        return;
      }
      if (
        v.loopFrames &&
        row.voice &&
        !row.stopping &&
        this.status === "playing" &&
        this.context.state !== "closed"
      )
        // onended carries no render-frame/coverage proof. Callback delivery
        // time cannot distinguish a scheduled end from earlier loss. Until
        // a completion witness exists, finite ends must stay non-successful.
        this.playbackFault({
          code:
            v.stopFrame === undefined
              ? "recordingLoopEnded"
              : "recordingLoopCompletionUnverified",
        });
      this.notify();
    };
    row.voice = this.#finiteEpoch
      ? this.#finiteEpoch.start(
          clip,
          v,
          when,
          from,
          (this.finiteGraphBundle?.graphs ?? this.graphs).get(track).gain,
          release,
          (e) => this.playbackFault(e),
        )
      : startPlannedVoice(
          this.context,
          this.graphs.get(track).gain,
          v,
          when,
          from,
          this.memory,
          release,
        );
    this.rows.add(row);
    this.highWater = Math.max(this.highWater, this.rows.size);
  }

  stopTrack(id) {
    if (!this.project?.tracks.some((t) => t.id === id))
      fail("invalidLoopTrack");
    this.stoppedTracks.add(id);
    for (const r of this.rows)
      if (r.track === id) {
        r.stopping = true;
        r.voice.stop();
      }
    this.notify();
  }
  playTrack(id) {
    if (this.closing || this.disposed) fail("sessionDisposed");
    if (
      this.status !== "playing" ||
      !this.stoppedTracks.has(id) ||
      [...this.rows].some((r) => r.track === id)
    )
      fail("recordBusy");
    this.admission?.admitOrdinary(this.plan, this.project);
    const frame = Math.max(
        0,
        Math.round(
          (this.context.currentTime + 0.1 - this.transport.origin) *
            this.context.sampleRate,
        ),
      ),
      tick = this.plan.clock.nextBar(frame),
      target = this.plan.clock.frame(tick);
    for (const c of this.cursors.filter((c) => c.track === id)) {
      c.cycle = c.clip.loop
        ? Math.max(
            0,
            Math.floor((tick - c.clip.startTick) / c.clip.lengthTicks) -
              Math.ceil(
                c.clip.maxTailFrames /
                  Math.max(
                    1,
                    c.clip.lengthTicks * this.plan.clock.framesPerTick,
                  ),
              ) -
              1,
          )
        : 0;
      c.index = 0;
      c.done = !c.clip.voices.length;
      c.notBefore = target;
    }
    this.stoppedTracks.delete(id);
    this.pump();
    this.notify();
  }
  pause() {
    this.#finiteEpoch?.abortUnstarted();
    if (this.tailPending()) {
      this.#finiteTail.markControlled();
      if (
        this.rows.size &&
        Math.round(this.context.currentTime * 48000) <
          this.#finiteTail.snapshot().identity.bodyEndFrame
      )
        this.#tailDrain = true;
      else this.#finiteTail.fade();
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.status === "playing") {
      if (this.#finiteCompletion?.state === "pending")
        this.#finiteCompletion = {
          ...this.#finiteCompletion,
          state: "controlled",
        };
      this.offset = Math.max(
        0,
        Math.round(
          (this.context.currentTime - this.transport.origin) *
            this.context.sampleRate,
        ),
      );
      if (this.ownsTransport) this.transport.pause(this.context.currentTime);
      this.status = "paused";
    }
    for (const r of this.rows) {
      r.stopping = true;
      r.voice.stop();
    }
    this.notify();
  }
  stop() {
    ++this.generation;
    this.loading?.abort();
    this.pause();
    this.offset = 0;
    this.finite = null;
    if (this.ownsTransport) this.transport.reset();
    if (!this.disposed) this.status = "stopped";
    this.notify();
  }
  async waitVoices() {
    if (this.context.state === "closed") {
      for (const r of [...this.rows]) r.voice.disconnect();
      this.#finiteTail?.disconnect();
      return;
    }
    const end = Date.now() + 900;
    while (
      (this.rows.size || this.tailPending()) &&
      this.context.state === "running" &&
      Date.now() < end
    )
      await wait(10);
    if (this.rows.size || this.tailPending()) fail("loopClosePending");
  }
  dispose() {
    if (this.disposal) return this.disposal;
    if (this.disposed) return Promise.resolve();
    // Install terminal admission and the shared operation before stop can notify
    // subscribers. Cleanup may be retried after a caller closes its context;
    // failed cleanup must never reopen playback admission.
    this.closing = true;
    const operation = Promise.resolve().then(async () => {
      this.stop();
      await Promise.allSettled([...this.loads]);
      await this.waitVoices();
      this.#finiteReaders?.release();
      this.#finiteReaders = null;
      this.plan?.release();
      this.plan = null;
      this.releaseGraphs();
      this.context.removeEventListener("statechange", this.onState);
      this.disposed = true;
      this.status = "closed";
      this.notify();
      this.listeners.clear();
    });
    this.disposal = operation;
    void operation.catch(() => {
      if (this.disposal === operation) this.disposal = null;
    });
    return operation;
  }
  async unload() {
    this.stop();
    await Promise.allSettled([...this.loads]);
    await this.waitVoices();
    this.#finiteReaders?.release();
    this.#finiteReaders = null;
    this.plan?.release();
    this.plan = null;
    this.project = null;
    this.releaseGraphs();
    this.notify();
  }
}
