import { fail } from "../project/instrument-contract.js";
import { dampFrames, panMatrix } from "./frame-dsp.js";
import { gamelanPlaybackScale } from "./gamelan-level.js";

const BLOCK = 256;

// A periodic upper bound on absolute pre-master PCM, not a measurement of one
// lucky phase/cancellation. Each time bin takes a maximum for every overlapping
// voice and sums those maxima, including all previous full source tails.
export function repeatPeakBound(plan, items, volume, memory) {
  const period = plan.periodFrames;
  if (!Number.isSafeInteger(period) || period < 128 || !memory?.reserve)
    fail("invalidLoopPlan");
  const unique = new Map(items.map((item) => [item.key, item]));
  const bins = Math.ceil(period / BLOCK);
  let bytes = bins * 8 + unique.size * 256;
  for (const { lease } of unique.values())
    bytes += Math.ceil(lease.buffer.length / BLOCK) * 4;
  const held = memory.reserve(bytes, "periodic PCM headroom analysis");
  try {
    const profiles = new Map();
    for (const [key, item] of unique) {
      const buffer = item.lease.buffer;
      if (
        buffer.sampleRate !== plan.rate ||
        ![1, 2].includes(buffer.numberOfChannels)
      )
        fail("invalidLoopPlan");
      const peaks = new Float32Array(Math.ceil(buffer.length / BLOCK));
      let peak = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const data = buffer.getChannelData(channel);
        for (let frame = 0; frame < data.length; frame++) {
          const value = Math.abs(data[frame]);
          if (!Number.isFinite(value)) fail("invalidInstrumentPCM");
          const i = Math.floor(frame / BLOCK);
          if (value > peaks[i]) peaks[i] = value;
          peak = Math.max(peak, value);
        }
      }
      if (peak !== item.lease.metrics.peak) fail("cachedAssetInvalid");
      profiles.set(key, {
        peaks,
        channels: buffer.numberOfChannels,
        scale: gamelanPlaybackScale(item.bank, peak),
      });
    }
    const sums = new Float64Array(bins);
    for (const v of plan.voices) {
      const profile = profiles.get(v.key);
      if (!profile) fail("invalidLoopPlan");
      const matrix =
          v.mix.pan === 0
            ? [1, 0, 0, 1]
            : panMatrix(v.mix.pan, profile.channels === 1),
        pan = Math.max(
          Math.abs(matrix[0]) + Math.abs(matrix[1]),
          Math.abs(matrix[2]) + Math.abs(matrix[3]),
        ),
        gain = v.velocity * 0.25 * v.mix.volume * volume * profile.scale * pan;
      for (
        let cycle = -Math.floor((v.endFrame - 1) / period);
        cycle <= 0;
        cycle++
      ) {
        const start = v.startFrame + cycle * period,
          end = v.endFrame + cycle * period,
          first = Math.floor(Math.max(0, start) / BLOCK),
          last = Math.ceil(Math.min(period, end) / BLOCK);
        for (let bin = first; bin < last; bin++) {
          const from = Math.max(bin * BLOCK, start),
            to = Math.min((bin + 1) * BLOCK, period, end);
          if (to <= from) continue;
          const a = from - start,
            b = to - start - 1,
            raw = Math.max(
              profile.peaks[Math.floor(a / BLOCK)],
              profile.peaks[Math.floor(b / BLOCK)],
            ),
            damp =
              v.dampFrame === null
                ? 1
                : Math.max(
                    0,
                    Math.min(
                      1,
                      1 -
                        (a - (v.dampFrame - v.startFrame)) /
                          dampFrames(plan.rate),
                    ),
                  );
          sums[bin] += raw * damp * gain;
        }
      }
    }
    let bound = 0;
    for (const sum of sums) bound = Math.max(bound, sum);
    if (!Number.isFinite(bound)) fail("invalidLoopPlan");
    // Cover Float32 native gain/summing roundoff as well as the exact-input
    // envelope. This adds conservatism; it never raises the .95 ceiling.
    return {
      maxPeak: bound * (1 + 1e-5) + 1e-7,
      scratchBytes: bytes,
      binFrames: BLOCK,
    };
  } finally {
    held.release();
  }
}
