import { PROGRAMME_MAX_GAIN } from "./programme-level.js";
const branded = new WeakSet();
// A static safety knee; measured programmes stay below.82, so their fixed
// calibration remains linear. Unpredicted edits/strikes are bounded below.9.
const curve = Float32Array.from({ length: 65537 }, (_, i) => {
  const x = i / 32768 - 1,
    a = Math.abs(x);
  return a <= 0.85
    ? x
    : Math.sign(x) * (0.85 + 0.05 * (1 - Math.exp(-(a - 0.85) / 0.05)));
});
// The exporters use the same sampled curve/interpolation as the native live
// WaveShaper. Keep the nominal region linear and avoid a hard PCM clamp.
export function programmeSample(value) {
  if (!Number.isFinite(value)) throw RangeError("invalidPCM");
  const position = (Math.max(-1, Math.min(1, value)) + 1) * 32768,
    index = Math.min(65535, Math.floor(position));
  return Math.fround(
    curve[index] + (position - index) * (curve[index + 1] - curve[index]),
  );
}
export function createProgrammeOutputStage(context, input, baseFactory = null) {
  const base = baseFactory?.(context, input),
    gain = context.createGain(),
    ceiling = context.createWaveShaper();
  gain.gain.value = 1;
  ceiling.curve = curve;
  ceiling.oversample = "none";
  (base?.output ?? input).connect(gain);
  gain.connect(ceiling);
  let value = 1;
  const stage = {
    output: ceiling,
    programmeInput: gain,
    get programmeGain() {
      return value;
    },
    setProgrammeGain(next) {
      if (!Number.isFinite(next) || next < 1 || next > PROGRAMME_MAX_GAIN)
        throw RangeError("invalidProgrammeGain");
      gain.gain.setValueAtTime(next, context.currentTime);
      value = next;
    },
    dispose() {
      gain.disconnect();
      ceiling.disconnect();
      base?.dispose();
    },
  };
  branded.add(stage);
  return stage;
}
export function isProgrammeOutputStage(stage) {
  return branded.has(stage);
}
