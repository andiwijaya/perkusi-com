import { fail } from "../project/instrument-contract.js";

export const WAVEFORM_BINS = 128;
// Read-only UI metadata. No full-window copy or writable original escapes.
export function waveformSlice({
  capacity,
  frames,
  channels,
  sample,
  fromFrame = 0,
}) {
  if (
    !Number.isSafeInteger(capacity) ||
    capacity < 1 ||
    capacity > 192000 * 32 ||
    !Number.isSafeInteger(frames) ||
    frames < 0 ||
    frames > capacity ||
    !Number.isSafeInteger(fromFrame) ||
    fromFrame < 0 ||
    fromFrame > frames ||
    ![1, 2].includes(channels) ||
    typeof sample !== "function"
  )
    fail("invalidWaveform");
  const min = new Float32Array(WAVEFORM_BINS),
    max = new Float32Array(WAVEFORM_BINS),
    seen = new Uint8Array(WAVEFORM_BINS);
  let peak = 0;
  for (let f = fromFrame; f < frames; f++) {
    const bin = Math.min(
      WAVEFORM_BINS - 1,
      Math.floor((f * WAVEFORM_BINS) / capacity),
    );
    for (let c = 0; c < channels; c++) {
      const v = sample(c, f);
      if (!Number.isFinite(v)) fail("invalidWaveform");
      if (!seen[bin]) {
        min[bin] = max[bin] = v;
        seen[bin] = 1;
      } else {
        min[bin] = Math.min(min[bin], v);
        max[bin] = Math.max(max[bin], v);
      }
      peak = Math.max(peak, Math.abs(v));
    }
  }
  return { version: 1, capacity, frames, fromFrame, min, max, seen, peak };
}

export function mergeWaveform(previous, delta) {
  if (!previous || delta.fromFrame === 0) return delta;
  if (
    previous.frames !== delta.fromFrame ||
    previous.capacity !== delta.capacity
  )
    fail("invalidWaveform");
  for (let b = 0; b < WAVEFORM_BINS; b++)
    if (delta.seen[b]) {
      if (!previous.seen[b]) {
        previous.min[b] = delta.min[b];
        previous.max[b] = delta.max[b];
        previous.seen[b] = 1;
      } else {
        previous.min[b] = Math.min(previous.min[b], delta.min[b]);
        previous.max[b] = Math.max(previous.max[b], delta.max[b]);
      }
    }
  previous.frames = delta.frames;
  previous.peak = Math.max(previous.peak, delta.peak);
  return previous;
}

export function waveformPath(wave) {
  const y = (v) => 48 - Math.max(-1, Math.min(1, v)) * 44;
  return Array.from(wave.seen, (seen, b) =>
    seen
      ? `M${(b * 4 + 2).toFixed(1)},${y(wave.min[b]).toFixed(3)}V${y(wave.max[b]).toFixed(3)}`
      : "",
  )
    .filter(Boolean)
    .join(" ");
}
