import { InstrumentSampleCache } from "./instrument-cache.js";
import { inspectUserTake } from "./instrument-registry.js";
import { canonicalSoundKey } from "./canonical-score.js";
import { claimCanonicalPrivateReservation } from "./canonical-source-batch.js";
import {
  canonicalData,
  canonicalFrozenCopy,
  hashBytes,
} from "../project/canonical-data.js";
import { prepareBumiBuffer } from "../beatbox/bumi-presence.js";
import { fail, integer } from "../project/instrument-contract.js";

const kinds = ["instrument", "percussion", "phrase", "bilah", "recording"];
const check = (signal) => {
  if (signal?.aborted) fail("cancelled");
};
function rights(value, localRecording = false) {
  canonicalData(value);
  const local =
    localRecording &&
    value?.scope === "local-project-data" &&
    value.commercialUse === null &&
    value.rawRedistribution === null;
  if (
    !value ||
    (!local && value.commercialUse !== true) ||
    (!local && value.rawRedistribution !== true) ||
    typeof value.licenseId !== "string" ||
    !value.licenseId ||
    typeof value.sourceWorkId !== "string" ||
    !value.sourceWorkId
  )
    fail("canonicalAssetLicense");
  return canonicalFrozenCopy(value);
}
function descriptor(value, rate) {
  canonicalData(value);
  const d = canonicalFrozenCopy(value);
  if (
    !d ||
    typeof d !== "object" ||
    !integer(d.frames, 1, 8388608) ||
    ![1, 2].includes(d.channels) ||
    d.sampleRate !== rate ||
    !integer(d.encodedBytes, 0, 16777216) ||
    !Number.isFinite(d.gainTrim) ||
    d.gainTrim < 0 ||
    d.gainTrim > 1 ||
    !/^[a-f0-9]{64}$/.test(d.contentHash) ||
    !["encoded-asset", "decoded-pcm"].includes(d.hashKind)
  )
    fail("invalidCanonicalSample");
  return d;
}
async function pcmHash(buffer) {
  const raw = new Uint8Array(buffer.length * buffer.numberOfChannels * 4),
    view = new DataView(raw.buffer);
  for (let i = 0; i < buffer.length; i++)
    for (let c = 0; c < buffer.numberOfChannels; c++)
      view.setFloat32(
        (i * buffer.numberOfChannels + c) * 4,
        buffer.getChannelData(c)[i],
        true,
      );
  return hashBytes(raw);
}

