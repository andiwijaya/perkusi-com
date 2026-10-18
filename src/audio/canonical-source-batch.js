import { canonicalSoundKey } from "./canonical-score.js";
import { fail } from "../project/instrument-contract.js";
const factories = new WeakMap(),
  permits = new WeakMap();
const stamp = (d) =>
  [
    d.contentHash ?? d.sha256,
    d.sampleRate,
    d.channels,
    d.frames,
    d.encodedBytes,
    d.gainTrim,
    d.hashKind ?? "encoded-asset",
  ].join("|");

// Module-private capabilities, never a flag or byte subtraction supplied by a
// project. Stable policies are installed before a fresh cache is constructed.
export function createCanonicalSourceDispatcher(memory, context) {
  const pending = new Set(),
    cacheOwners = new Set();
  let provider = null,
    closed = false;
  function sourceLease(kind, d, bytes) {
    if (closed) fail("canonicalProviderClosed");
    const row = [...pending].find(
      (r) =>
        !r.cancelled &&
        !r.cacheClaimed &&
        r.kind === kind &&
        r.stamp === stamp(d),
    );
    const held = row
      ? ((row.cacheClaimed = true), row.cacheHeld)
      : memory.reserve(bytes, "canonical/source-cache-owned");
    if (!held) fail("canonicalSourceNotReserved");
    if (closed) {
      held.release();
      fail("canonicalProviderClosed");
    }
    const own = { held };
    cacheOwners.add(own);
    let released = false;
    return Object.freeze({
      resize: (n) => held.resize(n),
      release() {
        if (released) return;
        released = true;
        cacheOwners.delete(own);
        held.release();
      },
    });
  }
  const nativePolicy = Object.freeze({
    begin(d) {
      return sourceLease(
        "native",
        d,
        d.encodedBytes + Math.max(d.encodedBytes, d.frames * d.channels * 4),
      );
    },
    acquireDecode: (s) => memory.cachePolicy(context).acquireDecode(s),
  });
  return Object.freeze({
    nativePolicy,
    legacyBegin(entry, bytes) {
      return sourceLease("legacy", entry.descriptor, bytes);
    },
    bind(value) {
      if (provider) fail("invalidCanonicalProvider");
      provider = value;
      factories.set(provider, { memory, reserve });
    },
    close() {
      closed = true;
      for (const row of pending) {
        row.cancelled = true;
        if (!row.privateClaimed) row.privateHeld.release();
        if (!row.cacheClaimed) row.cacheHeld?.release();
      }
      pending.clear();
    },
    snapshot() {
      return Object.freeze({
        closed,
        pending: pending.size,
        cacheOwners: cacheOwners.size,
      });
    },
  });
  function reserve(requests) {
    if (closed) fail("canonicalProviderClosed");
    const rows = [];
    const keys = new Set();
    let cancelled = false;
    try {
      for (const request of requests) {
        const key = canonicalSoundKey(request);
        if (keys.has(key)) continue;
        keys.add(key);
        const d = provider.describe(request),
          pcm = d.frames * d.channels * 4,
          privateBytes = 4 * pcm + 8192,
          kind =
            request.kind === "instrument"
              ? "native"
              : request.kind === "recording"
                ? "recording"
                : "legacy",
          cacheBytes =
            kind === "native"
              ? d.encodedBytes + Math.max(d.encodedBytes, pcm)
              : kind === "legacy"
                ? 2 * d.encodedBytes + 2 * pcm + 8192
                : 2 * pcm + 4096;
        if (privateBytes > 67108864 || cacheBytes > 67108864)
          fail("combinedMemoryLimit");
        const row = {
          provider,
          memory,
          key,
          stamp: stamp(d),
          kind,
          privateHeld: null,
          cacheHeld: null,
          privateClaimed: false,
          cacheClaimed: false,
          privateReleased: false,
          cancelled: false,
        };
        rows.push(row);
        row.privateHeld = memory.reserve(
          privateBytes,
          "canonical/source-batch-private-copy",
        );
        if (closed) fail("canonicalProviderClosed");
        row.cacheHeld = memory.reserve(
          cacheBytes,
          "canonical/source-batch-cache-preflight",
        );
        if (closed) fail("canonicalProviderClosed");
        pending.add(row);
      }
    } catch (error) {
      for (const r of rows) {
        r.cancelled = true;
        pending.delete(r);
        if (!r.privateClaimed) r.privateHeld?.release();
        if (!r.cacheClaimed) r.cacheHeld?.release();
      }
      throw error;
    }
    const tokens = new Map();
    for (const row of rows) {
      const token = Object.freeze({});
      permits.set(token, row);
      tokens.set(row.key, token);
    }
    return Object.freeze({
      async load(request, options) {
        if (cancelled) fail("cancelled");
        const token = tokens.get(canonicalSoundKey(request));
        if (!token) fail("canonicalSourceNotReserved");
        try {
          return await provider.load(request, {
            ...options,
            sourceReservation: token,
          });
        } finally {
          const row = permits.get(token);
          if (!row.cacheClaimed) {
            row.cacheHeld.release();
            row.cacheClaimed = true;
          }
          pending.delete(row);
        }
      },
      dispose() {
        if (cancelled) return;
        cancelled = true;
        for (const row of rows) {
          row.cancelled = true;
          pending.delete(row);
          if (!row.privateClaimed) row.privateHeld.release();
          if (!row.cacheClaimed) {
            row.cacheHeld.release();
            row.cacheClaimed = true;
          }
        }
      },
      get pendingPrivate() {
        return rows.filter((r) => r.privateClaimed && !r.privateReleased)
          .length;
      },
    });
  }
}
export function hasCanonicalSourceBatch(provider, memory) {
  const f = factories.get(provider);
  return !!f && f.memory === memory;
}
export function reserveCanonicalSourceBatch(provider, requests, memory) {
  const f = factories.get(provider);
  if (!f || f.memory !== memory) fail("canonicalMemoryMismatch");
  return f.reserve(requests);
}
export function claimCanonicalPrivateReservation(
  token,
  provider,
  request,
  descriptor,
  memory,
) {
  const row = permits.get(token);
  if (
    !row ||
    row.cancelled ||
    row.provider !== provider ||
    row.memory !== memory ||
    row.key !== canonicalSoundKey(request) ||
    row.stamp !== stamp(descriptor) ||
    row.privateClaimed
  )
    fail("canonicalSourceNotReserved");
  row.privateClaimed = true;
  let released = false;
  return Object.freeze({
    resize: (n) => row.privateHeld.resize(n),
    release() {
      if (released) return;
      released = true;
      row.privateReleased = true;
      row.privateHeld.release();
    },
  });
}
