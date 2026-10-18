import { prepareLoopPlan, loopAdmission } from "./plan.js";
import { finalMixProgram, recordingOnlyPlan } from "./final-program.js";
import { buildMixGraph } from "./mix-graph.js";
import { startPlannedVoice } from "./planned-voice.js";
import { encodeFinalWav } from "./final-wav.js";
import { portableMixBytes, renderPortableMix } from "./portable-mix.js";
import { recordingProject, checkAbort, creditText } from "./recording-data.js";
import { fxBytes, hasEQ, limiterEnabled } from "./fx-model.js";
import { InstrumentSampleCache } from "../audio/instrument-cache.js";
import { gamelanWavAttribution } from "../gamelan/attribution.js";
import { instrumentSource } from "./model.js";
import { fail } from "../project/instrument-contract.js";
import { exportScoreChunks } from "./score-export.js";
import { programmeSample } from "../audio/programme-output.js";
import {
  calibratePCM,
  PROGRAMME_SCRATCH_BYTES,
} from "../audio/programme-level.js";
const yieldTask = () => new Promise((r) => setTimeout(r, 0));

export async function preflightMixFX(
  project,
  {
    registry,
    memory,
    documentStore,
    entries,
    signal,
    owner,
    contextFactory = (c, f, r) => new OfflineAudioContext(c, f, r),
  },
) {
  const rate =
      project.clock?.kind === "fixed-bar" ? project.clock.sampleRate : 48000,
    lease = memory.reserve(524288, "FX-admission-context");
  let context, cache, plan, untrim;
  try {
    checkAbort(signal);
    context = contextFactory(2, 1, rate);
    if (
      (project.tracks.some((t) => hasEQ(t.eq)) &&
        (!context.createIIRFilter || !context.createConstantSource)) ||
      (limiterEnabled(project.master) && !context.createWaveShaper)
    )
      fail("loopFXUnavailable");
    cache = new InstrumentSampleCache(context, registry, {
      memoryPolicy: memory.cachePolicy(context),
    });
    untrim = memory.registerTrimmer(cache, () => cache.trim());
    plan = await prepareLoopPlan(project, {
      recordedLoops: true,
      registry,
      rate,
      cache,
      memory,
      signal,
      resolveRecording: (a, o) =>
        documentStore.resolve(a, context, { ...o, entry: entries?.get(a.id) }),
    });
    const bounds = loopAdmission(plan, project, { recordedLoops: true });
    owner?.admitLivePreflight(plan, project);
    const future = memory.reserve(
      4096 +
        8192 * project.tracks.length +
        fxBytes(project) +
        bounds.maxOwned * 8192,
      "FX-admission-future-graph-voices",
    );
    future.release();
  } finally {
    plan?.release();
    cache?.dispose();
    untrim?.();
    if (context && context.state !== "closed")
      await context.startRendering().catch(() => {});
    lease.release();
  }
}

