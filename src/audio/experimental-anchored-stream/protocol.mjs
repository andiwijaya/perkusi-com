export const MAX_BLOCK = 16384;
export const integer = (n, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(n) && n >= min && n <= max;
export function fail(code) {
  throw Object.assign(Error(code), { code });
}
const names = ["runId", "contextId", "nodeId"];
export function identity(value) {
  if (
    !value ||
    !integer(value.generation, 1) ||
    !names.every(
      (k) =>
        typeof value[k] === "string" &&
        value[k].length > 0 &&
        value[k].length <= 96,
    )
  )
    fail("anchoredIdentity");
  return Object.freeze({
    runId: value.runId,
    contextId: value.contextId,
    nodeId: value.nodeId,
    generation: value.generation,
  });
}
export const sameIdentity = (a, b) =>
  !!a &&
  !!b &&
  names.every((k) => a[k] === b[k]) &&
  a.generation === b.generation;
