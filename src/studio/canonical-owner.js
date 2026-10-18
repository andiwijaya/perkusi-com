import {
  createCanonicalNativeSession,
  exportCanonicalScoreWav,
} from "../audio/canonical-native.js";
import { prepareCanonicalScore } from "../audio/canonical-score.js";
import { createCanonicalProductionAdapter } from "../audio/canonical-production-adapter.js";
import { fail } from "../project/instrument-contract.js";
import { createCanonicalRecordingHandles } from "../audio/canonical-recordings.js";

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
  let adapter;
  try {
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
  const gains = new WeakMap();
  const prepare = async (value, options) => {
    const score = await prepareCanonicalScore(value, {
      ...options,
      rate,
      memory,
      registry: adapter.registry,
      provider: adapter.provider,
      createBuffer: (...a) => session.context.createBuffer(...a),
    });
    let measured;
    try {
      // Use the established full-programme meter/calibration. This bounded
      // local owner pays the real WAV allocation and releases it before Play;
      // no guessed loudness factor or extra durable file is introduced.
      measured = await exportCanonicalScoreWav(score, {
        memory,
        context: session.context,
        signal: options?.signal,
      });
      gains.set(score, measured.calibration.gain);
      return score;
    } catch (error) {
      score.dispose();
      throw error;
    } finally {
      measured?.output.release();
    }
  };
  return Object.freeze({
    context: session.context,
    prepare,
    resume: () => session.resume(),
    pause: () => session.pause(),
    start: (score, options) => {
      if (!gains.has(score)) fail("canonicalNotAdmitted");
      return session.start(score, {
        ...options,
        programmeGain: gains.get(score),
      });
    },
    exportWav: (score, options) =>
      exportCanonicalScoreWav(score, {
        ...options,
        memory,
        context: session.context,
      }),
    snapshot: () => ({
      adapter: adapter.snapshot(),
      memory: memory.snapshot(),
    }),
    async dispose() {
      await session.dispose();
      await adapter.dispose();
      await retainedRecordings?.dispose();
    },
  });
}
