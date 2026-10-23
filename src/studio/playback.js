import { AudioEngine } from "../audio/engine.js";
import { CompositionPlayback } from "../audio/composition.js";
import { createBeatboxOutputStage } from "../beatbox/output-stage.js";
import { createProgrammeOutputStage } from "../audio/programme-output.js";
import { originalGroovePack } from "../beatbox/pack.js";
import { studioCatalog, studioPack, instrumentPack } from "./pack.js";
import { kendhangPack } from "./kendhang-pack.js";
import { bassPack } from "./bass-pack.js";
import { guitarPack } from "./guitar-pack.js";

// Shared construction, not a second engine. Each page owns its own context,
// banks and disposal; constructing this factory does not load or play audio.
export function createStudioPlayback({ arrangement = true } = {}) {
  const engine = new AudioEngine(studioPack(1), {
    variantPacks: [studioPack(2), studioPack(3)],
    sequenceCatalog: studioCatalog,
    outputStageFactory: (context, input) =>
      createProgrammeOutputStage(context, input, createBeatboxOutputStage),
  });
  engine.arrangement = arrangement;
  const playback = new CompositionPlayback(engine, {
    loopPack: originalGroovePack,
    instrumentPack,
    kendhangPack,
    bassPack,
    guitarPack,
  });
  return { engine, playback };
}
