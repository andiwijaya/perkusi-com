import { Transport } from "./transport.js";
import { secondsPerBeat } from "./transport.js";
import { validateProject } from "../project/schema.js";
import {
  createTrackMixer,
  scheduleShot,
  sequenceEvents,
  stepBeat,
  stepIndexAtBeat,
  nextStepIndex,
} from "./sequencing.js";
import { SampleBank } from "./sample-bank.js";
import {
  createLoopVoice,
  fadeOutVoice,
  cancelFade,
  disconnectVoice,
  MASTER_MAX,
} from "./voice.js";

export class AudioEngine {
  constructor(
    pack,
    {
      contextFactory = () => new AudioContext({ latencyHint: "interactive" }),
      bankOptions,
      variantPacks = [],
      outputStageFactory = null,
      sequenceCatalog = null,
      timers = {
        setInterval: (...args) => globalThis.setInterval(...args),
        clearInterval: (...args) => globalThis.clearInterval(...args),
      },
      lookahead = 0.12,
      tickMs = 25,
    } = {},
  ) {
    this.pack = pack;
    this.sequenceCatalog = sequenceCatalog;
    this.sequence = null;
    this.mixer = null;
    this.nextStep = 0;
    this.passedStep = -1;
    this.arrangement = false;
    if (outputStageFactory !== null && typeof outputStageFactory !== "function")
      throw new TypeError("Invalid output stage factory");
    this.outputStageFactory = outputStageFactory;
    const guardedBankOptions = {
      ...bankOptions,
      validateCandidate: (entry, metrics) => {
        this.admitCandidate(entry, metrics);
        bankOptions?.validateCandidate?.(entry, metrics);
      },
    };
    this.bank = new SampleBank(pack, guardedBankOptions);
    this.banks = new Set([this.bank]);
    this.variants = new Map(
      pack.stems.map((stem) => [
        stem.id,
        new Map([[stem.variant ?? 1, { bank: this.bank, stem }]]),
      ]),
    );
    for (const alternate of variantPacks) {
      if (
        alternate.bpm !== pack.bpm ||
        alternate.bars !== pack.bars ||
        alternate.beatsPerBar !== pack.beatsPerBar ||
        alternate.key !== pack.key ||
        alternate.stems.length !== pack.stems.length ||
        alternate.stems.some((stem) => !this.variants.has(stem.id))
      )
        throw new Error("Incompatible variant pack");
      const bank = new SampleBank(alternate, guardedBankOptions);
      this.banks.add(bank);
      for (const stem of alternate.stems) {
        const choices = this.variants.get(stem.id);
        if (
          !Number.isInteger(stem.variant) ||
          stem.variant < 1 ||
          choices.has(stem.variant) ||
          choices.size >= 4
        )
          throw new Error("Invalid variant identity");
        choices.set(stem.variant, { bank, stem });
      }
    }
    this.defaultVariants = new Map(
      pack.stems.map((stem) => [stem.id, stem.variant ?? 1]),
    );
    this.selectedVariant = new Map(this.defaultVariants);
    this.appliedVariant = new Map(pack.stems.map((stem) => [stem.id, null]));
    this.variantOperations = new Map(pack.stems.map((stem) => [stem.id, 0]));
    this.transport = new Transport(pack);
    this.contextFactory = contextFactory;
    this.timers = timers;
    this.lookahead = lookahead;
    this.tickMs = tickMs;
    this.context = null;
    this.master = null;
    this.output = null;
    this.outputStage = null;
    this.volume = 0.65;
    this.status = "idle";
    this.error = null;
    this.enabled = new Map(pack.stems.map((s) => [s.id, true]));
    this.applied = new Map(pack.stems.map((s) => [s.id, false]));
    this.pending = new Map();
    this.voices = new Set();
    this.roleVoice = new Map();
    this.captures = new Set();
    this.events = [];
    this.stats = {
      created: 0,
      disposed: 0,
      ticks: 0,
      deferredChanges: 0,
      starts: 0,
    };
    this.operation = 0;
    // Asset selection/loading is separate from the user's transport intent.
    // Only Play opens this gate; Pause/interruption/disposal closes it.
    this.playbackRequested = false;
    this.timer = null;
    this.startPromise = null;
    this.disposed = false;
    this.disposePromise = null;
    this.disposalClosePending = false;
    this.closeRetryPromise = null;
    this.contextStateBoundary = null;
    this.onContextState = () => {
      if (this.context.state !== "running") {
        const contain = () => {
          this.playbackRequested = false;
          ++this.operation;
          this.startPromise = null;
          for (const bank of this.banks) bank.cancelLoading();
          this.rememberSequencePosition(this.context.currentTime);
          if (this.transport.running)
            this.transport.pause(this.context.currentTime);
          this.clearTimer();
          this.clearVoices();
          this.pending.clear();
          this.status =
            this.context.state === "closed" ? "error" : this.context.state;
          if (this.context.state === "closed") this.error = "context-closed";
          if (this.context.state === "closed")
            for (const capture of [...this.captures]) capture.dispose();
        };
        if (this.contextStateBoundary) this.contextStateBoundary(contain);
        else contain();
      }
    };
  }
  record(type, detail = {}) {
    this.events.push({
      type,
      clock: this.context?.currentTime || 0,
      ...detail,
    });
    if (this.events.length > 256) this.events.shift();
  }
  variantEntry(id, variant = this.selectedVariant.get(id)) {
    const choice = this.variants.get(id)?.get(variant);
    if (!choice) throw new Error("Unknown role/variant");
    return choice.bank.get(id);
  }
  cacheBounds(candidate = null, metrics = null) {
    let bytes = 0,
      peaks = 0;
    for (const bank of this.banks)
      for (const entry of bank.entries.values())
        bytes += (entry === candidate ? metrics : entry.metrics)?.bytes || 0;
    for (const choices of this.variants.values())
      peaks += Math.max(
        ...[...choices.values()].map(({ bank, stem }) => {
          const entry = bank.get(stem.id);
          return (
            ((entry === candidate ? metrics : entry.metrics)?.peak || 0) *
            stem.gainTrim
          );
        }),
      );
    return { bytes, peak: peaks * MASTER_MAX };
  }
  admitCandidate(entry, metrics) {
    const bounds = this.cacheBounds(entry, metrics);
    if (bounds.peak > 0.95) throw new Error("unsafe-pack-headroom");
    if (bounds.bytes > 32 * 1024 * 1024)
      throw new Error("decoded-bank-memory-limit");
  }
  playableEntry(id, variant = this.selectedVariant.get(id)) {
    const choice = this.variants.get(id)?.get(variant);
    const entry = this.variantEntry(id, variant);
    if (!choice.bank.verifyRetained(id)) return null;
    try {
      this.admitCandidate(entry, entry.metrics);
      return entry;
    } catch (error) {
      Object.assign(entry, {
        buffer: null,
        metrics: null,
        state: "error",
        error: error.message,
      });
      this.record("asset-rejected", { id, variant, error: error.message });
      return null;
    }
  }
  loopSelection() {
    return this.pack.stems
      .filter((stem) => this.sequence || this.enabled.get(stem.id))
      .map((stem) => [
        stem.id,
        this.selectedVariant.get(stem.id),
        this.variantOperations.get(stem.id),
      ]);
  }
  async loadSelection(context, operation) {
    const attempted = new Set();
    while (
      !this.disposed &&
      this.playbackRequested &&
      operation === this.operation
    ) {
      const selection = this.loopSelection();
      await Promise.all(
        selection.map(async ([id, variant, token]) => {
          const key = id + ":" + variant + ":" + token;
          if (attempted.has(key)) return;
          attempted.add(key);
          await this.variants
            .get(id)
            .get(variant)
            .bank.load(id, context, { priority: this.sequence ? 0 : 10 });
          if (!this.sequence && token === this.variantOperations.get(id))
            this.activateLoadedLoop(id, variant, operation, context, true);
        }),
      );
      if (JSON.stringify(selection) === JSON.stringify(this.loopSelection()))
        return;
    }
  }
  activateLoadedLoop(id, variant, operation, context, joinInitial = false) {
    if (
      this.disposed ||
      !this.playbackRequested ||
      this.sequence ||
      operation !== this.operation ||
      context !== this.context ||
      context.state !== "running" ||
      !this.enabled.get(id) ||
      this.selectedVariant.get(id) !== variant ||
      !this.playableEntry(id, variant)
    )
      return;
    if (!this.transport.running) {
      const bounds = this.cacheBounds();
      if (bounds.peak > 0.95) throw new Error("unsafe-pack-headroom");
      if (bounds.bytes > 32 * 1024 * 1024)
        throw new Error("decoded-bank-memory-limit");
      const when = context.currentTime + 0.05;
      this.loopStartAt = when;
      this.transport.start(when);
      this.status = "playing";
      this.error = null;
      ++this.stats.starts;
      for (const [role, choice] of this.loopSelection()) {
        if (!this.playableEntry(role, choice)) continue;
        this.addVoice(role, when, choice);
        this.applied.set(role, true);
        this.appliedVariant.set(role, choice);
      }
      this.record("play", { when, origin: this.transport.origin });
      this.clearTimer();
      this.timer = this.timers.setInterval(() => this.pump(), this.tickMs);
      return;
    }
    if (this.applied.get(id) && this.appliedVariant.get(id) === variant) return;
    // Assets ready during the existing first-start lead share that exact origin.
    // Later arrivals/retries join on the normal common bar, never start off-clock.
    if (
      joinInitial &&
      !this.applied.get(id) &&
      context.currentTime + 0.005 <= this.loopStartAt
    ) {
      this.cancelPending(id);
      this.addVoice(id, this.loopStartAt, variant);
      this.applied.set(id, true);
      this.appliedVariant.set(id, variant);
    } else this.queueChange(id);
  }
  selectedBank() {
    return {
      pack: {
        ...this.pack,
        stems: this.pack.stems.map((stem) => this.variantEntry(stem.id).stem),
      },
      duration: this.bank.duration,
      get: (id) => this.variantEntry(id),
    };
  }
  ensureContext() {
    if (this.disposed) throw new Error("Engine disposed");
    if (!this.context || this.context.state === "closed") {
      this.context?.removeEventListener("statechange", this.onContextState);
      this.outputStage?.dispose();
      this.mixer?.dispose();
      this.mixer = null;
      this.outputStage = null;
      this.master?.disconnect();
      this.context = this.contextFactory();
      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      this.output = null;
      try {
        const stage = this.outputStageFactory?.(this.context, this.master);
        if (
          this.outputStageFactory &&
          (!stage?.output ||
            typeof stage.output.connect !== "function" ||
            typeof stage.dispose !== "function")
        )
          throw new TypeError("Invalid output stage");
        this.outputStage = stage;
        this.output = this.outputStage?.output || this.master;
        this.output.connect(this.context.destination);
        if (this.sequence) {
          this.mixer = createTrackMixer(
            this.context,
            this.master,
            this.sequence.tracks,
          );
          this.mixer.update(this.sequence.tracks, 0, true);
        }
      } catch (error) {
        this.master.disconnect();
        this.outputStage?.dispose();
        this.outputStage = null;
        this.output = null;
        // A retry must build a complete graph, never reuse a silent partial one.
        void this.context.close().catch(() => {});
        throw error;
      }
      this.context.addEventListener("statechange", this.onContextState);
    }
    return this.context;
  }
  play() {
    if (this.disposed) return Promise.reject(new Error("Engine disposed"));
    this.playbackRequested = true;
    if (this.startPromise) return this.startPromise;
    if (this.transport.running && this.context?.state === "running")
      return Promise.resolve(this.snapshot());
    const operation = ++this.operation;
    // Create/resume synchronously in the caller's user gesture, before any fetch await.
    let context, resumed;
    try {
      context = this.ensureContext();
      resumed = context.resume();
    } catch (error) {
      this.status = "error";
      this.error = "audio-start: " + error.message;
      return Promise.resolve(this.snapshot());
    }
    this.status = "loading";
    this.error = null;
    const promise = (async () => {
      try {
        await resumed;
        if (!this.sequence) {
          await this.loadSelection(context, operation);
          if (
            this.disposed ||
            !this.playbackRequested ||
            operation !== this.operation
          )
            return this.snapshot();
          if (!this.transport.running) {
            if (!this.loopSelection().length) this.status = "ready";
            else throw new Error("no-assets-ready");
          }
          return this.snapshot();
        }
        await Promise.all([
          this.loadSelection(context, operation),
          this.composition?.load(context),
        ]);
        if (
          this.disposed ||
          !this.playbackRequested ||
          operation !== this.operation
        )
          return this.snapshot();
        if (context.state !== "running") throw new Error("context-not-running");
        const available = this.pack.stems.filter((s) =>
          this.playableEntry(s.id),
        );
        if (!available.length) throw new Error("no-assets-ready");
        const bounds = this.cacheBounds();
        if (bounds.peak > 0.95) throw new Error("unsafe-pack-headroom");
        if (bounds.bytes > 32 * 1024 * 1024)
          throw new Error("decoded-bank-memory-limit");
        const when = context.currentTime + 0.05;
        this.transport.start(when);
        this.status = "playing";
        ++this.stats.starts;
        this.composition?.start(when);
        if (this.sequence) {
          if (available.length !== this.pack.stems.length)
            throw new Error("no-assets-ready");
          this.nextStep = Math.max(
            this.passedStep + 1,
            nextStepIndex(this.transport.position, this.sequence.timing.swing),
          );
          this.pump();
        }
        for (const stem of this.sequence ? [] : available)
          if (this.enabled.get(stem.id)) {
            this.addVoice(stem.id, when);
            this.applied.set(stem.id, true);
            this.appliedVariant.set(stem.id, this.selectedVariant.get(stem.id));
          }
        this.record("play", { when, origin: this.transport.origin });
        this.clearTimer();
        this.timer = this.timers.setInterval(() => this.pump(), this.tickMs);
        return this.snapshot();
      } catch (error) {
        if (operation === this.operation && !this.disposed) {
          for (const bank of this.banks) bank.cancelLoading();
          if (this.transport.running) this.transport.pause(context.currentTime);
          this.clearTimer();
          this.clearVoices();
          this.status = "error";
          this.error = "audio-start: " + error.message;
        }
        return this.snapshot();
      } finally {
        if (this.startPromise === promise) this.startPromise = null;
      }
    })();
    this.startPromise = promise;
    return promise;
  }
  addVoice(id, when, variant = this.selectedVariant.get(id)) {
    const entry = this.playableEntry(id, variant);
    if (!entry) throw new Error("Asset is not admitted for playback");
    const voice = createLoopVoice(
      this.context,
      this.master,
      entry,
      { duration: this.bank.duration },
      when,
      this.transport.phaseSeconds(when, this.pack.bars),
    );
    this.voices.add(voice);
    voice.variant = variant;
    this.roleVoice.set(id, voice);
    ++this.stats.created;
    voice.source.onended = () => this.removeVoice(voice);
    this.record("voice-start", {
      id,
      when,
      phase: voice.phase,
      ratio: voice.ratio,
      variant,
    });
    return voice;
  }
  removeVoice(voice) {
    if (!this.voices.delete(voice)) return;
    disconnectVoice(voice);
    if (this.roleVoice.get(voice.id) === voice) this.roleVoice.delete(voice.id);
    ++this.stats.disposed;
  }
  clearVoices(fade = false) {
    const now = this.context?.currentTime || 0;
    for (const voice of [...this.voices]) {
      if (fade && this.context?.state === "running" && voice.when <= now) {
        fadeOutVoice(voice, now);
        voice.source.stop(voice.endTime);
        // onended owns disconnection; dispose/reset may remove earlier.
      } else this.removeVoice(voice);
    }
    for (const id of this.applied.keys()) {
      this.applied.set(id, false);
      this.appliedVariant.set(id, null);
    }
  }
  clearTimer() {
    if (this.timer !== null) this.timers.clearInterval(this.timer);
    this.timer = null;
  }
  cancelPending(id) {
    const change = this.pending.get(id);
    if (!change) return;
    if (change.scheduled && change.voice) {
      if (change.enabled) this.removeVoice(change.voice);
      else cancelFade(change.voice, change.at);
    }
    if (change.scheduled && change.oldVoice) {
      cancelFade(change.oldVoice, change.at);
      if (this.voices.has(change.oldVoice))
        this.roleVoice.set(id, change.oldVoice);
    }
    this.pending.delete(id);
    this.record("change-cancel", { id, at: change.at });
  }
  setLayer(id, enabled) {
    this.bank.get(id);
    if (typeof enabled !== "boolean" || this.disposed)
      throw new Error("Invalid layer state");
    this.pump();
    this.enabled.set(id, enabled);
    if (!enabled && !this.sequence) {
      this.variantOperations.set(id, this.variantOperations.get(id) + 1);
      for (const choice of this.variants.get(id).values())
        choice.bank.cancel(id);
    }
    this.queueChange(id);
    const entry = this.variantEntry(id);
    if (
      enabled &&
      this.context &&
      (this.transport.running || this.status === "loading") &&
      !entry.buffer &&
      entry.state !== "error"
    )
      return this.setVariation(id, this.selectedVariant.get(id));
  }
  queueChange(id) {
    const enabled = this.enabled.get(id),
      variant = this.selectedVariant.get(id);
    this.cancelPending(id);
    if (!this.playbackRequested || !this.transport.running) return;
    if (enabled && !this.playableEntry(id, variant)) return;
    if (
      enabled === this.applied.get(id) &&
      (!enabled || variant === this.appliedVariant.get(id))
    )
      return;
    const at = this.transport.nextBar(this.context.currentTime);
    this.pending.set(id, {
      enabled,
      variant,
      at,
      scheduled: false,
      voice: null,
      oldVoice: null,
    });
    this.record("change-queue", { id, enabled, variant, at });
    this.pump();
  }
  async setVariation(id, variant) {
    this.variantEntry(id, variant);
    if (this.disposed) return;
    this.pump();
    const previous = this.selectedVariant.get(id);
    if (previous !== variant)
      this.variants.get(id).get(previous).bank.cancel(id);
    this.selectedVariant.set(id, variant);
    const token = this.variantOperations.get(id) + 1;
    this.variantOperations.set(id, token);
    this.queueChange(id);
    const choice = this.variants.get(id).get(variant),
      operation = this.operation,
      context = this.context;
    if (!context || (!this.sequence && !this.enabled.get(id))) return;
    await choice.bank.load(id, context, { priority: 10 });
    if (
      this.disposed ||
      operation !== this.operation ||
      token !== this.variantOperations.get(id) ||
      context !== this.context
    )
      return;
    if (!this.sequence)
      this.activateLoadedLoop(id, variant, operation, context);
    else this.queueChange(id);
    return this.snapshot();
  }
  pump() {
    if (!this.transport.running || this.context?.state !== "running") return;
    if (this.sequence) return this.pumpSequence();
    ++this.stats.ticks;
    const now = this.context.currentTime;
    for (const voice of [...this.voices])
      if (voice.endTime !== null && voice.endTime <= now)
        this.removeVoice(voice);
    for (const [id, change] of this.pending) {
      if (change.enabled && !this.playableEntry(id, change.variant)) {
        this.cancelPending(id);
        continue;
      }
      if (change.scheduled && change.at <= now) {
        this.applied.set(id, change.enabled);
        this.appliedVariant.set(id, change.enabled ? change.variant : null);
        this.pending.delete(id);
        this.record("change-applied", {
          id,
          at: change.at,
          enabled: change.enabled,
          variant: change.variant,
        });
        continue;
      }
      if (!change.scheduled && change.at < now + 0.005) {
        change.at = this.transport.nextBar(now);
        ++this.stats.deferredChanges;
        this.record("change-deferred", { id, at: change.at });
      }
      if (!change.scheduled && change.at <= now + this.lookahead) {
        if (change.enabled && this.applied.get(id))
          change.oldVoice = this.roleVoice.get(id);
        change.voice = change.enabled
          ? this.addVoice(id, change.at, change.variant)
          : this.roleVoice.get(id);
        if (change.oldVoice) fadeOutVoice(change.oldVoice, change.at);
        if (!change.enabled && change.voice)
          fadeOutVoice(change.voice, change.at);
        change.scheduled = true;
        this.record("change-scheduled", {
          id,
          at: change.at,
          enabled: change.enabled,
          variant: change.variant,
          lead: change.at - now,
        });
      }
    }
  }
  configureSequence(project, variant = 1, force = false) {
    const next = validateProject(project, this.sequenceCatalog);
    const musical = (p) =>
      p
        ? JSON.stringify([
            p.pack,
            p.timing.bpm,
            p.timing.swing,
            p.patterns.map((a) => [a.id, a.steps]),
            p.activePattern,
            p.chain,
          ])
        : "";
    const reschedule = force || musical(next) !== musical(this.sequence);
    const changedKit =
      this.selectedVariant.get(this.pack.stems[0].id) !== variant;
    if (!this.variants.get(this.pack.stems[0].id).has(variant))
      throw new Error("Unknown kit");
    if (changedKit) this.pause();
    const now = this.context?.currentTime || 0,
      running = this.transport.running;
    const beat = this.transport.beatsAt(now);
    if (running && reschedule) {
      this.composition?.cancelScheduled?.(now);
      this.rememberSequencePosition(now);
      for (const v of [...this.voices]) if (v.when > now) this.removeVoice(v);
      this.transport.pause(now);
    }
    this.sequence = next;
    for (const stem of this.pack.stems)
      this.selectedVariant.set(stem.id, variant);
    this.transport.beatSeconds = secondsPerBeat(next.timing.bpm);
    this.setVolume(next.master.volume);
    this.mixer?.update(next.tracks);
    if (running && reschedule) {
      this.transport.position = beat;
      this.transport.start(now);
      this.nextStep = Math.max(
        this.passedStep + 1,
        nextStepIndex(beat, next.timing.swing),
      );
      this.pump();
    }
  }
  sequenceStepAt(time) {
    const swing = this.sequence.timing.swing;
    let index = stepIndexAtBeat(this.transport.beatsAt(time), swing);
    // Compare absolute times too, including pre-start lead and inverse-rounding.
    if (this.transport.timeAt(stepBeat(index, swing)) > time) index--;
    if (this.transport.timeAt(stepBeat(index + 1, swing)) <= time) index++;
    return index;
  }
  rememberSequencePosition(time) {
    if (this.sequence && this.transport.running)
      this.passedStep = Math.max(this.passedStep, this.sequenceStepAt(time));
  }
  nextSequenceStep(time, minimumLead) {
    const threshold = time + minimumLead,
      swing = this.sequence.timing.swing;
    let index = nextStepIndex(this.transport.beatsAt(threshold), swing);
    // Avoid losing an exactly eligible boundary to floating-point inversion.
    if (
      index > 0 &&
      this.transport.timeAt(stepBeat(index - 1, swing)) >= threshold
    )
      index--;
    if (this.transport.timeAt(stepBeat(index, swing)) < threshold) index++;
    return index;
  }
  pumpSequence() {
    ++this.stats.ticks;
    const now = this.context.currentTime;
    for (const v of [...this.voices])
      if (v.endTime !== null && v.endTime <= now) this.removeVoice(v);
    this.rememberSequencePosition(now);
    // Stale callbacks skip expired steps on the swung clock, never burst them.
    const eligible = this.nextSequenceStep(now, 0.002);
    if (this.nextStep < eligible) {
      this.record("sequence-gap", { from: this.nextStep, to: eligible });
      this.nextStep = eligible;
    }
    while (true) {
      const index = this.nextStep,
        when = this.transport.timeAt(
          stepBeat(index, this.sequence.timing.swing),
        );
      if (when > now + this.lookahead) break;
      this.nextStep++;
      if (when < now + 0.002) continue;
      this.composition?.step(index, when);
      if (!this.transport.running) return;
      for (const e of sequenceEvents(this.sequence, index, this.arrangement))
        this.addShot(e.role, when, e.velocity, { index, ...e });
    }
  }
  addShot(id, when, velocity = 1, detail = {}) {
    const entry = this.playableEntry(id);
    if (!entry || !this.mixer || this.voices.size >= 64) return;
    const prior = [...this.voices]
      .filter((v) => v.id === id && v.when <= when)
      .sort((a, b) => b.when - a.when)[0];
    const voice = scheduleShot(
      this.context,
      this.mixer,
      entry,
      when,
      velocity,
      prior,
    );
    this.voices.add(voice);
    ++this.stats.created;
    voice.source.onended = () => this.removeVoice(voice);
    this.record("shot", { id, when, velocity, ...detail });
    return voice;
  }
  async triggerPad(id) {
    if (!this.sequence || this.disposed) return;
    const context = this.ensureContext(),
      operation = this.operation;
    // A cached pad on a running clock can schedule in this gesture. A no-op
    // native resume promise can otherwise consume a short upcoming-step window.
    if (context.state !== "running") await context.resume();
    if (!this.playableEntry(id))
      await this.variants
        .get(id)
        .get(this.selectedVariant.get(id))
        .bank.load(id, context);
    if (
      this.disposed ||
      operation !== this.operation ||
      context.state !== "running"
    )
      return;
    const now = context.currentTime;
    let when = now + 0.005;
    if (this.transport.running && this.sequence.timing.quantize) {
      const index = this.nextSequenceStep(now, 0.005);
      when = this.transport.timeAt(stepBeat(index, this.sequence.timing.swing));
    }
    if (!this.playableEntry(id)) {
      this.error = "asset-failed";
      return;
    }
    return this.addShot(id, when, 1, { pad: true });
  }
  pause() {
    if (this.disposed) return;
    this.playbackRequested = false;
    this.composition?.cancelScheduled?.(this.context?.currentTime || 0);
    this.rememberSequencePosition(this.context?.currentTime || 0);
    ++this.operation;
    for (const bank of this.banks) bank.cancelLoading();
    // Permit a new gesture while an aborted decode/resume is still settling.
    this.startPromise = null;
    if (this.transport.running) this.transport.pause(this.context.currentTime);
    this.clearTimer();
    this.pending.clear();
    this.clearVoices(true);
    if (!this.disposed) this.status = "paused";
    this.record("pause", { beat: this.transport.position });
  }
  rewind() {
    if (this.disposed) return;
    this.pause();
    this.transport.reset();
    this.passedStep = -1;
    this.nextStep = 0;
  }
  reset() {
    if (this.disposed) return;
    this.rewind();
    for (const id of this.enabled.keys()) this.enabled.set(id, false);
    this.selectedVariant = new Map(this.defaultVariants);
    this.status = "ready";
    this.record("reset");
  }
  async suspend() {
    if (this.disposed) return;
    this.pause();
    const operation = this.operation;
    const context = this.context;
    await context?.suspend();
    if (
      this.disposed ||
      operation !== this.operation ||
      context !== this.context
    )
      return;
    // The state property/promise may precede the native statechange event.
    // A suspended clock cannot finish a scheduled fade/onended cleanup.
    this.clearVoices();
    if (!this.disposed) this.status = "suspended";
  }
  async retry(id) {
    if (
      !this.context ||
      this.disposed ||
      (!this.sequence && !this.enabled.get(id))
    )
      return;
    const variant = this.selectedVariant.get(id),
      choice = this.variants.get(id).get(variant),
      token = this.variantOperations.get(id) + 1,
      operation = this.operation,
      context = this.context;
    this.variantOperations.set(id, token);
    try {
      // Retry can recover an outstanding Play, but cannot reopen a later Pause.
      // Decode/cache warming also works on a paused or suspended native context.
      if (this.playbackRequested && context.state !== "running")
        await context.resume();
      if (
        this.disposed ||
        operation !== this.operation ||
        context !== this.context
      )
        return;
      await choice.bank.load(id, context, { priority: 20 });
      if (
        this.disposed ||
        token !== this.variantOperations.get(id) ||
        operation !== this.operation ||
        context !== this.context
      )
        return;
      if (!this.sequence)
        this.activateLoadedLoop(id, variant, operation, context);
      else this.queueChange(id);
    } catch (error) {
      if (operation === this.operation && !this.disposed)
        this.error = "audio-start: " + error.message;
    }
  }
  setVolume(value) {
    if (this.disposed) return;
    if (!Number.isFinite(value) || value < 0 || value > MASTER_MAX)
      throw new RangeError("Unsafe master volume");
    this.volume = value;
    this.master?.gain.setTargetAtTime(value, this.context.currentTime, 0.005);
  }
  createCapture() {
    if (!this.context || this.disposed)
      throw new Error("Audio not initialized");
    const destination = this.context.createMediaStreamDestination();
    this.output.connect(destination);
    const capture = {
      stream: destination.stream,
      dispose: () => {
        if (!this.captures.delete(capture)) return;
        try {
          this.output.disconnect(destination);
        } catch {
          /* Graph already closed. */
        }
        destination.disconnect();
        for (const track of destination.stream.getTracks()) track.stop();
      },
    };
    this.captures.add(capture);
    return capture;
  }
  snapshot() {
    return {
      status: this.status,
      playbackRequested: this.playbackRequested,
      error: this.error,
      contextState: this.context?.state || "absent",
      currentTime: this.context?.currentTime || 0,
      beat: this.transport.beatsAt(this.context?.currentTime || 0),
      origin: this.transport.origin,
      volume: this.volume,
      stems: Object.fromEntries(
        this.pack.stems.map((s) => [
          s.id,
          {
            enabled: this.enabled.get(s.id),
            active: this.applied.get(s.id),
            variant: this.selectedVariant.get(s.id),
            appliedVariant: this.appliedVariant.get(s.id),
            pendingAt: this.pending.get(s.id)?.at ?? null,
            state: this.variantEntry(s.id).state,
            error: this.variantEntry(s.id).error || null,
            metrics: this.variantEntry(s.id).metrics || null,
            progress: this.variantEntry(s.id).progress
              ? { ...this.variantEntry(s.id).progress }
              : null,
          },
        ]),
      ),
      resources: {
        voices: this.voices.size,
        timer: this.timer !== null,
        captures: this.captures.size,
        decodedBytes: this.cacheBounds().bytes,
        loading: [
          ...new Set([...this.banks].flatMap((bank) => [...bank.queues])),
        ].map((queue) => queue.snapshot()),
      },
      stats: { ...this.stats },
      events: this.events.map((event) => ({ ...event })),
      sequence: this.sequence
        ? {
            nextStep: this.nextStep,
            passedStep: this.passedStep,
            playhead: this.transport.running
              ? this.sequenceStepAt(this.context.currentTime)
              : -1,
            arrangement: this.arrangement,
          }
        : null,
    };
  }
  dispose({ immediate = false } = {}) {
    if (!this.disposePromise)
      this.disposePromise = this.releaseResources(immediate);
    return this.disposePromise;
  }
  async releaseResources(immediate = false) {
    if (this.disposed) return;
    this.disposed = true;
    this.playbackRequested = false;
    ++this.operation;
    this.clearTimer();
    const fade =
      !immediate && this.context?.state === "running" && this.voices.size > 0;
    this.clearVoices(fade);
    this.pending.clear();
    for (const bank of this.banks) bank.dispose();
    for (const capture of [...this.captures]) capture.dispose();
    this.context?.removeEventListener("statechange", this.onContextState);
    if (fade) await new Promise((resolve) => setTimeout(resolve, 8));
    this.clearVoices();
    this.master?.disconnect();
    this.mixer?.dispose();
    this.outputStage?.dispose();
    this.composition?.dispose();
    if (this.context && this.context.state !== "closed") {
      this.disposalClosePending = true;
      await this.context.close();
      this.disposalClosePending = false;
    }
    this.transport.reset();
    this.status = "disposed";
    this.record("dispose");
  }
  retryDisposedClose() {
    // Only resume the final native-close stage. Earlier cleanup failures stay
    // failures; the terminal engine is never made playable or rebuilt.
    if (!this.disposed || !this.disposalClosePending)
      return Promise.reject(new Error("No pending disposal close"));
    if (this.closeRetryPromise) return this.closeRetryPromise;
    this.closeRetryPromise = (async () => {
      if (this.context?.state !== "closed") await this.context.close();
      this.disposalClosePending = false;
      this.transport.reset();
      this.status = "disposed";
      this.record("dispose");
    })().finally(() => {
      this.closeRetryPromise = null;
    });
    return this.closeRetryPromise;
  }
}
