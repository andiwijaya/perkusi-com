import {
  InstrumentRegistry,
  inspectInstrumentBuffer,
} from "./instrument-registry.js";
import { contextLoadQueue } from "./load-queue.js";
import { ResourceBudget, MAX_EXTENSION_BYTES } from "./resource-budget.js";
import {
  InstrumentError,
  fail,
  integer,
  frozenCopy,
} from "../project/instrument-contract.js";

const states = new WeakMap();
const noLegacy = () => 0;
const defaultTimers = {
  setTimeout: (...a) => globalThis.setTimeout(...a),
  clearTimeout: (...a) => globalThis.clearTimeout(...a),
};
const error = (code) => new InstrumentError(code);
const keyFor = (d) => [d.sha256, d.sampleRate, d.channels, d.frames].join("|");
function nextSequence(state) {
  if (state.counter >= Number.MAX_SAFE_INTEGER) fail("cacheSequenceLimit");
  return ++state.counter;
}

function shared(context, options) {
  const maxBytes = options.maxBytes ?? MAX_EXTENSION_BYTES,
    legacy = options.legacyRetainedBytes ?? noLegacy,
    memoryPolicy = options.memoryPolicy ?? null;
  if (
    !integer(maxBytes, 1, MAX_EXTENSION_BYTES) ||
    typeof legacy !== "function" ||
    (memoryPolicy !== null &&
      (typeof memoryPolicy.begin !== "function" ||
        typeof memoryPolicy.acquireDecode !== "function"))
  )
    fail("invalidCachePolicy");
  let state = states.get(context);
  if (state) {
    if (
      state.maxBytes !== maxBytes ||
      state.legacy !== legacy ||
      state.memoryPolicy !== memoryPolicy
    )
      fail("cachePolicyMismatch");
    return state;
  }
  state = {
    context,
    queue: contextLoadQueue(context),
    maxBytes,
    legacy,
    memoryPolicy,
    budget: new ResourceBudget({ maxBytes, historyPolicy: "monotonic" }),
    entries: new Map(),
    jobs: new Set(),
    facades: new Set(),
    tick: 0,
    counter: 0,
    scopes: 0,
    stats: {
      requests: 0,
      hits: 0,
      fetches: 0,
      decoded: 0,
      evictions: 0,
      hashFailures: 0,
      cancelled: 0,
      highWaterBytes: 0,
      highWaterNative: 0,
    },
  };
  states.set(context, state);
  return state;
}
function baseBytes(state) {
  const bytes = state.legacy();
  if (!integer(bytes, 0, state.maxBytes)) fail("invalidLegacyFootprint");
  return bytes;
}
function updateWater(state) {
  const snapshot = state.budget.snapshot();
  state.stats.highWaterBytes = Math.max(
    state.stats.highWaterBytes,
    snapshot.bytes,
  );
  state.stats.highWaterNative = Math.max(
    state.stats.highWaterNative,
    snapshot.native,
  );
}
function evict(state, entry) {
  if (!entry.buffer || entry.scopes.size || entry.currentJob) return false;
  state.budget.release(entry.allocation);
  entry.buffer = null;
  entry.metrics = null;
  entry.allocation = null;
  entry.state = "idle";
  entry.memory?.release();
  entry.memory = null;
  state.stats.evictions++;
  return true;
}
function ensureMemory(state, additional, preserve) {
  if (!integer(additional, 0, state.maxBytes)) fail("cacheMemoryLimit");
  let total = state.budget.snapshot().bytes + baseBytes(state) + additional;
  const candidates = [...state.entries.values()]
    .filter(
      (e) => e !== preserve && e.buffer && !e.scopes.size && !e.currentJob,
    )
    .sort((a, b) => a.lastUse - b.lastUse);
  for (const entry of candidates) {
    if (total <= state.maxBytes) break;
    evict(state, entry);
    total = state.budget.snapshot().bytes + baseBytes(state) + additional;
  }
  if (total > state.maxBytes) fail("cacheMemoryLimit");
}
function notify(scope, detail) {
  if (!scope.active || !scope.progress) return;
  try {
    scope.progress(Object.freeze(detail));
  } catch {
    /* A UI sink never owns loading or a foreign lease. */
  }
}
function notifyJob(job, detail) {
  for (const scope of [...job.entry.scopes.values()])
    if (scope.job === job) notify(scope, detail);
}
function releaseScope(scope, reason = "cancelled") {
  if (!scope.active) return;
  scope.active = false;
  scope.signal?.removeEventListener("abort", scope.abort);
  scope.entry.scopes.delete(scope.id);
  scope.facade.scopes.delete(scope);
  scope.state.scopes--;
  if (scope.ready) scope.state.budget.unpin(scope.entry.allocation, scope.id);
  else scope.reject(error(reason));
  if (!scope.entry.scopes.size && scope.entry.currentJob)
    scope.entry.currentJob.cancel(error("cancelled"));
  if (!scope.entry.scopes.size && scope.entry.quarantined && scope.entry.buffer)
    evict(scope.state, scope.entry);
}
function lease(scope) {
  return Object.freeze({
    get buffer() {
      if (!scope.active || !scope.ready) fail("sampleLeaseReleased");
      return scope.entry.buffer;
    },
    metrics: frozenCopy(scope.entry.metrics),
    sourceHash: scope.descriptor.sha256,
    release: () => releaseScope(scope),
    retain: () => retainScope(scope),
  });
}
function retainScope(original) {
  const { state, entry, facade } = original;
  if (
    !original.active ||
    !original.ready ||
    facade.disposed ||
    entry.quarantined
  )
    fail("sampleLeaseReleased");
  if (state.scopes >= 256) fail("cacheScopeLimit");
  ensureMemory(state, 0, entry);
  if (!original.active || facade.disposed) fail("sampleLeaseReleased");
  const scope = {
    ...original,
    id: "lease-" + nextSequence(state),
    signal: null,
    abort: null,
    progress: null,
    resolve: () => {},
    reject: () => {},
    cached: true,
  };
  entry.scopes.set(scope.id, scope);
  facade.scopes.add(scope);
  state.scopes++;
  state.budget.pin(entry.allocation, scope.id);
  return lease(scope);
}
function resolveScope(scope) {
  if (!scope.active) return;
  scope.ready = true;
  scope.state.budget.pin(scope.entry.allocation, scope.id);
  scope.resolve(lease(scope));
  notify(scope, {
    phase: "ready",
    bytes: scope.descriptor.encodedBytes,
    cached: scope.cached,
  });
}
function raceAbort(promise, signal) {
  if (signal.aborted) return Promise.reject(error("cancelled"));
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(error("cancelled"));
    };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (e) => {
        signal.removeEventListener("abort", abort);
        reject(e);
      },
    );
  });
}
function runJob(state, entry, descriptor, facade) {
  if (state.jobs.size >= 64) fail("cacheQueueFull");
  let encodedId, decodedId;
  const controller = new AbortController(),
    timers = facade.timers,
    handles = new Set();
  let logicalRelease = null,
    nativeRelease = null,
    globalNativeRelease = null,
    memory = null,
    encodedReserved = false,
    decodedReserved = false,
    nativeStarted = false,
    reader = null,
    workerStarted = false;
  const job = { state, entry, descriptor, controller, cancel: null };
  function clear(handle) {
    if (handle !== null) {
      timers.clearTimeout(handle);
      handles.delete(handle);
    }
  }
  function deadline(ms, code) {
    const handle = timers.setTimeout(() => job.cancel(error(code)), ms);
    handles.add(handle);
    return handle;
  }
  job.cancel = (reason) => {
    if (controller.signal.aborted) return;
    state.stats.cancelled++;
    controller.abort(reason);
    logicalRelease?.();
    for (const handle of handles) timers.clearTimeout(handle);
    handles.clear();
    if (nativeStarted && decodedReserved) state.budget.cancel(decodedId);
    for (const scope of [...entry.scopes.values()])
      if (scope.job === job && !scope.ready)
        releaseScope(scope, reason.code ?? "assetFailed");
    if (reader) void reader.cancel().catch(() => {});
    if (!workerStarted) {
      state.jobs.delete(job);
      if (entry.currentJob === job) {
        entry.currentJob = null;
        if (!entry.buffer) entry.state = "failed";
      }
    }
  };
  state.jobs.add(job);
  entry.currentJob = job;
  entry.state = "loading";
  const queuedDeadline = deadline(facade.deadlines.queued, "queueTimedOut");
  logicalRelease = state.queue.enqueue(async () => {
    workerStarted = true;
    clear(queuedDeadline);
    let totalDeadline = null;
    let buffer;
    try {
      totalDeadline = deadline(facade.deadlines.total, "loadTimedOut");
      const decodedBytes = descriptor.frames * descriptor.channels * 4;
      // Hash scratch and native decoded output are sequential. Reserve their
      // maximum as well as the one preallocated encoded body before fetching.
      const projected = Math.max(decodedBytes, descriptor.encodedBytes);
      ensureMemory(state, descriptor.encodedBytes + projected, entry);
      if (controller.signal.aborted || entry.currentJob !== job)
        throw error("cancelled");
      memory = state.memoryPolicy?.begin(descriptor) ?? null;
      if (
        state.memoryPolicy &&
        (!memory ||
          typeof memory.resize !== "function" ||
          typeof memory.release !== "function")
      )
        throw error("invalidMemoryOwner");
      if (controller.signal.aborted || entry.currentJob !== job)
        throw error("cancelled");
      // Issue IDs at synchronous admission, not enqueue: older queued workers
      // may start after newer canceled jobs. Never reset the context sequence.
      encodedId = "allocation-" + nextSequence(state);
      decodedId = "allocation-" + nextSequence(state);
      state.budget.reserve({
        id: encodedId,
        bytes: descriptor.encodedBytes,
        category: "encoder",
      });
      encodedReserved = true;
      state.budget.reserve({
        id: decodedId,
        bytes: projected,
        category: "decode",
      });
      decodedReserved = true;
      updateWater(state);
      const headerDeadline = deadline(
        facade.deadlines.headers,
        "headerTimedOut",
      );
      state.stats.fetches++;
      const response = await raceAbort(
        facade.fetcher(descriptor.assetPath, { signal: controller.signal }),
        controller.signal,
      );
      clear(headerDeadline);
      if (!response.ok) throw error("assetFailed");
      const rawLength = response.headers?.get?.("content-length"),
        compression = response.headers?.get?.("content-encoding");
      if (
        rawLength &&
        !compression &&
        (!/^\d+$/.test(rawLength) ||
          Number(rawLength) !== descriptor.encodedBytes)
      )
        throw error("assetLength");
      if (typeof response.body?.getReader !== "function")
        throw error("unobservableAssetBody");
      reader = response.body.getReader();
      const encoded = new Uint8Array(descriptor.encodedBytes);
      let bytes = 0;
      let idleDeadline = deadline(facade.deadlines.idle, "bodyTimedOut");
      while (true) {
        const part = await raceAbort(reader.read(), controller.signal);
        if (part.done) break;
        if (!(part.value instanceof Uint8Array)) throw error("assetFailed");
        if (bytes + part.value.byteLength > encoded.length)
          throw error("assetTooLarge");
        encoded.set(part.value, bytes);
        bytes += part.value.byteLength;
        if (part.value.byteLength) {
          clear(idleDeadline);
          idleDeadline = deadline(facade.deadlines.idle, "bodyTimedOut");
        }
        notifyJob(job, { phase: "body", bytes, totalBytes: encoded.length });
      }
      clear(idleDeadline);
      reader.releaseLock?.();
      reader = null;
      if (bytes !== encoded.length) throw error("assetLength");
      // WebCrypto digest also cannot be aborted. Keep its encoded/scratch
      // reservations until it settles, even after consumers cancel.
      const digest = await facade.digest(encoded);
      if (digest !== descriptor.sha256) {
        state.stats.hashFailures++;
        throw error("assetHash");
      }
      if (controller.signal.aborted || entry.currentJob !== job)
        throw error("cancelled");
      nativeRelease = await state.queue.acquireDecode(controller.signal);
      if (!nativeRelease || controller.signal.aborted) throw error("cancelled");
      if (state.memoryPolicy) {
        globalNativeRelease = await state.memoryPolicy.acquireDecode(
          controller.signal,
        );
        if (!globalNativeRelease || controller.signal.aborted)
          throw error("cancelled");
      }
      state.budget.activateNative(decodedId);
      nativeStarted = true;
      updateWater(state);
      const decodeDeadline = deadline(
        facade.deadlines.decode,
        "decodeTimedOut",
      );
      notifyJob(job, { phase: "decode", bytes });
      if (controller.signal.aborted || entry.currentJob !== job)
        throw error("cancelled");
      // Native decode cannot be aborted. Cancellation rejects consumers now but
      // this await, byte/native reservations and the physical slot stay owned.
      buffer = await state.context.decodeAudioData(encoded.buffer);
      clear(decodeDeadline);
      state.stats.decoded++;
      if (
        controller.signal.aborted ||
        entry.currentJob !== job ||
        !entry.scopes.size
      ) {
        state.budget.cancel(decodedId);
        state.budget.settle(
          decodedId,
          buffer.length * buffer.numberOfChannels * 4,
          "cache",
          {
            discard: () => {
              buffer = null;
            },
          },
        );
        decodedReserved = false;
        throw error("cancelled");
      }
      const metrics = inspectInstrumentBuffer(buffer, descriptor);
      ensureMemory(state, 0, entry);
      if (
        controller.signal.aborted ||
        entry.currentJob !== job ||
        !entry.scopes.size
      )
        throw error("cancelled");
      memory?.resize(metrics.bytes);
      if (
        controller.signal.aborted ||
        entry.currentJob !== job ||
        !entry.scopes.size
      )
        throw error("cancelled");
      state.budget.settle(decodedId, metrics.bytes, "cache", {
        discard: () => {
          buffer = null;
        },
      });
      decodedReserved = false;
      state.budget.release(encodedId);
      encodedReserved = false;
      nativeRelease();
      nativeRelease = null;
      globalNativeRelease?.();
      globalNativeRelease = null;
      entry.memory = memory;
      memory = null;
      entry.buffer = buffer;
      entry.metrics = metrics;
      entry.allocation = decodedId;
      entry.quarantined = false;
      entry.state = "ready";
      entry.currentJob = null;
      entry.lastUse = ++state.tick;
      for (const scope of [...entry.scopes.values()])
        if (scope.job === job) resolveScope(scope);
    } catch (e) {
      job.cancel(e instanceof InstrumentError ? e : error("assetFailed"));
      if (!entry.buffer && entry.currentJob === job) entry.state = "failed";
    } finally {
      clear(totalDeadline);
      for (const handle of handles) timers.clearTimeout(handle);
      handles.clear();
      if (reader) {
        void reader.cancel().catch(() => {});
        reader = null;
      }
      if (decodedReserved) state.budget.reject(decodedId);
      if (encodedReserved) state.budget.release(encodedId);
      nativeRelease?.();
      globalNativeRelease?.();
      memory?.release();
      logicalRelease?.();
      state.jobs.delete(job);
      if (entry.currentJob === job) entry.currentJob = null;
    }
  });
  return job;
}

