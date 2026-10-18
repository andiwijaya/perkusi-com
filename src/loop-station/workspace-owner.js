import { AudioMemory } from "../audio/audio-memory.js";
import { isProgrammeOutputStage } from "../audio/programme-output.js";
import { CaptureSession } from "./capture-session.js";
import { RootCaptureCoordinator } from "./capture-coordinator.js";
import { TakePool } from "./take-pool.js";
import { loopAdmission } from "./plan.js";
import { portableRecordingAdmission } from "./final-program.js";
import { panPeakFactor } from "./pan-headroom.js";
import { fail } from "../project/instrument-contract.js";
import {
  captureInputChannels,
  captureReservedBytes,
  createLiveInstrumentInput,
  activateInstrumentMonitor,
  closeInstrumentMonitor,
} from "./instrument-input.js";
import { instrumentVoice } from "../audio/instrument-voice.js";
import { eqBound, fxBytes } from "./fx-model.js";
import { overdubBase, admitOverdubBytes } from "./overdub.js";
import { MicInput } from "./mic-input.js";
import {
  createMicSource,
  retireMicPreparation,
  setMicMonitor,
  MIC_MONITOR_PEAK,
} from "./mic-source.js";

const safe = (n) => Number.isSafeInteger(n) && n >= 0;
const caught = (p) => {
  void p.catch(() => {});
  return p;
};
// Only mix fields may change under a frozen capture epoch. Imports, source text,
// clocks, track IDs and clip topology remain part of the identity.
export const captureProjectIdentity = (p) =>
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
const audibleGain = (p, t) =>
  t.mute || (p.tracks.some((x) => x.solo) && !t.solo) ? 0 : t.gain;
function envelope(a, b) {
  if (!b) return a;
  if (captureProjectIdentity(a) !== captureProjectIdentity(b))
    fail("captureProjectChanged");
  return {
    ...a,
    master: { ...a.master, volume: Math.max(a.master.volume, b.master.volume) },
    tracks: a.tracks.map((t) => {
      const old = b.tracks.find((x) => x.id === t.id);
      return {
        ...t,
        gain: Math.max(audibleGain(a, t), audibleGain(b, old)),
        pan: t.pan || old.pan ? 1 : 0,
        mute: false,
        solo: false,
      };
    }),
  };
}

