import {
  CLIP_ROLES,
  newCompositionClip,
  validateComposition,
} from "./composition-model.js";
import { compositionRegistry } from "./studio-registry.js";
import { MAX_PROJECT_BYTES } from "./schema.js";
import {
  dataTree,
  utf8Bytes,
  frozenCopy,
  fail,
} from "./instrument-contract.js";

// First Q1 mapping slice, deliberately not connected to schema dispatch/UI.
// Old global controls are independently materialized for every local pattern;
// immutable samples stay registry references. Presence is retained for inverse.
export function materializeLegacyPatternControls(value) {
  dataTree(value, "invalidProject");
  if (utf8Bytes(JSON.stringify(value)) > MAX_PROJECT_BYTES)
    fail("projectTooLarge");
  const p = validateComposition(value, compositionRegistry);
  return frozenCopy({
    rolePresence: p.clips.map((c) => c.role),
    patterns: p.patterns.map((pattern) => ({
      id: pattern.id,
      beatbox: CLIP_ROLES.map((role) => ({
        ...(p.clips.find((c) => c.role === role) ?? newCompositionClip(role)),
        phasePolicy: "continue-source",
      })),
    })),
  });
}
