import { Transport } from "../audio/transport.js";
import {
  createProgrammeOutputStage,
  PROGRAMME_OUTPUT_BYTES,
} from "../audio/programme-output.js";
import { InstrumentSampleCache } from "../audio/instrument-cache.js";
import {
  canonicalVoiceOwners,
  reserveCanonicalVoiceOwners,
} from "../audio/canonical-voice-budget.js";
import { LoopStationSession } from "../loop-station/session.js";
import { WorkspaceAudioOwner } from "../loop-station/workspace-owner.js";
import { SelectedRecorder } from "../loop-station/selected-recorder.js";
import { AudioDocument } from "../loop-station/audio-document.js";
import { adoptRecording, digest } from "../loop-station/recording-data.js";
import { adoptOverdub } from "../loop-station/overdub.js";
import { exportAudioBundle } from "../loop-station/audio-bundle.js";
import { retainCanonicalBundle } from "../project/canonical-package.js";
import { canonicalCaptureProject } from "./canonical-capture-material.js";
import { fail } from "../project/instrument-contract.js";
import { prepareCanonicalCaptureBacking } from "./canonical-capture-backing.js";
import { prepareLoopPlan } from "../loop-station/plan.js";

export async function createCanonicalCaptureOwner({
  bundle,
  registry,
  memory,
  rate = 48000,
  contextFactory,
  outputFactory,
  fetcher,
  moduleURL,
  finiteReaderModuleURL,
  instrumentId = "saron-barung",
  trackId = null,
  signal,
  onChange = () => {},
  bars = 2,
  resolveUrl,
  programmeFetcher,
}) {
  if (canonicalVoiceOwners(memory).count) fail("canonicalOutputStillOwned");
  const own = retainCanonicalBundle(bundle),
    leases = [];
  let context,
    engine,
    cache,
    untrim,
    owner,
    controller,
    recorder,
    stage,
    backing,
    exclusive,
    closed = false,
    pendingClose = null,
    terminal = false,
    recordGeneration = 0,
    backingFault = null,
    pendingStart = Promise.resolve();
  const check = () => {
    if (signal?.aborted || terminal) fail("cancelled");
  };
  const close = () => {
    terminal = true;
    if (pendingClose) return pendingClose;
    pendingClose = (async () => {
      // Actual context closure acknowledges every native node before releasing
      // context/stage leases. It also releases a pending browser mic request.
      owner?.micInput?.close();
      const boundary = owner?.begin("stop");
      try {
        if (context && context.state !== "closed") await context.close();
        if (context && context.state !== "closed")
          fail("canonicalContextStillOwned");
        await boundary?.closed;
      } finally {
        boundary?.finish();
      }
      if (owner) {
        await owner.retryCleanupAfterContextClose();
        await recorder?.discardAll();
        await owner.replaceable();
        await owner.dispose();
      }
      await controller?.dispose();
      cache?.dispose();
      untrim?.();
      stage?.dispose();
      engine?.master.disconnect();
      backing?.dispose();
      for (const lease of leases) lease.release();
      exclusive?.release();
      own.dispose();
      closed = true;
    })();
    pendingClose.catch(() => {
      pendingClose = null;
    });
    return pendingClose;
  };
  try {
    check();
    // Reserve the complete capture workspace frontier before native effects.
    // The local dispatcher still checks every actual child against16/.95;
    // this ticket prevents an unrelated canonical owner entering concurrently.
    exclusive = reserveCanonicalVoiceOwners(memory, {
      count: 16,
      peak: 0.95,
      label: "exclusive-canonical-capture-workspace",
    });
    const project = canonicalCaptureProject(own.project, registry, {
      trackId,
      rate,
    });
    leases.push(memory.reserve(524288, "canonical/owned-capture-context"));
    context = contextFactory(rate);
    if (context.sampleRate !== rate) fail("takeRateMismatch");
    await context.resume();
    check();
    leases.push(
      memory.reserve(
        PROGRAMME_OUTPUT_BYTES + 4096,
        "canonical/capture-output-stage",
      ),
    );
    const master = context.createGain();
    master.gain.value = 1;
    stage = createProgrammeOutputStage(context, master);
    stage.output.connect(outputFactory(context));
    backing = await prepareCanonicalCaptureBacking({
      bundle: own,
      context,
      memory,
      clock: project.clock,
      bars,
      resolveUrl,
      fetcher: programmeFetcher,
      signal,
    });
    check();
    const transport = new Transport({ bpm: project.timing.bpm });
    engine = {
      context,
      transport,
      master,
      volume: 1,
      outputStage: stage,
      output: stage.output,
      disposed: false,
    };
    cache = new InstrumentSampleCache(context, registry, {
      memoryPolicy: backing.cachePolicy,
      ...(fetcher ? { fetcher } : {}),
    });
    untrim = memory.registerTrimmer(cache, () => cache.trim());
    const document = new AudioDocument({
      registry,
      memory,
      backend: { entry: (ref) => own.entries.get(ref.id) },
    });
    owner = new WorkspaceAudioOwner({
      memory,
      getProject: () => controller?.project ?? project,
      instrumentFetcher: fetcher,
      captureReplay: false,
      externalBacking: backing,
      instrumentMemoryPolicy: backing.cachePolicy,
    });
    controller = new LoopStationSession({
      context,
      transport,
      memory,
      registry,
      cache,
      output: master,
      ownsTransport: true,
      admission: owner,
      finiteReaderModuleURL,
      resolveRecording: (ref, options) =>
        document.resolve(ref, context, options),
      prepare: async (value, options) => {
        // The selected base remains in the authoritative adoption projection,
        // but its audible copy is already present once in the full backing.
        const monitor = structuredClone(value);
        for (const t of monitor.tracks) t.clips = [];
        const plan = await prepareLoopPlan(monitor, options);
        plan.project = value;
        return plan;
      },
    });
    owner.attach(engine, controller);
    await controller.prepareProject(project);
    check();
    // This fresh exclusive context has no playing source yet. Build the
    // initial mixer against a stable native time; its strict instant-program
    // check must not race a render quantum while the graph is constructed.
    await context.suspend();
    check();
    await owner.prepareInstrument("track-1", {
      moduleURL,
      overdub: trackId !== null,
    });
    check();
    await context.resume();
    check();
    recorder = new SelectedRecorder(owner);
    await recorder.prepare("track-1", {
      instrumentId,
      overdub: trackId !== null,
    });
    check();
    const snapshot = () => ({
      ...recorder.snapshot(),
      closed,
      pendingClose: terminal && !closed,
      overdubTrackId: trackId,
      memory: memory.snapshot(),
      micStatus: owner.micStatus,
      backing: backing.snapshot(),
      backingFault,
    });
    const notify = () => {
      try {
        onChange(snapshot());
      } catch {
        /* observer only */
      }
    };
    owner.capture.subscribe(notify);
    controller.subscribe(notify);
    return Object.freeze({
      context,
      source: () => (recorder.source?.isCurrent() ? recorder.source : null),
      waveformState() {
        const h = recorder.current;
        return h
          ? Object.freeze({
              identity: h,
              frames: h.take?.frames ?? h.acknowledgedFrames ?? 0,
              read: (from) => h.waveform(from),
            })
          : null;
      },
      snapshot,
      enableMic() {
        check();
        if (
          globalThis.document?.permissionsPolicy?.allowsFeature?.(
            "microphone",
          ) === false
        )
          fail("micPolicyBlocked");
        return recorder.enableMic().then((x) => {
          notify();
          return x;
        });
      },
      setMicMonitoring(enabled, { headphonesConfirmed = false } = {}) {
        check();
        return owner.setMicMonitoring("track-1", enabled, {
          headphonesConfirmed,
        });
      },
      async record({ bars = 2, countInBars = 1 } = {}) {
        check();
        if (!recorder.source) fail("instrumentNotReady");
        if (bars !== backing.bars) fail("captureWindowChanged");
        await owner.run("play", () => controller.play());
        check();
        const handle = recorder.arm({ bars, countInBars });
        const generation = ++recordGeneration;
        pendingStart = handle.prepared
          .then(() => {
            check();
            if (
              generation !== recordGeneration ||
              ["closed", "closing", "closing-error"].includes(handle.state)
            )
              fail("cancelled");
            backing.start(handle.plan.startFrame, master);
          })
          .catch(async (e) => {
            if (e.code !== "cancelled")
              backingFault = e.code ?? "canonicalBackingFailed";
            await handle.stop();
            notify();
          });
        pendingStart.catch((e) => {
          backingFault = e.code ?? "canonicalBackingCleanupPending";
          notify();
        });
        handle.ready.then(notify, notify);
        handle.closed.then(notify, notify);
        notify();
        return handle;
      },
      async stop() {
        if (closed) return;
        recordGeneration++;
        await recorder.stop();
        await pendingStart;
        await backing.stop();
        notify();
      },
      async exportPackage() {
        check();
        recordGeneration++;
        await recorder.stop();
        await pendingStart;
        await backing.stop();
        check();
        const take = recorder.current?.take;
        if (!take) fail("captureTakeHeld");
        if (take.partial) fail("partialTakeNeedsReview");
        const provenance = recorder.takes.attribution(take.id),
          copy = owner.pool.copyPCM(take.id);
        let held;
        try {
          const hash = await digest(copy.buffer);
          check();
          const adopted =
              trackId === null
                ? adoptRecording(
                    controller.project,
                    registry,
                    "track-1",
                    take,
                    hash,
                  )
                : adoptOverdub(
                    controller.project,
                    registry,
                    "track-1",
                    take,
                    hash,
                    recorder.base,
                  ),
            entries = new Map();
          held = memory.reserve(
            copy.buffer.byteLength + 4096,
            "canonical/capture-export-blob",
          );
          entries.set(adopted.ref.id, {
            blob: new Blob([copy.buffer]),
            provenance,
          });
          for (const ref of adopted.project.assetRefs)
            if (!entries.has(ref.id))
              entries.set(ref.id, own.entries.get(ref.id));
          // The current Studio retains the actual root limiter. A material
          // container cannot install a second nonlinear outer limiter.
          const exported = structuredClone(adopted.project);
          if (exported.master.limiter) exported.master.limiter.bypass = true;
          let output = await exportAudioBundle(exported, entries, {
            registry,
            memory,
            signal,
          });
          // The complete portable output now owns its source Blob parts AND
          // encoded container under its existing2x-size reservation. Retire
          // the temporary source-Blob ticket only after that real handoff.
          entries.clear();
          held.release();
          held = null;
          let released = false;
          return {
            get blob() {
              return output?.blob ?? null;
            },
            take,
            release() {
              if (released) return;
              released = true;
              output.release();
              output = null;
            },
          };
        } catch (e) {
          held?.release();
          throw e;
        } finally {
          copy.release();
        }
      },
      wav() {
        check();
        const take = recorder.current?.take;
        if (!take) fail("captureTakeHeld");
        return recorder.takes.wav(take.id);
      },
      dispose: close,
    });
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      Object.assign(error, { cleanup: close, cleanupError });
    }
    throw error;
  }
}
