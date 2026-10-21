import { CaptureSession } from "./capture-session.js";
import {
  freezeCaptureProject,
  MasterCaptureClock,
} from "./master-capture-clock.js";
import { AudioMemory } from "../audio/audio-memory.js";
import { TakePool } from "./take-pool.js";
import { Transport } from "../audio/transport.js";
import { fail } from "../project/instrument-contract.js";
import {
  captureInputChannels,
  captureReservedBytes,
} from "./instrument-input.js";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  // Internal observers must not create unhandled rejections; callers retain the
  // original rejecting promise and can inspect the terminal outcome.
  void promise.catch(() => {});
  return { promise, resolve, reject };
};
const safe = (n) => Number.isSafeInteger(n) && n >= 0;

// INTERNAL OPT-IN ONLY. The workspace/root must dispatch rootIntent BEFORE its
// Stop/seek/import/navigation/disposal action. No default entry imports this.
// Input kinds/channels are explicitly admitted; no default Record UI.
export class RootCaptureCoordinator {
  constructor({
    root,
    enabled = false,
    registry,
    moduleURL,
    openSession = (options) => CaptureSession.open(options),
    replay = true,
  } = {}) {
    const { engine, transport, memory, pool, output, project } = root ?? {};
    const context = engine?.context;
    if (
      !enabled ||
      typeof replay !== "boolean" ||
      !context ||
      engine.transport !== transport ||
      !(transport instanceof Transport) ||
      !(memory instanceof AudioMemory) ||
      !(pool instanceof TakePool) ||
      !pool.usesMemory(memory) ||
      output?.context !== context ||
      output !== (root.captureBus ?? engine.master) ||
      (root.captureBus && typeof root.captureOutputGain !== "function") ||
      transport.running ||
      !moduleURL ||
      typeof root.headroom !== "function"
    )
      fail("invalidCaptureOwner");
    this.root = root;
    this.replay = replay;
    this.context = context;
    this.transport = transport;
    this.memory = memory;
    this.pool = pool;
    this.output = output;
    this.projectIdentity = root.projectIdentity ?? JSON.stringify;
    this.rootProjectText = this.projectIdentity(project);
    this.project = freezeCaptureProject(project, registry, context.sampleRate);
    this.clock = new MasterCaptureClock(
      context,
      transport,
      this.project,
      registry,
    );
    if (
      Math.abs(transport.beatSeconds - 60 / this.clock.master.effectiveBpm) >
      1e-10
    )
      fail("loopTempoLocked");
    this.moduleURL = moduleURL;
    this.openSession = openSession;
    this.generation = 0;
    this.admission = true;
    this.closing = false;
    this.disposed = false;
    this.disposal = null;
    this.records = new Set();
    this.retained = new Map();
    this.listeners = new Set();
    this.onContextState = () => {
      for (const r of this.records) this.trace(r, "context-state");
      if (context.state !== "running")
        void this.rootIntent("context-state").catch(() => {});
    };
    context.addEventListener("statechange", this.onContextState);
  }
  snapshot() {
    return {
      admission: this.admission,
      closing: this.closing,
      disposed: this.disposed,
      generation: this.generation,
      owners: [...this.records].map((r) => ({
        trackId: r.trackId,
        state: this.state(r),
        cancelled: r.cancelled,
        outcome: this.outcome(r),
        playbackOutcome: r.playbackOutcome,
        inputOutcome: r.inputOutcome ?? null,
        take: r.take,
        persistence: "memory-only",
      })),
      retained: [...this.retained.values()].map((x) => x.take),
      retainedOutcomes: [...this.retained.values()].map((x) => ({
        id: x.take.id,
        outcome: this.outcome(x.record),
      })),
      memory: this.memory.snapshot(),
    };
  }
  subscribe(fn) {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }
  notify() {
    for (const fn of this.listeners) {
      try {
        fn(this.snapshot());
      } catch {
        /* view owns no resources */
      }
    }
  }
  state(r) {
    if (r.cleanupError) return "closing-error";
    if (r.cleaned) return "closed";
    if (r.cancelled) return "closing";
    return r.session?.state ?? "preparing";
  }
  outcome(r) {
    const base = r.session?.outcome ?? r.outcome;
    if (!base && !r.terminalCause) return undefined;
    const frames = r.session?.acknowledgedFrames ?? base?.frames ?? 0;
    return Object.freeze({
      ...base,
      terminalCause: r.terminalCause ?? null,
      acknowledgedFrames: frames,
      acknowledgedEndFrame: r.plan.startFrame + frames,
      ...(base?.captureFault
        ? {
            captureDiagnostics: Object.freeze({
              generation: r.generation,
              sourceGeneration: r.sourceGeneration,
              plannedTransportOriginFrame: Math.round(
                r.origin * this.context.sampleRate,
              ),
              timeline: Object.freeze(
                (r.trace ?? []).map((x) => Object.freeze({ ...x })),
              ),
              droppedTraceEvents: r.traceOverflow ?? 0,
            }),
          }
        : {}),
    });
  }
  trace(r, event) {
    if (!r.trace) return;
    if (r.trace.length >= 16) {
      r.traceOverflow++;
      return;
    }
    r.trace.push({
      event,
      contextFrame: Math.round(
        this.context.currentTime * this.context.sampleRate,
      ),
      contextState: this.context.state,
      transportOriginFrame: Math.round(
        this.transport.origin * this.context.sampleRate,
      ),
      transportRunning: this.transport.running,
      inputConnected: !!r.connected,
    });
  }
  current(r) {
    return (
      !r.cancelled &&
      !this.closing &&
      !this.disposed &&
      this.admission &&
      r.generation === this.generation &&
      !this.root.engine.disposed &&
      this.projectIdentity(this.root.project) === this.rootProjectText &&
      this.root.engine.context === this.context &&
      this.transport.running &&
      this.context.state === "running" &&
      this.transport.origin === r.origin &&
      this.transport.beatSeconds === r.beatSeconds &&
      r.source.generation === r.sourceGeneration &&
      r.source.isCurrent()
    );
  }
  requireCurrent(r) {
    if (!this.current(r)) fail("captureCancelled");
  }
  requireHeadroom(r) {
    const foreign = this.root.headroom();
    const gain = this.root.captureOutputGain
      ? this.root.captureOutputGain()
      : 0.75;
    if (
      !foreign ||
      !Number.isFinite(foreign.peak) ||
      foreign.peak < 0 ||
      !safe(foreign.voices) ||
      !Number.isFinite(gain) ||
      gain < 0 ||
      foreign.peak + (this.replay ? r.source.peak * r.gain * gain : 0) > 0.95 ||
      foreign.voices + r.source.voices > 16
    )
      fail("captureHeadroom");
  }
  preflight(r, sourceBytes) {
    this.requireHeadroom(r);
    const bytes =
      this.memory.snapshot().bytes +
      sourceBytes +
      captureReservedBytes(r.channels, r.plan.endFrame - r.plan.startFrame);
    if (!safe(bytes) || bytes > this.memory.snapshot().maxBytes)
      fail("combinedMemoryLimit");
  }
  arm(
    trackId,
    {
      source,
      bars = 1,
      countInBars = 0,
      gain = 0.5,
      expectedPlan,
      alignBars = 1,
    } = {},
  ) {
    if (this.closing || this.disposed || !this.admission)
      fail("captureOwnerTerminal");
    if (
      this.root.engine.disposed ||
      this.projectIdentity(this.root.project) !== this.rootProjectText
    )
      fail("captureProjectChanged");
    if (this.records.size) fail("captureOwnerBusy");
    const channels = captureInputChannels(
      source,
      this.context,
      this.memory,
      this.transport,
    );
    if (
      typeof trackId !== "string" ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(trackId) ||
      !source ||
      source.context !== this.context ||
      source.memory !== this.memory ||
      source.sampleRate !== this.context.sampleRate ||
      source.framesPerBar !== this.project.clock.framesPerBar ||
      source.preGain !== true ||
      !/^[a-f0-9]{64}$/.test(source.referenceSHA256 ?? "") ||
      !safe(source.generation) ||
      !safe(source.estimatedBytes) ||
      !safe(source.voices) ||
      source.voices < 1 ||
      !Number.isFinite(source.peak) ||
      source.peak < 0 ||
      !Number.isFinite(gain) ||
      gain < 0 ||
      gain > 1 ||
      typeof source.prepare !== "function" ||
      typeof source.isCurrent !== "function"
    )
      fail("invalidCaptureSource");
    const plan = this.clock.plan({
      bars,
      countInBars,
      alignBars,
      leadSeconds: 0.1,
    });
    if (
      expectedPlan &&
      (plan.startFrame !== expectedPlan.startFrame ||
        plan.endFrame !== expectedPlan.endFrame ||
        plan.transportOriginFrame !== expectedPlan.transportOriginFrame)
    )
      fail("capturePlanChanged");
    const r = {
      trackId,
      source,
      gain,
      channels,
      plan,
      generation: this.generation,
      sourceGeneration: source.generation,
      origin: this.transport.origin,
      beatSeconds: this.transport.beatSeconds,
      controller: new AbortController(),
      prepared: deferred(),
      ready: deferred(),
      closed: deferred(),
      playbackFault: deferred(),
      owner: Object.freeze({ trackId, generation: this.generation }),
      cancelled: false,
      cleaned: false,
      session: null,
      take: null,
      playbackOutcome: null,
    };
    this.preflight(r, source.estimatedBytes);
    this.records.add(r); // admission/token installed before any async source/module work
    const self = this;
    r.handle = Object.freeze({
      plan,
      prepared: r.prepared.promise,
      ready: r.ready.promise,
      closed: r.closed.promise,
      playbackFault: r.playbackFault.promise,
      persistence: "memory-only",
      get state() {
        return self.state(r);
      },
      get take() {
        return r.take;
      },
      get outcome() {
        return self.outcome(r);
      },
      get acknowledgedFrames() {
        return r.session?.acknowledgedFrames ?? r.take?.frames ?? 0;
      },
      get playbackOutcome() {
        return r.playbackOutcome;
      },
      get inputOutcome() {
        return r.inputOutcome ?? null;
      },
      get node() {
        return r.session?.input ?? null;
      },
      get output() {
        return r.route ?? null;
      },
      waveform: (fromFrame = 0) => r.session?.waveform(fromFrame) ?? null,
      stop: () => {
        self.cancel(r, "track-stop");
        return r.closed.promise;
      },
    });
    if (typeof source.onFault === "function")
      r.unlistenInput = source.onFault((fault) => {
        r.inputOutcome = { ...fault };
        this.cancel(
          r,
          fault.code === "micInputLost"
            ? "micInputLost"
            : "instrumentInputLost",
        );
      });
    queueMicrotask(() => {
      void this.run(r);
    });
    this.notify();
    return r.handle;
  }
  retain(r, take) {
    if (!take || r.take) return;
    this.pool.pin(take.id, r.owner);
    r.take = take;
    this.retained.set(take.id, { take, owner: r.owner, record: r });
  }
  async run(r) {
    try {
      this.requireCurrent(r);
      r.sourceLease = await r.source.prepare({
        context: this.context,
        transport: this.transport,
        memory: this.memory,
        signal: r.controller.signal,
        plan: r.plan,
        admitVoice: () => {
          this.requireCurrent(r);
          this.requireHeadroom(r);
        },
      });
      this.requireCurrent(r);
      const lease = r.sourceLease;
      if (
        lease?.input?.context !== this.context ||
        lease.input === this.output ||
        lease.input === this.root.engine.master ||
        lease.input === this.root.engine.output ||
        lease.memory !== this.memory ||
        (r.channels === 2 &&
          r.source.kind !== "original-microphone-input" &&
          (lease.channels !== 2 ||
            lease.input.channelCount !== 2 ||
            lease.input.channelCountMode !== "explicit")) ||
        lease.generation !== r.sourceGeneration ||
        typeof lease.release !== "function" ||
        !safe(lease.startFrame) ||
        !safe(lease.endFrame) ||
        lease.endFrame <= lease.startFrame ||
        lease.startFrame > r.plan.startFrame ||
        lease.endFrame < r.plan.endFrame
      )
        fail("invalidCaptureSourceLease");
      this.preflight(r, 0);
      if (
        r.plan.startFrame <=
        Math.ceil(this.context.currentTime * this.context.sampleRate)
      )
        fail("captureStartMissed");
      r.routeLease = this.memory.reserve(8192, "root-capture-selected-route");
      // At most16 small control records fit the existing route/control allowance.
      // No audio samples, device IDs, wall-clock polling or per-quantum logging.
      r.trace = [];
      r.traceOverflow = 0;
      this.trace(r, "source-prepared");
      r.route = this.context.createGain();
      r.route.gain.value = r.gain;
      r.route.connect(this.output); // selected gain applied exactly once, never master feedback
      this.trace(r, "route-connected");
      r.session = await this.openSession({
        clock: this.clock,
        memory: this.memory,
        pool: this.pool,
        destination: r.route,
        moduleURL: this.moduleURL,
        plan: r.plan,
        channels: r.channels,
        signal: r.controller.signal,
        replayPeakLimit: r.source.replayPeakLimit,
        replay: this.replay,
      });
      // Even a construction racing cancellation is stopped/drained, never connected to input.
      this.observe(r);
      this.trace(r, "session-open");
      this.requireCurrent(r);
      // Caller peak/voices can change while the module/session opens. Its
      // memory is already reserved; readmit headroom only, without double charge.
      this.requireHeadroom(r);
      lease.input.connect(r.session.input);
      r.connected = true;
      this.trace(r, "input-connected");
      r.prepared.resolve(r.handle);
      this.notify();
    } catch (error) {
      r.error = error;
      r.prepared.reject(error);
      this.cancel(r, error.code ?? "prepare-failed");
      if (r.session) await r.session.closed;
      await this.cleanup(r);
    }
  }
  observe(r) {
    r.readyTask = r.session.ready
      .then((take) => {
        this.retain(r, take);
        if (!this.current(r)) this.cancel(r, "owner-changed");
        else if (
          r.session.outcome?.partial ||
          r.session.outcome?.reason === "takeAdoptionFailed"
        )
          this.cancel(r, r.session.outcome.reason);
        r.ready.resolve(take);
        this.notify();
      })
      .catch((error) => {
        r.error = error;
        r.ready.resolve(null);
        this.cancel(r, "take-retain-failed");
      });
    void r.session.playbackFault.then((fault) => {
      if (fault && !r.playbackOutcome) {
        r.playbackOutcome = fault;
        r.playbackFault.resolve(fault);
        this.cancel(r, "replay-fault");
      }
    });
    void r.session.closed.then(async () => {
      await r.readyTask;
      await this.cleanup(r);
    });
  }
  cancel(r, reason, cause = reason) {
    if (r.cleaned) return;
    const first = !r.cancelled;
    if (first) this.trace(r, "cancel");
    if (first)
      r.terminalCause = Object.freeze({
        intent: reason,
        code: cause,
        generation: r.generation,
        requestedFrame: Math.round(
          this.context.currentTime * this.context.sampleRate,
        ),
        acknowledgedFramesAtCancel: r.session?.acknowledgedFrames ?? 0,
      });
    r.cancelled = true; // terminal BEFORE abort/stop or subscriber reentry
    r.outcome = {
      reason,
      partial: true,
      frames: 0,
      persistence: "memory-only",
    };
    if (first) r.controller.abort();
    if (r.connected) {
      try {
        r.sourceLease.input.disconnect(r.session.input);
        r.connected = false;
        this.trace(r, "input-disconnected");
      } catch (error) {
        r.disconnectError = error;
      }
    }
    r.route?.disconnect(); // owns selected route only, never caller/foreign output
    r.session?.stop();
    if (first) this.notify();
  }
  async cleanup(r) {
    if (r.cleaned || r.cleaning) return;
    if (r.session && r.session.state !== "closed") return;
    r.cleaning = true;
    this.trace(r, "session-closed");
    try {
      if (r.readyTask) await r.readyTask;
      if (r.connected) {
        if (this.context.state !== "closed")
          r.sourceLease.input.disconnect(r.session.input);
        r.connected = false;
      }
      if (r.sourceLease && !r.sourceReleased) {
        await r.sourceLease.release();
        r.sourceReleased = true;
        this.trace(r, "source-released");
      }
      r.route?.disconnect();
      r.routeLease?.release();
      r.routeLease = null;
      r.unlistenInput?.();
      r.cleaned = true;
      r.cleanupError = null;
      this.records.delete(r);
      r.ready.resolve(r.take);
      r.playbackFault.resolve(r.playbackOutcome);
      r.closed.resolve();
    } catch (error) {
      r.cleanupError = error;
      r.closed.reject(error); // terminal; keep lease until explicit confirmed cleanup retry
    } finally {
      r.cleaning = false;
      this.notify();
    }
  }
  stopTrack(trackId) {
    const targets = [...this.records].filter((r) => r.trackId === trackId);
    for (const r of targets) this.cancel(r, "track-stop");
    return Promise.all(targets.map((r) => r.closed.promise));
  }
  rootIntent(kind, action = () => {}, cause = kind) {
    this.admission = false;
    this.generation++;
    const targets = [...this.records];
    for (const r of targets) this.cancel(r, kind, cause);
    // Caller action sees terminal admission synchronously, before its first await.
    let result;
    try {
      result = action();
    } catch (e) {
      result = Promise.reject(e);
    }
    return Promise.all([
      Promise.resolve(result),
      ...targets.map((r) => r.closed.promise),
    ]);
  }
  beginEpoch() {
    if (this.closing || this.disposed || this.records.size)
      fail("captureOwnerTerminal");
    if (
      this.root.engine.disposed ||
      this.projectIdentity(this.root.project) !== this.rootProjectText
    )
      fail("captureProjectChanged");
    this.generation++;
    this.admission = true;
    this.notify();
  }
  releaseTake(id) {
    const x = this.retained.get(id);
    if (!x || !x.record.cleaned) fail("captureTakeHeld");
    this.pool.unpin(id, x.owner);
    try {
      this.pool.release(id);
    } catch (e) {
      this.pool.pin(id, x.owner);
      throw e;
    }
    this.retained.delete(id);
  }
  handoffTake(id, owner) {
    const x = this.retained.get(id);
    if (!owner || !x || !x.record.cleaned) fail("captureTakeHeld");
    this.pool.pin(id, owner);
    this.pool.unpin(id, x.owner);
    this.retained.delete(id);
    return x.take;
  }
  retarget(output) {
    if (
      this.records.size ||
      this.retained.size ||
      output?.context !== this.context ||
      this.closing ||
      this.disposed
    )
      fail("recordBusy");
    this.output = output;
    this.root.output = this.root.captureBus = output;
  }
  dispose() {
    if (this.disposal) return this.disposal;
    this.closing = true;
    this.admission = false;
    const done = deferred();
    this.disposal = done.promise; // install before callbacks/reentrant disposal
    const operation = this.rootIntent("dispose");
    void operation
      .then(() => {
        for (const [id, x] of this.retained) {
          this.pool.unpin(id, x.owner);
          if (!this.pool.snapshot().find((t) => t.id === id)?.pins)
            this.pool.release(id);
          this.retained.delete(id);
        }
        this.context.removeEventListener("statechange", this.onContextState);
        this.disposed = true;
        done.resolve();
        this.notify();
      })
      .catch(done.reject);
    return this.disposal;
  }
  async retryCleanupAfterContextClose() {
    if (this.context.state !== "closed") fail("captureCleanupUnconfirmed");
    for (const r of [...this.records])
      if (r.cleanupError) await this.cleanup(r);
    if (this.records.size) fail("captureCleanupUnconfirmed");
    if (this.closing) {
      for (const [id, x] of this.retained) {
        this.pool.unpin(id, x.owner);
        if (!this.pool.snapshot().find((t) => t.id === id)?.pins)
          this.pool.release(id);
        this.retained.delete(id);
      }
      this.context.removeEventListener("statechange", this.onContextState);
      this.disposed = true;
    }
  }
}
