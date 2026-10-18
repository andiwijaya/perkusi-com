import { PPQ } from "../project/instrument-project.js";

export const STOPPED_POSITION = Object.freeze({
  state: "stopped",
  bar: 0,
  step: null,
  phase: 0,
  beat: 0,
  frame: 0,
});

// Presentation only: project the caller's audio frame onto the same rounded
// musical boundaries as eventFrame/MasterClock.frame. Never advances a clock.
export function musicalPosition(frame, framesPerTick) {
  const width = framesPerTick * (PPQ / 4);
  let step = Math.max(0, Math.floor(frame / width));
  if (Math.round((step + 1) * width) <= frame) step++;
  if (Math.round(step * width) > frame) step--;
  const bar = Math.floor(step / 16),
    start = Math.round(bar * 16 * width),
    end = Math.round((bar + 1) * 16 * width);
  return {
    frame,
    bar,
    step: step % 16,
    beat: frame / framesPerTick / PPQ,
    phase: Math.max(0, Math.min(1, (frame - start) / (end - start))),
  };
}

export function scorePosition(frame, framesPerTick, bodyFrames, repeat) {
  const tail = !repeat && frame >= bodyFrames,
    phase = repeat ? frame % bodyFrames : Math.min(frame, bodyFrames - 1);
  return {
    ...musicalPosition(Math.max(0, phase), framesPerTick),
    absoluteFrame: frame,
    state: tail ? "tail" : "playing",
    ...(tail ? { step: null, phase: 1 } : {}),
  };
}
