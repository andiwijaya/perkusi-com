import { readFile } from "node:fs/promises";
import catalog from "../../internal/instrument-focus/registry-48000.json" with { type: "json" };
import { InstrumentRegistry } from "../../src/audio/instrument-registry.js";

export const canonicalFixtureRegistry = new InstrumentRegistry(catalog.banks);
export function fixturePCM() {
  return [0, 1].map((layer) =>
    Float32Array.from({ length: 240000 }, (_, i) =>
      i === 0 ? -0 : layer ? 0.03 * Math.cos(i / 31) : 0.05 * Math.sin(i / 19),
    ),
  );
}

// Original pinned data, without invoking failed model/overdub/recording APIs.
export async function legacyContractFixtures() {
  const dir = new URL("../fixtures/v5-canonical/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("MANIFEST.json", dir)));
  return new Map(
    await Promise.all(
      manifest.map(async ({ id }) => [
        id,
        JSON.parse(await readFile(new URL(id + ".perkusi.json", dir))),
      ]),
    ),
  );
}
