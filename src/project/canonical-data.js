import { array, record, fail, utf8Bytes } from "./instrument-contract.js";

export const MAX_CANONICAL_BYTES = 8 * 1024 * 1024;
export const CANONICAL_INVALID = "invalidCanonicalProject";

// Deliberately separate from the old per-project50000-node guard. Many valid
// old groups can coexist in one canonical document; all remain byte-bounded.
export function canonicalData(value) {
  const ancestors = new WeakSet();
  let nodes = 0;
  function visit(v, depth) {
    if (++nodes > 2000000 || depth > 64) fail(CANONICAL_INVALID);
    if (v === null || typeof v === "string" || typeof v === "boolean") return;
    if (typeof v === "number" && Number.isFinite(v)) return;
    if (!v || typeof v !== "object" || ancestors.has(v))
      fail(CANONICAL_INVALID);
    ancestors.add(v);
    if (Array.isArray(v)) array(v, 0, 2000000, CANONICAL_INVALID);
    else record(v, Reflect.ownKeys(v), CANONICAL_INVALID);
    for (const k of Object.keys(v))
      visit(Object.getOwnPropertyDescriptor(v, k).value, depth + 1);
    ancestors.delete(v);
  }
  visit(value, 0);
  if (utf8Bytes(JSON.stringify(value)) > MAX_CANONICAL_BYTES)
    fail("projectTooLarge");
}
export const exact = (v, keys) => record(v, keys, CANONICAL_INVALID);
export const list = (v, min, max) => array(v, min, max, CANONICAL_INVALID);
export function ensure(condition, code = CANONICAL_INVALID) {
  if (!condition) fail(code);
}
export function sameData(a, b) {
  if (a === b) return true;
  if (
    !a ||
    !b ||
    typeof a !== "object" ||
    typeof b !== "object" ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((k) => Object.hasOwn(b, k) && sameData(a[k], b[k]))
  );
}
export async function hashBytes(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}

// Wire semantics have no shared mutable object identity. Deliberately do not
// preserve aliases supplied to the object API (JSON input already has none).
export function canonicalFrozenCopy(value) {
  if (value === null || typeof value !== "object") return value;
  const copy = Array.isArray(value)
    ? value.map(canonicalFrozenCopy)
    : Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, canonicalFrozenCopy(v)]),
      );
  return Object.freeze(copy);
}
