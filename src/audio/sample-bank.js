import { secondsPerBeat } from "./transport.js";
import { contextLoadQueue } from "./load-queue.js";

export function validatePack(pack, { maxOneShotSeconds = 2 } = {}) {
  // Explicit delivery profile, never inferred from project data. Existing
  // Studio/Beatbox callers keep the original two-second one-shot contract.
  if (
    !Number.isInteger(maxOneShotSeconds) ||
    maxOneShotSeconds < 2 ||
    maxOneShotSeconds > 30
  )
    throw new Error("Invalid one-shot duration profile");
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
        stem.durationSeconds > maxOneShotSeconds)
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
  constructor(pack, options = {}) {
    const {
      fetcher = (...args) => globalThis.fetch(...args),
      timeoutMs,
      totalTimeoutMs = timeoutMs ?? 60000,
      headerTimeoutMs = 10000,
      idleTimeoutMs = 10000,
      decodeTimeoutMs = 10000,
      queueTimeoutMs = timeoutMs ?? 60000,
      now = () => performance.now(),
      validateCandidate = () => {},
      prepareBuffer = null,
      maxOneShotSeconds = 2,
      timers = {
        setTimeout: (...args) => globalThis.setTimeout(...args),
        clearTimeout: (...args) => globalThis.clearTimeout(...args),
      },
    } = options;
    this.pack = validatePack(pack, { maxOneShotSeconds });
    this.fetcher = fetcher;
    this.timeoutMs = totalTimeoutMs;
    this.legacyDeadline =
      timeoutMs !== undefined && options.totalTimeoutMs === undefined;
    this.budgets = {
      total: totalTimeoutMs,
      headers: headerTimeoutMs,
      body: idleTimeoutMs,
      decode: decodeTimeoutMs,
      queued: queueTimeoutMs,
    };
    for (const value of Object.values(this.budgets))
      if (!Number.isFinite(value) || value <= 0)
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
        { stem, state: "idle", buffer: null, generation: 0, progress: null },
      ]),
    );
    this.disposed = false;
    this.duration = pack.bars * pack.beatsPerBar * secondsPerBeat(pack.bpm);
    this.queues = new Set();
  }
  get(id) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error("Unknown stem: " + id);
    return entry;
  }
  load(id, context, { priority = 0 } = {}) {
    const entry = this.get(id);
    if (this.disposed) return Promise.reject(new Error("Bank disposed"));
    if (entry.buffer) return Promise.resolve(this.verifyRetained(id));
    if (entry.promise) return entry.promise;
    const generation = ++entry.generation,
      controller = new AbortController();
    const queue = contextLoadQueue(context);
    this.queues.add(queue);
    Object.assign(entry, {
      controller,
      state: "loading",
      error: null,
      progress: { phase: "queued", loaded: 0, total: null },
    });
    let settle;
    const promise = new Promise((resolve) => {
      settle = resolve;
    });
    const request = {
      done: false,
      finish: null,
      started: null,
      phaseDeadline: this.now() + this.budgets.queued,
      totalDeadline: Infinity,
      timers: new Set(),
      reader: null,
      release: null,
    };
    entry.request = request;
    entry.promise = promise;
    const clear = (key) => {
      if (request[key] !== undefined) {
        this.timers.clearTimeout(request[key]);
        request.timers.delete(request[key]);
        delete request[key];
      }
    };
    const timer = (key, ms, fn) => {
      clear(key);
      request[key] = this.timers.setTimeout(fn, ms);
      request.timers.add(request[key]);
    };
    const fail = (code) =>
      request.finish(
        "error",
        null,
        null,
        this.legacyDeadline ? "timeout" : code,
      );
    request.finish = (state, buffer = null, metrics = null, error = null) => {
      if (request.done) return;
      request.done = true;
      for (const task of request.timers) this.timers.clearTimeout(task);
      request.timers.clear();
      if (state !== "ready") {
        controller.abort();
        void request.reader?.cancel().catch(() => {});
      }
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
          progress:
            state === "ready" ? { ...entry.progress, phase: "ready" } : null,
        });
      }
      request.release?.();
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
      if (this.now() >= request.totalDeadline) {
        fail("total-timeout");
        return false;
      }
      if (this.now() >= request.phaseDeadline) {
        fail(
          entry.progress.phase === "queued"
            ? "queue-timeout"
            : entry.progress.phase === "headers"
              ? "headers-timeout"
              : entry.progress.phase === "decoding"
                ? "decode-timeout"
                : "body-stalled",
        );
        return false;
      }
      return true;
    };
    const phase = (name, budget, error) => {
      entry.progress = { ...entry.progress, phase: name };
      request.phaseDeadline = this.now() + budget;
      timer("phaseTimer", budget, () => fail(error));
    };
    timer("phaseTimer", this.budgets.queued, () => fail("queue-timeout"));
    const worker = async () => {
      if (!live()) return;
      request.started = this.now();
      request.totalDeadline = request.started + this.budgets.total;
      timer("totalTimer", this.budgets.total, () => fail("total-timeout"));
      phase(
        "headers",
        Math.min(this.budgets.headers, this.budgets.total),
        "headers-timeout",
      );
      try {
        const response = await this.fetcher(entry.stem.url, {
          signal: controller.signal,
        });
        if (!live()) return;
        if (!response.ok) throw new Error("Asset HTTP " + response.status);
        const length = Number(response.headers?.get("content-length"));
        if (Number.isFinite(length) && length > 4 * 1024 * 1024)
          throw new Error("Asset size limit");
        const encoding = response.headers?.get("content-encoding");
        entry.progress.total =
          !encoding || encoding === "identity"
            ? Number.isInteger(length) && length > 0
              ? length
              : null
            : null;
        phase(
          "body",
          Math.min(this.budgets.body, this.budgets.total),
          "body-stalled",
        );
        let bytes;
        if (response.body?.getReader) {
          const reader = response.body.getReader(),
            chunks = [];
          request.reader = reader;
          try {
            while (live()) {
              const { done, value } = await reader.read();
              if (!live()) return;
              if (done) break;
              if (!value?.byteLength) continue;
              entry.progress.loaded += value.byteLength;
              if (entry.progress.loaded > 4 * 1024 * 1024)
                throw new Error("Asset size limit");
              chunks.push(value);
              // Only genuine positive bytes extend inactivity, never headers,
              // zero chunks, UI polls or a promise that has not delivered data.
              phase("body", this.budgets.body, "body-stalled");
            }
            if (!live()) return;
            bytes = new Uint8Array(entry.progress.loaded);
            let offset = 0;
            for (const chunk of chunks) {
              bytes.set(chunk, offset);
              offset += chunk.byteLength;
            }
            bytes = bytes.buffer;
          } finally {
            reader.releaseLock();
            request.reader = null;
          }
        } else {
          // Non-streaming adapters have no observable progress: their whole
          // body remains bounded by inactivity; no fictitious byte updates.
          bytes = await response.arrayBuffer();
          if (!live()) return;
          entry.progress.loaded = bytes.byteLength;
        }
        if (!live()) return;
        if (!bytes.byteLength || bytes.byteLength > 4 * 1024 * 1024)
          throw new Error("Asset size limit");
        if (
          entry.progress.total !== null &&
          entry.progress.loaded !== entry.progress.total
        )
          throw new Error("Incomplete asset body");
        phase(
          "decoding",
          Math.min(this.budgets.decode, this.budgets.total),
          "decode-timeout",
        );
        const releaseDecode = await queue.acquireDecode(controller.signal);
        if (!releaseDecode) return;
        let buffer;
        try {
          if (!live()) return;
          buffer = await context.decodeAudioData(bytes);
        } finally {
          releaseDecode();
        }
        if (!live()) return;
        const duration =
          this.pack.kind === "one-shot"
            ? entry.stem.durationSeconds
            : this.duration;
        let metrics = inspectBuffer(buffer, duration);
        if (this.prepareBuffer) {
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
          this.validateCandidate(entry, metrics);
          if (live()) request.finish("ready", buffer, metrics);
        }
      } catch (error) {
        if (live()) request.finish("error", null, null, error.message);
      }
    };
    request.release = queue.enqueue(worker, priority);
    return promise;
  }
  verifyRetained(id) {
    const entry = this.get(id);
    if (!entry.buffer) return null;
    try {
      const b = entry.buffer,
        m = entry.metrics;
      const duration =
        this.pack.kind === "one-shot"
          ? entry.stem.durationSeconds
          : this.duration;
      if (
        !m ||
        !b.length ||
        b.numberOfChannels < 1 ||
        b.numberOfChannels > 2 ||
        b.sampleRate < 8000 ||
        Math.abs(b.duration - duration) > 2 / b.sampleRate ||
        m.bytes !== b.length * b.numberOfChannels * 4 ||
        !Number.isFinite(m.peak) ||
        m.peak <= 0 ||
        m.peak > 0.95 ||
        !Number.isFinite(m.rms) ||
        m.rms <= 0
      )
        throw new Error("Invalid cached audio metrics");
      this.validateCandidate(entry, m);
      return b;
    } catch (error) {
      Object.assign(entry, {
        state: "error",
        buffer: null,
        metrics: null,
        progress: null,
        error: error.message,
      });
      return null;
    }
  }
  loadAll(context) {
    return Promise.all(
      this.pack.stems.map((stem) => this.load(stem.id, context)),
    );
  }
  cancel(id) {
    this.get(id).request?.finish("idle");
  }
  cancelLoading() {
    for (const entry of this.entries.values()) entry.request?.finish("idle");
  }
  evictCache() {
    // Caller must first stop/disconnect its voices. This drops retained cache
    // references only; native decode leases remain owned until real settlement.
    this.cancelLoading();
    for (const entry of this.entries.values())
      Object.assign(entry, {
        buffer: null,
        metrics: null,
        state: this.disposed ? "disposed" : "idle",
        progress: null,
        error: null,
      });
  }
  dispose() {
    this.disposed = true;
    this.cancelLoading();
    for (const entry of this.entries.values())
      Object.assign(entry, {
        buffer: null,
        metrics: null,
        state: "disposed",
        progress: null,
      });
  }
  loadingResources() {
    return [...this.queues].map((queue) => queue.snapshot());
  }
  snapshot() {
    return Object.fromEntries(
      [...this.entries].map(([id, e]) => [
        id,
        {
          state: e.state,
          error: e.error || null,
          metrics: e.metrics || null,
          progress: e.progress ? { ...e.progress } : null,
        },
      ]),
    );
  }
}
