import { newComposition } from "../project/composition-model.js";
import { migrateLegacyMetadata } from "../project/canonical-metadata.js";
import { startSongChain } from "../project/canonical-authoring.js";
import { createCanonicalBundle } from "../project/canonical-package.js";

export async function createFreshCanonicalProject({
  registry,
  memory,
  title,
} = {}) {
  const initial = await migrateLegacyMetadata(
      JSON.stringify(newComposition(title)),
      { registry },
    ),
    project = structuredClone(initial.project);
  startSongChain(project, 4);
  return createCanonicalBundle(project, {
    registry,
    memory,
    originals: initial.originals,
  });
}
