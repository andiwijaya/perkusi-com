import { canonicalRamp } from "./canonical-dynamic-render.js";
import { canonicalData } from "../project/canonical-data.js";
import { fail, integer } from "../project/instrument-contract.js";

// Explicit owned anchors remove the engine-dependent value inherited when one
// setTargetAtTime interrupts another. Never read AudioParam.value as history.
// Fresh internal graphs only; active UI/control replacement is not wired here.
export function scheduleCanonicalTargets(params, rows, rate, originFrame = 0) {
  canonicalData(rows);
  if (
    ![44100, 48000].includes(rate) ||
    !integer(originFrame, 0, Number.MAX_SAFE_INTEGER) ||
    !Array.isArray(rows) ||
    !rows.length ||
    rows.length > 512 ||
    !Array.isArray(params) ||
    !params.length ||
    params.some(
      (p) =>
        typeof p.setValueAtTime !== "function" ||
        typeof p.setTargetAtTime !== "function",
    ) ||
    rows.some(
      (r, i) =>
        !integer(r.frame, 0, Number.MAX_SAFE_INTEGER - originFrame) ||
        (i && r.frame <= rows[i - 1].frame) ||
        !Array.isArray(r.values) ||
        r.values.length !== params.length ||
        r.values.some((v) => !Number.isFinite(v) || Math.abs(v) > 1.5),
    )
  )
    fail("invalidCanonicalRamp");
  const plan = canonicalRamp(rows, rate);
  for (const [i, row] of rows.entries()) {
    const anchor = plan.at(row.frame),
      when = (originFrame + row.frame) / rate;
    for (const [channel, param] of params.entries()) {
      if (i === 0) param.value = anchor[channel];
      param.setValueAtTime(anchor[channel], when);
      if (i > 0) param.setTargetAtTime(row.values[channel], when, 0.004);
    }
  }
  return plan;
}
