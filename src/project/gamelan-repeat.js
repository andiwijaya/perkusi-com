import { takePlan } from "./instrument-take.js";
import { eventFrame } from "./instrument-project.js";
import { legacyAudible } from "./instrument-mix.js";
import { fail } from "./instrument-contract.js";
import { dampFrames } from "../audio/frame-dsp.js";

export const REPEAT_LOOKAHEAD = 0.75;
// Includes a delayed onended delivery during the tested 400ms main-thread stall.
const RELEASE_GRACE = 0.45;
export function gamelanRepeatPlan(project, registry, rate) {
  const plan = takePlan(project, registry, rate),
    periodTicks = plan.project.clock.lengthTicks,
    periodFrames = eventFrame(
      periodTicks,
      plan.project.composition.timing.bpm,
      rate,
    );
  if (legacyAudible(plan.project.composition)) fail("repeatNeedsEventOnly");
  if (periodFrames < 128) fail("invalidLoopPlan");
  const voices = plan.voices.map((v) => {
    const damps = plan.project.events
      .filter(
        (e) =>
          e.action === "damp" &&
          e.bankId === v.bankId &&
          e.sampleId === v.sampleId,
      )
      .map((e) => ({
        tick: e.tick > v.tick ? e.tick : e.tick + periodTicks,
        event: e,
      }))
      .sort((a, b) => a.tick - b.tick);
    const first = damps[0];
    const dampFrame = first
      ? eventFrame(
          first.event.tick,
          plan.project.composition.timing.bpm,
          rate,
        ) + (first.tick >= periodTicks ? periodFrames : 0)
      : null;
    return {
      ...v,
      dampFrame:
        dampFrame !== null && dampFrame < v.naturalEndFrame ? dampFrame : null,
      endFrame:
        dampFrame === null
          ? v.naturalEndFrame
          : Math.min(v.naturalEndFrame, dampFrame + dampFrames(rate)),
    };
  });
  return {
    ...plan,
    voices,
    periodFrames,
    maxTailFrames: Math.max(...voices.map((v) => v.endFrame - v.startFrame)),
  };
}

export function repeatedVoice(plan, cycle, index) {
  const voice = plan.voices[index],
    shift = cycle * plan.periodFrames;
  return {
    ...voice,
    startFrame: voice.startFrame + shift,
    endFrame: voice.endFrame + shift,
    naturalEndFrame: voice.naturalEndFrame + shift,
    dampFrame: voice.dampFrame === null ? null : voice.dampFrame + shift,
  };
}

// Exact periodic interval sweep. Bound all owned pending/playing/end-callback
// nodes, not only simultaneous audible tails. No truncation or voice stealing.
export function repeatAdmission(plan, metrics, volume) {
  if (!Number.isFinite(volume) || volume < 0 || volume > 1)
    fail("invalidLoopPlan");
  const period = plan.periodFrames,
    events = [];
  let baseCount = 0,
    basePeak = 0;
  for (const v of plan.voices) {
    const peak = metrics.get(v.key)?.peak;
    if (!Number.isFinite(peak) || peak < 0) fail("invalidLoopPlan");
    const weight =
        peak *
        v.velocity *
        0.25 *
        v.mix.volume *
        volume *
        (v.mix.pan ? Math.SQRT2 : 1),
      lead = Math.ceil(REPEAT_LOOKAHEAD * plan.rate),
      grace = Math.ceil(RELEASE_GRACE * plan.rate),
      width = v.endFrame - v.startFrame + lead + grace,
      full = Math.floor(width / period),
      rest = width % period,
      start = (((v.startFrame - lead) % period) + period) % period;
    baseCount += full;
    basePeak += full * weight;
    if (rest) {
      const end = start + rest;
      events.push({ frame: start, count: 1, peak: weight });
      if (end <= period) events.push({ frame: end, count: -1, peak: -weight });
      else {
        baseCount++;
        basePeak += weight;
        events.push({ frame: end - period, count: -1, peak: -weight });
      }
    }
  }
  events.sort((a, b) => a.frame - b.frame || a.count - b.count);
  let count = baseCount,
    peak = basePeak,
    maxOwned = count,
    maxPeak = peak;
  for (const e of events) {
    count += e.count;
    peak += e.peak;
    maxOwned = Math.max(maxOwned, count);
    maxPeak = Math.max(maxPeak, peak);
  }
  if (maxOwned > 16) fail("voiceLimit");
  if (maxPeak > 0.95) fail("voiceHeadroom");
  return {
    maxOwned,
    maxPeak,
    lookahead: REPEAT_LOOKAHEAD,
    releaseGrace: RELEASE_GRACE,
  };
}
