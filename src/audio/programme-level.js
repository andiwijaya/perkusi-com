// Fixed programme calibration. No moving gain, envelope, EQ or source rewrite.
// The target follows the owner's accepted Beatbox demo (~-18LKFS), not a
// streaming-service delivery specification. Peak headroom takes priority.
export const PROGRAMME_TARGET = -18;
export const PROGRAMME_PEAK = 0.82;
export const PROGRAMME_MAX_GAIN = 16;
export const PROGRAMME_SCRATCH_BYTES = 524288;
const shelf = [
  [1.53512485958697, -2.69169618940638, 1.19839281085285],
  [1, -1.69065929318241, 0.73248077421585],
];
const rlb = [
  [1, -2, 1],
  [1, -1.99004745483398, 0.99007225036621],
];
// Same analogue poles/zeros at other rates via the bilinear transform. At48k
// retain ITU-R BS.1770-5 Annex1 tables1/2 exactly. QA validates997Hz at both rates.
function coefficients(pair, rate) {
  if (rate === 48000) return pair;
  const r = rate / 48000,
    u = 1 - r,
    v = 1 + r;
  const convert = ([a, b, c]) => [
    a * v * v + b * u * v + c * u * u,
    2 * a * u * v + b * (u * u + v * v) + 2 * c * u * v,
    a * u * u + b * u * v + c * v * v,
  ];
  const b = convert(pair[0]),
    a = convert(pair[1]);
  return [b.map((x) => x / a[0]), a.map((x) => x / a[0])];
}
export class ProgrammeMeter {
  constructor(rate) {
    if (![44100, 48000].includes(rate))
      throw RangeError("unsupportedDecodeProfile");
    this.rate = rate;
    this.size = Math.round(rate * 0.4);
    this.hop = Math.round(rate * 0.1);
    this.ring = new Float64Array(this.size);
    this.frames = 0;
    this.sum = 0;
    this.peak = 0;
    this.blocks = [];
    this.filters = [shelf, rlb].map((p) => coefficients(p, rate));
    this.states = Array.from({ length: 2 }, () =>
      Array.from({ length: 2 }, () => [0, 0, 0, 0]),
    );
  }
  push(left, right) {
    if (left.length !== right.length) throw RangeError("invalidPCM");
    for (let i = 0; i < left.length; i++) {
      let energy = 0;
      for (let ch = 0; ch < 2; ch++) {
        let x = (ch ? right : left)[i];
        if (!Number.isFinite(x)) throw RangeError("invalidPCM");
        this.peak = Math.max(this.peak, Math.abs(x));
        for (let f = 0; f < 2; f++) {
          const [b, a] = this.filters[f],
            s = this.states[ch][f];
          const y =
            b[0] * x + b[1] * s[0] + b[2] * s[1] - a[1] * s[2] - a[2] * s[3];
          s[1] = s[0];
          s[0] = x;
          s[3] = s[2];
          s[2] = y;
          x = y;
        }
        energy += x * x;
      }
      const slot = this.frames % this.size;
      this.sum += energy - this.ring[slot];
      this.ring[slot] = energy;
      this.frames++;
      if (
        this.frames >= this.size &&
        (this.frames - this.size) % this.hop === 0
      )
        this.blocks.push(Math.max(0, this.sum) / this.size);
    }
  }
  result() {
    const loudness = (e) => (e > 0 ? -0.691 + 10 * Math.log10(e) : null),
      mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    const absolute = this.blocks.filter((x) => x > 0 && loudness(x) > -70),
      relative = absolute.length ? loudness(mean(absolute)) - 10 : null;
    const active = absolute.filter((x) => loudness(x) > relative);
    return {
      peak: this.peak,
      integratedLKFS: active.length ? loudness(mean(active)) : null,
      maxMomentaryLKFS: this.blocks.length
        ? loudness(Math.max(...this.blocks))
        : null,
      frames: this.frames,
    };
  }
}
export function measureProgramme(channels, rate) {
  const meter = new ProgrammeMeter(rate);
  meter.push(channels[0], channels[1] ?? channels[0]);
  return meter.result();
}
export function programmeGain(metrics, master = 0.65, nominal = 0.65) {
  if (
    !Number.isFinite(master) ||
    master <= 0 ||
    !Number.isFinite(metrics.integratedLKFS) ||
    metrics.peak <= 0
  )
    return 1;
  const factor = nominal / master;
  return Math.max(
    1,
    Math.min(
      PROGRAMME_MAX_GAIN,
      10 **
        ((PROGRAMME_TARGET - metrics.integratedLKFS - 20 * Math.log10(factor)) /
          20),
      PROGRAMME_PEAK / (metrics.peak * factor),
    ),
  );
}
export function calibratePCM(channels, rate, master = 0.65, nominal = 0.65) {
  const metrics = measureProgramme(channels, rate),
    gain = programmeGain(metrics, master, nominal);
  return { gain, metrics };
}
const auditions = new WeakMap();
export const auditionMetricsReady = (buffer) => auditions.has(buffer);
export function auditionGain(
  buffer,
  existingScale,
  master = 0.65,
  ceiling = 0.4,
) {
  let metrics = auditions.get(buffer);
  if (!metrics) {
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) =>
        buffer.getChannelData(c),
      ),
      meter = new ProgrammeMeter(buffer.sampleRate);
    meter.push(channels[0], channels[1] ?? channels[0]);
    if (buffer.length < meter.size) {
      const silence = new Float32Array(meter.size - buffer.length);
      meter.push(silence, silence);
    }
    metrics = meter.result();
    auditions.set(buffer, metrics);
  }
  if (!Number.isFinite(metrics.maxMomentaryLKFS) || metrics.peak <= 0) return 1;
  const prior = existingScale * 0.25 * master;
  // Individual strikes use the accepted Beatbox percussion's active level,
  // rather than force a sparse strike to the loudness of an entire groove.
  return Math.max(
    1,
    Math.min(
      8,
      10 ** ((-23 - metrics.maxMomentaryLKFS - 20 * Math.log10(prior)) / 20),
      ceiling / (metrics.peak * prior),
    ),
  );
}
