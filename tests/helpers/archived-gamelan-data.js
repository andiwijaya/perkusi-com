// Exact pinned old test data. No composition/demo generator or audio runtime.
import archived from "../fixtures/retirement-data/archived-gamelan-demos.json" with { type: "json" };
export const INSTRUMENT_DEMOS = archived.catalogue;
export function instrumentDemo(id, registry) {
  for (const projects of Object.values(archived.profiles)) {
    const project = projects[id];
    if (!project) continue;
    try {
      for (const bank of project.banks) registry.bank(bank.id, bank.version);
      return structuredClone(project);
    } catch {
      // Try the other pinned native profile, never synthesize or convert data.
    }
  }
  throw Error("Unknown archived test specimen or registry profile");
}
