import { MasterClock } from "../loop-station/master-clock.js";
import { PPQ } from "../project/instrument-project.js";
import { nextStepIndex, stepBeat } from "../audio/sequencing.js";
import { fail } from "../project/instrument-contract.js";

// Called after asynchronous preparation. The next swung step is derived from
// the current native audio clock and the active song's absolute origin.
export function canonicalPadWhenFrame({
  timing,
  rate,
  swing,
  nowFrame,
  originFrame,
  fromFrame = 0,
}) {
  if (
    !Number.isFinite(swing) ||
    swing < 0 ||
    swing > 0.5 ||
    ![nowFrame, originFrame, fromFrame].every(
      (v) => Number.isSafeInteger(v) && v >= 0,
    )
  )
    fail("invalidCanonicalPadGrid");
  const clock = new MasterClock({ timing, clock: timing.clock }, rate),
    origin = originFrame - fromFrame,
    minimum = nowFrame + Math.ceil(0.08 * rate);
  const step = nextStepIndex(
      clock.tick(Math.max(0, minimum - origin)) / PPQ,
      swing,
    );
  let when = origin + clock.frame(stepBeat(step, swing) * PPQ);
  // Rounding to an integer frame must not move a boundary inside native lead.
  if (when < minimum)
    when = origin + clock.frame(stepBeat(step + 1, swing) * PPQ);
  if (!Number.isSafeInteger(when)) fail("invalidCanonicalPadGrid");
  return when;
}
