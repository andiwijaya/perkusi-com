import { PPQ } from "../project/instrument-project.js";
// Presentation only; identical rounded swung boundaries to the logical planner.
export function canonicalGridStep(
  frame,
  { startTick = 0, bar = 0, timing, rate, swing = 0 },
) {
  const fpt =
      timing.clock.kind === "fixed-bar"
        ? timing.clock.framesPerBar / (4 * PPQ)
        : (60 * rate) / (timing.bpm * PPQ),
    base = startTick + bar * 4 * PPQ;
  if (
    frame < Math.round(base * fpt) ||
    frame >= Math.round((base + 4 * PPQ) * fpt)
  )
    return null;
  let step = 0;
  for (let i = 1; i < 16; i++)
    if (
      frame >=
      Math.round((base + (i / 4 + (i % 2 ? swing / 4 : 0)) * PPQ) * fpt)
    )
      step = i;
    else break;
  return step;
}
