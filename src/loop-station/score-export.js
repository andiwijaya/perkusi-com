import { renderPortableMix, portableMixBytes } from "./portable-mix.js";
import { encodeStreamWav } from "./stream-wav.js";
import {
  ProgrammeMeter,
  programmeGain,
  PROGRAMME_SCRATCH_BYTES,
} from "../audio/programme-level.js";
import { programmeSample } from "../audio/programme-output.js";
import { checkAbort } from "./recording-data.js";

// A complete first mix measures fixed gain; a fresh second mix encodes it.
// Both preserve state continuously across chunks, including EQ and long tails.
export async function exportScoreChunks(
  plan,
  program,
  meta,
  { memory, context, signal, onProgress, releaseSources },
) {
  const rate = program.rate,
    master = plan.project.master.volume;
  let working,
    meterLease,
    meter = new ProgrammeMeter(rate),
    prePeak = 0,
    limitedSamples = 0;
  const rawMaster = plan.project.master;
  try {
    working = memory.reserve(
      portableMixBytes(plan.project, program, { boundedSourceViews: true }) +
        2048 * 32,
      "final-score-source-windows/chunk-native-views",
    );
    meterLease = memory.reserve(PROGRAMME_SCRATCH_BYTES, "final-score-meter");
    await renderPortableMix(context, plan.project, program, {
      signal,
      analysisOnly: true,
      boundedSourceViews: true,
      onProgress,
      onChunk: (cs) => {
        meter.push(cs[0], cs[1]);
        for (const c of [cs[2], cs[3]])
          for (const x of c) {
            prePeak = Math.max(prePeak, Math.abs(x));
            if (
              Math.abs(x) > 0.8 &&
              rawMaster.limiter &&
              !rawMaster.limiter.bypass
            )
              limitedSamples++;
          }
      },
    });
    checkAbort(signal);
    const metrics = meter.result(),
      gain = programmeGain(metrics, master, 1);
    meter = null;
    meterLease.release();
    meterLease = null;
    Object.assign(meta.render, {
      path: "portable-score-chunks-v1",
      programmeCalibration: { gain, metrics },
      prePeak,
      postPeak: Math.abs(programmeSample(metrics.peak * gain)),
      limitedSamples,
      silent: metrics.peak === 0,
    });
    return await encodeStreamWav(
      { frames: program.frames, sampleRate: rate },
      meta,
      {
        memory,
        signal,
        onProgress,
        produce: (write) =>
          renderPortableMix(context, plan.project, program, {
            signal,
            analysisOnly: true,
            boundedSourceViews: true,
            onChunk: (cs) => {
              for (let c = 0; c < 2; c++)
                for (let i = 0; i < cs[c].length; i++)
                  cs[c][i] = programmeSample(cs[c][i] * gain);
              write(cs[0], cs[1]);
            },
          }),
        beforeAssemble: () => {
          plan = null;
          program = null;
          context = null;
          working.release();
          working = null;
          releaseSources();
        },
      },
    );
  } finally {
    working?.release();
    meterLease?.release();
  }
}
