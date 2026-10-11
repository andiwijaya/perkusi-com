import { Transport } from "./transport.js";
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
      timers = {
        setInterval: (...args) => globalThis.setInterval(...args),
        clearInterval: (...args) => globalThis.clearInterval(...args),
      },
      lookahead = 0.12,
      tickMs = 25,
    } = {},
  ) {
    this.pack = pack;
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
    this.timer = null;
    this.startPromise = null;
    this.disposed = false;
    this.disposePromise = null;
    this.onContextState = () => {
      if (this.context.state !== "running") {
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
    const entry = this.variantEntry(id, variant);
    if (!entry.buffer) return null;
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
  async loadSelection(context, operation) {
    while (!this.disposed && operation === this.operation) {
      const selection = [...this.selectedVariant];
      await Promise.all(
        selection.map(([id, variant]) =>
          this.variants.get(id).get(variant).bank.load(id, context),
        ),
      );
      if (
        selection.every(
          ([id, variant]) => this.selectedVariant.get(id) === variant,
        )
      )
        return;
    }
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
      this.master?.disconnect();
      this.context = this.contextFactory();
      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.context.destination);
      this.context.addEventListener("statechange", this.onContextState);
    }
    return this.context;
  }
  play() {
    if (this.disposed) return Promise.reject(new Error("Engine disposed"));
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
        await Promise.all([resumed, this.loadSelection(context, operation)]);
        if (this.disposed || operation !== this.operation)
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
        for (const stem of available)
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
    this.queueChange(id);
    const entry = this.variantEntry(id);
    if (
      enabled &&
      this.transport.running &&
      !entry.buffer &&
      entry.state !== "error"
    )
      return this.setVariation(id, this.selectedVariant.get(id));
  }
  queueChange(id) {
    const enabled = this.enabled.get(id),
      variant = this.selectedVariant.get(id);
    this.cancelPending(id);
    if (!this.transport.running) return;
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
    this.selectedVariant.set(id, variant);
    const token = this.variantOperations.get(id) + 1;
    this.variantOperations.set(id, token);
    this.queueChange(id);
    const choice = this.variants.get(id).get(variant),
      operation = this.operation;
    if (!this.context || choice.bank.get(id).buffer) return;
    await choice.bank.load(id, this.context);
    if (
      this.disposed ||
      operation !== this.operation ||
      token !== this.variantOperations.get(id)
    )
      return;
    this.queueChange(id);
    return this.snapshot();
  }
  pump() {
    if (!this.transport.running || this.context?.state !== "running") return;
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
  pause() {
    if (this.disposed) return;
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
  reset() {
    if (this.disposed) return;
    this.pause();
    this.transport.reset();
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
    if (!this.context || this.disposed) return;
    const variant = this.selectedVariant.get(id),
      choice = this.variants.get(id).get(variant),
      token = this.variantOperations.get(id),
      operation = this.operation;
    await choice.bank.load(id, this.context);
    if (
      this.disposed ||
      token !== this.variantOperations.get(id) ||
      operation !== this.operation
    )
      return;
    this.queueChange(id);
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
    this.master.connect(destination);
    const capture = {
      stream: destination.stream,
      dispose: () => {
        if (!this.captures.delete(capture)) return;
        try {
          this.master.disconnect(destination);
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
          },
        ]),
      ),
      resources: {
        voices: this.voices.size,
        timer: this.timer !== null,
        captures: this.captures.size,
        decodedBytes: this.cacheBounds().bytes,
      },
      stats: { ...this.stats },
      events: this.events.map((event) => ({ ...event })),
    };
  }
  dispose() {
    if (!this.disposePromise) this.disposePromise = this.releaseResources();
    return this.disposePromise;
  }
  async releaseResources() {
    if (this.disposed) return;
    this.disposed = true;
    ++this.operation;
    this.clearTimer();
    const fade = this.context?.state === "running" && this.voices.size > 0;
    this.clearVoices(fade);
    this.pending.clear();
    for (const bank of this.banks) bank.dispose();
    for (const capture of [...this.captures]) capture.dispose();
    this.context?.removeEventListener("statechange", this.onContextState);
    if (fade) await new Promise((resolve) => setTimeout(resolve, 8));
    this.clearVoices();
    this.master?.disconnect();
    if (this.context && this.context.state !== "closed")
      await this.context.close();
    this.transport.reset();
    this.status = "disposed";
    this.record("dispose");
  }
}
