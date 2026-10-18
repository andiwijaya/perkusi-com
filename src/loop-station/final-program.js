import { PPQ } from "../project/instrument-project.js";
import { loopVoiceAt, loopAdmission } from "./plan.js";
import { fxTailFrames } from "./fx-model.js";
import { fail } from "../project/instrument-contract.js";
import { recordedLoopGeometry } from "./recorded-loop.js";

const portablePrograms = new WeakMap();
export function recordingOnlyPlan(plan) {
  let clips = 0;
  for (const track of plan.tracks)
    for (const clip of track.clips) {
      if (!recordedLoopGeometry(clip, plan.clock)) return false;
      clips++;
    }
  return clips > 0;
}
// A JSON/backend label alone cannot grant the portable contribution budget.
export function portableRecordingAdmission(plan, program) {
  const trusted = portablePrograms.get(program);
  if (
    !trusted ||
    trusted.plan !== plan ||
    trusted.project !== plan.project ||
    trusted.clock !== plan.clock ||
    !recordingOnlyPlan(plan)
  )
    fail("invalidLoopPlan");
  const clips = plan.tracks.flatMap((t) => t.clips);
  if (
    clips.length !== trusted.clips.length ||
    clips.some((c, i) => c !== trusted.clips[i])
  )
    fail("invalidLoopPlan");
  return trusted.admission;
}

export function finalMixProgram(
  plan,
  bars,
  { backend = "native-checkpoints" } = {},
) {
  if (
    !["native-checkpoints", "live-readers", "portable-recordings"].includes(
      backend,
    )
  )
    fail("invalidLoopPlan");
  if (backend === "portable-recordings" && !recordingOnlyPlan(plan))
    fail("invalidLoopPlan");
  if (![4, 8].includes(bars)) fail("finalMixLength");
  const bodyFrames = plan.clock.frame(bars * 4 * PPQ),
    events = [];
  let naturalEnd = bodyFrames;
  for (const track of plan.tracks)
    for (const clip of track.clips) {
      const start = plan.clock.frame(clip.startTick),
        period = plan.clock.frame(clip.startTick + clip.lengthTicks) - start;
      if (
        clip.loop &&
        (plan.project.assetRefs.some((a) => a.id === clip.sourceId) ||
          clip.voices.some((v) => v.cycles)) &&
        start < bodyFrames &&
        (bodyFrames - start) % period
      )
        fail("finalMixPeriodMismatch");
      if (
        start < bodyFrames &&
        ((!clip.loop &&
          plan.project.assetRefs.some((a) => a.id === clip.sourceId) &&
          clip.voices.some((v) => start + v.frames > bodyFrames)) ||
          (clip.voices.some((v) => v.key.startsWith("legacy/")) &&
            start + period > bodyFrames))
      )
        fail("finalMixPeriodMismatch");
      const cycles = clip.loop
        ? Math.max(0, Math.ceil((bodyFrames - start) / period))
        : 1;
      if (cycles > 4096) fail("finalMixLength");
      for (let cycle = 0; cycle < cycles; cycle++)
        for (const voice of clip.voices) {
          const spec = loopVoiceAt(
            plan.clock,
            clip,
            voice,
            cycle,
            clip.loop && cycle === cycles - 1,
          );
          if (spec.startFrame >= bodyFrames) continue;
          events.push({ trackId: track.id, spec });
          naturalEnd = Math.max(naturalEnd, spec.endFrame);
          if (events.length > 2048) fail("finalMixLength");
        }
    }
  if (!events.length) fail("emptyMix");
  const tailFrames = fxTailFrames(plan.project, plan.clock.rate),
    frames = naturalEnd + tailFrames;
  if (frames > plan.clock.rate * 40) fail("finalMixLength");
  let admission = loopAdmission(plan, plan.project, {
    recordedLoops: backend !== "native-checkpoints",
  });
  if (backend === "portable-recordings") {
    // The frame renderer removes half-open ended events before starting the
    // next period; it owns contributions, not native ended-callback tails.
    const points = events
      .flatMap(({ spec }) => [
        [spec.startFrame, 1],
        [spec.endFrame, -1],
      ])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let active = 0,
      maxOwned = 0;
    for (const [, delta] of points) {
      active += delta;
      maxOwned = Math.max(maxOwned, active);
    }
    if (active !== 0 || maxOwned < 1 || maxOwned > 16) fail("voiceLimit");
    admission = Object.freeze({ ...admission, maxOwned });
    for (const event of events) {
      Object.freeze(event.spec);
      Object.freeze(event);
    }
    Object.freeze(events);
  }
  const program = {
    backend,
    bars,
    rate: plan.clock.rate,
    bodyFrames,
    naturalEnd,
    tailFrames,
    frames,
    events,
    admission,
    latencyFrames: 0,
  };
  if (backend === "portable-recordings") {
    Object.freeze(program);
    portablePrograms.set(program, {
      plan,
      project: plan.project,
      clock: plan.clock,
      clips: plan.tracks.flatMap((t) => t.clips),
      admission,
    });
  }
  return program;
}
