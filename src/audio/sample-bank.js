import { secondsPerBeat } from "./transport.js";

export function validatePack(pack) {
  if (pack.schemaVersion !== 1 || !/^[a-z0-9-]+$/.test(pack.id))
    throw new Error("Invalid pack identity");
  secondsPerBeat(pack.bpm);
  if (
    pack.beatsPerBar !== 4 ||
    !Number.isInteger(pack.bars) ||
    pack.bars < 1 ||
    pack.bars > 8
  )
    throw new Error("Invalid loop geometry");
  if (!Array.isArray(pack.stems) || !pack.stems.length || pack.stems.length > 8)
    throw new Error("Invalid stem count");
  const ids = new Set();
  for (const stem of pack.stems) {
    if (
      pack.kind === "one-shot" &&
      (!Number.isFinite(stem.durationSeconds) ||
        stem.durationSeconds <= 0 ||
        stem.durationSeconds > 2)
    )
      throw new Error("Invalid one-shot geometry");
    if (
      !/^[a-z0-9-]+$/.test(stem.id) ||
      ids.has(stem.id) ||
      !stem.url ||
      !stem.licenseId
    )
      throw new Error("Invalid stem provenance/identity");
    if (
      !Number.isFinite(stem.gainTrim) ||
      stem.gainTrim < 0 ||
      stem.gainTrim > 1
    )
      throw new Error("Unsafe stem gain");
    ids.add(stem.id);
  }
  return pack;
}

export function inspectBuffer(buffer, expectedDuration) {
  if (
    !buffer.length ||
    buffer.numberOfChannels < 1 ||
    buffer.numberOfChannels > 2 ||
    buffer.sampleRate < 8000
  )
    throw new Error("Invalid decoded buffer");
  if (Math.abs(buffer.duration - expectedDuration) > 2 / buffer.sampleRate)
    throw new Error("Loop duration differs from pack timing");
  let peak = 0,
    energy = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++)
    for (const sample of buffer.getChannelData(channel)) {
      if (!Number.isFinite(sample)) throw new Error("Non-finite audio sample");
      peak = Math.max(peak, Math.abs(sample));
      energy += sample * sample;
    }
  if (!energy || peak > 0.95) throw new Error("Silent or unsafe decoded asset");
  return {
    peak,
    rms: Math.sqrt(energy / (buffer.length * buffer.numberOfChannels)),
    bytes: buffer.length * buffer.numberOfChannels * 4,
  };
}

export class SampleBank {
  constructor(
    pack,
    {
      fetcher = (...args) => globalThis.fetch(...args),
      timeoutMs = 10000,
      now = () => performance.now(),
      validateCandidate = () => {},
      prepareBuffer = null,
      timers = {
        setTimeout: (...args) => globalThis.setTimeout(...args),
        clearTimeout: (...args) => globalThis.clearTimeout(...args),
      },
    } = {},
  ) {
    this.pack = validatePack(pack);
    this.fetcher = fetcher;
    this.timeoutMs = timeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
      throw new Error("Invalid load deadline");
    this.now = now;
    this.validateCandidate = validateCandidate;
    if (prepareBuffer !== null && typeof prepareBuffer !== "function")
      throw new TypeError("Invalid buffer preparation");
    this.prepareBuffer = prepareBuffer;
    this.timers = timers;
    this.entries = new Map(
      pack.stems.map((stem) => [
        stem.id,
        { stem, state: "idle", buffer: null, generation: 0 },
      ]),
    );
    this.disposed = false;
    this.duration = pack.bars * pack.beatsPerBar * secondsPerBeat(pack.bpm);
  }
  get(id) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error("Unknown stem: " + id);
    return entry;
  }
  load(id, context) {
    const entry = this.get(id);
    if (this.disposed) return Promise.reject(new Error("Bank disposed"));
    if (entry.buffer) return Promise.resolve(entry.buffer);
    if (entry.promise) return entry.promise;
    const generation = ++entry.generation;
    const controller = new AbortController();
    entry.controller = controller;
    entry.state = "loading";
    entry.error = null;
    const deadline = this.now() + this.timeoutMs;
    let settle;
    const promise = new Promise((resolve) => {
      settle = resolve;
    });
    const request = { done: false, finish: null };
    entry.request = request;
    entry.promise = promise;
    request.finish = (state, buffer = null, metrics = null, error = null) => {
      if (request.done) return;
      request.done = true;
      this.timers.clearTimeout(request.timeout);
      if (state !== "ready") controller.abort();
      if (entry.request === request && generation === entry.generation) {
        ++entry.generation;
        Object.assign(entry, {
          state: this.disposed ? "disposed" : state,
          buffer,
          metrics,
          error,
          promise: null,
          controller: null,
          timeout: null,
          request: null,
        });
      }
      settle(buffer);
    };
    const live = () => {
      if (
        request.done ||
        this.disposed ||
        entry.request !== request ||
        generation !== entry.generation
      )
        return false;
      if (this.now() >= deadline) {
        request.finish("error", null, null, "timeout");
        return false;
      }
      return true;
    };
    request.timeout = this.timers.setTimeout(
      () => request.finish("error", null, null, "timeout"),
      this.timeoutMs,
    );
    entry.timeout = request.timeout;
    // This worker may outlive its bounded logical promise: native decode is not
    // abortable. Every continuation is guarded and stale rejection is consumed.
    void (async () => {
      try {
        const response = await this.fetcher(entry.stem.url, {
          signal: controller.signal,
        });
        if (!live()) return;
        if (!response.ok) throw new Error("Asset HTTP " + response.status);
        const bytes = await response.arrayBuffer();
        if (!live()) return;
        if (!bytes.byteLength || bytes.byteLength > 4 * 1024 * 1024)
          throw new Error("Asset size limit");
        let buffer = await context.decodeAudioData(bytes);
        if (!live()) return;
        const duration =
          this.pack.kind === "one-shot"
            ? entry.stem.durationSeconds
            : this.duration;
        let metrics = inspectBuffer(buffer, duration);
        if (this.prepareBuffer) {
          // Validate both original and prepared PCM, then admit the final metrics.
          // Preparation is synchronous and happens once per fresh decode, never
          // per voice/start/variant switch. Cached geometry and memory stay fixed.
          buffer = this.prepareBuffer(buffer, entry.stem);
          metrics = inspectBuffer(buffer, duration);
        }
        const used = [...this.entries.values()].reduce(
          (sum, item) => sum + (item.metrics?.bytes || 0),
          0,
        );
        if (used + metrics.bytes > 32 * 1024 * 1024)
          throw new Error("Decoded bank memory limit");
        if (live()) {
          // Synchronous admission and publication form one turn: engine-wide
          // reservations cannot be bypassed by a stale UI intent or another bank.
          this.validateCandidate(entry, metrics);
          if (live()) request.finish("ready", buffer, metrics);
        }
      } catch (error) {
        if (live()) request.finish("error", null, null, error.message);
      }
    })();
    return promise;
  }
  loadAll(context) {
    return Promise.all(
      this.pack.stems.map((stem) => this.load(stem.id, context)),
    );
  }
  cancelLoading() {
    for (const entry of this.entries.values()) entry.request?.finish("idle");
  }
  dispose() {
    this.disposed = true;
    this.cancelLoading();
    for (const entry of this.entries.values())
      Object.assign(entry, { buffer: null, metrics: null, state: "disposed" });
  }
  snapshot() {
    return Object.fromEntries(
      [...this.entries].map(([id, e]) => [
        id,
        { state: e.state, error: e.error || null, metrics: e.metrics || null },
      ]),
    );
  }
}