// Offline work owns its context/cache/nodes. It never dispatches a live Stop or
// changes a live transport/project. Every allocation shares the workspace ledger.
export class FinalMixExporter {
  constructor({
    memory,
    registry,
    registryForRate = () => registry,
    documentStore,
    owner,
    contextFactory = (channels, frames, rate) =>
      new OfflineAudioContext(channels, frames, rate),
  }) {
    Object.assign(this, {
      memory,
      registry,
      registryForRate,
      documentStore,
      owner,
      contextFactory,
    });
    this.pending = null;
    this.generation = 0;
  }
  render(value, { bars = 4, onProgress = () => {} } = {}) {
    if (this.pending) fail("finalMixBusy");
    const project = recordingProject(value, this.registry),
      abort = new AbortController(),
      token = ++this.generation;
    const emit = (p) => {
      try {
        onProgress(p);
      } catch {
        /* UI never owns audio resources. */
      }
    };
    // Publish ownership before a progress callback can reenter render/cancel.
    const operation = Promise.resolve().then(() =>
      this.run(project, { bars, signal: abort.signal, emit }),
    );
    this.pending = { abort, operation, token };
    const done = () => {
      if (this.pending?.token === token) this.pending = null;
    };
    void operation.then(done, done);
    return operation;
  }
  async cancel() {
    const p = this.pending;
    if (!p) return;
    p.abort.abort();
    await p.operation.catch(() => {});
  }
  async run(project, { bars, signal, emit }) {
    const memory = this.memory,
      rate =
        project.clock?.kind === "fixed-bar"
          ? project.clock.sampleRate
          : (this.owner.engine?.context.sampleRate ?? 48000),
      registry = this.registryForRate(rate);
    if (![44100, 48000].includes(rate)) fail("takeRateMismatch");
    let prep,
      context,
      cache,
      plan,
      graph,
      ticket,
      untrim,
      prepLease,
      contextLease,
      outputLease,
      portableLease,
      renderPromise,
      pendingBoundary;
    const voices = new Set(),
      aux = [];
    let rendered,
      result,
      stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      for (const row of voices) row.voice.stop();
    };
    const drain = async () => {
      stop();
      if (context) {
        if (!renderPromise) renderPromise = context.startRendering();
        if (pendingBoundary) {
          await pendingBoundary.catch(() => {});
          pendingBoundary = null;
        }
        if (context.state === "suspended") await context.resume();
        await renderPromise.catch(() => {});
      }
    };
    try {
      checkAbort(signal);
      emit({ phase: "preparing", value: 0 });
      checkAbort(signal);
      prepLease = memory.reserve(524288, "final-prepare-context");
      prep = this.contextFactory(2, 1, rate);
      cache = new InstrumentSampleCache(prep, registry, {
        memoryPolicy: memory.cachePolicy(prep),
      });
      untrim = memory.registerTrimmer(cache, () => cache.trim());
      plan = await prepareLoopPlan(project, {
        recordedLoops: true,
        registry,
        rate,
        cache,
        memory,
        signal,
        resolveRecording: (a, o) => this.documentStore.resolve(a, prep, o),
      });
      const portableRecordings = recordingOnlyPlan(plan);
      let program = finalMixProgram(plan, bars, {
        backend: portableRecordings
          ? "portable-recordings"
          : "native-checkpoints",
      });
      const checkpointed =
        !portableRecordings &&
        typeof prep.suspend === "function" &&
        typeof prep.resume === "function";
      ticket = this.owner.reserveRender(
        plan,
        portableRecordings ? program : undefined,
      );
      await prep.startRendering();
      prepLease.release();
      prepLease = null;
      checkAbort(signal);
      if (!project.assetRefs.length) {
        contextLease = memory.reserve(524288, "final-score-context");
        const meta = {
          format: "perkusi-final-mix",
          version: 1,
          project,
          render: {
            bars,
            rate,
            bodyFrames: program.bodyFrames,
            naturalEnd: program.naturalEnd,
            tailFrames: program.tailFrames,
            frames: program.frames,
            latencyFrames: 0,
            outputProtection: "programme-soft-knee-v1",
          },
          recordingCredits: [],
          officialCredits: [...project.origins, ...(project.sources ?? [])].map(
            (o) => ({
              id: o.id,
              text: gamelanWavAttribution(instrumentSource(o.text, registry)),
            }),
          ),
        };
        result = await exportScoreChunks(plan, program, meta, {
          memory,
          context: prep,
          signal,
          onProgress: emit,
          releaseSources: () => {
            plan.release();
            plan = null;
            program = null;
            cache.dispose();
            cache = null;
            untrim();
            untrim = null;
            ticket.release();
            ticket = null;
            prep = null;
            contextLease.release();
            contextLease = null;
          },
        });
        checkAbort(signal);
        result.meta = meta;
        result.stats = meta.render;
        return result;
      }
      // 4 native channels + 4 getChannelData views: post L/R and pre-limiter L/R.
      outputLease = memory.reserve(
        program.frames * 32,
        "final-render/native-and-views",
      );
      contextLease = memory.reserve(
        524288 + 65536,
        "final-context-routing-schedule",
      );
      context = this.contextFactory(4, checkpointed ? program.frames : 1, rate);
      if (!checkpointed) {
        portableLease = memory.reserve(
          portableMixBytes(project, program),
          "final-portable-source-views-and-state",
        );
        rendered = await renderPortableMix(context, project, program, {
          signal,
          onProgress: emit,
        });
        renderPromise = context.startRendering();
        await renderPromise;
      } else {
        const merger = context.createChannelMerger(4),
          post = context.createChannelSplitter(2),
          pre = context.createChannelSplitter(2);
        aux.push(merger, post, pre);
        merger.connect(context.destination);
        graph = buildMixGraph(context, project, memory, post);
        graph.master.connect(pre);
        for (let c = 0; c < 2; c++) {
          post.connect(merger, c, c);
          pre.connect(merger, c, c + 2);
        }
        const events = [...program.events].sort(
          (a, b) =>
            a.spec.startFrame - b.spec.startFrame ||
            a.trackId.localeCompare(b.trackId),
        );
        let cursor = 0;
        const schedule = (end) => {
          while (
            cursor < events.length &&
            events[cursor].spec.startFrame < end
          ) {
            checkAbort(signal);
            if (voices.size >= 16) fail("voiceLimit");
            const e = events[cursor++],
              row = { voice: null };
            row.voice = startPlannedVoice(
              context,
              graph.graphs.get(e.trackId).gain,
              e.spec,
              e.spec.startFrame / rate,
              e.spec.startFrame,
              memory,
              () => voices.delete(row),
            );
            voices.add(row);
          }
        };
        const chunk = 2048;
        let next = chunk;
        schedule(Math.min(next, program.frames));
        if (next < program.frames)
          pendingBoundary = context.suspend(next / rate);
        signal.addEventListener("abort", stop, { once: true });
        renderPromise = context.startRendering();
        while (pendingBoundary) {
          await pendingBoundary;
          pendingBoundary = null;
          await yieldTask();
          checkAbort(signal);
          if (Math.round(context.currentTime * rate) !== next)
            fail("finalMixBoundary");
          schedule(Math.min(next + chunk, program.frames));
          emit({ phase: "rendering", value: next / program.frames });
          next += chunk;
          if (next < program.frames)
            pendingBoundary = context.suspend(next / rate);
          await context.resume();
        }
        rendered = await renderPromise;
      }
      checkAbort(signal);
      for (const row of [...voices]) row.voice.disconnect();
      voices.clear();
      let prePeak = 0,
        postPeak = 0,
        limitedSamples = 0;
      const preChannels = [
          rendered.getChannelData(2),
          rendered.getChannelData(3),
        ],
        postChannels = [rendered.getChannelData(0), rendered.getChannelData(1)];
      for (let from = 0; from < rendered.length; from += 32768) {
        checkAbort(signal);
        for (let f = from; f < Math.min(rendered.length, from + 32768); f++)
          for (let c = 0; c < 2; c++) {
            const a = preChannels[c][f],
              b = postChannels[c][f];
            if (
              !Number.isFinite(a) ||
              !Number.isFinite(b) ||
              Math.abs(a) > 0.95 ||
              Math.abs(b) > 0.95
            )
              fail("unsafeOutput");
            prePeak = Math.max(prePeak, Math.abs(a));
            postPeak = Math.max(postPeak, Math.abs(b));
            if (
              Math.abs(a) > 0.8 &&
              project.master.limiter &&
              !project.master.limiter.bypass
            )
              limitedSamples++;
          }
        emit({
          phase: "checking",
          value: Math.min(1, (from + 32768) / rendered.length),
        });
        await yieldTask();
      }
      const recordingCredits = [];
      const programmeLease = project.assetRefs.length
        ? null
        : this.memory.reserve(PROGRAMME_SCRATCH_BYTES, "programme-final-meter");
      let programmeCalibration;
      try {
        programmeCalibration = project.assetRefs.length
          ? { gain: 1, metrics: null }
          : calibratePCM(postChannels, rate, project.master.volume, 1);
        postPeak = 0;
        for (const channel of postChannels)
          for (let i = 0; i < channel.length; i++) {
            channel[i] = programmeSample(
              channel[i] * programmeCalibration.gain,
            );
            postPeak = Math.max(postPeak, Math.abs(channel[i]));
          }
      } finally {
        programmeLease?.release();
      }
      for (const ref of project.assetRefs) {
        checkAbort(signal);
        const entry = await this.documentStore.backend.entry(ref);
        recordingCredits.push({
          id: ref.id,
          sha256: ref.sha256,
          text: creditText(entry.provenance),
        });
      }
      const official = [...project.origins, ...(project.sources ?? [])].map(
        (o) => {
          const p = instrumentSource(o.text, registry);
          return { id: o.id, text: gamelanWavAttribution(p) };
        },
      );
      const meta = {
        format: "perkusi-final-mix",
        version: 1,
        project,
        render: {
          programmeCalibration,
          outputProtection: "programme-soft-knee-v1",
          bars,
          path: portableRecordings
            ? "portable-recordings-v1"
            : checkpointed
              ? "native-checkpoints"
              : "portable-frames-v1",
          rate,
          bodyFrames: program.bodyFrames,
          naturalEnd: program.naturalEnd,
          tailFrames: program.tailFrames,
          frames: program.frames,
          latencyFrames: 0,
          prePeak,
          postPeak,
          limitedSamples,
          silent: postPeak === 0,
        },
        recordingCredits,
        officialCredits: official,
      };
      result = await encodeFinalWav(rendered, meta, {
        memory,
        signal,
        onProgress: emit,
      });
      checkAbort(signal);
      result.meta = meta;
      result.stats = meta.render;
      return result;
    } catch (e) {
      result?.release();
      await drain();
      throw e;
    } finally {
      signal.removeEventListener("abort", stop);
      if (context && context.state !== "closed") await drain();
      for (const row of [...voices]) row.voice.disconnect();
      voices.clear();
      graph?.release();
      for (const n of aux) n.disconnect();
      plan?.release();
      cache?.dispose();
      untrim?.();
      portableLease?.release();
      if (prep && prep.state !== "closed")
        await prep.startRendering().catch(() => {});
      ticket?.release();
      prepLease?.release();
      contextLease?.release();
      outputLease?.release();
    }
  }
}
