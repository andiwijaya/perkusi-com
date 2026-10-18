// Trusted CdM recordings have very different recorded peaks. Apply one fixed,
// bounded playback trim per immutable decoded sample, never an AGC/compressor.
// Original PCM, pitch, duration, damping and stored microphone takes stay intact.
// Admission callers must multiply their raw peak by this same trim.
export function gamelanPlaybackScale(bank, peak) {
  if (
    bank?.setId !== "cdm-porto-recorded-candidate" ||
    !Number.isFinite(peak) ||
    peak <= 0
  )
    return 1;
  return Math.max(1, Math.min(4, 0.8 / peak));
}
