import { canonicalData } from "../project/canonical-data.js";
import { fail, integer } from "../project/instrument-contract.js";
const key = (d) =>
  [d.sha256, d.sampleRate, d.channels, d.frames, d.encodedBytes].join("|");

// One-batch reservation/handoff core, not an installed context cache policy.
// A claimed ticket belongs to its real cache/job until that owner releases it.
export function createCanonicalAssetEscrow(memory, descriptors) {
  canonicalData(descriptors);
  if (!Array.isArray(descriptors) || descriptors.length > 128)
    fail("invalidCanonicalProvider");
  const rows = new Map();
  const decodeOwner = Object.freeze({ kind: "canonical-asset-escrow" });
  let cancelled = false;
  try {
    for (const d of descriptors) {
      if (
        !/^[a-f0-9]{64}$/.test(d.sha256) ||
        ![44100, 48000].includes(d.sampleRate) ||
        ![1, 2].includes(d.channels) ||
        !integer(d.frames, 1, 8388608) ||
        !integer(d.encodedBytes, 1, 16777216)
      )
        fail("invalidCanonicalSample");
      const id = key(d),
        prior = rows.get(id),
        bytes =
          d.encodedBytes + Math.max(d.encodedBytes, d.frames * d.channels * 4);
      if (prior) {
        if (prior.bytes !== bytes) fail("invalidCanonicalSample");
        continue;
      }
      if (bytes > 67108864) fail("combinedMemoryLimit");
      const held = memory.reserve(
        bytes,
        "canonical/asset-escrow-encoded-hash-decode",
      );
      rows.set(id, { id, held, bytes, state: "reserved" });
    }
  } catch (error) {
    for (const row of rows.values()) row.held.release();
    throw error;
  }
  return Object.freeze({
    policy: Object.freeze({
      acquireDecode(signal) {
        return memory.cachePolicy(decodeOwner).acquireDecode(signal);
      },
      begin(d) {
        canonicalData(d);
        if (cancelled) fail("cancelled");
        const row = rows.get(key(d));
        if (!row || row.state !== "reserved") fail("canonicalAssetNotReserved");
        row.state = "claimed";
        return Object.freeze({
          resize(bytes) {
            if (row.state !== "claimed") fail("memoryReleased");
            if (!integer(bytes, 1, row.bytes)) fail("combinedMemoryLimit");
            row.held.resize(bytes);
          },
          release() {
            if (row.state === "released") return;
            row.state = "released";
            row.held.release();
          },
        });
      },
    }),
    cancel() {
      if (cancelled) return;
      cancelled = true;
      for (const row of rows.values())
        if (row.state === "reserved") {
          row.state = "released";
          row.held.release();
        }
    },
    snapshot() {
      return Object.freeze({
        cancelled,
        rows: Object.freeze(
          [...rows.values()].map((r) =>
            Object.freeze({ id: r.id, state: r.state, maximumBytes: r.bytes }),
          ),
        ),
      });
    },
  });
}
