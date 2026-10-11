// Beatbox mastering only. Asset admission and the user master range stay intact.
// Low-level audio receives +9.54 dB; a smooth knee prevents boosted transients
// from reaching full scale. This is a static curve, with no envelope pumping.
export const BEATBOX_BOOST = 3;
export const BEATBOX_KNEE = 0.7;
export const BEATBOX_CEILING = 0.9;

export function beatboxOutputSample(value) {
  const magnitude = Math.abs(value);
  if (magnitude <= BEATBOX_KNEE) return value;
  const position = Math.min(1, (magnitude - BEATBOX_KNEE) / 0.3);
  return (
    Math.sign(value) *
    (BEATBOX_KNEE +
      (BEATBOX_CEILING - BEATBOX_KNEE) * (1 - (1 - position) ** 1.5))
  );
}

const curve = Float32Array.from({ length: 65537 }, (_, index) =>
  beatboxOutputSample((index / 65536) * 2 - 1),
);

export function createBeatboxOutputStage(context, input) {
  const boost = context.createGain();
  const ceiling = context.createWaveShaper();
  boost.gain.value = BEATBOX_BOOST;
  ceiling.curve = curve;
  // Preserve the exact sample ceiling; native oversampling filters can overshoot.
  ceiling.oversample = "none";
  input.connect(boost);
  boost.connect(ceiling);
  return {
    output: ceiling,
    dispose() {
      boost.disconnect();
      ceiling.disconnect();
    },
  };
}