export class InstrumentSampleCache {
  #data;
  constructor(context, registry, options = {}) {
    if (
      !context ||
      !integer(context.sampleRate, 8000, 192000) ||
      typeof context.decodeAudioData !== "function" ||
      !(registry instanceof InstrumentRegistry)
    )
      fail("invalidInstrumentCache");
    const data = {
      context,
      registry,
      state: null,
      scopes: new Set(),
      disposed: false,
      fetcher: options.fetcher ?? ((...a) => globalThis.fetch(...a)),
      digest:
        options.digest ??
        (async (data) =>
          [
            ...new Uint8Array(
              await globalThis.crypto.subtle.digest("SHA-256", data),
            ),
          ]
            .map((x) => x.toString(16).padStart(2, "0"))
            .join("")),
      timers: options.timers ?? defaultTimers,
      deadlines: {
        headers: 10000,
        idle: 10000,
        decode: 10000,
        total: 60000,
        queued: 60000,
        ...options.deadlines,
      },
    };
    if (
      typeof data.fetcher !== "function" ||
      typeof data.digest !== "function" ||
      typeof data.timers.setTimeout !== "function" ||
      typeof data.timers.clearTimeout !== "function" ||
      Object.values(data.deadlines).some((n) => !Number.isFinite(n) || n <= 0)
    )
      fail("invalidCacheDeadline");
    data.state = shared(context, options);
    this.#data = data;
    data.state.facades.add(data);
  }
  acquire(bankId, bankVersion, sampleId, { signal, onProgress } = {}) {
    const data = this.#data;
    if (data.disposed) return Promise.reject(error("cacheDisposed"));
    let descriptor;
    try {
      descriptor = data.registry.sample(bankId, bankVersion, sampleId);
      if (descriptor.sampleRate !== data.context.sampleRate)
        fail("unsupportedDecodeProfile");
      if (
        signal !== undefined &&
        signal !== null &&
        !(signal instanceof AbortSignal)
      )
        fail("invalidCacheSignal");
      if (signal?.aborted) fail("cancelled");
      if (onProgress !== undefined && typeof onProgress !== "function")
        fail("invalidCacheProgress");
      if (data.state.scopes >= 256) fail("cacheScopeLimit");
    } catch (e) {
      return Promise.reject(e);
    }
    const state = data.state,
      key = keyFor(descriptor);
    let entry = state.entries.get(key);
    if (!entry) {
      if (state.entries.size >= 256) {
        for (const [k, candidate] of state.entries)
          if (
            !candidate.scopes.size &&
            !candidate.currentJob &&
            !candidate.buffer
          ) {
            state.entries.delete(k);
            break;
          }
        if (state.entries.size >= 256)
          return Promise.reject(error("cacheEntryLimit"));
      }
      entry = {
        key,
        descriptor,
        scopes: new Map(),
        state: "idle",
        buffer: null,
        metrics: null,
        allocation: null,
        currentJob: null,
        lastUse: 0,
        quarantined: false,
      };
      state.entries.set(key, entry);
    }
    state.stats.requests++;
    return new Promise((resolve, reject) => {
      const scope = {
        id: "lease-" + nextSequence(state),
        state,
        entry,
        descriptor,
        facade: data,
        resolve,
        reject,
        ready: false,
        active: true,
        signal,
        progress: onProgress,
        cached: !!entry.buffer,
        job: null,
        abort: null,
      };
      scope.abort = () => releaseScope(scope);
      entry.scopes.set(scope.id, scope);
      data.scopes.add(scope);
      state.scopes++;
      signal?.addEventListener("abort", scope.abort, { once: true });
      try {
        if (entry.buffer) {
          if (entry.quarantined) fail("cachedAssetInvalid");
          let metrics;
          try {
            metrics = inspectInstrumentBuffer(entry.buffer, descriptor);
            if (
              metrics.peak !== entry.metrics.peak ||
              metrics.rms !== entry.metrics.rms
            )
              fail("cachedAssetInvalid");
          } catch (e) {
            entry.quarantined = true;
            throw e;
          }
          ensureMemory(state, 0, entry);
          if (!scope.active) return;
          state.budget.revalidate(entry.allocation, metrics.bytes);
          state.stats.hits++;
          entry.lastUse = ++state.tick;
          resolveScope(scope);
        } else {
          let job = entry.currentJob;
          if (!job || job.controller.signal.aborted)
            job = runJob(state, entry, descriptor, data);
          scope.job = job;
          notify(scope, {
            phase: "queued",
            bytes: 0,
            totalBytes: descriptor.encodedBytes,
          });
        }
      } catch (e) {
        releaseScope(scope, e.code ?? "assetFailed");
      }
    });
  }
  clear() {
    const state = this.#data.state;
    if (state.jobs.size || state.scopes) fail("cacheBusy");
    for (const entry of state.entries.values()) evict(state, entry);
    if (state.budget.snapshot().bytes) fail("cacheBusy");
    state.entries.clear();
    state.budget = new ResourceBudget({
      maxBytes: state.maxBytes,
      historyPolicy: "monotonic",
    });
  }
  trim() {
    for (const entry of this.#data.state.entries.values())
      evict(this.#data.state, entry);
  }
  dispose() {
    const data = this.#data;
    if (data.disposed) return;
    data.disposed = true;
    for (const scope of [...data.scopes]) releaseScope(scope, "cacheDisposed");
    data.state.facades.delete(data);
    if (!data.state.facades.size)
      for (const entry of data.state.entries.values()) evict(data.state, entry);
  }
  snapshot() {
    const state = this.#data.state;
    return frozenCopy({
      budget: state.budget.snapshot(),
      declaredLegacyBytes: baseBytes(state),
      queue: state.queue.snapshot(),
      activeJobs: state.jobs.size,
      activeScopes: state.scopes,
      entries: [...state.entries.values()].map((e) => ({
        key: e.key,
        state: e.state,
        decodedBytes: e.metrics?.bytes ?? 0,
        pinsAndPending: e.scopes.size,
      })),
      stats: state.stats,
    });
  }
}
