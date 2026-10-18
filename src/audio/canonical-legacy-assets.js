import { canonicalSoundKey } from "./canonical-score.js";
import { hashBytes } from "../project/canonical-data.js";
import { fail } from "../project/instrument-contract.js";

const cancelled = (s) => {
  if (s?.aborted) fail("cancelled");
};
// Fresh context-bound verified raw cache. The provider performs processing on
// its private copy, so this cache is never modified by Bumi or a loan consumer.
export function createCanonicalLegacyAssets({
  context,
  memory,
  urlFor,
  fetcher = (...a) => fetch(...a),
  beginReservation = null,
} = {}) {
  const rows = new Map(),
    jobs = new Set();
  let closed = false;
  function evict(row) {
    if (row.state === "ready" && !row.refs) {
      rows.delete(row.key);
      row.buffer = null;
      row.held.release();
    }
  }
  function lease(row) {
    row.refs++;
    let released = false;
    return Object.freeze({
      buffer: row.buffer,
      sourceHash: row.hash,
      release() {
        if (released) return;
        released = true;
        row.refs--;
        if (closed) evict(row);
      },
    });
  }
  function begin(entry, key, signal) {
    const d = entry.descriptor,
      pcm = d.frames * d.channels * 4,
      bytes = 2 * d.encodedBytes + 2 * pcm + 8192;
    if (bytes > 67108864) fail("combinedMemoryLimit");
    if (
      [...rows.values()].reduce((n, row) => n + row.pcm, 0) + pcm >
      32 * 1024 * 1024
    )
      fail("cacheMemoryLimit");
    const held = beginReservation
      ? beginReservation(entry, bytes)
      : memory.reserve(bytes, "canonical/legacy-encoded-decode-cache");
    try {
      if (closed) fail("canonicalProviderClosed");
      cancelled(signal);
      if (rows.has(key)) {
        held.release();
        return rows.get(key);
      }
      if (
        [...rows.values()].reduce((n, row) => n + row.pcm, 0) + pcm >
        32 * 1024 * 1024
      )
        fail("cacheMemoryLimit");
    } catch (error) {
      held.release();
      throw error;
    }
    const controller = new AbortController(),
      row = {
        key,
        hash: d.contentHash,
        held,
        controller,
        refs: 0,
        subscribers: 0,
        state: "loading",
        buffer: null,
        job: null,
        pcm,
      };
    rows.set(key, row);
    jobs.add(row);
    row.job = (async () => {
      try {
        const response = await fetcher(urlFor(d.contentHash), {
          signal: controller.signal,
        });
        cancelled(controller.signal);
        if (!response.ok) fail("assetFailed");
        const length = response.headers?.get("content-length");
        if (
          length !== null &&
          (!/^\d+$/.test(length) || Number(length) !== d.encodedBytes)
        )
          fail("assetLength");
        if (!response.body?.getReader) fail("unobservableAssetBody");
        const encoded = new Uint8Array(d.encodedBytes),
          reader = response.body.getReader();
        let at = 0;
        try {
          while (true) {
            const part = await reader.read();
            cancelled(controller.signal);
            if (part.done) break;
            if (
              !(part.value instanceof Uint8Array) ||
              at + part.value.length > encoded.length
            )
              fail("assetLength");
            encoded.set(part.value, at);
            at += part.value.length;
          }
        } finally {
          try {
            await reader.cancel();
          } catch {
            /* Reader is already complete/aborted. */
          }
        }
        if (at !== encoded.length) fail("assetLength");
        if ((await hashBytes(encoded)) !== d.contentHash) fail("assetHash");
        cancelled(controller.signal);
        const release = await memory
          .cachePolicy(context)
          .acquireDecode(controller.signal);
        let buffer;
        try {
          cancelled(controller.signal);
          buffer = await context.decodeAudioData(encoded.buffer);
        } finally {
          release();
        }
        cancelled(controller.signal);
        if (
          buffer.length !== d.frames ||
          buffer.sampleRate !== d.sampleRate ||
          buffer.numberOfChannels !== d.channels
        )
          throw Object.assign(Error("invalidCanonicalSample"), {
            code: "invalidCanonicalSample",
            geometry: {
              expected: {
                frames: d.frames,
                rate: d.sampleRate,
                channels: d.channels,
              },
              actual: {
                frames: buffer.length,
                rate: buffer.sampleRate,
                channels: buffer.numberOfChannels,
              },
            },
          });
        for (let c = 0; c < d.channels; c++)
          for (const x of buffer.getChannelData(c))
            if (!Number.isFinite(x) || Math.abs(x) > 0.95)
              fail("invalidCanonicalSample");
        row.buffer = buffer;
        row.state = "ready";
        held.resize(2 * pcm + 8192);
        return row;
      } catch (error) {
        row.state = "failed";
        rows.delete(key);
        held.release();
        throw error;
      } finally {
        jobs.delete(row);
      }
    })();
    row.job.catch(() => {});
    return row;
  }
  return Object.freeze({
    async acquire(entry, { signal } = {}) {
      if (closed) fail("canonicalProviderClosed");
      cancelled(signal);
      const key = canonicalSoundKey(entry.request);
      let row = rows.get(key);
      if (!row) row = begin(entry, key, signal);
      row.subscribers++;
      let aborted = false,
        abort;
      const stop = new Promise((_, reject) => {
        abort = () => {
          aborted = true;
          if (row.subscribers === 1 && row.state === "loading")
            row.controller.abort();
          reject(Object.assign(Error("cancelled"), { code: "cancelled" }));
        };
        signal?.addEventListener("abort", abort, { once: true });
      });
      try {
        await Promise.race([row.job, stop]);
        cancelled(signal);
        if (closed) fail("cancelled");
        return lease(row);
      } finally {
        signal?.removeEventListener("abort", abort);
        row.subscribers--;
        if ((closed || aborted) && !row.subscribers && row.state === "loading")
          row.controller.abort();
        if (closed) evict(row);
      }
    },
    snapshot() {
      return Object.freeze({
        closed,
        jobs: jobs.size,
        entries: rows.size,
        pins: [...rows.values()].reduce((n, r) => n + r.refs, 0),
      });
    },
    async dispose() {
      closed = true;
      for (const row of jobs) row.controller.abort();
      await Promise.allSettled([...jobs].map((row) => row.job));
      for (const row of rows.values()) evict(row);
    },
  });
}