// The local workspace's single dispatcher and admission frontier. Capture stays
// internal/injected; explicit stereo capabilities add no Record UI.
export class WorkspaceAudioOwner {
  #bridge = null;
  #cohort = null;
  constructor({ memory, getProject }) {
    if (!(memory instanceof AudioMemory) || typeof getProject !== "function")
      fail("invalidCaptureOwner");
    this.memory = memory;
    this.getProject = getProject;
    this.pool = new TakePool(memory);
    this.claims = new Set();
    this.producers = new Map();
    this.playbacks = new Set();
    this.renders = new Set();
    this.savedBarriers = new Set();
    this.boundaries = new Set();
    this.generation = 0;
    this.version = 0;
    this.capture = null;
    this.mixFrontier = null;
    this.terminal = false;
    this.disposal = null;
    this.micInput = null;
    this.micStatus = "off";
  }
  attach(engine, controller) {
    if (
      this.engine ||
      controller.memory !== this.memory ||
      controller.transport !== engine.transport ||
      controller.output !== engine.master
    )
      fail("invalidCaptureOwner");
    this.engine = engine;
    this.controller = controller;
    engine.contextStateBoundary = (action) => {
      if (
        !controller.snapshot().finiteCaptureBridge ||
        (!this.controllerBarrier && controller.status !== "playing")
      )
        return action();
      const boundary =
        this.controllerBarrier ??
        controller.playbackFault({
          code:
            engine.context.state === "closed"
              ? "contextClosed"
              : "contextSuspended",
        });
      void boundary.then(action).catch(() => {});
    };
  }
  engineGain() {
    const e = this.engine,
      value = e?.master?.gain.value;
    if (
      !e ||
      (e.outputStage && !isProgrammeOutputStage(e.outputStage)) ||
      e.output !== (e.outputStage?.output ?? e.master) ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 1 ||
      !Number.isFinite(e.volume) ||
      e.volume < 0 ||
      e.volume > 1
    )
      fail("invalidCaptureGainChain");
    // The workspace fixes this stage to1. Existing generic engine callers keep
    // their own policy; never reuse MASTER_MAX=.75 for the workspace graph.
    return Math.max(value, e.volume);
  }
  mixProject(plan, project) {
    const f = this.mixFrontier;
    return f?.plan === plan &&
      (f.fault || this.engine.context.currentTime < f.until)
      ? envelope(project, f.project)
      : project;
  }
  captureGain(project, trackId) {
    const t = project.tracks.find((x) => x.id === trackId);
    if (!t) fail("invalidLoopTrack");
    return (
      audibleGain(project, t) *
      eqBound(t.eq) *
      // The selected track gain explicitly upmixes mono replay to stereo.
      panPeakFactor(2, t.pan) *
      project.master.volume *
      this.engineGain()
    );
  }
  bounds(
    plan = this.controller?.plan,
    project = this.controller?.project,
    options = {},
  ) {
    if (!plan || !project) return { maxOwned: 0, maxPeak: 0 };
    const p = this.mixProject(plan, project),
      b = this.controller?.liveAdmission
        ? this.controller.liveAdmission(plan, p, options)
        : loopAdmission(plan, p);
    return { ...b, maxPeak: b.maxPeak * this.engineGain(), project: p };
  }
  checkMemory(
    ordinaryVoices,
    pending = null,
    project = this.controller?.project,
  ) {
    const c = this.controller;
    const future = [
      ...this.claims,
      ...this.producers.values(),
      ...this.playbacks,
      ...(pending ? [pending] : []),
    ].reduce((sum, x) => sum + x.futureBytes, 0);
    const voiceBytes = Math.max(0, ordinaryVoices - (c?.rows.size ?? 0)) * 8192;
    const estimate = (p) =>
      4096 + 8192 * (p?.tracks.length ?? 8) + (p ? fxBytes(p) : 0);
    const graphBytes = c?.master
      ? Math.max(0, estimate(project) - estimate(c.project))
      : estimate(project);
    const total =
      this.memory.snapshot().bytes + future + voiceBytes + graphBytes;
    if (!safe(total) || total > this.memory.snapshot().maxBytes)
      fail("combinedMemoryLimit");
  }
  check(plan, project, pending = null, options = {}) {
    const b = this.bounds(plan, project, options);
    let peak = b.maxPeak,
      voices = b.maxOwned + [...this.renders].reduce((n, r) => n + r.voices, 0);
    for (const claim of [
      ...this.claims,
      ...this.producers.values(),
      ...this.playbacks,
      ...(pending ? [pending] : []),
    ]) {
      peak += claim.prePeak * this.captureGain(b.project, claim.trackId);
      voices += claim.voices;
    }
    if (!safe(voices) || voices > 16) fail("voiceLimit");
    if (!Number.isFinite(peak) || peak > 0.95) fail("voiceHeadroom");
    this.checkMemory(b.maxOwned, pending, project);
    return { peak, voices };
  }
  admitOrdinary(plan, project, { mix = false, program = null } = {}) {
    if (this.terminal) fail("sessionDisposed");
    if (mix) {
      program ??= this.controller.prepareMixProgram();
      this.controller.checkMixProgram(program, false);
    }
    const candidate = mix
      ? envelope(this.mixProject(plan, project), this.controller.project)
      : project;
    // Check and publish the same frontier synchronously before automation/nodes.
    const result = this.check(plan, candidate);
    if (mix) this.controller.checkMixProgram(program, false);
    this.version++;
    if (mix)
      this.mixFrontier = {
        plan,
        project: candidate,
        program,
        until: program.graceFrame / program.rate,
      };
    else if (this.mixFrontier?.plan !== plan) this.mixFrontier = null;
    return result;
  }
  mixScheduleFault(program) {
    if (this.mixFrontier?.program === program) this.mixFrontier.fault = true;
  }
  finishMixScheduleFault(program) {
    if (
      this.mixFrontier?.program === program &&
      !this.claims.size &&
      !this.controller.rows.size
    )
      this.mixFrontier = null;
  }
  runtimeVoice(pendingRow) {
    this.check(this.controller?.plan, this.controller?.project, null, {
      pendingRow,
    });
  }
  keepTransportRunning() {
    return (
      this.claims.size > 0 || this.producers.size > 0 || this.playbacks.size > 0
    );
  }
  begin(kind) {
    const generation = ++this.generation;
    let resolve, reject;
    const boundary = {
      kind,
      generation,
      closed: caught(
        new Promise((a, b) => {
          resolve = a;
          reject = b;
        }),
      ),
    };
    this.boundaries.add(boundary);
    boundary.current = () => generation === this.generation && !this.terminal;
    boundary.finish = () => this.boundaries.delete(boundary);
    // Marker/shared barrier precede rootIntent subscriber/abort reentry.
    try {
      const closed = this.capture?.rootIntent(
        kind,
        () => {},
        kind === "controller-fault" ? this.lastFault : kind,
      );
      const silence = ["play", "resume"].includes(kind)
        ? []
        : [...this.producers.values()].map((p) => p.source.silence());
      const releaseMic = !["play", "resume"].includes(kind);
      if (releaseMic && this.micInput?.state === "requesting")
        this.micInput.close();
      Promise.all([
        closed,
        releaseMic ? Promise.resolve(closed).then(() => this.stopMic()) : null,
        this.stopSaved(),
        ...silence,
        ...[...this.savedBarriers].map((b) => b.closed),
        this.assigning?.catch(() => {}),
      ]).then(resolve, reject);
    } catch (error) {
      reject(error);
    }
    return boundary;
  }
  savedBlocked(trackId) {
    return [...this.savedBarriers].some(
      (b) =>
        trackId === undefined ||
        b.trackId === undefined ||
        b.trackId === trackId,
    );
  }
  holdSaved(trackId) {
    let resolve;
    const barrier = {
      trackId,
      closed: new Promise((r) => {
        resolve = r;
      }),
    };
    this.savedBarriers.add(barrier);
    barrier.finish = () => {
      this.savedBarriers.delete(barrier);
      resolve();
    };
    return barrier;
  }
  beginTakeOperation(trackId) {
    if (
      this.boundaries.size ||
      this.assigning ||
      this.savedBlocked(trackId) ||
      [...this.claims].some(
        (c) => trackId === undefined || c.trackId === trackId,
      )
    )
      fail("recordBusy");
    return this.holdSaved(trackId);
  }
  hasTakeWork() {
    return (
      this.claims.size > 0 ||
      (this.capture?.snapshot().retained.length ?? 0) > 0 ||
      (this.takeStore?.hasWork() ?? false)
    );
  }
  requireDisposition() {
    if (this.hasTakeWork()) fail("captureTakeNeedsReview");
  }
  run(kind, action, { destructive = false } = {}) {
    const b = this.begin(kind);
    return caught(
      (async () => {
        await b.closed;
        if (!b.current()) fail("cancelled");
        if (destructive) this.requireDisposition();
        return await action(b);
      })().finally(b.finish),
    );
  }
  controllerFault(error, action) {
    this.lastFault = error.code ?? "audioFailed";
    const operation = this.run("controller-fault", action);
    this.controllerBarrier = operation;
    void operation
      .finally(() => {
        if (this.controllerBarrier === operation) this.controllerBarrier = null;
      })
      .catch(() => {});
    return operation;
  }
  finiteCaptureCohort(controller, plan, project) {
    if (!this.canStartFiniteCapture(controller, plan, project)) return null;
    const b = this.#bridge;
    this.#cohort = Object.freeze({
      ...b,
      ownerGeneration: this.generation,
      controllerGeneration: controller.generation,
    });
    return this.#cohort;
  }
  canStartFiniteCapture(
    controller = this.controller,
    plan = controller?.plan,
    project = controller?.project,
  ) {
    const b = this.#bridge,
      row = b && this.producers.get(b.trackId);
    if (
      !b ||
      controller !== b.controller ||
      plan !== b.plan ||
      project !== b.project ||
      controller.context !== this.engine.context ||
      this.terminal ||
      this.boundaries.size > 1 ||
      [...this.boundaries].some(
        (b) => !["play", "resume"].includes(b.kind) || !b.current(),
      ) ||
      this.assigning ||
      this.savedBlocked() ||
      this.claims.size ||
      this.renders.size ||
      this.playbacks.size ||
      this.producers.size !== 1 ||
      row?.source !== b.source ||
      row.closing ||
      !b.source?.isCurrent() ||
      b.source.generation !== b.sourceGeneration ||
      this.capture !== b.capture ||
      this.capture.snapshot().owners.length ||
      this.capture.snapshot().retained.length ||
      this.capture.output !== controller.graphs.get(b.trackId)?.gain ||
      !controller.canBridgeCapture(b.trackId)
    )
      return null;
    return true;
  }
  detachClosed() {
    if (
      this.engine?.context.state !== "closed" ||
      !this.controller?.disposed ||
      this.boundaries.size ||
      this.controllerBarrier ||
      this.capture ||
      this.claims.size ||
      this.producers.size ||
      this.playbacks.size ||
      this.renders.size ||
      this.assigning ||
      this.hasTakeWork()
    )
      fail("recordBusy");
    this.engine = null;
    this.controller = null;
    this.#bridge = null;
    this.#cohort = null;
    this.lastFault = null;
  }
  canArmFiniteCapture(source) {
    const b = this.#cohort,
      c = this.controller;
    return (
      !!b &&
      b.source === source &&
      b.sourceGeneration === source.generation &&
      source.isCurrent() &&
      this.generation === b.ownerGeneration &&
      c.generation === b.controllerGeneration &&
      c.plan === b.plan &&
      c.project === b.project &&
      c.context === this.engine.context &&
      this.capture === b.capture &&
      this.captureTrack === b.trackId &&
      this.producers.get(b.trackId)?.source === source &&
      this.producers.size === 1 &&
      !this.playbacks.size &&
      !this.renders.size &&
      !this.capture.snapshot().retained.length &&
      c.hasFiniteCaptureCohort(b)
    );
  }
  producerHeadroom() {
    const b = this.bounds();
    let peak = b.maxPeak,
      voices = b.maxOwned + [...this.renders].reduce((n, r) => n + r.voices, 0);
    for (const p of [...this.producers.values(), ...this.playbacks]) {
      peak += p.prePeak * this.captureGain(b.project, p.trackId);
      voices += p.voices;
    }
    return { peak, voices };
  }
  admitLivePreflight(plan, project) {
    if (this.terminal) fail("sessionDisposed");
    if (this.engine && this.controller)
      return this.admitOrdinary(plan, project);
    // A cold workspace has no audible graph or native rows. Refuse malformed
    // partial attachment/claims; still charge simultaneous cold render owners.
    if (
      this.engine ||
      this.controller ||
      this.claims.size ||
      this.producers.size ||
      this.playbacks.size
    )
      fail("invalidCaptureOwner");
    const b = loopAdmission(plan, project, { recordedLoops: true });
    const voices =
      b.maxOwned + [...this.renders].reduce((n, r) => n + r.voices, 0);
    if (!safe(voices) || voices > 16) fail("voiceLimit");
    this.checkMemory(b.maxOwned, null, project);
    return { voices, peak: b.maxPeak };
  }
  reserveRender(plan, program) {
    if (this.terminal) fail("sessionDisposed");
    const voices = (
        program
          ? portableRecordingAdmission(plan, program)
          : loopAdmission(plan)
      ).maxOwned,
      b = this.bounds();
    // A loaded plan is a future playback requirement, not an owned voice.
    // Playing may schedule more nodes; stopped/paused sessions cannot, but
    // every ending or already scheduled row keeps its slot until release.
    // A later Play still checks the render tickets through admitOrdinary.
    const ordinary =
      ["stopped", "paused"].includes(this.controller?.status)
        ? this.controller.rows.size
        : b.maxOwned;
    const current =
      ordinary +
      [
        ...this.claims,
        ...this.producers.values(),
        ...this.playbacks,
        ...this.renders,
      ].reduce((n, r) => n + r.voices, 0);
    if (!safe(current) || !safe(voices) || voices < 1 || current + voices > 16)
      fail("voiceLimit");
    const ticket = { voices };
    this.renders.add(ticket);
    this.version++;
    return {
      release: () => {
        if (this.renders.delete(ticket)) this.version++;
      },
    };
  }
  assignInstrument(trackId, options) {
    if (this.assigning) fail("recordBusy");
    let resolve, reject;
    const operation = new Promise((a, b) => {
      resolve = a;
      reject = b;
    });
    this.assigning = operation;
    void this.assignInstrumentNow(trackId, options).then(resolve, reject);
    void operation
      .finally(() => {
        if (this.assigning === operation) this.assigning = null;
      })
      .catch(() => {});
    return operation;
  }
  async assignInstrumentNow(trackId, options) {
    const generation = this.generation;
    if (
      this.terminal ||
      this.boundaries.size ||
      this.savedBlocked() ||
      this.claims.size ||
      this.controller?.hasFiniteWitnessReaders?.() ||
      (this.capture?.snapshot().retained.length ?? 0)
    )
      fail("recordBusy");
    const c = this.controller,
      graph = c.graphs.get(trackId);
    if (!graph) fail("invalidCaptureSource");
    if (options?.overdub === true)
      admitOverdubBytes(c.project, overdubBase(c.project, trackId));
    else if (c.project.tracks.find((t) => t.id === trackId)?.clips.length)
      fail("invalidCaptureSource");
    await this.stopSaved();
    await this.closeProducers();
    if (
      this.terminal ||
      generation !== this.generation ||
      this.boundaries.size ||
      this.savedBlocked() ||
      this.claims.size
    )
      fail("cancelled");
    this.capture.retarget(graph.gain);
    this.captureTrack = trackId;
    const source = await createLiveInstrumentInput({
      context: this.engine.context,
      transport: this.engine.transport,
      memory: this.memory,
      registry: c.registry,
      framesPerBar: c.plan.clock.policy.framesPerBar,
      ...options,
      outputGain: this.engine.outputStage?.programmeGain ?? 1,
    });
    return this.installProducer(trackId, source, graph, generation);
  }
  // Called directly from Enable Mic while activation is still live. All local
  // preparation must already have completed; no async work precedes enable().
  enableMic(trackId, { provider, activation, supportedConstraints } = {}) {
    const c = this.controller,
      graph = c?.graphs.get(trackId);
    if (
      this.terminal ||
      this.boundaries.size ||
      this.assigning ||
      this.claims.size ||
      this.savedBlocked() ||
      !this.capture ||
      !graph ||
      this.captureTrack !== trackId ||
      this.capture.snapshot().retained.length ||
      this.engine.context.state !== "running"
    )
      fail("recordBusy");
    const generation = this.generation;
    let source;
    const abort = new AbortController();
    this.micPreparation = abort;
    this.micInput?.close();
    const mic = (this.micInput = new MicInput(this.engine.context, {
      ...(provider ? { provider } : {}),
      ...(activation ? { activation } : {}),
      ...(supportedConstraints ? { supportedConstraints } : {}),
      onRelease: (reason) => {
        if (this.micInput === mic) this.micStatus = reason;
        abort.abort();
        source?.invalidate(reason);
      },
    }));
    this.micStatus = "requesting";
    const requested = mic.enable({ userGesture: true });
    const operation = (async () => {
      try {
        if (!(await requested)) {
          this.micStatus = mic.state;
          return null;
        }
        await this.stopSaved();
        await this.closeProducers();
        if (
          generation !== this.generation ||
          this.terminal ||
          mic.state !== "ready"
        )
          fail("cancelled");
        this.capture.retarget(graph.gain);
        source = await createMicSource({
          context: this.engine.context,
          memory: this.memory,
          transport: this.engine.transport,
          mic,
          signal: abort.signal,
          framesPerBar: c.plan.clock.policy.framesPerBar,
        });
        if (
          generation !== this.generation ||
          this.terminal ||
          abort.signal.aborted ||
          mic.state !== "ready"
        )
          fail("cancelled");
        const installed = await this.installProducer(
          trackId,
          source,
          graph,
          generation,
        );
        if (
          abort.signal.aborted ||
          !installed.isCurrent() ||
          generation !== this.generation
        )
          fail("cancelled");
        retireMicPreparation(installed);
        if (this.micPreparation === abort) this.micPreparation = null;
        this.micStatus = "ready";
        return installed;
      } catch (e) {
        const row = this.producers.get(trackId);
        if (source && row?.source === source) await this.closeProducer(row);
        else if (source) await closeInstrumentMonitor(source);
        else mic.close();
        if (e.code !== "cancelled") this.micStatus = e.code ?? "error";
        throw e;
      }
    })();
    this.assigning = operation;
    void operation
      .finally(() => {
        if (this.assigning === operation) this.assigning = null;
        if (this.micPreparation === abort) this.micPreparation = null;
      })
      .catch(() => {});
    return operation;
  }
  async setMicMonitoring(
    trackId,
    enabled,
    { headphonesConfirmed = false } = {},
  ) {
    const row = this.producers.get(trackId),
      c = this.controller;
    if (
      typeof enabled !== "boolean" ||
      !row ||
      row.closing ||
      row.monitorPending ||
      this.terminal ||
      this.boundaries.size ||
      this.assigning ||
      row.source.kind !== "original-microphone-input" ||
      !row.source.isCurrent() ||
      !c.graphs.has(trackId)
    )
      fail("recordBusy");
    if (enabled && !headphonesConfirmed) fail("micHeadphonesRequired");
    const old = row.prePeak;
    if (enabled) {
      row.prePeak = MIC_MONITOR_PEAK;
      try {
        this.check(c.plan, c.project);
      } catch (e) {
        row.prePeak = old;
        throw e;
      }
    }
    // Publish conservative headroom before connecting the silent DSP output.
    // An outstanding disable keeps it reserved until the native mute receipt.
    this.version++;
    row.monitorPending = true;
    try {
      const receipt = await setMicMonitor(row.source, row.gain, enabled);
      if (
        !receipt.cancelled &&
        this.producers.get(trackId) === row &&
        !row.closing
      ) {
        row.prePeak = enabled ? MIC_MONITOR_PEAK : 0;
        row.monitorReceipt = receipt;
        this.version++;
      }
      return receipt;
    } finally {
      row.monitorPending = false;
    }
  }
  async stopMic() {
    const mic = this.micInput;
    if (!mic) return;
    this.micPreparation?.abort();
    if (mic.state === "requesting") mic.close();
    const rows = [...this.producers.values()].filter(
      (r) => r.source.kind === "original-microphone-input",
    );
    for (const row of rows) {
      await this.capture?.stopTrack(row.trackId);
      await this.closeProducer(row);
    }
    mic.close();
    if (this.micInput === mic && this.micStatus === "ready")
      this.micStatus = "off";
  }
  async installProducer(trackId, source, graph, generation) {
    const c = this.controller;
    const isMic = source.kind === "original-microphone-input";
    const row = {
      trackId,
      source,
      prePeak: isMic ? 0 : source.peak,
      voices: source.producerVoices ?? 3,
      futureBytes: 0,
    };
    try {
      if (
        this.terminal ||
        generation !== this.generation ||
        this.boundaries.size ||
        this.savedBlocked() ||
        c.graphs.get(trackId) !== graph
      )
        fail("cancelled");
      row.nodeLease = this.memory.reserve(4096, "live-monitor-route");
      this.check(c.plan, c.project, row);
      this.producers.set(trackId, row);
      this.version++;
      row.gain = this.engine.context.createGain();
      row.gain.gain.value = 0;
      row.gain.connect(graph.gain);
      row.startFrame = isMic
        ? Math.ceil(
            this.engine.context.currentTime * this.engine.context.sampleRate,
          )
        : activateInstrumentMonitor(source, {
            destination: row.gain,
            admitVoice: () => {
              if (
                this.terminal ||
                this.producers.get(trackId) !== row ||
                c.graphs.get(trackId) !== graph
              )
                fail("recordBusy");
              this.check(c.plan, c.project);
            },
          });
      row.gain.gain.setValueAtTime(
        isMic ? 1 / (this.engine.outputStage?.programmeGain ?? 1) : 1,
        row.startFrame / this.engine.context.sampleRate,
      );
      row.unlisten = source.onFault((f) => {
        this.lastFault = f.code;
        // A producer failure is not a user track-stop. Preserve its cause in
        // the root barrier before containing shared playback/clock. Mic has
        // its own device-only lifecycle; instrument fault contains the graph.
        const stopped = isMic
          ? this.capture?.rootIntent("micInputLost", () => {}, f.code)
          : c.playbackFault(f);
        void Promise.resolve(stopped)
          .then(() => this.closeProducer(row))
          .catch(() => {});
      });
      if (this.#bridge?.controller === c && this.#bridge.trackId === trackId) {
        this.#bridge.source = source;
        this.#bridge.sourceGeneration = source.generation;
      }
      return source;
    } catch (e) {
      await closeInstrumentMonitor(source);
      row.gain?.disconnect();
      row.nodeLease?.release();
      if (this.producers.get(trackId) === row) this.producers.delete(trackId);
      throw e;
    }
  }
  closeProducer(row) {
    if (
      row.closing &&
      !(row.closeFailed && this.engine.context.state === "closed")
    )
      return row.closing;
    row.closeFailed = false;
    row.closing = (async () => {
      await closeInstrumentMonitor(row.source);
      row.unlisten?.();
      row.gain.disconnect();
      row.nodeLease.release();
      this.producers.delete(row.trackId);
      this.version++;
    })().catch((e) => {
      row.closeFailed = true;
      throw e;
    });
    return row.closing;
  }
  closeProducers() {
    return Promise.all(
      [...this.producers.values()].map((p) => this.closeProducer(p)),
    );
  }
  async playSaved(takeId, trackId) {
    if (
      this.playbacks.size ||
      this.claims.size ||
      this.terminal ||
      this.boundaries.size ||
      this.assigning ||
      this.savedBlocked(trackId) ||
      !this.engine.transport.running
    )
      fail("recordBusy");
    const take = this.pool.describe(takeId),
      c = this.controller,
      generation = this.generation,
      graph = c.graphs.get(trackId);
    if (take.partial || take.frames % c.plan.clock.policy.framesPerBar)
      fail("partialTakeNeedsReview");
    const row = {
      trackId,
      prePeak: take.peak,
      voices: 1,
      futureBytes: take.validBytes * 2 + 12288,
    };
    this.check(c.plan, c.project, row);
    this.playbacks.add(row);
    this.version++;
    let done;
    row.closed = new Promise((r) => {
      done = r;
    });
    const release = () => {
      if (row.released) return;
      row.released = true;
      row.gain?.disconnect();
      if (row.copy) row.copy.buffer = null;
      row.copy?.release();
      row.lease?.release();
      this.playbacks.delete(row);
      this.version++;
      done();
    };
    try {
      row.copy = this.pool.copyToAudioBuffer(takeId, this.engine.context);
      row.lease = this.memory.reserve(
        take.validBytes + 8192,
        "saved-take/native-view/voice",
      );
      row.futureBytes = 0;
      row.gain = this.engine.context.createGain();
      row.gain.gain.value = 4;
      row.gain.connect(graph.gain);
      const plan = this.capture.clock.plan({
        bars: take.frames / c.plan.clock.policy.framesPerBar,
        countInBars: 0,
        leadSeconds: 0.1,
      });
      row.voice = instrumentVoice(
        this.engine.context,
        row.gain,
        row.copy.buffer,
        plan.startFrame / this.engine.context.sampleRate,
        1,
        {
          release,
        },
      );
      row.voice.source.loop = true;
      row.voice.end = Number.MAX_VALUE;
      // Native allocation/start hooks can reenter root/history operations after
      // the row is published but before its voice is assigned. Their stop
      // snapshot holds row.closed; stop the now-created voice before resolving.
      if (
        this.terminal ||
        generation !== this.generation ||
        this.boundaries.size ||
        this.assigning ||
        this.savedBlocked(trackId) ||
        !this.engine.transport.running ||
        c.graphs.get(trackId) !== graph
      )
        fail("recordBusy");
      return row;
    } catch (e) {
      if (row.voice) {
        row.voice.stop();
        await row.closed;
      } else release();
      throw e;
    }
  }
  stopSaved(trackId) {
    const rows = [...this.playbacks].filter(
      (p) => trackId === undefined || p.trackId === trackId,
    );
    for (const p of rows) p.voice?.stop();
    return Promise.all(rows.map((p) => p.closed));
  }
  prepareSynthetic(trackId, options) {
    return this.prepareCapture(trackId, options);
  }
  prepareInstrument(trackId, options) {
    return this.prepareCapture(trackId, options);
  }
  async prepareCapture(
    trackId,
    {
      moduleURL,
      openSession = (o) => CaptureSession.open(o),
      overdub = false,
    } = {},
  ) {
    const generation = this.generation;
    const c = this.controller,
      e = this.engine;
    if (
      this.terminal ||
      this.boundaries.size ||
      this.assigning ||
      this.savedBlocked() ||
      !c?.plan ||
      c.status !== "stopped" ||
      e.transport.running ||
      c.rows.size ||
      JSON.stringify(c.project) !== JSON.stringify(this.getProject()) ||
      c.project.clock?.kind !== "fixed-bar" ||
      c.plan.clock.policy.framesPerBar !== c.project.clock.framesPerBar ||
      c.plan.clock.rate !== e.context.sampleRate
    )
      fail("captureClockNotFrozen");
    const t = c.project.tracks.find((x) => x.id === trackId);
    if (typeof overdub !== "boolean" || !t) fail("invalidCaptureSource");
    const bridge = !overdub && c.canBridgeCapture?.(trackId);
    if (!bridge) c.reclaimOptionalFinitePreparation?.("capturePreparation");
    this.#bridge = null;
    this.#cohort = null;
    if (overdub) admitOverdubBytes(c.project, overdubBase(c.project, trackId));
    else if (t.clips.length) fail("invalidCaptureSource");
    this.requireDisposition();
    if (this.capture) await this.capture.dispose();
    if (
      this.terminal ||
      generation !== this.generation ||
      this.boundaries.size ||
      c.status !== "stopped" ||
      e.transport.running ||
      JSON.stringify(c.project) !== JSON.stringify(this.getProject())
    )
      fail("captureCancelled");
    c.graph();
    e.transport.beatSeconds = 60 / c.plan.clock.effectiveBpm;
    const owner = this,
      output = c.graphs.get(trackId).gain;
    const root = {
      engine: e,
      transport: e.transport,
      memory: this.memory,
      pool: this.pool,
      output,
      captureBus: output,
      get project() {
        return c.project;
      },
      projectIdentity: captureProjectIdentity,
      captureOutputGain: () =>
        owner.captureGain(
          owner.mixProject(c.plan, c.project),
          owner.captureTrack,
        ),
      headroom: () => {
        return owner.producerHeadroom();
      },
    };
    this.captureTrack = trackId;
    this.capture = new RootCaptureCoordinator({
      root,
      enabled: true,
      registry: c.registry,
      moduleURL,
      openSession: async (options) => {
        const claim = [...this.claims][0];
        if (!claim) fail("captureCancelled");
        claim.futureBytes -= 8192; // selected route now held in the actual ledger
        const session = await openSession(options);
        claim.futureBytes = 0; // pool/window now held; peak/voices remain reserved through closed
        return session;
      },
    });
    if (bridge)
      this.#bridge = {
        controller: c,
        context: c.context,
        plan: c.plan,
        project: c.project,
        trackId,
        capture: this.capture,
        source: null,
      };
    return this.capture;
  }
  armSynthetic({ source, bars = 1, gain = 1 } = {}) {
    if (source?.kind !== "qualified-finite-synthetic")
      fail("invalidCaptureSource");
    return this.armInput({ source, bars, gain });
  }
  armInstrument({
    source,
    bars = 1,
    countInBars = 0,
    gain = 1,
    alignBars = 1,
  } = {}) {
    if (
      captureInputChannels(
        source,
        this.engine.context,
        this.memory,
        this.engine.transport,
      ) !== 2
    )
      fail("invalidCaptureSource");
    return this.armInput({ source, bars, countInBars, gain, alignBars });
  }
  armMic(options) {
    if (options?.source?.kind !== "original-microphone-input")
      fail("invalidCaptureSource");
    return this.armInput(options);
  }
  armInput({
    source,
    bars = 1,
    countInBars = 0,
    gain = 1,
    alignBars = 1,
  } = {}) {
    const c = this.controller;
    if (
      this.terminal ||
      this.boundaries.size ||
      this.assigning ||
      (c.hasFiniteWitnessReaders?.() && !this.canArmFiniteCapture(source)) ||
      this.savedBlocked(this.captureTrack) ||
      !this.capture ||
      this.claims.size ||
      c.status !== "playing" ||
      c.loading ||
      this.capture.output !== c.graphs.get(this.captureTrack)?.gain ||
      JSON.stringify(c.project) !== JSON.stringify(this.getProject())
    )
      fail("recordBusy");
    const channels = captureInputChannels(
      source,
      this.engine.context,
      this.memory,
      this.engine.transport,
    );
    // Both adapters preallocate source/producer resources before admission.
    if (
      source.estimatedBytes !== 0 ||
      !Number.isFinite(source.peak) ||
      source.peak < 0 ||
      !safe(source.voices) ||
      source.voices < 1 ||
      !Number.isFinite(gain) ||
      gain < 0 ||
      gain > 1
    )
      fail("invalidCaptureSource");
    const plan = this.capture.clock.plan({
      bars,
      countInBars,
      alignBars,
      leadSeconds: 0.1,
    });
    const claim = {
      trackId: this.captureTrack,
      prePeak: source.peak * gain,
      voices: source.voices,
      channels,
      futureBytes: captureReservedBytes(
        channels,
        plan.endFrame - plan.startFrame,
      ),
      generation: this.generation,
    };
    // A refused prospective arm publishes no claim/version. Successful claims
    // still reserve synchronously before coordinator notifications or awaits.
    this.check(c.plan, c.project, claim);
    this.claims.add(claim);
    this.version++;
    try {
      if (!this.capture.admission) this.capture.beginEpoch();
      const h = this.capture.arm(this.captureTrack, {
        source,
        bars,
        countInBars,
        gain,
        alignBars,
        expectedPlan: plan,
      });
      void h.closed.then(
        () => {
          this.claims.delete(claim);
          this.version++;
        },
        () => {
          /* unconfirmed cleanup keeps reservation */
        },
      );
      return h;
    } catch (error) {
      this.claims.delete(claim);
      this.version++;
      throw error;
    }
  }
  stopTrack(id) {
    const pending = [...this.savedBarriers].filter(
      (b) => b.trackId === undefined || b.trackId === id,
    );
    const barrier = this.holdSaved(id);
    return caught(
      (async () => {
        try {
          const closed = this.capture?.stopTrack(id) ?? Promise.resolve();
          const producer = this.producers.get(id);
          this.controller?.stopTrack(id);
          await Promise.all([
            closed,
            this.stopSaved(id),
            producer?.source.kind === "original-microphone-input"
              ? Promise.resolve(closed).then(() => this.stopMic())
              : producer?.source.silence(),
            ...pending.map((b) => b.closed),
          ]);
        } finally {
          barrier.finish();
        }
      })(),
    );
  }
  releaseTake(id) {
    this.capture.releaseTake(id);
  }
  async replaceable() {
    if (this.claims.size || (this.capture?.snapshot().retained.length ?? 0))
      fail("captureTakeNeedsReview");
    await this.closeProducers();
    await this.stopSaved();
    if (this.capture) {
      await this.capture.dispose();
      this.capture = null;
    }
  }
  dispose() {
    if (this.disposal) return this.disposal;
    this.terminal = true;
    let resolve, reject;
    this.disposal = caught(
      new Promise((a, b) => {
        resolve = a;
        reject = b;
      }),
    );
    const b = this.begin("dispose");
    void (async () => {
      await b.closed;
      await this.assigning?.catch(() => {});
      this.requireDisposition();
      await this.closeProducers();
      await this.capture?.dispose();
    })()
      .finally(b.finish)
      .then(resolve, reject);
    return this.disposal;
  }
  async retryCleanupAfterContextClose() {
    if (this.engine.context.state !== "closed")
      fail("captureCleanupUnconfirmed");
    await this.capture?.retryCleanupAfterContextClose();
    if (this.capture?.snapshot().owners.length)
      fail("captureCleanupUnconfirmed");
    await this.closeProducers();
    this.claims.clear();
    this.version++;
  }
  snapshot() {
    return {
      generation: this.generation,
      version: this.version,
      terminal: this.terminal,
      boundaries: this.boundaries.size,
      claims: [...this.claims].map((x) => ({ ...x })),
      producers: [...this.producers.values()].map((p) => ({
        trackId: p.trackId,
        prePeak: p.prePeak,
        voices: p.voices,
        startFrame: p.startFrame,
      })),
      savedPlaybackCount: this.playbacks.size,
      renders: this.renders.size,
      capture: this.capture?.snapshot() ?? null,
      memory: this.memory.snapshot(),
    };
  }
}
