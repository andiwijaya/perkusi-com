import { finalMixProgram } from "./final-program.js";
import { portableMixBytes, renderPortableMix } from "./portable-mix.js";
import {
  ProgrammeMeter,
  programmeGain,
  PROGRAMME_SCRATCH_BYTES,
} from "../audio/programme-level.js";
export async function calibrateLoopProgramme(
  plan,
  memory,
  {
    signal,
    bars = 4,
    contextFactory = () => new OfflineAudioContext(1, 1, plan.clock.rate),
  } = {},
) {
  // Captured PCM keeps its reviewed replay/monitor contract. Programme
  // matching here is deliberately limited to demos and instrument scores.
  if (plan.project.assetRefs?.length) return { gain: 1, metrics: null };
  if (!plan.tracks.some((t) => t.clips.length))
    return { gain: 1, metrics: null };
  let program;
  try {
    program = finalMixProgram(plan, bars);
  } catch (e) {
    if (e.code !== "finalMixPeriodMismatch") throw e;
    program = finalMixProgram(plan, 8);
  }
  const lease = memory.reserve(
    2048 * 16 +
      portableMixBytes(plan.project, program) +
      PROGRAMME_SCRATCH_BYTES +
      524288,
    "programme-offline/PCM-views-meter-context",
  );
  let context;
  try {
    context = contextFactory();
    const meter = new ProgrammeMeter(plan.clock.rate);
    await renderPortableMix(context, plan.project, program, {
      signal,
      analysisOnly: true,
      onChunk: (channels) => meter.push(channels[0], channels[1]),
    });
    const metrics = meter.result();
    return {
      gain: programmeGain(metrics, plan.project.master.volume, 1),
      metrics,
    };
  } finally {
    try {
      if (context) await context.startRendering();
    } finally {
      lease.release();
    }
  }
}
