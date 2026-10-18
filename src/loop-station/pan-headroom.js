import { fail } from "../project/instrument-contract.js";

// Admission only, never a DSP gain. Each StereoPanner coefficient is <=1:
// mono input cannot increase its per-channel peak; stereo can sum both input
// channels onto one side. Use their absolute bounds, with no phase-cancellation
// credit. This deliberately overbounds intermediate pans and nested panners.
export function panPeakFactor(channels, pan) {
  if (
    ![1, 2].includes(channels) ||
    !Number.isFinite(pan) ||
    pan < -1 ||
    pan > 1
  )
    fail("invalidLoopPlan");
  return channels === 2 && pan !== 0 ? 2 : 1;
}
