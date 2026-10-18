import { record, finite, fail } from "../project/instrument-contract.js";
export const FLAT_EQ = Object.freeze({
  version: 1,
  bypass: true,
  lowDb: 0,
  midDb: 0,
  highDb: 0,
});
export const BYPASS_LIMITER = Object.freeze({
  version: 1,
  bypass: true,
  kind: "soft-knee-v1",
});
export const EQ_TAIL_SECONDS = 0.1,
  LIMITER_KNEE = 0.8,
  LIMITER_CEILING = 0.95;
export function validateEQ(eq) {
  record(
    eq,
    ["version", "bypass", "lowDb", "midDb", "highDb"],
    "invalidLoopFX",
  );
  if (
    eq.version !== 1 ||
    typeof eq.bypass !== "boolean" ||
    ![eq.lowDb, eq.midDb, eq.highDb].every((v) => finite(v, -6, 6))
  )
    fail("invalidLoopFX");
}
export function validateLimiter(limiter) {
  record(limiter, ["version", "bypass", "kind"], "invalidLoopFX");
  if (
    limiter.version !== 1 ||
    typeof limiter.bypass !== "boolean" ||
    limiter.kind !== "soft-knee-v1"
  )
    fail("invalidLoopFX");
}
export function eqGains(eq = FLAT_EQ) {
  if (eq.bypass) return { high: 1, upper: 0, lower: 0 };
  const low = 10 ** (eq.lowDb / 20),
    mid = 10 ** (eq.midDb / 20),
    high = 10 ** (eq.highDb / 20);
  return { high, upper: mid - high, lower: low - mid };
}
export function eqBound(eq) {
  const g = eqGains(eq);
  // LP poles are positive and stable; each LP impulse has exact absolute sum1.
  return Math.abs(g.high) + Math.abs(g.upper) + Math.abs(g.lower);
}
export function hasEQ(eq) {
  const g = eqGains(eq);
  return g.high !== 1 || g.upper !== 0 || g.lower !== 0;
}
export function limiterEnabled(master) {
  return master.limiter && !master.limiter.bypass;
}
export function fxBytes(project) {
  const eqTracks = project.tracks.filter((t) => hasEQ(t.eq)).length;
  return (
    eqTracks * 32768 +
    (eqTracks ? 8192 : 0) +
    (limiterEnabled(project.master) ? 2 * 65537 * 4 + 8192 : 0)
  );
}
export function fxTailFrames(project, rate) {
  return project.tracks.some((t) => hasEQ(t.eq))
    ? Math.ceil(EQ_TAIL_SECONDS * rate)
    : 0;
}
export function softLimit(value) {
  const a = Math.abs(value);
  return a <= LIMITER_KNEE
    ? value
    : Math.sign(value) *
        (LIMITER_KNEE +
          (LIMITER_CEILING - LIMITER_KNEE) *
            (1 -
              Math.exp(
                -(a - LIMITER_KNEE) / (LIMITER_CEILING - LIMITER_KNEE),
              )));
}
