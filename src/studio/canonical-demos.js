import { createFlagshipDemo } from "../project/flagship-demo.js";
import { compositionDemo } from "../project/composition-model.js";
import { migrateLegacyMetadata } from "../project/canonical-metadata.js";
import { startSongChain } from "../project/canonical-authoring.js";
import { createCanonicalBundle } from "../project/canonical-package.js";
import { fail } from "../project/instrument-contract.js";
import { createStarter, starterContent } from "../loop-station/starters.js";
import { canonicalStarterProject } from "./canonical-starter-project.js";
export async function createCanonicalDemo(
  kind = "flagship",
  { registry, memory, locale = "id" } = {},
) {
  let demo;
  if (kind === "flagship") demo = await createFlagshipDemo(registry, locale);
  else if (kind.startsWith("starter:")) {
    const id = kind.slice(8),
      recipe = starterContent.find((s) => s.id === id);
    if (!recipe) fail("unknownDemo");
    const original = structuredClone(createStarter(id, registry));
    original.title = recipe.name[locale] ?? recipe.name.id;
    const migrated = await migrateLegacyMetadata(JSON.stringify(original), {
        registry,
      }),
      canonical = canonicalStarterProject(migrated.project);
    demo = { canonical, originals: migrated.originals };
  } else {
    if (!["fusion", "bumi", "malam", "ruang", "arus"].includes(kind))
      fail("unknownDemo");
    const migrated = await migrateLegacyMetadata(
        JSON.stringify(compositionDemo(kind)),
        { registry },
      ),
      canonical = structuredClone(migrated.project);
    startSongChain(canonical, 4);
    demo = { canonical, originals: migrated.originals };
  }
  return createCanonicalBundle(demo.canonical, {
    registry,
    memory,
    originals: demo.originals,
  });
}
