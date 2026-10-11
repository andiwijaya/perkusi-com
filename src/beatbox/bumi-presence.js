// Bumi's original lip-kick has most of its energy below 180 Hz. Preserve the
// score/loop and add presence around its existing oral formant, not sub-bass.
// Peaking coefficients: https://www.w3.org/TR/audio-eq-cookbook/
export const BUMI_PRESENCE = Object.freeze({
  frequency: 320,
  q: 0.8,
  gainDb: 6,
});

export function prepareBumiBuffer(buffer, stem) {
  if (stem.id !== "kick") return buffer;
  const amplitude = 10 ** (BUMI_PRESENCE.gainDb / 40);
  const omega = (2 * Math.PI * BUMI_PRESENCE.frequency) / buffer.sampleRate;
  const alpha = Math.sin(omega) / (2 * BUMI_PRESENCE.q);
  const cosine = Math.cos(omega);
  const denominator = 1 + alpha / amplitude;
  const b0 = (1 + alpha * amplitude) / denominator;
  const b1 = (-2 * cosine) / denominator;
  const b2 = (1 - alpha * amplitude) / denominator;
  const a1 = (-2 * cosine) / denominator;
  const a2 = (1 - alpha / amplitude) / denominator;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    let x1 = 0,
      x2 = 0,
      y1 = 0,
      y2 = 0;
    for (let frame = 0; frame < samples.length; frame++) {
      const x = samples[frame];
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      samples[frame] = y;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
    }
  }
  return buffer;
}
