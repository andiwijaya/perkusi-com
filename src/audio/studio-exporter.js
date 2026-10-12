import { mixedStudioView } from "../project/composition-model.js";
import { SampleBank } from "./sample-bank.js";
import { encodeWav, throwIfCancelled } from "./wav.js";
import { ProjectError, validateProject } from "../project/schema.js";
import {
  arrangementEvents,
  createTrackMixer,
  scheduleShot,
  trackGain,
} from "./sequencing.js";
import { disconnectVoice } from "./voice.js";

export function studioExportBudget(
  project,
  catalog,
  retainedBytes = 0,
  extra = { decode: 0, audible: false },
) {
  const valid = validateProject(project, catalog),
    seconds = (valid.chain.length * 4 * 60) / valid.timing.bpm;
  const frames = Math.round(seconds * 48000);
  const mixed = valid.schemaVersion === 3 ? mixedStudioView(valid) : valid;
  const kit = catalog.kits.find((k) => k.id === valid.pack.id);
  const decode = kit.assets.reduce((s, a) => s + a.frames * 4, 0);
  const bytes =
    frames * 12 + decode + (extra.decode || 0) + retainedBytes + 4096;
  if (
    !Number.isFinite(retainedBytes) ||
    retainedBytes < 0 ||
    frames > 1536000 ||
    bytes > 32 * 1024 * 1024
  )
    throw new ProjectError("exportLimit");
  if (
    valid.master.volume === 0 ||
    (!extra.audible &&
      !arrangementEvents(mixed).some(
        (e) =>
          trackGain(
            mixed.tracks.find((t) => t.role === e.role),
            mixed.tracks,
          ) *
            e.velocity >
          0,
      ))
  )
    throw new ProjectError("emptyMix");
  return { valid, frames, seconds, bytes };
}
export class StudioWavExporter {
  constructor({
    catalog,
    packForKit,
    outputStageFactory,
    retainedBytes = () => 0,
    bankOptions,
    extensions = null,
    contextFactory = (frames) => new OfflineAudioContext(2, frames, 48000),
  }) {
    Object.assign(this, {
      catalog,
      packForKit,
      outputStageFactory,
      retainedBytes,
      bankOptions,
      contextFactory,
      extensions,
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
    const budget = studioExportBudget(
        project,
        this.catalog,
        this.retainedBytes(),
        this.extensions?.budget(project),
      ),
      controller = new AbortController();
    this.active = controller;
    const { signal } = controller;
    let context, bank, master, stage, mixer, extras;
    const voices = [],
      last = new Map(),
      decodes = new Set();
    const abort = () => bank?.cancelLoading();
    signal.addEventListener("abort", abort);
    try {
      context = this.contextFactory(budget.frames);
      bank = new SampleBank(
        this.packForKit(budget.valid.pack.id),
        this.bankOptions,
      );
      const decodeContext = {
        decodeAudioData: async (data) => {
          const job = context.decodeAudioData(data);
          decodes.add(job);
          try {
            return await job;
          } finally {
            decodes.delete(job);
          }
        },
      };
      let loaded = 0;
      onProgress({ phase: "loading", value: 0 });
      await Promise.all(
        bank.pack.stems.map(async (s) => {
          await bank.load(s.id, decodeContext);
          throwIfCancelled(signal);
          if (!bank.get(s.id).buffer) throw new ProjectError("assetFailed");
          onProgress({ phase: "loading", value: ++loaded / 8 });
        }),
      );
      throwIfCancelled(signal);
      extras = await this.extensions?.prepare(
        decodeContext,
        budget.valid,
        signal,
      );
      throwIfCancelled(signal);
      master = context.createGain();
      master.gain.value = budget.valid.master.volume;
      stage = this.outputStageFactory(context, master);
      stage.output.connect(context.destination);
      const tracks =
        budget.valid.schemaVersion === 3
          ? mixedStudioView(budget.valid).tracks
          : budget.valid.tracks;
      mixer = createTrackMixer(context, master, tracks);
      mixer.update(tracks, 0, true);
      for (const e of arrangementEvents(budget.valid)) {
        const v = scheduleShot(
          context,
          mixer,
          bank.get(e.role),
          e.when,
          e.velocity,
          last.get(e.role),
        );
        voices.push(v);
        last.set(e.role, v);
      }
      this.extensions?.schedule(context, master, budget.valid, extras, voices);
      // Exact arrangement length; fade the end rather than append hidden tail bars.
      master.gain.setValueAtTime(
        budget.valid.master.volume,
        Math.max(0, budget.seconds - 0.004),
      );
      master.gain.linearRampToValueAtTime(0, budget.seconds);
      onProgress({ phase: "rendering", value: null });
      throwIfCancelled(signal);
      const pcm = await context.startRendering();
      throwIfCancelled(signal);
      const encoded = await encodeWav(pcm, { signal, onProgress });
      throwIfCancelled(signal);
      return {
        ...encoded,
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
      for (const v of voices) disconnectVoice(v);
      mixer?.dispose();
      master?.disconnect();
      stage?.dispose();
      bank?.dispose();
      this.extensions?.dispose(extras);
      await Promise.allSettled([...decodes]);
      this.active = null;
    }
  }
  dispose() {
    this.disposed = true;
    this.cancel();
  }
}
