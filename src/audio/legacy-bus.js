import kitManifest from "../../internal/studio-kits/manifest.json" with { type: "json" };
import fusion from "../../internal/v3-sounds/manifest.json" with { type: "json" };
import { originalRegistry } from "../project/original-registry.js";
import { compositionRegistry } from "../project/studio-registry.js";
import { createPackFromCatalog } from "./pack-catalog.js";
import { validatePack } from "./sample-bank.js";
import { compositionExportExtras } from "./composition.js";
import { StudioWavExporter, studioExportBudget } from "./studio-exporter.js";
import { legacyAudible } from "../project/instrument-mix.js";
import { fail } from "../project/instrument-contract.js";
import { canonicalLegacyRender } from "./canonical-legacy.js";
import { decodeCanonicalWav, renderYield } from "./frame-dsp.js";
import { legacyCycleGeometry, renderLegacyCycles } from "./legacy-cycles.js";

// Trusted existing assets, served only by the local candidate server. No new
// recording, oscillator, transposition or schema3 flattening is introduced.
const kit = (id) => {
  const selected = compositionRegistry.kits.find((k) => k.id === id);
  return validatePack({
    schemaVersion: 1,
    id: "studio-kits",
    kind: "one-shot",
    version: kitManifest.version,
    bpm: 120,
    beatsPerBar: 4,
    bars: 1,
    key: null,
    stems: selected.assets.map((a) => ({
      ...a,
      url:
        "/internal/" +
        (id === "fusion" ? "v3-sounds/" : "studio-kits/") +
        a.assetPath,
    })),
  });
};
const instrumentPack = () =>
  validatePack({
    schemaVersion: 1,
    id: "bilah",
    kind: "one-shot",
    version: "1.0.0",
    bpm: 120,
    beatsPerBar: 4,
    bars: 1,
    key: null,
    stems: fusion.instrument.assets.map((a) => ({
      ...a,
      url: "/internal/v3-sounds/" + a.assetPath,
    })),
  });
const loopPack = (variant) =>
  createPackFromCatalog(
    originalRegistry,
    Object.fromEntries(originalRegistry.roleOrder.map((r) => [r, variant])),
    (path) => "/sounds/original-groove/" + path.split("/").at(-1),
  );

// Same original mastering formula, with a job-local admitted curve rather
// than another permanent global PCM table. Parity is checked against V1-V3.
export function legacyOutputStage(context, input) {
  const boost = context.createGain(),
    shaper = context.createWaveShaper();
  const curve = Float32Array.from({ length: 65537 }, (_, i) => {
    const x = (i / 65536) * 2 - 1,
      a = Math.abs(x);
    return a <= 0.7
      ? x
      : Math.sign(x) *
          (0.7 + 0.2 * (1 - (1 - Math.min(1, (a - 0.7) / 0.3)) ** 1.5));
  });
  boost.gain.value = 3;
  shaper.curve = curve;
  shaper.oversample = "none";
  input.connect(boost);
  boost.connect(shaper);
  return {
    output: shaper,
    dispose() {
      boost.disconnect();
      shaper.disconnect();
      shaper.curve = null;
    },
  };
}