// Pure provider boundary. The default native adapter is the existing verified
// InstrumentSampleCache. Legacy/recording acquisition is an explicit trusted
// capability, not an imported URL or a synthetic fallback. No runtime/UI hooks.
export function createCanonicalAssetProvider({
  context,
  memory,
  registry,
  nativeRights = [],
  catalog = [],
  legacyAcquire = null,
  cacheOptions = {},
  nativeMemoryPolicy = null,
} = {}) {
  if (
    ![44100, 48000].includes(context?.sampleRate) ||
    typeof context.createBuffer !== "function" ||
    typeof memory?.reserve !== "function" ||
    typeof registry?.sample !== "function" ||
    !Array.isArray(catalog) ||
    catalog.length > 256 ||
    !Array.isArray(nativeRights) ||
    nativeRights.length > 256 ||
    (legacyAcquire !== null && typeof legacyAcquire !== "function")
  )
    fail("invalidCanonicalProvider");
  const rate = context.sampleRate,
    entries = new Map(),
    native = new Map(),
    jobs = new Set(),
    loans = new Set();
  for (const item of nativeRights) {
    canonicalData(item);
    const r = rights(item.rights),
      key = canonicalSoundKey({ kind: "instrument", ...item.request });
    if (native.has(key)) fail("invalidCanonicalProvider");
    native.set(key, r);
  }
  for (const item of catalog) {
    canonicalData(item);
    const request = canonicalFrozenCopy(item.request);
    if (!kinds.includes(request.kind) || request.kind === "instrument")
      fail("invalidCanonicalProvider");
    const key = canonicalSoundKey(request),
      d = descriptor(item.descriptor, rate),
      r = rights(item.rights, request.kind === "recording");
    const processing = item.processing ?? "none";
    if (
      !["none", "bumi-presence-v1"].includes(processing) ||
      (processing !== "none" &&
        (request.kind !== "phrase" ||
          request.pack.processing !== processing)) ||
      (request.kind === "phrase" && request.pack.processing !== processing) ||
      entries.has(key)
    )
      fail("invalidCanonicalProvider");
    entries.set(
      key,
      Object.freeze({ request, descriptor: d, rights: r, processing }),
    );
  }
  let cache = null,
    closing = false,
    disposed = false,
    resolveDisposed;
  const cleanupFaults = new Set();
  let rejectDisposed,
    disposalRejected = false,
    disposal;
  function newDisposal() {
    disposalRejected = false;
    disposal = new Promise((resolve, reject) => {
      resolveDisposed = resolve;
      rejectDisposed = reject;
    });
    disposal.catch(() => {});
  }
  newDisposal();
  function releaseOwned(own) {
    try {
      own.source.release();
    } catch (error) {
      cleanupFaults.add(own);
      throw error;
    }
    cleanupFaults.delete(own);
    own.held?.release();
  }
  function finish() {
    if (closing && !jobs.size && !loans.size && !disposed) {
      if (cleanupFaults.size) {
        disposalRejected = true;
        rejectDisposed(
          Object.assign(Error("canonicalProviderCleanupPending"), {
            code: "canonicalProviderCleanupPending",
          }),
        );
        return;
      }
      disposed = true;
      cache?.dispose();
      resolveDisposed();
    }
  }
  function resolve(request) {
    canonicalData(request);
    if (!request || !kinds.includes(request.kind))
      fail("canonicalAssetUnavailable");
    if (request.kind !== "instrument") {
      const e = entries.get(canonicalSoundKey(request));
      if (!e) fail("canonicalAssetUnavailable");
      if (
        request.kind === "recording" &&
        (request.asset.sha256 !== e.descriptor.contentHash ||
          request.asset.frames !== e.descriptor.frames ||
          request.asset.channels !== e.descriptor.channels ||
          request.asset.sampleRate !== rate)
      )
        fail("canonicalAssetIdentityMismatch");
      return e;
    }
    const s = registry.sample(
        request.bankId,
        request.version,
        request.sampleId,
      ),
      r = native.get(canonicalSoundKey(request));
    if (!r || r.licenseId !== s.licenseId || r.sourceWorkId !== s.sourceWorkId)
      fail("canonicalAssetLicense");
    return Object.freeze({
      request: Object.freeze({
        kind: "instrument",
        bankId: request.bankId,
        version: request.version,
        sampleId: request.sampleId,
      }),
      descriptor: descriptor(
        {
          frames: s.frames,
          channels: s.channels,
          sampleRate: s.sampleRate,
          encodedBytes: s.encodedBytes,
          gainTrim: s.gainTrim,
          contentHash: s.sha256,
          hashKind: "encoded-asset",
        },
        rate,
      ),
      rights: r,
      processing: "none",
    });
  }
  const provider = Object.freeze({
    purpose: "production",
    describe(request) {
      if (closing) fail("canonicalProviderClosed");
      return resolve(request).descriptor;
    },
    async load(request, { signal, sourceReservation } = {}) {
      if (closing) fail("canonicalProviderClosed");
      check(signal);
      if (jobs.size + loans.size >= 64) fail("canonicalProviderBusy");
      const entry = resolve(request),
        d = entry.descriptor,
        controller = new AbortController(),
        job = { controller };
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      jobs.add(job);
      let source = null,
        held = null,
        published = false;
      try {
        check(controller.signal);
        // Native clone+view and sequential interleaved/hash scratch. The source
        // cache retains its OWN existing lease; no guessed subtraction/handoff.
        const privateBytes = d.frames * d.channels * 16 + 8192;
        if (privateBytes > 67108864) fail("combinedMemoryLimit");
        held = sourceReservation
          ? claimCanonicalPrivateReservation(
              sourceReservation,
              provider,
              request,
              d,
              memory,
            )
          : memory.reserve(
              privateBytes,
              "canonical/provider-private-loan-and-digest",
            );
        check(controller.signal);
        if (entry.request.kind === "instrument") {
          cache ??= new InstrumentSampleCache(context, registry, {
            ...cacheOptions,
            memoryPolicy: nativeMemoryPolicy ?? memory.cachePolicy(context),
          });
          source = await cache.acquire(
            entry.request.bankId,
            entry.request.version,
            entry.request.sampleId,
            { signal: controller.signal },
          );
        } else {
          if (!legacyAcquire) fail("canonicalAssetUnavailable");
          source = await legacyAcquire(entry, {
            context,
            memory,
            signal: controller.signal,
          });
        }
        if (!source || typeof source.release !== "function")
          fail("invalidCanonicalProvider");
        check(controller.signal);
        if (source.sourceHash !== d.contentHash)
          fail("canonicalAssetIdentityMismatch");
        const input = source.buffer;
        if (
          input?.length !== d.frames ||
          input.sampleRate !== rate ||
          input.numberOfChannels !== d.channels ||
          typeof input.copyFromChannel !== "function"
        )
          fail("invalidCanonicalSample");
        const copy = context.createBuffer(d.channels, d.frames, rate);
        for (let c = 0; c < d.channels; c++) {
          const target = copy.getChannelData(c);
          input.copyFromChannel(target, c, 0);
          for (const value of target)
            if (!Number.isFinite(value)) fail("invalidCanonicalSample");
        }
        const recordingDiagnostics =
          entry.request.kind === "recording" ? inspectUserTake(copy) : null;
        const decodedHash = await pcmHash(copy);
        check(controller.signal);
        if (d.hashKind === "decoded-pcm" && decodedHash !== d.contentHash)
          fail("canonicalAssetIdentityMismatch");
        if (entry.processing === "bumi-presence-v1")
          prepareBumiBuffer(copy, { id: entry.request.role });
        const processedHash =
          entry.processing === "none" ? decodedHash : await pcmHash(copy);
        check(controller.signal);
        for (let c = 0; c < d.channels; c++)
          for (const value of copy.getChannelData(c))
            if (
              !Number.isFinite(value) ||
              (entry.request.kind !== "recording" && Math.abs(value) > 0.95)
            )
              fail("invalidCanonicalSample");
        held.resize(d.frames * d.channels * 8 + 8192);
        const own = { source, held };
        loans.add(own);
        const receipt = Object.freeze({
          encodedHash: d.hashKind === "encoded-asset" ? d.contentHash : null,
          decodedHash,
          processedHash,
          processing: entry.processing,
          rate,
          rights: entry.rights,
          recordingDiagnostics,
        });
        let released = false;
        const loan = Object.freeze({
          buffer: copy,
          verifiedHash: d.contentHash,
          receipt,
          release() {
            if (released) return;
            released = true;
            loans.delete(own);
            try {
              releaseOwned(own);
            } finally {
              finish();
            }
          },
        });
        published = true;
        return loan;
      } finally {
        signal?.removeEventListener("abort", abort);
        jobs.delete(job);
        try {
          if (!published) {
            if (source) releaseOwned({ source, held });
            else held?.release();
          }
        } finally {
          finish();
        }
      }
    },
    snapshot() {
      return Object.freeze({
        closing,
        disposed,
        jobs: jobs.size,
        loans: loans.size,
        pendingCleanup: cleanupFaults.size,
        cache: cache?.snapshot() ?? null,
        legacyHookInstalled: false,
        uiReady: false,
      });
    },
    dispose() {
      if (disposalRejected) newDisposal();
      if (!closing) {
        closing = true;
        for (const job of jobs) job.controller.abort();
      }
      for (const own of [...cleanupFaults])
        try {
          releaseOwned(own);
        } catch {
          /* Unknown ownership remains charged for explicit retry. */
        }
      finish();
      return disposal;
    },
  });
  return provider;
}
