import { fail, integer } from "../project/instrument-contract.js";
const pools = new WeakMap();
const pool = (memory) => {
  if (!pools.has(memory)) pools.set(memory, { next: 0, rows: new Map() });
  return pools.get(memory);
};
// Internal/native-owner capability, never an imported project field. Every new
// context/backend shares the pool attached to the same workspace AudioMemory.
// A legacy owner must register its real pending/live owners before integration.
export function reserveCanonicalVoiceOwners(memory, { count, peak, label }) {
  if (
    !integer(count, 0, 16) ||
    !Number.isFinite(peak) ||
    peak < 0 ||
    typeof label !== "string"
  )
    fail("invalidCanonicalOwner");
  const p = pool(memory);
  let total = count,
    weight = peak;
  for (const r of p.rows.values()) {
    total += r.count;
    weight += r.peak;
  }
  if (total > 16) fail("voiceLimit");
  if (weight > 0.95) fail("voiceHeadroom");
  const held = memory.reserve(
      1024 + count * 8192,
      "canonical/pending-native-owner-ticket",
    ),
    id = "canonical-owner-" + ++p.next;
  // A trusted memory trimmer can synchronously admit another owner. Recheck
  // the ledger after reservation, before publishing this pending owner.
  let afterCount = count,
    afterPeak = peak;
  for (const r of p.rows.values()) {
    afterCount += r.count;
    afterPeak += r.peak;
  }
  if (afterCount > 16 || afterPeak > 0.95) {
    held.release();
    fail(afterCount > 16 ? "voiceLimit" : "voiceHeadroom");
  }
  p.rows.set(id, { id, count, peak, label });
  let released = false;
  return Object.freeze({
    id,
    release() {
      if (released) return;
      released = true;
      p.rows.delete(id);
      held.release();
    },
  });
}
export function canonicalVoiceOwners(memory) {
  const p = pool(memory);
  return Object.freeze({
    count: [...p.rows.values()].reduce((n, r) => n + r.count, 0),
    peak: [...p.rows.values()].reduce((n, r) => n + r.peak, 0),
    owners: Object.freeze(
      [...p.rows.values()].map((r) => Object.freeze({ ...r })),
    ),
  });
}

// Reserve the COMPLETE graph/node allowance before its first native allocation.
// Child helpers use subleases; they cannot grow or release the parent's pool.
export function canonicalAllocationScope(memory, bytes, label) {
  const held = memory.reserve(bytes, label),
    children = new Set();
  let used = 0,
    released = false;
  return {
    memory: {
      reserve(n, childLabel) {
        if (released || !integer(n, 1, bytes) || used + n > bytes)
          fail("combinedMemoryLimit");
        const child = { n, label: childLabel };
        used += n;
        children.add(child);
        let done = false;
        return {
          release() {
            if (done) return;
            done = true;
            used -= n;
            children.delete(child);
          },
        };
      },
    },
    release() {
      if (released) return;
      if (children.size) fail("canonicalAllocationStillOwned");
      released = true;
      held.release();
    },
    get usedBytes() {
      return used;
    },
  };
}
