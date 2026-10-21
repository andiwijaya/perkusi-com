import { createCanonicalProductionAdapter } from "../audio/canonical-production-adapter.js";
import { createCanonicalRecordingHandles } from "../audio/canonical-recordings.js";
import { prepareCanonicalScore } from "../audio/canonical-score.js";
import { exportCanonicalScoreWav } from "../audio/canonical-native.js";
import { PPQ } from "../project/instrument-project.js";
import { fail } from "../project/instrument-contract.js";

export function captureBackingCommand(project, bars) {
  if (![1, 2, 4, 8].includes(bars)) fail("invalidLoopPlan");
  if (project.transport.kind === "legacy-continuous")
    return { kind: "window", bars: bars > 4 ? 8 : 4, cycles: 1 };
  const ticks = project.chain.length
    ? project.chain.reduce(
        (n, e) =>
          n +
          project.sections.find((s) => s.id === e.sectionId).lengthTicks *
            e.repeats,
        0,
      )
    : project.sections.find((s) => s.id === project.activeSection).lengthTicks;
  const cycles = Math.ceil((bars * 4 * PPQ) / ticks);
  if (cycles > 8) fail("arrangementExpansionLimit");
  return {
    kind: cycles > 1 ? "repeat" : "once",
    bars: null,
    cycles: Math.max(1, cycles),
  };
}

// This is the existing complete canonical export, used as transient monitoring
// material only. It never becomes a project asset or enters the dry input bus.
export async function prepareCanonicalCaptureBacking({
  bundle,
  context,
  memory,
  clock,
  bars,
  resolveUrl,
  fetcher,
  signal,
}) {
  const recordings = createCanonicalRecordingHandles(bundle, { memory });
  let adapter, score, wav, bufferLease, scratch, player, cachePolicy;
  const check = () => {
    if (signal?.aborted) fail("cancelled");
  };
  try {
    check();
    adapter = createCanonicalProductionAdapter({
      context,
      memory,
      resolveUrl,
      fetcher,
      recordings: recordings.recordings,
    });
    const working = structuredClone(bundle.project);
    working.timing.clock = structuredClone(clock);
    const command = captureBackingCommand(working, bars);
    score = await prepareCanonicalScore(working, {
      registry: adapter.registry,
      provider: adapter.provider,
      memory,
      rate: context.sampleRate,
      createBuffer: (...a) => context.createBuffer(...a),
      command,
      signal,
    });
    const bodyFrames = score.program.bodyFrames;
    wav = await exportCanonicalScoreWav(score, { memory, context, signal });
    // Release real source/cache loans before provisioning the retained backing.
    score.dispose();
    score = null;
    await adapter.dispose();
    cachePolicy = adapter.retireNativeCachePolicy();
    adapter = null;
    await recordings.dispose();
    check();
    const frames = wav.output.frames,
      rate = context.sampleRate;
    bufferLease = memory.reserve(
      frames * 8,
      "canonical/capture-backing-stereo-PCM",
    );
    scratch = memory.reserve(
      32768 * 8 + 4096,
      "canonical/capture-backing-decode-window",
    );
    // The private exporter has a fixed, validated Float32 stereo header. Read
    // bounded slices instead of making another whole-WAV/PCM copy.
    const h = new DataView(await wav.output.blob.slice(0, 58).arrayBuffer());
    if (
      h.getUint32(0, false) !== 0x52494646 ||
      h.getUint32(8, false) !== 0x57415645 ||
      h.getUint16(20, true) !== 3 ||
      h.getUint16(22, true) !== 2 ||
      h.getUint32(24, true) !== rate ||
      h.getUint16(34, true) !== 32 ||
      h.getUint32(50, false) !== 0x64617461 ||
      h.getUint32(54, true) !== frames * 8
    )
      fail("invalidCanonicalBacking");
    const buffer = context.createBuffer(2, frames, rate),
      channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
    let peak = 0;
    for (let from = 0; from < frames; from += 32768) {
      check();
      const count = Math.min(32768, frames - from),
        bytes = new DataView(
          await wav.output.blob
            .slice(58 + from * 8, 58 + (from + count) * 8)
            .arrayBuffer(),
        );
      for (let f = 0; f < count; f++)
        for (let c = 0; c < 2; c++) {
          const x = bytes.getFloat32(f * 8 + c * 4, true);
          if (!Number.isFinite(x) || Math.abs(x) > 0.95)
            fail("invalidCanonicalBacking");
          peak = Math.max(peak, Math.abs(x));
          channels[c][from + f] = x;
        }
    }
    if (peak !== wav.output.peak) fail("invalidCanonicalBacking");
    scratch.release();
    scratch = null;
    wav.output.release();
    wav = null;
    player = createPlayer({
      context,
      memory,
      buffer,
      bufferLease,
      peak,
      bodyFrames,
      command,
      bars,
      cachePolicy,
    });
    bufferLease = null;
    return player;
  } catch (e) {
    player?.dispose();
    throw e;
  } finally {
    score?.dispose();
    await adapter?.dispose();
    await recordings.dispose();
    wav?.output.release();
    scratch?.release();
    bufferLease?.release();
  }
}

function createPlayer({
  context,
  memory,
  buffer,
  bufferLease,
  peak,
  bodyFrames,
  command,
  bars,
  cachePolicy,
}) {
  const frames = buffer.length;
  let source,
    gain,
    nodeLease,
    started = false,
    ended = false,
    disposed = false,
    origin = null,
    resolve;
  const done = new Promise((r) => {
    resolve = r;
  });
  try {
    nodeLease = memory.reserve(
      16384,
      "canonical/capture-backing-native-source-gain",
    );
    gain = context.createGain();
    gain.gain.value = 1;
    source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 1;
    source.connect(gain);
    source.onended = () => {
      ended = true;
      resolve();
    };
  } catch (e) {
    source?.disconnect();
    gain?.disconnect();
    nodeLease?.release();
    throw e;
  }
  return Object.freeze({
    context,
    memory,
    peak,
    voices: 1,
    bars,
    cachePolicy,
    start(whenFrame, destination) {
      if (
        disposed ||
        started ||
        context.state !== "running" ||
        destination.context !== context ||
        !Number.isSafeInteger(whenFrame) ||
        whenFrame <
          Math.ceil(context.currentTime * context.sampleRate) +
            Math.ceil(0.02 * context.sampleRate)
      )
        fail("captureStartMissed");
      gain.connect(destination);
      origin = whenFrame;
      source.start(whenFrame / context.sampleRate);
      started = true;
    },
    stop() {
      if (!started || ended || context.state === "closed")
        return Promise.resolve();
      const now = context.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(1, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.02);
      source.stop(now + 0.02);
      return done;
    },
    snapshot: () =>
      Object.freeze({
        kind: "complete-canonical-monitor-print",
        frames,
        bodyFrames,
        sampleRate: context.sampleRate,
        peak,
        originFrame: origin,
        started,
        ended,
        command,
      }),
    dispose() {
      if (disposed) return;
      if (started && !ended && context.state !== "closed")
        fail("canonicalVoiceStillOwned");
      source.onended = null;
      source.disconnect();
      source.buffer = null;
      gain.disconnect();
      buffer = null;
      nodeLease.release();
      bufferLease.release();
      disposed = true;
      resolve();
    },
  });
}
