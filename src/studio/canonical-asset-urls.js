import { fail } from "../project/instrument-contract.js";

// Ordinary Vite asset URLs, derived only from the repository's shipped audio.
// Importing this map loads URL modules, not decoded PCM or a QA audio endpoint.
const urls = import.meta.glob(
  [
    "../../internal/gamelan-delivery/audio/**/*.wav",
    "../../internal/loop-instruments/audio/**/*.wav",
    "../../internal/studio-kits/audio/**/*.wav",
    "../../internal/v3-sounds/audio/**/*.wav",
    "../../internal/original-groove/audio/**/*.wav",
  ],
  { eager: true, query: "?url", import: "default" },
);

export function canonicalAssetUrl({ path }) {
  const url = urls["../../" + path];
  if (typeof url !== "string") fail("canonicalAssetUnavailable");
  return url;
}
