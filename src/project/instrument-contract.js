// Opt-in foundation guards. No legacy validator/constants are modified.
export class InstrumentError extends Error {
  constructor(code, options) {
    super(code, options);
    this.name = "InstrumentError";
    this.code = code;
  }
}
export const fail = (code) => {
  throw new InstrumentError(code);
};
export const integer = (value, min, max) =>
  Number.isSafeInteger(value) &&
  !Object.is(value, -0) &&
  value >= min &&
  value <= max;
export const finite = (value, min, max) =>
  Number.isFinite(value) && value >= min && value <= max;
export const identifier = (value) =>
  typeof value === "string" && /^[a-z0-9-]{1,64}$/.test(value);
export const version = (value) =>
  typeof value === "string" && /^[a-z0-9.-]{1,64}$/.test(value);
export const utf8Bytes = (value) => new TextEncoder().encode(value).length;
export function record(value, keys, code) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail(code);
  const own = Reflect.ownKeys(value);
  const allowed = new Set(keys);
  if (
    own.length !== keys.length ||
    allowed.size !== keys.length ||
    own.some((k) => typeof k !== "string" || !allowed.has(k))
  )
    fail(code);
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !Object.hasOwn(d, "value") || !d.enumerable) fail(code);
  }
}
export function array(value, min, max, code) {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length < min ||
    value.length > max ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    fail(code);
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !Object.hasOwn(d, "value") || !d.enumerable) fail(code);
  }
}
// Reject accessors before reading any value, including nested legacy data.
export function dataTree(value, code) {
  let count = 0;
  const ancestors = new WeakSet();
  function visit(v, depth) {
    if (++count > 50000 || depth > 32) fail(code);
    if (v === null || ["string", "boolean"].includes(typeof v)) return;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) fail(code);
      return;
    }
    if (!v || typeof v !== "object" || ancestors.has(v)) fail(code);
    ancestors.add(v);
    if (Array.isArray(v)) array(v, 0, 50000, code);
    else record(v, Reflect.ownKeys(v), code);
    for (const key of Object.keys(v))
      visit(Object.getOwnPropertyDescriptor(v, key).value, depth + 1);
    ancestors.delete(v);
  }
  visit(value, 0);
}
export function frozenCopy(value) {
  const copy = structuredClone(value);
  function freeze(v) {
    if (v && typeof v === "object") {
      Object.values(v).forEach(freeze);
      Object.freeze(v);
    }
    return v;
  }
  return freeze(copy);
}
