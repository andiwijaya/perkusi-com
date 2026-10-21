// Gains alone cannot prove silence: an old voice can still sound during a
// target ramp/release after a zero-gain or disabled control boundary.
export const quiescentCanonicalLoopSource = (t) =>
  t.shots.length === 0 &&
  !t.segments.some((s) => s.phrases.some((p) => p.control.enabled));
export const canonicalLoopSourcePeak = (t) =>
  t.master === 0 || quiescentCanonicalLoopSource(t) ? 0 : 0.9;
