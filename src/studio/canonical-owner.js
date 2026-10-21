import {
  createCanonicalNativeSession,
  exportCanonicalScoreWav,
  measureCanonicalScore,
} from "../audio/canonical-native.js";
import {
  prepareCanonicalScore,
  canonicalScoreFrame,
} from "../audio/canonical-score.js";
import { createCanonicalProductionAdapter } from "../audio/canonical-production-adapter.js";
import { fail } from "../project/instrument-contract.js";
import { createCanonicalRecordingHandles } from "../audio/canonical-recordings.js";
import { createCanonicalStudioBus } from "../audio/canonical-studio-bus.js";
import { installCanonicalStreamPlayer } from "../audio/canonical-stream-queue.js";
import { createCanonicalLoopJob } from "../audio/canonical-loop-job.js";

// Trusted local factory. No app, storage, URL gate or device initialization.
export async function createCanonicalStudioOwner({
  rate,
  memory,
  contextFactory,
  outputFactory,
  resolveUrl,
  fetcher,
  decodeProfiles,
  recordings,
  bundle,
  signal,
  streamExperiment = null,
} = {}) {
  const retainedRecordings = bundle
    ? createCanonicalRecordingHandles(bundle, { memory })
    : null;
  let session;
  try {
    session = await createCanonicalNativeSession({
      rate,
      memory,
      contextFactory,
      outputFactory,
      signal,
    });
  } catch (error) {
    if (error.cleanup) {
      const cleanup = error.cleanup;
      error.cleanup = async () => {
        await cleanup();
        await retainedRecordings?.dispose();
      };
    } else await retainedRecordings?.dispose();
    throw error;
  }
  let adapter,
    experimental = null;
  try {
    if (streamExperiment !== null) {
      const { createExperimentalAnchoredOwner } =
        await import("../audio/experimental-anchored-stream/owner.js");
      experimental = createExperimentalAnchoredOwner({
        session,
        memory,
        options: streamExperiment,
      });
    }
    adapter = createCanonicalProductionAdapter({
      context: session.context,
      memory,
      resolveUrl,
      fetcher,
      decodeProfiles,
      recordings: [
        ...(recordings ?? []),
        ...(retainedRecordings?.recordings ?? []),
      ],
    });
  } catch (error) {
    const cleanup = async () => {
      await session.dispose();
      await retainedRecordings?.dispose();
    };
    try {
      await cleanup();
    } catch (cleanupError) {
      Object.assign(error, { cleanup, cleanupError });
    }
    throw error;
  }
  const gains = new WeakMap(),
    auditions = new WeakSet(),
    loopJobs = new Set();
  let primary = null,
    bus = null;
  const prepare = async (value, options) => {
    const audition = options?.audition === true;
    const repeat = options?.repeat === true && !audition;
    experimental?.assertIntent(options);
    const score = await prepareCanonicalScore(value, {
      ...options,
      ...(repeat && options?.command?.kind !== "window"
        ? { command: { kind: "repeat", bars: null, cycles: 1 } }
        : {}),
      rate,
      memory,
      registry: adapter.registry,
      provider: adapter.provider,
      createBuffer: (...a) => session.context.createBuffer(...a),
      sharedMaster: true,
    });
    let measured;
    try {
      if (audition) {
        auditions.add(score);
        return score;
      }
      if (experimental) await experimental.prepare(score, options);
      else if (repeat) await installCanonicalStreamPlayer(session.context);
      // Use the exporter's exact full-programme first-pass DSP/meter. Playback
      // does not allocate an encoded WAV that would immediately be discarded.
      measured = await measureCanonicalScore(score, {
        memory,
        context: session.context,
        signal: options?.signal,
      });
      const peak = measured.metadata.render.postPeak;
      if (!Number.isFinite(peak) || peak < 0 || peak > 0.95)
        fail("voiceHeadroom");
      gains.set(score, measured.calibration.gain);
      primary ??= score;
      return score;
    } catch (error) {
      score.dispose();
      throw error;
    } finally {
      measured?.output?.release();
    }
  };
  return Object.freeze({
    context: session.context,
    prepare,
    position: (score, frame) => canonicalScoreFrame(score, frame),
    resume: () => (experimental ? experimental.resume() : session.resume()),
    pause: () => (experimental ? experimental.pause() : session.pause()),
    interrupt: () =>
      experimental ? experimental.interrupt() : session.dispose(),
    start: (score, options) => {
      const audition = options?.audition === true;
      experimental?.assertIntent(options);
      if (audition ? !auditions.has(score) || !primary : !gains.has(score))
        fail("canonicalNotAdmitted");
      const programme = audition ? primary : score;
      if (!bus) {
        bus = createCanonicalStudioBus(
          session.context,
          memory,
          session.output,
          {
            limiter: programme.project.master.limiter,
            createMaster: session.createMaster,
            onFault: (error) => session.fail(error),
          },
        );
        session.setOutput(bus.input);
      }
      bus.configure(gains.get(programme), programme.project.master.limiter);
      if (!audition) primary = score;
      const release = bus.acquire();
      try {
        const job =
          !audition && options?.repeat === true
            ? experimental
              ? experimental.start(score, {
                  ...options,
                  destination: bus.input,
                })
              : createCanonicalLoopJob({
                  score,
                  memory,
                  context: session.context,
                  destination: bus.input,
                  closeContext: () => session.dispose(),
                  fromFrame: options?.fromFrame ?? 0,
                  signal: options?.signal,
                })
            : session.start(score, {
                ...options,
                programmeGain: null,
                sharedMaster: true,
              });
        if (job.continuous) loopJobs.add(job);
        job.done.then(release, release);
        return job;
      } catch (error) {
        release();
        throw error;
      }
    },
    exportWav: (score, options) => {
      if (experimental) fail("experimentalStreamUnsupportedCombination");
      return exportCanonicalScoreWav(score, {
        ...options,
        memory,
        context: session.context,
      });
    },
    snapshot: () => ({
      adapter: adapter.snapshot(),
      memory: memory.snapshot(),
      output: bus?.snapshot() ?? null,
      loops: [...loopJobs].map((job) => job.snapshot()),
      ...(experimental ? { streamExperiment: experimental.snapshot() } : {}),
    }),
    async dispose() {
      if (experimental) await experimental.interrupt();
      else await session.dispose();
      await Promise.all([...loopJobs].map((job) => job.dispose()));
      await Promise.allSettled([...loopJobs].map((job) => job.done));
      loopJobs.clear();
      bus?.dispose();
      await adapter.dispose();
      await retainedRecordings?.dispose();
    },
  });
}