async function prepareLegacyResource(
  project,
  {
    memory,
    rate,
    signal,
    contextFactory = (frames, r) => new OfflineAudioContext(2, frames, r),
    yieldTask = renderYield,
    periodFrames = null,
  },
) {
  if (!legacyAudible(project.composition)) return null;
  const p = project.composition,
    extensions = compositionExportExtras({ loopPack, instrumentPack });
  const budget = studioExportBudget(
    p,
    compositionRegistry,
    0,
    extensions.budget(p),
  );
  const selected = compositionRegistry.kits.find(
    (k) => k.id === p.pack.id,
  ).assets;
  const loops = p.clips
    .filter((c) => c.enabled)
    .map((c) =>
      originalRegistry.assets.find(
        (a) => a.role === c.role && a.variant === c.variant,
      ),
    );
  const assets = [
    ...selected,
    ...loops,
    ...(p.patterns.some((a) => a.notes.some(Boolean))
      ? fusion.instrument.assets
      : []),
  ];
  const geometry =
      periodFrames === null ? null : legacyCycleGeometry(p, rate, periodFrames),
    // Native output + getChannelData views for every first/steady terminal state.
    // Decoded source conversion has one-frame tolerance, plus the explicit loop
    // release. Reserve before fetching/allocating anything.
    maxTail =
      Math.ceil(
        Math.max(
          0,
          ...selected.map((a) => a.durationSeconds),
          ...(p.patterns.some((a) => a.notes.some(Boolean))
            ? fusion.instrument.assets.map((a) => a.durationSeconds)
            : []),
        ) * rate,
      ) + 2,
    cycleBytes = geometry
      ? geometry.states *
          (periodFrames + maxTail + Math.round(0.004 * rate)) *
          16 +
        4096
      : 0;
  // All encoded stream chunks/joined/decoder inputs + declared output/native
  // copies, all banks, curve/native-copy and graph allowance admitted upfront.
  const preparationBytes = Math.ceil(
    budget.bytes +
      assets.reduce((n, a) => n + a.bytes * 3, 0) +
      1048576 +
      cycleBytes,
  );
  // A valid long continuous score can exceed the entire pool, not just its
  // currently free part. Report the same actionable budget refusal before the
  // ledger's owner-shape guard (and before fetch/context/buffer allocation).
  if (preparationBytes > memory.snapshot().maxBytes)
    fail("combinedMemoryLimit");
  const allocation = memory.reserve(
    preparationBytes,
    "legacy Float32 preparation/decodes/graph",
  );
  let decoderContext, closePromise;
  const finishDecoder = () => {
    if (!decoderContext || decoderContext.state === "closed")
      return Promise.resolve();
    closePromise ??= Promise.resolve().then(() =>
      decoderContext.startRendering(),
    );
    return closePromise;
  };
  const exporter = new StudioWavExporter({
    catalog: compositionRegistry,
    packForKit: kit,
    outputStageFactory: legacyOutputStage,
    extensions,
    contextFactory: (frames, r) => {
      decoderContext = contextFactory(frames, r);
      return decoderContext;
    },
  });
  let result,
    cycles,
    peak = 0,
    success = false;
  try {
    result = await exporter.render(p, () => {}, {
      rate,
      signal,
      acquireDecode: memory.cachePolicy(exporter).acquireDecode,
      decodeAudioData: decodeCanonicalWav,
      renderCanonical: async (options) => {
        if (!geometry) return canonicalLegacyRender({ ...options, yieldTask });
        cycles = await renderLegacyCycles({
          ...options,
          yieldTask,
          periodFrames,
        });
        return cycles.states[0].buffer;
      },
    });
    for (let c = 0; c < 2; c++)
      for (const value of result.pcm.getChannelData(c)) {
        if (!Number.isFinite(value) || Math.abs(value) > 0.950001)
          fail("unsafeOutput");
        peak = Math.max(peak, Math.abs(value));
      }
    if (signal?.aborted) fail("cancelled");
    // Canonical rendering uses this one-frame native context only for decoding
    // and AudioBuffer creation. Finish its silent destination before shrinking
    // the admitted preparation resources; the prepared PCM is unchanged.
    await finishDecoder();
    if (signal?.aborted) fail("cancelled");
    allocation.resize(cycles ? cycles.bytes : result.frames * 8 + 4096);
    let active = true;
    success = true;
    return {
      get buffer() {
        if (!active) fail("memoryReleased");
        return result.pcm;
      },
      peak: cycles?.peak ?? peak,
      frames: cycles?.frames ?? result.frames,
      ...(cycles
        ? {
            periodFrames,
            phases: cycles.phases,
            maxLogicalVoices: cycles.maxLogicalVoices,
            cycle(index) {
              if (!active) fail("memoryReleased");
              if (!Number.isSafeInteger(index) || index < 0)
                fail("invalidLoopPlan");
              return cycles.states[
                index === 0 ? 0 : 1 + ((index - 1) % cycles.phases)
              ];
            },
          }
        : {}),
      release() {
        if (!active) return;
        active = false;
        result = null;
        cycles = null;
        allocation.release();
      },
    };
  } finally {
    exporter.dispose();
    // Error/cancellation also owns the decoder through its real completion.
    await finishDecoder();
    if (!success) {
      result = null;
      cycles = null;
      allocation.release();
    }
  }
}

export const prepareLegacyBus = (project, options) =>
  prepareLegacyResource(project, { ...options, periodFrames: null });
export const prepareLegacyContinuous = (project, options) => {
  if (!Number.isSafeInteger(options?.periodFrames))
    fail("legacyLoopClockUnsupported");
  return prepareLegacyResource(project, options);
};
