// Fixed group calibration, measured with 400 ms K-weighted short-hit energy at
// 44.1/48 kHz through the default output path. Nylon E3 is the retained strongest
// reference. Preserve within-group dynamics; these are not per-hit normalizers.
// Kendhang stops below that reference to retain transient headroom. Coincident
// hits can still engage the existing output safety knee; user mix/master remain.
export const INSTRUMENT_BASE_GAIN = Object.freeze({
  drum: 5.8,
  bilah: 5.75,
  kendhang: 1.35,
  bass: 1.05,
  guitar: 1,
});
