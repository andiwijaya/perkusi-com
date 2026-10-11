import { validateProject, ProjectError } from "../project/schema.js";
import { SampleBank } from "./sample-bank.js";
import { createLoopVoice, disconnectVoice } from "./voice.js";
import { encodeWav, throwIfCancelled } from "./wav.js";

export const EXPORT_RATE = 48000;
export const EXPORT_MEMORY_LIMIT = 32 * 1024 * 1024;
export function exportBudget(project, catalog, retainedBytes = 0) {
  const valid = validateProject(project, catalog),
    seconds = (valid.export.bars * 4 * 60) / valid.timing.bpm,
    frames = Math.round(seconds * EXPORT_RATE);
  const active = valid.tracks.filter((t) => t.enabled);
  if (!active.length || valid.master.volume === 0)
    throw new ProjectError("emptyMix");
  const bytes =
    frames * 10 +
    ((active.length * catalog.bars * 4 * 60) / catalog.bpm) * EXPORT_RATE * 4 +
    retainedBytes +
    4 * 1024 * 1024;
  if (
    !Number.isFinite(retainedBytes) ||
    retainedBytes < 0 ||
    seconds > 20 ||
    frames > 960000 ||
    bytes > EXPORT_MEMORY_LIMIT
  )
    throw new ProjectError("exportLimit");
  return { valid, active, seconds, frames, bytes };
}
export class OfflineWavExporter {
  constructor({
    catalog,
    packForSelection,
    prepareBuffer,
    outputStageFactory,
    contextFactory = (frames) =>
      new OfflineAudioContext(1, frames, EXPORT_RATE),
    retainedBytes = () => 0,
    bankOptions = {},
  }) {
    Object.assign(this, {
      catalog,
      packForSelection,
      prepareBuffer,
      outputStageFactory,
      contextFactory,
      retainedBytes,
      bankOptions,
    });
    this.active = null;
    this.disposed = false;
  }
  cancel() {
    this.active?.abort();
  }
  async render(project, onProgress = () => {}) {
    if (this.disposed) throw new ProjectError("cancelled");
    if (this.active) throw new ProjectError("exportBusy");
    const budget = exportBudget(project, this.catalog, this.retainedBytes()),
      controller = new AbortController();
    this.active = controller;
    const signal = controller.signal;
    let context, master, stage, bank;
    const voices = [],
      pendingDecodes = new Set();
    const abort = () => bank?.cancelLoading();
    signal.addEventListener("abort", abort);
    try {
      // Fixed 4/8-bar mono output, conservative page-retained + decode/render/WAV budget.
      context = this.contextFactory(budget.frames);
      const selection = Object.fromEntries(
        budget.valid.tracks.map((t) => [t.role, t.variant]),
      );
      const fullPack = this.packForSelection(selection),
        pack = {
          ...fullPack,
          stems: fullPack.stems.filter((s) =>
            budget.active.some((t) => t.role === s.id),
          ),
        };
      bank = new SampleBank(pack, {
        ...this.bankOptions,
        prepareBuffer: this.prepareBuffer,
      });
      const decodeContext = {
        decodeAudioData: async (bytes) => {
          const pending = context.decodeAudioData(bytes);
          pendingDecodes.add(pending);
          try {
            return await pending;
          } finally {
            pendingDecodes.delete(pending);
          }
        },
      };
      let loaded = 0;
      onProgress({ phase: "loading", value: 0 });
      throwIfCancelled(signal);
      await Promise.all(
        pack.stems.map(async (s) => {
          await bank.load(s.id, decodeContext);
          throwIfCancelled(signal);
          if (!bank.get(s.id).buffer) throw new ProjectError("assetFailed");
          onProgress({ phase: "loading", value: ++loaded / pack.stems.length });
        }),
      );
      throwIfCancelled(signal);
      const bound =
        pack.stems.reduce(
          (sum, s) => sum + bank.get(s.id).metrics.peak * s.gainTrim,
          0,
        ) * 0.75;
      if (bound > 0.95) throw new ProjectError("unsafeOutput");
      master = context.createGain();
      master.gain.value = budget.valid.master.volume;
      stage = this.outputStageFactory(context, master);
      stage.output.connect(context.destination);
      for (const stem of pack.stems)
        voices.push(
          createLoopVoice(
            context,
            master,
            bank.get(stem.id),
            { duration: bank.duration },
            0,
          ),
        );
      onProgress({ phase: "rendering", value: null });
      throwIfCancelled(signal);
      // Native offline work cannot be force-aborted portably. Keep the job owned
      // until it settles, discard cancelled PCM, then allow another render.
      const rendered = await context.startRendering();
      throwIfCancelled(signal);
      const result = await encodeWav(rendered, { signal, onProgress });
      throwIfCancelled(signal);
      return {
        ...result,
        bars: budget.valid.export.bars,
        seconds: budget.seconds,
        estimatedBytes: budget.bytes,
        project: budget.valid,
      };
    } catch (error) {
      if (signal.aborted) throw new ProjectError("cancelled");
      if (error instanceof ProjectError) throw error;
      throw new ProjectError(
        error instanceof RangeError ? "exportLimit" : "exportFailed",
      );
    } finally {
      signal.removeEventListener("abort", abort);
      for (const voice of voices) disconnectVoice(voice);
      master?.disconnect();
      stage?.dispose();
      bank?.dispose();
      // SampleBank logically cancels immediately; native decoding may outlive
      // that promise. Keep single-job ownership until native PCM work settles.
      await Promise.allSettled([...pendingDecodes]);
      this.active = null;
    }
  }
  dispose() {
    this.disposed = true;
    this.cancel();
  }
}
