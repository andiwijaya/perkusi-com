import { canonicalScoreFixture, qaBuffer } from "./canonical-score-fixtures.js";
import { PPQ } from "../../src/project/instrument-project.js";

export async function reviewSequence(
  rate,
  memory,
  createBuffer = qaBuffer,
  profile = "single",
) {
  const f = await canonicalScoreFixture(rate, memory, createBuffer, {
    profile,
  });
  const c = structuredClone(f.canonical);
  const source =
    c.sourceDefs.find(
      (d) => d.kind === "instrument-events" && d.workingOriginId,
    ) ?? c.sourceDefs.find((d) => d.kind === "instrument-events");
  const seed = source.programme.events.find((e) => e.action === "strike");
  source.programme.events = [];
  for (let i = 0; i < 17; i++) {
    const tick =
      137 + i * (profile === "single" ? 4 * PPQ : Math.round(0.8 * PPQ));
    source.programme.events.push({
      ...seed,
      id: `sequential-${i}`,
      tick,
      velocity: 0.1,
    });
    source.programme.events.push({
      ...seed,
      id: `damp-${i}`,
      tick: tick + Math.round(0.1 * PPQ),
      action: "damp",
      velocity: 0,
    });
  }
  if (profile === "single") {
    source.programme.clock.lengthTicks = 68 * PPQ;
    c.transport.nativeLengthTicks = 68 * PPQ;
    c.sections[0].lengthTicks = 68 * PPQ;
    c.sections[0].placements[0].lengthTicks = 68 * PPQ;
  }
  return { ...f, canonical: c };
}
