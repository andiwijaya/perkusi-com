import { fail } from "./instrument-contract.js";

// Share only the SAME immutable Blob object, never matching hashes/content.
// Each consumer has an independent control lease and lifetime. A separate
// Blob (even with identical bytes) always reserves its complete payload.
const pools = new WeakMap();
function poolFor(memory) {
  let pool = pools.get(memory);
  if (!pool) pools.set(memory, (pool = new WeakMap()));
  return pool;
}
function reference(pool, blob, row, control) {
  row.refs++;
  let owned = blob;
  return Object.freeze({
    release() {
      if (!owned) return;
      if (--row.refs === 0) {
        pool.delete(owned);
        row.held.release();
      }
      owned = null;
      control.release();
    },
  });
}
export function retainCanonicalInputBlob(
  blob,
  memory,
  label = "canonical/input-blob-reference",
) {
  if (!(blob instanceof Blob) || typeof memory?.reserve !== "function")
    fail("invalidCanonicalPackage");
  const pool = poolFor(memory);
  const control = memory.reserve(4096, label);
  let row, candidate;
  try {
    row = pool.get(blob);
    if (!row) {
      candidate = memory.reserve(
        Math.max(1, blob.size),
        "canonical/immutable-input-blob",
      );
      // Recheck after a trusted trimmer's possible nested admission.
      row = pool.get(blob);
      if (row) candidate.release();
      else {
        row = { held: candidate, refs: 0 };
        pool.set(blob, row);
      }
      candidate = null;
    }
  } catch (error) {
    candidate?.release();
    control.release();
    throw error;
  }
  return reference(pool, blob, row, control);
}

// Reserve both assembly and the complete output BEFORE creating encoded data.
// Once assembled, only the real immutable Blob remains; URL/download readers
// retain that exact object through independent references in the same pool.
export function createCanonicalBlobAssembler(memory, bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 67108864)
    fail("combinedMemoryLimit");
  let control,
    payload,
    assembly,
    state = "preparing";
  try {
    control = memory.reserve(4096, "canonical/portable-output-reference");
    payload = memory.reserve(bytes, "canonical/portable-project-output");
    assembly = memory.reserve(bytes, "canonical/portable-project-assembly");
  } catch (error) {
    assembly?.release();
    payload?.release();
    control?.release();
    throw error;
  }
  const dispose = () => {
    if (state !== "preparing") return;
    state = "disposed";
    assembly.release();
    payload.release();
    control.release();
  };
  return Object.freeze({
    dispose,
    assemble(parts, type = "application/octet-stream") {
      if (state !== "preparing") fail("canonicalBundleReleased");
      let output;
      try {
        if (
          !Array.isArray(parts) ||
          parts.some(
            (p) =>
              !(
                p instanceof Blob ||
                p instanceof ArrayBuffer ||
                ArrayBuffer.isView(p)
              ),
          ) ||
          parts.reduce(
            (n, p) => n + (p instanceof Blob ? p.size : p.byteLength),
            0,
          ) !== bytes
        )
          fail("invalidCanonicalPackage");
        output = new Blob(parts, { type });
        if (output.size !== bytes) fail("invalidCanonicalPackage");
      } catch (error) {
        dispose();
        throw error;
      }
      const pool = poolFor(memory),
        row = { held: payload, refs: 0 };
      pool.set(output, row);
      const held = reference(pool, output, row, control);
      state = "published";
      assembly.release();
      return Object.freeze({
        get blob() {
          return output;
        },
        release() {
          if (!output) return;
          output = null;
          held.release();
        },
      });
    },
  });
}
