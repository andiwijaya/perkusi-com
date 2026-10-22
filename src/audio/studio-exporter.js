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
import { calibratePCM, PROGRAMME_SCRATCH_BYTES } from "./programme-level.js";
import { programmeSample } from "./programme-output.js";

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
      !arrangementEvents(mixed).some((e) => {
        const eventTracks =
          valid.loopScope === "pattern-v1"
            ? mixedStudioView(valid, e.patternId).tracks
            : mixed.tracks;
        return (
          trackGain(
            eventTracks.find((t) => t.role === e.role),
            eventTracks,
          ) *
            e.velocity >
          0
        );
      }))
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
    matchProgramme = false,
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
      matchProgramme,
    });
    this.active = null;
    this.disposed = false;
  }
  cancel() {
    this.active?.abort();
  }
  async render(project, onProgress = () => {}, pcmOptions = null) {
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
    if (
      this.matchProgramme &&
      budget.bytes + PROGRAMME_SCRATCH_BYTES > 32 * 1024 * 1024
    ) {
      this.active = null;
      throw new ProjectError("exportLimit");
    }
    if (this.matchProgramme) budget.bytes += PROGRAMME_SCRATCH_BYTES;
    const { signal } = controller;
    const cancelExternal = () => controller.abort();
    pcmOptions?.signal?.addEventListener("abort", cancelExternal);
    if (pcmOptions?.signal?.aborted) controller.abort();
    let context, bank, master, stage, mixer, extras;
    const voices = [],
      last = new Map(),
      decodes = new Set();
    const abort = () => bank?.cancelLoading();
    signal.addEventListener("abort", abort);
    try {
      const rate = pcmOptions?.rate ?? 48000;
      if (![44100, 48000].includes(rate)) throw new ProjectError("exportLimit");
      // Canonical V4 needs only the native decoder/AudioBuffer factory. Do not
      // provision a second arrangement-sized native render destination.
      context = this.contextFactory(
        pcmOptions?.renderCanonical ? 1 : Math.round(budget.seconds * rate),
        rate,
      );
      bank = new SampleBank(
        this.packForKit(budget.valid.pack.id),
        this.bankOptions,
      );
      const decodeContext = {
        decodeAudioData: async (data) => {
          const job = (async () => {
            const release = await pcmOptions?.acquireDecode?.(signal);
            try {
              throwIfCancelled(signal);
              return await (pcmOptions?.decodeAudioData
                ? pcmOptions.decodeAudioData(context, data)
                : context.decodeAudioData(data));
            } finally {
              release?.();
            }
          })();
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
      // Only the V4 prepared bus opts into this frame-domain renderer. The
      // ordinary V1-V3 graph, envelope and WAV path below remain unchanged.
      if (pcmOptions?.renderCanonical) {
        onProgress({ phase: "rendering", value: 0 });
        const pcm = await pcmOptions.renderCanonical({
          context,
          project: budget.valid,
          bank,
          extras,
          rate,
          signal,
          onProgress,
        });
        throwIfCancelled(signal);
        return {
          pcm,
          frames: pcm.length,
          sampleRate: pcm.sampleRate,
          channels: 2,
          seconds: budget.seconds,
          estimatedBytes: budget.bytes,
          project: budget.valid,
        };
      }
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
      this.extensions?.schedule(
        context,
        master,
        budget.valid,
        extras,
        voices,
        mixer,
      );
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
      const calibration = this.matchProgramme
        ? calibratePCM(
            [pcm.getChannelData(0), pcm.getChannelData(1)],
            rate,
            budget.valid.master.volume,
          )
        : { gain: 1, metrics: null };
      if (this.matchProgramme && !pcmOptions?.uncalibrated)
        for (let c = 0; c < 2; c++) {
          const a = pcm.getChannelData(c);
          for (let i = 0; i < a.length; i++)
            a[i] = programmeSample(a[i] * calibration.gain);
        }
      // Optional admitted Float32 bus keeps the original score and DSP. The
      // ordinary V1-V3 WAV path and its 48kHz encoding remain unchanged.
      const encoded = pcmOptions
        ? { pcm, frames: pcm.length, sampleRate: pcm.sampleRate, channels: 2 }
        : await encodeWav(pcm, { signal, onProgress });
      throwIfCancelled(signal);
      return {
        ...encoded,
        programmeCalibration: calibration,
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
      pcmOptions?.signal?.removeEventListener("abort", cancelExternal);
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
