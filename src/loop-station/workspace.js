import "../style.css";
import "./workspace.css";
import c44 from "../../internal/instrument-focus/registry-44100.json" with { type: "json" };
import c48 from "../../internal/instrument-focus/registry-48000.json" with { type: "json" };
import { InstrumentRegistry } from "../audio/instrument-registry.js";
import { drumBanks } from "./drum-sources.js";
import { melodicBanks } from "./melodic-sources.js";
import { starterContent, createStarter } from "./starters.js";
import { AudioEngine } from "../audio/engine.js";
import { createProgrammeOutputStage } from "../audio/programme-output.js";
import { calibrateLoopProgramme } from "./programme-level.js";
import { createPackFromCatalog } from "../audio/pack-catalog.js";
import { originalRegistry } from "../project/original-registry.js";
import { AudioMemory } from "../audio/audio-memory.js";
import { InstrumentSampleCache } from "../audio/instrument-cache.js";
import { LoopStationSession } from "./session.js";
import { WorkspaceAudioOwner } from "./workspace-owner.js";
import { freezeCaptureProject } from "./master-capture-clock.js";
import {
  LoopHistory,
  emptyLoopProject,
  eightTrackProject,
  assignSource,
  instrumentSource,
} from "./model.js";
import { eightTrackDemo } from "./demo.js";
import { loopCopy } from "./copy.js";
import { renderSiteShell } from "../app/site-shell.js";
import { initNavigation } from "../app/navigation.js";
import { resolveLocale, readLocale, saveLocale } from "../i18n/locale.js";
import { focusKeeper } from "../gamelan/accessible-focus.js";
import { fail } from "../project/instrument-contract.js";
import { commitLoopEdit } from "./persisted-edit.js";
import { SharedLoopDraft } from "./shared-draft.js";
import { legacyAudible } from "../project/instrument-mix.js";
import { SelectedRecorder } from "./selected-recorder.js";
import { RecordPanel } from "./record-panel.js";
import { alignRecordedClip } from "./phase-alignment.js";
import { phaseCopy } from "./phase-copy.js";
import { DeviceProfileStore } from "./device-profiles.js";
import { mountDeviceProfiles } from "./device-profile-panel.js";
import { TrackWaveforms, waveformCopy } from "./track-waveforms.js";
import { recordCopy } from "./record-copy.js";
import { AudioDocument } from "./audio-document.js";
import { audioCopy } from "./audio-copy.js";
import { adoptRecording, digest, checkAbort } from "./recording-data.js";
import { importAudioBundle } from "./audio-bundle.js";
import { overdubBase, adoptOverdub } from "./overdub.js";
import { prepareLoopPlan } from "./plan.js";
import { MasterClock } from "./master-clock.js";
import { legacyCycleGeometry } from "../audio/legacy-cycles.js";
import { PPQ } from "../project/instrument-project.js";
import { overdubCopy } from "./overdub-copy.js";
import { FinalMixExporter, preflightMixFX } from "./final-export.js";
import { FinalPanel } from "./final-panel.js";
import {
  gamelanHostAllowed,
  syncLoopPublicMetadata,
} from "../gamelan/public-context.js";
import { finalCopy } from "./final-copy.js";
import { FLAT_EQ, BYPASS_LIMITER, hasEQ, limiterEnabled } from "./fx-model.js";
import captureModuleURL from "./capture-worklet.js?worker&url";
import finiteReaderModuleURL from "./finite-reader-worklet.js?worker&url";
export const LOOP_DRAFT_KEY = "perkusi.loop-station.draft.v5",
  LOOP_INCOMING_KEY = "perkusi.loop-station.incoming.v4";
const host = document.getElementById("loop-workspace");
export let workspace = null;
if (
  !import.meta.env.GAMELAN_V5_UX ||
  !gamelanHostAllowed(location.hostname, import.meta.env.GAMELAN_PUBLIC_BUILD)
) {
  host.textContent = "Local preview unavailable.";
} else workspace = init();
function init() {
  const storedLocale = () => {
    try {
      return readLocale(localStorage);
    } catch {
      return null;
    }
  };
  const registry = new InstrumentRegistry([
      ...c48.banks,
      ...drumBanks,
      ...melodicBanks(),
    ]),
    memory = new AudioMemory(),
    urls = new Set(),
    portableExports = new Map(),
    focus = focusKeeper(host),
    rows = new Map();
  let locale = resolveLocale({
      pathname: location.pathname,
      explicitLocale: new URL(location.href).searchParams.get("lang"),
      storedLocale: storedLocale(),
    }),
    page = 0,
    view = new URL(location.href).searchParams.get("view") === "studio",
    incoming = null,
    incomingReady = false,
    recovery = null,
    error = null,
    revision = 0,
    rendered = "",
    engine = null,
    controller = null,
    cache = null,
    contextLease = null,
    untrim = null,
    removeNavigation = null,
    starting = false,
    draftUnsaved = false,
    draftConflict = false,
    editing = false,
    pendingEdits = 0,
    editTail = Promise.resolve(),
    intent = 0,
    closing = null,
    audioClosing = null,
    audioRecovered = false,
    selected = "track-1",
    recorder = null,
    restoring = true,
    storageReady = false,
    storageOperation = null,
    storageReceipt = false,
    adoptedReceipt = false;
  const documentStore = new AudioDocument({ registry, memory }),
    deviceProfiles = new DeviceProfileStore(),
    trackWaveforms = new TrackWaveforms({ documentStore, memory });
  const markerKey = LOOP_DRAFT_KEY + ".audio-revision";
  const audioText = () => audioCopy[locale];
  const text = () => loopCopy[locale];
  let initial = emptyLoopProject(registry);
  let draft;
  try {
    draft = localStorage.getItem(LOOP_DRAFT_KEY);
    if (draft) {
      try {
        initial = eightTrackProject(draft, registry);
      } catch {
        recovery = draft;
        error = "draftRecoveryRequired";
      }
    }
  } catch {
    error = "routeConflict";
    draftUnsaved = true;
  }
  try {
    incoming = sessionStorage.getItem(LOOP_INCOMING_KEY);
  } catch {
    error = "routeConflict";
  }
  if (incoming && !draft && recovery === null) {
    try {
      initial = eightTrackProject(incoming, registry);
      incomingReady = true;
      draftUnsaved = true;
    } catch (e) {
      error = e.code ?? "generic";
    }
  }
  let history = new LoopHistory(initial, registry);
  const audioOwner = new WorkspaceAudioOwner({
    memory,
    getProject: () => history.project,
  });
  const activeStarts = new Set();
  selected = history.project.tracks[0].id;
  const draftStore = new SharedLoopDraft({
    key: LOOP_DRAFT_KEY,
    storage: () => localStorage,
    locks: navigator.locks,
    expected: draft,
  });
  const registryForRate = (rate) =>
    new InstrumentRegistry([
      ...(rate === 44100 ? c44 : c48).banks,
      ...drumBanks,
      ...melodicBanks(rate),
    ]);
  const finalExporter = new FinalMixExporter({
    memory,
    registry,
    registryForRate,
    documentStore,
    owner: audioOwner,
  });
  const finalPanel = new FinalPanel({
    exporter: finalExporter,
    owner: audioOwner,
    project: () => history.project,
    locale: () => locale,
    busy: () =>
      restoring ||
      editing ||
      starting ||
      !!closing ||
      !!audioClosing ||
      recovery !== null,
    act,
    preview: previewFinal,
    refresh: status,
  });
  const fxActive = (p) =>
    p.tracks.some((t) => hasEQ(t.eq)) || limiterEnabled(p.master);
  const checkFX = (p, options = {}) =>
    preflightMixFX(p, {
      registry: registryForRate(
        p.clock?.kind === "fixed-bar"
          ? p.clock.sampleRate
          : (engine?.context.sampleRate ?? 48000),
      ),
      memory,
      documentStore,
      owner: audioOwner,
      ...options,
    });
  const recordPanel = new RecordPanel({
    host,
    locale: () => locale,
    selected: () => selected,
    project: () => history.project,
    recorder: () => recorder,
    owner: audioOwner,
    busy: () =>
      restoring ||
      editing ||
      finalPanel.pending ||
      starting ||
      !!closing ||
      !!audioClosing ||
      recovery !== null,
    act,
    prepare: prepareRecorder,
    record: recordSelected,
    play: () => play(false),
    refresh: status,
    adopt: adoptTake,
    preview: previewRecording,
    canPreview: canPreviewRecording,
    recover: recoverRecordingAudio,
    waveforms: updateWaveforms,
  });
  async function save(p, options) {
    if (recovery !== null && !Object.hasOwn(options ?? {}, "backup"))
      fail("draftRecoveryRequired");
    try {
      if (restoring) fail("recordBusy");
      if (storageReady) {
        await documentStore.save(p, options);
        storageReceipt = true;
        adoptedReceipt = false;
        try {
          localStorage.setItem(markerKey, String(documentStore.revision));
        } catch {
          /* IDB is authoritative. */
        }
      } else {
        if (p.assetRefs.length) fail("audioStorageUnavailable");
        await draftStore.write(JSON.stringify(p), options);
      }
      draftConflict = false;
      draftUnsaved = false;
    } catch (e) {
      storageReceipt = false;
      adoptedReceipt = false;
      if (e.code === "draftConflict") draftConflict = true;
      throw e;
    }
  }
  function download(value, name) {
    const url = URL.createObjectURL(
      new Blob([value], { type: "application/json" }),
    );
    urls.add(url);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      urls.delete(url);
    }, 1000);
  }
  async function portableDownload(project) {
    if (!project.assetRefs.length) {
      download(JSON.stringify(project, null, 2), "perkusi-loop.perkusi.json");
      return;
    }
    if (!storageReady) fail("audioStorageUnavailable");
    const result = await documentStore.portable(project, {
      signal: storageOperation?.signal,
    });
    let url;
    try {
      url = URL.createObjectURL(result.blob);
      urls.add(url);
      portableExports.set(url, result);
      const a = document.createElement("a");
      a.href = url;
      a.download = "perkusi-loop.perkusi";
      a.click();
      setTimeout(() => releasePortable(url), 1500);
    } catch (e) {
      if (url) releasePortable(url);
      else result.release();
      throw e;
    }
  }
  function releasePortable(url) {
    const result = portableExports.get(url);
    if (!result) return;
    URL.revokeObjectURL(url);
    urls.delete(url);
    portableExports.delete(url);
    result.blob = null;
    result.release();
  }
  function audioOperation(kind, fn, { sessionCopy = false } = {}) {
    if (restoring || storageOperation) fail("recordBusy");
    const operation = new AbortController();
    storageOperation = operation;
    const boundary = audioOwner.begin(kind);
    try {
      return queueEdit(async () => {
        try {
          await boundary.closed;
          if (!sessionCopy) audioOwner.requireDisposition();
          await audioOwner.replaceable();
          ++intent;
          await controller?.unload();
          checkAbort(operation.signal);
          return await fn(operation.signal);
        } finally {
          storageOperation = null;
          boundary.finish();
        }
      });
    } catch (e) {
      storageOperation = null;
      boundary.finish();
      throw e;
    }
  }
  function downloadProject() {
    audioOwner.requireDisposition();
    return audioOperation("portable-export", () =>
      portableDownload(history.project),
    );
  }
  function adoptTake() {
    if (!storageReady) fail("audioStorageUnavailable");
    const take = recorder?.current?.take,
      assignment = recorder?.assignment;
    if (
      !take ||
      recorder.current.state !== "closed" ||
      assignment.trackId !== selected
    )
      fail("captureTakeHeld");
    if (take.partial) fail("partialTakeNeedsReview");
    const overdub = recorder.overdub,
      expectedBase = recorder.base;
    if (overdub) {
      if (
        JSON.stringify(overdubBase(history.project, selected)) !==
        JSON.stringify(expectedBase)
      )
        fail("captureProjectChanged");
    } else if (
      history.project.tracks.find((t) => t.id === selected)?.clips.length
    )
      fail("recorderEmptyTarget");
    // Session save transfers the coordinator pin, never the immutable PCM.
    if (!recorder.takes.saved.has(take.id)) recorder.save();
    const provenance = recorder.takes.attribution(take.id),
      trackId = selected;
    return audioOperation(
      "adopt-take",
      async (signal) => {
        const copy = audioOwner.pool.copyPCM(take.id);
        let blobLease;
        try {
          blobLease = memory.reserve(take.validBytes, "take-durable-blob-copy");
          const blob = new Blob([copy.buffer]),
            sha256 = await digest(copy.buffer);
          checkAbort(signal);
          const { project, ref } = (overdub ? adoptOverdub : adoptRecording)(
            history.project,
            registry,
            trackId,
            take,
            sha256,
            expectedBase,
          );
          // Resolve both immutable layers and admit their real combined peak,
          // voices and future graph/native memory before the durable commit.
          if (overdub) {
            const preflight = await prepareLoopPlan(project, {
              recordedLoops: true,
              registry: controller.registry,
              rate: controller.context.sampleRate,
              memory,
              cache,
              signal,
              resolveRecording: (a, options) =>
                documentStore.resolve(a, controller.context, {
                  ...options,
                  entry: a.id === ref.id ? { blob, provenance } : undefined,
                }),
            });
            try {
              audioOwner.admitOrdinary(preflight, project);
            } finally {
              preflight.release();
            }
          }
          await save(project, {
            signal,
            entries: new Map([[ref.id, { blob, provenance }]]),
          });
          history.commit(() => project);
          adoptedReceipt = true;
          revision++;
        } finally {
          copy.buffer = null;
          copy.release();
          blobLease?.release();
        }
      },
      { sessionCopy: true },
    );
  }
  function importProject(file) {
    return audioOperation("portable-import", async (signal) => {
      let parsed;
      try {
        let candidate, entries;
        if (file.name?.endsWith(".perkusi")) {
          if (!storageReady) fail("audioStorageUnavailable");
          parsed = await importAudioBundle(file, { registry, memory, signal });
          candidate = eightTrackProject(
            JSON.stringify(parsed.project),
            registry,
          );
          entries = parsed.entries;
        } else {
          if (file.size > 2 * 1024 * 1024) fail("projectTooLarge");
          const text = await file.text();
          checkAbort(signal);
          let raw;
          try {
            raw = JSON.parse(text);
          } catch {
            fail("invalidLoopProject");
          }
          candidate =
            raw.schemaVersion === 5
              ? eightTrackProject(text, registry)
              : assignSource(history.project, registry, selected, text);
        }
        if (fxActive(candidate)) await checkFX(candidate, { entries, signal });
        await save(candidate, {
          signal,
          entries,
          ...(recovery !== null ? { backup: recovery } : {}),
        });
        history.commit(() => candidate);
        recovery = null;
        selected = candidate.tracks[0].id;
        revision++;
      } finally {
        parsed?.release();
      }
    });
  }
  async function act(fn) {
    const savedFocus = focus.capture();
    try {
      error = null;
      await fn();
    } catch (e) {
      if (e.code !== "cancelled") {
        error = e.code ?? "generic";
        rendered = "";
      }
    } finally {
      render();
      focus.restore(savedFocus);
    }
  }
  function queueEdit(fn) {
    if (finalPanel.pending) fail("finalMixBusy");
    if (closing || restoring) fail("recordBusy");
    pendingEdits++;
    editing = true;
    const operation = editTail.then(fn);
    editTail = operation.catch(() => {});
    status();
    return operation.finally(() => {
      editing = --pendingEdits > 0;
      render();
    });
  }
  let programmeJob = null,
    programmeAbort = null;
  async function waitProgramme() {
    programmeAbort?.abort();
    await programmeJob?.catch(() => {});
  }
  async function calibrateCurrentProgramme(bars) {
    await waitProgramme();
    const abort = new AbortController();
    programmeAbort = abort;
    const job = calibrateLoopProgramme(controller.plan, memory, {
      signal: abort.signal,
      bars,
    });
    programmeJob = job;
    try {
      return await job;
    } finally {
      if (programmeJob === job) {
        programmeJob = null;
        programmeAbort = null;
      }
    }
  }
  function queueRootEdit(kind, fn) {
    if (finalPanel.pending) fail("finalMixBusy");
    const boundary = audioOwner.begin(kind);
    try {
      return queueEdit(async () => {
        await boundary.closed;
        await waitProgramme();
        audioOwner.requireDisposition();
        await audioOwner.replaceable();
        return fn();
      }).finally(boundary.finish);
    } catch (e) {
      boundary.finish();
      throw e;
    }
  }
  function commit(change, { mix = false } = {}) {
    const enqueue = mix ? queueEdit : (fn) => queueRootEdit("edit", fn);
    return enqueue(async () => {
      if (recovery !== null) fail("draftRecoveryRequired");
      const candidate = change(history.project);
      new LoopHistory(candidate, registry);
      const mixController =
        mix &&
        controller?.plan &&
        JSON.stringify(controller.project) === JSON.stringify(history.project)
          ? controller
          : null;
      if (!mixController) {
        const boundary = audioOwner.begin("replace-project");
        try {
          await boundary.closed;
          audioOwner.requireDisposition();
          await audioOwner.replaceable();
          ++intent;
          controller?.stop();
        } finally {
          boundary.finish();
        }
      }
      if (!mix && fxActive(candidate)) {
        await controller?.unload();
        await checkFX(candidate);
      }
      await commitLoopEdit({
        history,
        candidate,
        save,
        preview: mixController ? (p) => mixController.setMix(p) : null,
        onRollbackFailure: (e) => {
          if (!mixController.error) mixController.playbackFault(e);
        },
        allowUnsaved: (e, p) =>
          !storageReady &&
          !p.assetRefs.length &&
          ["routeConflict", "draftConflict", "draftLockUnavailable"].includes(
            e.code,
          ),
        onUnsaved: (e) => {
          draftUnsaved = true;
          error = e.code;
        },
      });
      if (!candidate.tracks.some((t) => t.id === selected))
        selected = candidate.tracks[0].id;
      revision++;
    });
  }
  function moveHistory(redo = false) {
    return queueRootEdit(redo ? "redo" : "undo", async () => {
      const candidate = (redo ? history.redoStack : history.undoStack).at(-1);
      if (!candidate) return;
      try {
        await save(candidate);
      } catch (e) {
        if (
          storageReady ||
          candidate.assetRefs.length ||
          !["routeConflict", "draftConflict", "draftLockUnavailable"].includes(
            e.code,
          )
        )
          throw e;
        draftUnsaved = true;
      }
      ++intent;
      controller?.stop();
      if (redo) history.redo();
      else history.undo();
      revision++;
    });
  }
  function ensureAudio() {
    if (engine?.disposed) fail("loopClosePending");
    if (engine) return engine.context;
    const fixedRate =
      history.project.clock?.kind === "fixed-bar"
        ? history.project.clock.sampleRate
        : null;
    if (fixedRate && ![44100, 48000].includes(fixedRate))
      fail("takeRateMismatch");
    contextLease = memory.reserve(524288, "loop-context-graph-allowance");
    try {
      engine = new AudioEngine(
        createPackFromCatalog(
          originalRegistry,
          undefined,
          (p) => "/sounds/original-groove/" + p.split("/").at(-1),
        ),
        {
          outputStageFactory: createProgrammeOutputStage,
          contextFactory: () =>
            new AudioContext({
              latencyHint: "interactive",
              sampleRate: fixedRate ?? 48000,
            }),
        },
      );
      engine.volume = 1;
      const c = engine.ensureContext(),
        r = new InstrumentRegistry([
          ...(c.sampleRate === 44100 ? c44 : c48).banks,
          ...drumBanks,
          ...melodicBanks(c.sampleRate),
        ]);
      if (![44100, 48000].includes(c.sampleRate)) fail("takeRateMismatch");
      cache = new InstrumentSampleCache(c, r, {
        memoryPolicy: memory.cachePolicy(c),
      });
      untrim = memory.registerTrimmer(cache, () => cache.trim());
      controller = new LoopStationSession({
        context: c,
        transport: engine.transport,
        memory,
        registry: r,
        cache,
        output: engine.master,
        ownsTransport: true,
        finiteReaderModuleURL,
        admission: audioOwner,
        resolveRecording: (ref, options) =>
          documentStore.resolve(ref, c, options),
      });
      audioOwner.attach(engine, controller);
      controller.subscribe(() => render());
      return c;
    } catch (e) {
      if (!engine?.context) {
        contextLease.release();
        contextLease = null;
      }
      throw e;
    }
  }
  async function previewFinal(bars) {
    const boundary = audioOwner.begin("preview-final");
    try {
      await boundary.closed;
      if (!boundary.current()) fail("cancelled");
      audioOwner.requireDisposition();
      await audioOwner.replaceable();
      await controller?.unload();
      if (!boundary.current()) fail("cancelled");
      return await play(false, bars);
    } finally {
      boundary.finish();
    }
  }
  function canPreviewRecording() {
    return (
      !!recorder &&
      !recorder.overdub &&
      recorder.assignment?.trackId === selected &&
      controller?.status === "stopped" &&
      !engine.transport.running &&
      audioOwner.canStartFiniteCapture()
    );
  }
  async function previewRecording() {
    if (!canPreviewRecording()) fail("recordBusy");
    await play(false, 4, true);
    if (!controller.snapshot().finiteCaptureBridge) fail("recordBusy");
  }
  async function recoverRecordingAudio() {
    if (!engine || engine.context.state === "closed") return;
    ++intent;
    await waitProgramme();
    await engine.context.close();
    await audioOwner.retryCleanupAfterContextClose();
    await controller.waitVoices();
    await controller.dispose();
    audioRecovered = true;
    error = "audioRecovered";
  }
  async function resetRecoveredAudio() {
    if (!audioRecovered) return;
    await waitProgramme();
    audioOwner.requireDisposition();
    await audioOwner.replaceable();
    await controller.dispose();
    await engine.dispose();
    cache?.dispose();
    untrim?.();
    untrim = null;
    cache = null;
    contextLease?.release();
    contextLease = null;
    audioOwner.detachClosed();
    engine = null;
    controller = null;
    recorder = null;
    audioRecovered = false;
    error = null;
  }
  async function play(
    resume,
    bars,
    recordPreview = false,
    projectOverride = null,
  ) {
    if (restoring || recovery !== null || storageOperation) fail("recordBusy");
    await resetRecoveredAudio();
    if (bars !== undefined) {
      audioOwner.requireDisposition();
      if (
        audioOwner.producers.size &&
        !(recordPreview && canPreviewRecording())
      )
        fail("recordBusy");
    }
    const boundary = audioOwner.begin(resume ? "resume" : "play");
    const token = ++intent;
    activeStarts.add(token);
    starting = true;
    render();
    try {
      await boundary.closed;
      await waitProgramme();
      if (!boundary.current()) return;
      const c = ensureAudio();
      await c.resume();
      if (token !== intent || !boundary.current()) return;
      if (
        JSON.stringify(controller.project) !==
        JSON.stringify(projectOverride ?? history.project)
      ) {
        await audioOwner.replaceable();
        if (token !== intent || !boundary.current()) return;
        await controller.load(projectOverride ?? history.project);
      }
      if (token !== intent || !boundary.current()) return;
      await controller.waitVoices();
      if (token !== intent || !boundary.current()) return;
      if (!resume && !audioOwner.producers.size) {
        const calibration = await calibrateCurrentProgramme(bars);
        if (token !== intent || !boundary.current()) return;
        engine.outputStage.setProgrammeGain(calibration.gain);
      }
      controller.play({ resume, bars });
    } finally {
      boundary.finish();
      activeStarts.delete(token);
      starting = activeStarts.size > 0;
      render();
    }
  }
  async function closeAudioNow() {
    ++intent;
    await waitProgramme();
    await audioOwner.replaceable();
    controller?.stop();
    await finalPanel.close();
    recordPanel.releaseExport();
    for (const url of portableExports.keys()) releasePortable(url);
    if (engine) {
      if (engine.disposalClosePending) await engine.retryDisposedClose();
      else await engine.dispose();
      await controller?.dispose();
      cache?.dispose();
      untrim?.();
      untrim = null;
      contextLease?.release();
      contextLease = null;
      render();
    }
  }
  function closeAudio() {
    if (audioClosing) return audioClosing;
    let resolve, reject;
    const shared = new Promise((a, b) => {
      resolve = a;
      reject = b;
    });
    audioClosing = shared;
    void audioOwner
      .run("close", closeAudioNow, { destructive: true })
      .then(resolve, reject);
    void shared.catch(() => {
      if (audioClosing === shared) audioClosing = null;
    });
    return shared;
  }
  function pause() {
    ++intent;
    return audioOwner.run("pause", async () => {
      await waitProgramme();
      controller?.pause();
    });
  }
  function stop() {
    ++intent;
    return audioOwner.run("stop", async () => {
      await waitProgramme();
      controller?.stop();
    });
  }
  async function leave(href) {
    if (closing) return closing;
    if (editing) fail("recordBusy");
    const boundary = audioOwner.begin("navigation");
    closing = (async () => {
      await boundary.closed;
      if (!boundary.current()) fail("cancelled");
      audioOwner.requireDisposition();
      await finalPanel.close();
      await save(history.project);
      await closeAudioNow();
      await trackWaveforms.dispose();
      location.assign(href);
    })().finally(() => {
      boundary.finish();
      closing = null;
    });
    status();
    return closing;
  }
  function node(tag, value, parent) {
    const n = document.createElement(tag);
    if (value !== undefined) n.textContent = value;
    parent?.append(n);
    return n;
  }
  function button(parent, label, id, fn) {
    const b = node("button", label, parent);
    b.id = id;
    b.type = "button";
    b.onclick = () => void act(fn);
    return b;
  }
  function checkbox(parent, label, id, checked, fn) {
    const l = node("label", label, parent),
      i = node("input", undefined, l);
    i.type = "checkbox";
    i.id = id;
    i.checked = checked;
    i.onchange = () => void act(() => fn(i.checked));
    return i;
  }
  function updateTrack(id, change, mix = true) {
    return commit(
      (p) => {
        const n = structuredClone(p),
          t = n.tracks.find((t) => t.id === id);
        change(t, n);
        return n;
      },
      { mix },
    );
  }
  function commitFX(change) {
    if (audioOwner.hasTakeWork()) fail("captureTakeNeedsReview");
    return commit(change);
  }
  function editEQ(id, change) {
    return commitFX((p) => {
      const next = structuredClone(p);
      change(next.tracks.find((t) => t.id === id));
      return next;
    });
  }
  function status() {
    const s = controller?.snapshot() ?? {
      status: "stopped",
      owned: 0,
      maxOwned: 0,
    };
    host.dataset.state = s.status;
    host.dataset.saving = String(editing);
    host.dataset.rendering = String(finalPanel.pending);
    const t = text(),
      state = host.querySelector("#ls-state");
    if (state)
      state.textContent =
        s.status === "stopped" &&
        s.finite &&
        s.finiteCompletion?.state === "verified"
          ? t.state.finished
          : (t.state[s.status] ?? t.state.error);
    const notice = host.querySelector("#ls-error"),
      code = draftConflict
        ? "draftConflict"
        : (error ?? s.error ?? (draftUnsaved ? "routeConflict" : null));
    if (code === "tuningConsentRequired") {
      const tuning = host.querySelector("#ls-tuning");
      if (tuning) tuning.open = true;
    }
    if (notice) {
      notice.hidden = !code;
      notice.textContent = code
        ? (finalCopy[locale].errors[code] ??
          overdubCopy[locale].errors[code] ??
          audioText().errors[code] ??
          recordCopy[locale].errors[code] ??
          t.errors[code] ??
          t.errors.generic)
        : "";
    }
    const audio = host.querySelector("#ls-audio-info");
    if (audio) {
      const mem = s.memory ?? memory.snapshot();
      audio.dataset.highWaterBytes = String(mem.highWaterBytes);
      audio.dataset.maxOwned = String(s.maxOwned ?? 0);
      audio.textContent = [
        engine?.context?.sampleRate ?? 0,
        s.owned,
        mem.bytes,
      ].join(" / ");
    }
    const busy =
      restoring ||
      starting ||
      !!closing ||
      recordPanel.pending ||
      s.status === "loading";
    for (const b of host.querySelectorAll("[data-edit]"))
      b.disabled =
        busy ||
        editing ||
        finalPanel.pending ||
        recovery !== null ||
        ((b.id.startsWith("ls-eq-") || b.id === "ls-master-limiter") &&
          audioOwner.hasTakeWork()) ||
        b.dataset.layerLocked === "true";
    const set = (id, disabled) => {
      const b = host.querySelector("#" + id);
      if (b) b.disabled = disabled;
    };
    set(
      "ls-play",
      busy ||
        editing ||
        s.status === "playing" ||
        !history.project.tracks.some((t) => t.clips.length),
    );
    set("ls-resume", busy || editing || s.status !== "paused");
    set(
      "ls-save",
      busy || editing || audioOwner.hasTakeWork() || recovery !== null,
    );
    set(
      "ls-browser-save",
      busy || editing || finalPanel.pending || recovery !== null,
    );
    set("ls-load-button", busy || editing || finalPanel.pending);
    set("ls-storage-cancel", !storageOperation);
    const storageStatus = host.querySelector("#ls-storage-status");
    if (storageStatus)
      storageStatus.textContent = restoring
        ? audioText().restoring
        : storageOperation
          ? audioText().working
          : adoptedReceipt
            ? audioText().adopted
            : storageReceipt
              ? audioText().saved
              : !storageReady
                ? audioText().unavailable
                : "";
    const saveButton = host.querySelector("#ls-save");
    if (saveButton)
      saveButton.textContent = history.project.assetRefs.length
        ? audioText().download
        : text().save;
    const jsonNote = host.querySelector("#ls-json-note");
    if (jsonNote) jsonNote.hidden = !audioOwner.hasTakeWork();
    set("ls-pause", s.status !== "playing");
    set("ls-stop", !engine || s.status === "closed");
    set(
      "ls-undo",
      busy || editing || finalPanel.pending || !history.undoStack.length,
    );
    set(
      "ls-redo",
      busy || editing || finalPanel.pending || !history.redoStack.length,
    );
    for (const track of history.project.tracks) {
      const row = rows.get(track.id);
      if (!row) continue;
      const st = s.tracks?.find((t) => t.id === track.id)?.status ?? s.status;
      row.dataset.state = st;
      row.dataset.muted = String(
        track.mute ||
          (history.project.tracks.some((t) => t.solo) && !track.solo),
      );
      row.querySelector(".ls-track-state").textContent =
        t.state[st] ?? t.state.error;
      row.querySelector("[data-stop-track]").disabled =
        s.status !== "playing" || st === "stopped" || !track.clips.length;
      row.querySelector("[data-resume-track]").disabled =
        s.status !== "playing" || st !== "stopped" || !track.clips.length;
    }
    finalPanel.update();
    recordPanel.update();
    const rs = recorder?.snapshot();
    if (rs?.assignment && audioOwner.producers.has(rs.assignment.trackId)) {
      const row = rows.get(rs.assignment.trackId);
      if (row) {
        row.dataset.state = rs.state;
        row.querySelector(".ls-track-state").textContent =
          recordCopy[locale].states[rs.state] ??
          recordCopy[locale].states.error;
        row.querySelector("[data-stop-track]").disabled =
          busy ||
          !(
            rs.producer?.voices.length ||
            rs.playingSaved ||
            (recorder.current && recorder.current.state !== "closed")
          );
      }
    }
  }
  function updateWaveforms() {
    for (const id of rows.keys()) {
      const handle =
          recorder?.assignment?.trackId === id ? recorder.current : null,
        savedId = !handle ? recorder?.takes.layers(id).at(-1) : null;
      if (handle) {
        const frames = handle.take?.frames ?? handle.acknowledgedFrames;
        trackWaveforms.updateLive(
          id,
          handle,
          frames,
          (f) => handle.waveform(f),
          {
            partial: !!handle.take?.partial,
            state: recorder.snapshot().state,
          },
        );
      } else if (savedId) {
        const take = audioOwner.pool.describe(savedId);
        trackWaveforms.updateLive(
          id,
          take,
          take.frames,
          (f) => audioOwner.pool.waveform(savedId, f),
          { state: "saved" },
        );
      } else trackWaveforms.updateLive(id, null);
    }
  }
  function render() {
    const t = text(),
      sig = [
        revision,
        locale,
        page,
        view,
        selected,
        recovery !== null,
        incoming !== null,
        draftConflict,
      ].join("|");
    if (sig === rendered) {
      status();
      return;
    }
    const expanded = new Set(
      [...host.querySelectorAll(".ls-options[open]")].map(
        (n) => n.parentElement.id,
      ),
    );
    const existingRows = new Set(
      [...host.querySelectorAll(".ls-track")].map((n) => n.id),
    );
    const tuningWasOpen = host.querySelector("#ls-tuning")?.open ?? false;
    const masterFXWasOpen = host.querySelector("#ls-master-fx")?.open ?? false;
    const saved = focus.capture();
    rendered = sig;
    removeNavigation?.();
    host.replaceChildren();
    rows.clear();
    trackWaveforms.begin(history.project);
    document.documentElement.lang = locale;
    syncLoopPublicMetadata(locale);
    const header = node("div", undefined, host);
    header.innerHTML = renderSiteShell("studio", locale, {
      gamelanHref: locale === "en" ? "/en/gamelan/" : "/gamelan/?lang=id",
    }).header;
    header.querySelector('[data-route="studio"]').href =
      "/loop-station/?view=studio&lang=" + locale;
    removeNavigation = initNavigation();
    header.addEventListener("click", (e) => {
      const link = e.target.closest("a[href]");
      if (
        !link ||
        e.button !== 0 ||
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey ||
        e.altKey
      )
        return;
      e.preventDefault();
      if (link.dataset.locale) {
        void audioOwner.stopMic().catch(() => {});
        locale = link.dataset.locale;
        try {
          saveLocale(localStorage, locale);
        } catch {
          /* Locale stays usable with blocked storage. */
        }
        const u = new URL(location.href);
        u.searchParams.set("lang", locale);
        historyReplace(u);
        render();
      } else if (link.dataset.route === "studio") {
        view = true;
        render();
      } else if (link.classList.contains("skip-link")) {
        host.querySelector("#main").focus();
      } else void act(() => leave(link.href));
    });
    const main = node("main", undefined, host);
    main.id = "main";
    main.tabIndex = -1;
    main.className = "ls-page" + (view ? " studio-view" : "");
    node("h1", t.title, main);
    node("p", t.preview, main).className = "ls-note";
    node("p", t.steps, main);
    node("output", history.project.timing.bpm + " BPM", main).id = "ls-tempo";
    const tools = node("div", undefined, main);
    tools.className = "ls-toolbar";
    button(tools, t.play, "ls-play", () => play(false));
    button(tools, t.pause, "ls-pause", pause);
    button(tools, t.resume, "ls-resume", () => play(true));
    button(tools, t.stop, "ls-stop", stop);
    const masterLabel = node("label", t.masterVolume, tools);
    masterLabel.className = "ls-level";
    const masterVolume = node("input", undefined, masterLabel);
    masterVolume.id = "ls-master-volume";
    masterVolume.type = "range";
    masterVolume.min = 0;
    masterVolume.max = 1;
    masterVolume.step = 0.05;
    masterVolume.value = history.project.master.volume;
    masterVolume.setAttribute(
      "aria-valuetext",
      Math.round(history.project.master.volume * 100) + "%",
    );
    masterVolume.dataset.edit = "true";
    masterVolume.onchange = () => {
      const volume = Number(masterVolume.value);
      void act(() =>
        commit((p) => ({ ...p, master: { ...p.master, volume } }), {
          mix: true,
        }),
      );
    };
    node("p", t.masterHint, main).className = "ls-note";
    button(tools, t.newProject, "ls-new", () =>
      commit(() => emptyLoopProject(registry)),
    ).dataset.edit = "true";
    button(tools, t.demo, "ls-demo", () =>
      commit(() => eightTrackDemo(registry)),
    ).dataset.edit = "true";
    const starterBox = node("section", undefined, main);
    starterBox.className = "ls-starters";
    starterBox.setAttribute("aria-labelledby", "ls-starter-title");
    node("h2", t.starters, starterBox).id = "ls-starter-title";
    node("p", t.starterHint, starterBox);
    for (const recipe of starterContent) {
      const card = node("article", undefined, starterBox);
      node("h3", recipe.name[locale], card);
      node(
        "p",
        recipe.description[locale] +
          " · " +
          recipe.bpm +
          " BPM · " +
          t.starterKey,
        card,
      );
      button(card, t.loadStarter, "ls-starter-" + recipe.id, () =>
        commit(() => createStarter(recipe.id, registry)),
      ).dataset.edit = "true";
    }
    button(tools, t.save, "ls-save", downloadProject).setAttribute(
      "aria-describedby",
      "ls-json-note",
    );
    button(tools, audioText().save, "ls-browser-save", () =>
      audioOperation("save-project", (signal) =>
        save(history.project, { signal }),
      ),
    );
    button(tools, audioText().cancel, "ls-storage-cancel", () =>
      storageOperation?.abort(),
    );
    node("output", "", main).id = "ls-storage-status";
    host.querySelector("#ls-storage-status").setAttribute("role", "status");
    button(tools, t.undo, "ls-undo", () => moveHistory(false));
    button(tools, t.redo, "ls-redo", () => moveHistory(true));
    button(tools, view ? t.simple : t.view, "ls-view", () => {
      view = !view;
      render();
    });
    node("output", "", main).id = "ls-state";
    const jsonNote = node("p", recordCopy[locale].jsonGuard, main);
    jsonNote.id = "ls-json-note";
    jsonNote.className = "ls-rec-hint";
    const notice = node("p", "", main);
    notice.id = "ls-error";
    notice.className = "ls-error";
    notice.setAttribute("role", "alert");
    if (draftConflict) {
      const box = node("section", undefined, main);
      box.className = "ls-note";
      button(box, t.latestBackup, "ls-conflict-latest", () =>
        audioOperation("backup-latest", async () => {
          if (storageReady) {
            const latest = new AudioDocument({
              registry,
              memory,
              backend: documentStore.backend,
            });
            const project = await latest.read();
            if (!project) fail("draftConflict");
            await portableDownload(project);
          } else {
            const raw = draftStore.read();
            if (raw === null) fail("draftConflict");
            await portableDownload(eightTrackProject(raw, registry));
          }
        }),
      );
      button(box, t.loadLatest, "ls-conflict-load", () =>
        audioOperation("adopt-draft", async () => {
          await portableDownload(history.project);
          if (storageReady) {
            const latest = new AudioDocument({
              registry,
              memory,
              backend: documentStore.backend,
            });
            const next = await latest.read();
            if (!next) fail("draftConflict");
            history.commit(() => next);
            documentStore.revision = latest.revision;
            documentStore.current = latest.current;
          } else {
            const raw = draftStore.read();
            history.commit(() =>
              raw === null
                ? emptyLoopProject(registry)
                : eightTrackProject(raw, registry),
            );
            draftStore.adopt(raw);
          }
          draftConflict = false;
          draftUnsaved = false;
          revision++;
        }),
      );
    }
    if (recovery !== null) {
      const recoveryBox = node("section", undefined, main);
      recoveryBox.className = "ls-note";
      node("p", t.recovery, recoveryBox);
      button(recoveryBox, t.raw, "ls-raw", () =>
        download(recovery, "perkusi-recovery-original.txt"),
      );
      button(recoveryBox, t.new, "ls-fresh", async () => {
        const next = emptyLoopProject(registry);
        await save(next, { backup: recovery });
        history = new LoopHistory(next, registry);
        recovery = null;
        revision++;
        render();
      });
    }
    const files = node("div", undefined, main);
    files.className = "ls-toolbar";
    const tl = node("label", t.target, files),
      target = node("select", undefined, tl);
    target.id = "ls-target";
    target.dataset.edit = "true";
    for (const [index, track] of history.project.tracks.entries()) {
      const o = node("option", t.track + " " + (index + 1), target);
      o.value = track.id;
    }
    target.value = selected;
    target.onchange = () => {
      selected = target.value;
      render();
    };
    const input = node("input", undefined, files);
    input.id = "ls-file";
    input.type = "file";
    input.accept = ".perkusi,.json,application/json,application/octet-stream";
    input.className = "ls-file";
    input.hidden = true;
    input.setAttribute("aria-label", t.load);
    button(files, audioText().load, "ls-load-button", () => input.click());
    input.dataset.recoveryImport = "true";
    input.onchange = () =>
      void act(async () => {
        const file = input.files[0];
        if (!file) return;
        await importProject(file);
        input.value = "";
      });
    if (incoming)
      button(files, t.incoming, "ls-incoming", async () => {
        await commit((p) => assignSource(p, registry, selected, incoming));
        sessionStorage.removeItem(LOOP_INCOMING_KEY);
        incoming = null;
        revision++;
        render();
      }).dataset.edit = "true";
    recordPanel.mount(main);
    const pt = phaseCopy[locale],
      phaseBox = node("section", undefined, main);
    phaseBox.className = "ls-recorder";
    phaseBox.setAttribute("aria-labelledby", "ls-phase-title");
    node("h2", pt.title, phaseBox).id = "ls-phase-title";
    node("p", pt.hint, phaseBox).className = "ls-note";
    const phaseTrack = history.project.tracks.find((t) => t.id === selected);
    for (const [index, clip] of (phaseTrack?.clips ?? []).entries()) {
      const ref = history.project.assetRefs.find((a) => a.id === clip.sourceId);
      if (
        !ref ||
        !clip.loop ||
        clip.offsetFrames !== 0 ||
        history.project.clock?.kind !== "fixed-bar" ||
        ![1, 2, 4, 8].includes(ref.frames / history.project.clock.framesPerBar)
      )
        continue;
      const phaseRow = node("div", undefined, phaseBox);
      phaseRow.className = "ls-toolbar";
      const label = node(
        "label",
        pt.layer + " " + (index + 1) + " · " + pt.advance,
        phaseRow,
      );
      const input = node("input", undefined, label);
      input.type = "number";
      input.min = -250;
      input.max = 250;
      input.step = 0.1;
      input.id = "ls-phase-" + clip.id;
      input.value = String(
        ((clip.phaseAlignment?.advanceFrames ?? 0) * 1000) / ref.sampleRate,
      );
      const frames = () => {
        if (
          !input.value.trim() ||
          !Number.isFinite(Number(input.value)) ||
          Math.abs(Number(input.value)) > 250
        )
          fail("invalidPhaseAlignment");
        return Math.round((Number(input.value) * ref.sampleRate) / 1000);
      };
      button(phaseRow, pt.preview, "ls-phase-preview-" + clip.id, () => {
        const candidate = alignRecordedClip(
          history.project,
          phaseTrack.id,
          clip.id,
          frames(),
        );
        return play(false, 4, false, candidate);
      }).dataset.edit = "true";
      button(phaseRow, pt.apply, "ls-phase-apply-" + clip.id, () => {
        const n = frames();
        return commit((p) => alignRecordedClip(p, phaseTrack.id, clip.id, n));
      }).dataset.edit = "true";
      button(phaseRow, pt.reset, "ls-phase-reset-" + clip.id, () =>
        commit((p) => alignRecordedClip(p, phaseTrack.id, clip.id, 0)),
      ).dataset.edit = "true";
      mountDeviceProfiles({
        host: phaseBox,
        locale,
        store: deviceProfiles,
        sampleRate: ref.sampleRate,
        getDraft: () => (frames() * 1000) / ref.sampleRate,
        setDraft: (value) => {
          input.value = String(value);
        },
      }).dataset.profileClip = clip.id;
    }
    const masterFX = node("details", undefined, main);
    masterFX.id = "ls-master-fx";
    masterFX.open = masterFXWasOpen;
    node("summary", finalCopy[locale].limiter, masterFX);
    checkbox(
      masterFX,
      finalCopy[locale].limiter,
      "ls-master-limiter",
      !!limiterEnabled(history.project.master),
      (enabled) =>
        commitFX((p) => ({
          ...p,
          master: {
            ...p.master,
            limiter: { ...BYPASS_LIMITER, bypass: !enabled },
          },
        })),
    ).dataset.edit = "true";
    node("p", finalCopy[locale].limiterHint, masterFX).className = "ls-note";
    finalPanel.mount(main);
    const tuning = node("details", undefined, main);
    tuning.id = "ls-tuning";
    tuning.open = tuningWasOpen;
    node("summary", t.tuning, tuning);
    checkbox(
      tuning,
      t.consent,
      "ls-consent",
      history.project.tuningConsent === true,
      (v) => commit((p) => ({ ...p, tuningConsent: v })),
    ).dataset.edit = "true";
    const paging = node("div", undefined, main);
    paging.className = "ls-toolbar ls-mobile-pages";
    button(paging, t.track + " 1-4", "ls-page1", () => {
      page = 0;
      render();
    });
    button(paging, t.track + " 5-8", "ls-page2", () => {
      page = 1;
      render();
    });
    const grid = node("div", undefined, main);
    grid.className = "ls-grid";
    for (let index = 0; index < history.project.tracks.length; index++) {
      const track = history.project.tracks[index],
        row = node("section", undefined, grid);
      row.className = "ls-track";
      row.id = "ls-row-" + track.id;
      row.dataset.trackId = track.id;
      rows.set(track.id, row);
      row.dataset.mobileHidden = String(Math.floor(index / 4) !== page);
      node("h2", t.track + " " + (index + 1), row);
      node("output", "", row).className = "ls-track-state";
      const ref =
        history.project.sources?.find(
          (s) => s.id === track.clips[0]?.sourceId,
        ) ??
        history.project.origins.find((s) => s.id === track.clips[0]?.sourceId);
      const legacySource = ref
        ? legacyAudible(instrumentSource(ref.text, registry).composition)
        : false;
      let title = t.empty;
      if (ref) title = instrumentSource(ref.text, registry).composition.title;
      else if (track.clips.length) {
        const audio = history.project.assetRefs.find(
          (a) => a.id === track.clips[0].sourceId,
        );
        title = audio
          ? audioText().recording +
            " · " +
            (audio.frames / audio.sampleRate).toFixed(2) +
            " s"
          : track.clips[0].sourceId;
      }
      node("p", title, row);
      trackWaveforms.mount(row, track, history.project, locale);
      if (track.layering)
        node("p", overdubCopy[locale].layers, row).className = "ls-note";
      const advanced = node("details", undefined, row);
      advanced.className = "ls-options";
      advanced.open = existingRows.has(row.id) ? expanded.has(row.id) : view;
      node("summary", t.options, advanced);
      const eq = track.eq ?? FLAT_EQ,
        fx = node("fieldset", undefined, advanced);
      node("legend", finalCopy[locale].eq, fx);
      checkbox(
        fx,
        finalCopy[locale].bypass,
        "ls-eq-bypass-" + track.id,
        eq.bypass,
        (value) =>
          editEQ(
            track.id,
            (t) => {
              t.eq = { ...(t.eq ?? FLAT_EQ), bypass: value };
            },
            false,
          ),
      ).dataset.edit = "true";
      for (const [key, label] of [
        ["lowDb", "low"],
        ["midDb", "mid"],
        ["highDb", "high"],
      ]) {
        const l = node(
            "label",
            finalCopy[locale][label] + " | " + eq[key] + " dB",
            fx,
          ),
          input = node("input", undefined, l);
        l.className = "ls-level";
        input.type = "range";
        input.min = -6;
        input.max = 6;
        input.step = 1;
        input.value = eq[key];
        input.id = "ls-eq-" + key + "-" + track.id;
        input.dataset.edit = "true";
        input.onchange = () => {
          const v = Number(input.value);
          void act(() =>
            editEQ(
              track.id,
              (t) => {
                t.eq = { ...(t.eq ?? FLAT_EQ), [key]: v };
              },
              false,
            ),
          );
        };
      }
      node("p", finalCopy[locale].fxHint, fx).className = "ls-note";
      const controls = node("div", undefined, row);
      controls.className = "ls-mix";
      for (const [prop, label, min, max, step] of [
        ["gain", t.gain, 0, 1, 0.05],
        ["pan", t.pan, -1, 1, 0.1],
      ]) {
        const l = node("label", label, prop === "pan" ? advanced : controls);
        l.className = "ls-level";
        const i = node("input", undefined, l);
        i.type = "range";
        i.id = "ls-" + prop + "-" + track.id;
        i.min = min;
        i.max = max;
        i.step = step;
        i.value = track[prop];
        i.dataset.edit = "true";
        i.onchange = () => {
          const value = Number(i.value);
          void act(() => updateTrack(track.id, (t) => (t[prop] = value)));
        };
      }
      for (const [prop, label] of [
        ["mute", t.mute],
        ["solo", t.solo],
      ])
        checkbox(
          controls,
          label,
          "ls-" + prop + "-" + track.id,
          track[prop],
          (v) => updateTrack(track.id, (t) => (t[prop] = v)),
        ).dataset.edit = "true";
      const repeatControl = checkbox(
        advanced,
        t.repeat,
        "ls-repeat-" + track.id,
        track.clips.some((c) => c.loop),
        (v) =>
          updateTrack(
            track.id,
            (t, project) => {
              if (v) {
                const rate =
                    project.clock?.sampleRate ??
                    engine?.context?.sampleRate ??
                    48000,
                  clock = new MasterClock(project, rate);
                for (const clip of t.clips) {
                  const source = [
                    ...(project.sources ?? []),
                    ...project.origins,
                  ].find((s) => s.id === clip.sourceId);
                  if (!source) continue; // recording guards remain in the shared plan
                  const document = instrumentSource(source.text, registry);
                  if (!legacyAudible(document.composition)) continue;
                  if (
                    clip.lengthTicks !==
                    document.composition.chain.length * 4 * PPQ
                  )
                    fail("legacyRegionUnsupported");
                  const period = clip.lengthTicks * clock.framesPerTick;
                  if (Math.abs(period - Math.round(period)) > 1e-7)
                    fail("legacyLoopClockUnsupported");
                  legacyCycleGeometry(
                    document.composition,
                    rate,
                    Math.round(period),
                  );
                }
              }
              for (const c of t.clips) c.loop = v;
            },
            false,
          ),
      );
      repeatControl.dataset.layerLocked = String(!!track.layering);
      repeatControl.dataset.edit = "true";
      repeatControl.dataset.legacyRepeat = String(legacySource);
      if (legacySource)
        node("p", t.errors.legacyRepeatNeedsTailAdapter, advanced);
      const toolbar = node("div", undefined, row);
      toolbar.className = "ls-toolbar";
      button(toolbar, t.stopTrack, "ls-stop-" + track.id, () =>
        audioOwner.stopTrack(track.id),
      ).dataset.stopTrack = "true";
      button(toolbar, t.resumeTrack, "ls-resume-" + track.id, () =>
        controller.playTrack(track.id),
      ).dataset.resumeTrack = "true";
      row.append(advanced);
      const secondary = node("div", undefined, advanced);
      secondary.className = "ls-toolbar";
      button(secondary, t.clone, "ls-clone-" + track.id, () =>
        commit((p) => {
          const n = structuredClone(p),
            empty = n.tracks.find((t) => !t.clips.length);
          if (!empty) fail("trackLimit");
          if (!track.clips.length) fail("emptyMix");
          const ids = new Set(
            n.tracks.flatMap((t) => t.clips.map((c) => c.id)),
          );
          empty.kind = track.kind;
          const clonedIds = new Map();
          empty.clips = track.clips.map((c) => {
            let i = 1;
            while (ids.has("copy-" + i)) i++;
            ids.add("copy-" + i);
            clonedIds.set(c.id, "copy-" + i);
            return { ...c, id: "copy-" + i };
          });
          if (track.eq) empty.eq = structuredClone(track.eq);
          else delete empty.eq;
          delete empty.layering;
          if (track.layering)
            empty.layering = {
              version: 1,
              baseClipId: clonedIds.get(track.layering.baseClipId),
              overdubClipId: clonedIds.get(track.layering.overdubClipId),
            };
          return n;
        }),
      ).dataset.edit = "true";
      button(secondary, t.clear, "ls-clear-" + track.id, () =>
        updateTrack(
          track.id,
          (t) => {
            t.clips = [];
            t.kind = "event";
            delete t.layering;
          },
          false,
        ),
      ).dataset.edit = "true";
    }
    node("p", t.culture, main).className = "ls-note";
    node("p", waveformCopy[locale].hint, main).className = "ls-note";
    const credits = node(
      "a",
      locale === "id" ? "Kredit dan sumber suara" : "Sound credits and sources",
      main,
    );
    credits.href =
      locale === "en" ? "/en/gamelan/credits/" : "/gamelan/credits/?lang=id";
    credits.onclick = (e) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)
        return;
      e.preventDefault();
      void act(() => leave(credits.href));
    };
    const details = node("details", undefined, main);
    details.className = "ls-technical";
    node(
      "summary",
      locale === "id" ? "Info sesi audio" : "Audio session info",
      details,
    );
    node("output", "", details).id = "ls-audio-info";
    const policy = history.project.clock;
    if (policy?.kind === "fixed-bar")
      node(
        "p",
        (locale === "id" ? "Periode bar tersimpan: " : "Stored bar period: ") +
          policy.framesPerBar +
          " frame @ " +
          policy.sampleRate +
          " Hz; " +
          ((240 * policy.sampleRate) / policy.framesPerBar).toFixed(6) +
          " BPM",
        details,
      );
    node(
      "p",
      locale === "id"
        ? "Sample rate / suara aktif / byte audio. Paket .perkusi membawa PCM asli, hash, kredit, dan pengaturan FX. Batas audio proyek lokal: 16 MiB; hasil WAV mix akhir memakai anggaran memori bersama."
        : "Sample rate / owned voices / audio bytes. A .perkusi bundle includes original PCM, hashes, credits and FX settings. Local project audio limit: 16 MiB; final mix WAV uses the shared memory budget.",
      details,
    );
    status();
    focus.restore(saved);
  }
  function historyReplace(url) {
    window.history.replaceState(null, "", url);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      void pause().catch(() => {});
    }
  });
  window.addEventListener("pagehide", () => {
    storageOperation?.abort();
    void finalPanel.close();
    for (const url of portableExports.keys()) releasePortable(url);
    recordPanel.destroy();
    void trackWaveforms.dispose();
    void closeAudio().catch(() => {});
    for (const url of urls) URL.revokeObjectURL(url);
    removeNavigation?.();
  });
  window.addEventListener("beforeunload", (event) => {
    if (
      editing ||
      finalPanel.pending ||
      draftUnsaved ||
      draftConflict ||
      audioOwner.hasTakeWork()
    ) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) location.reload();
  });
  window.addEventListener("storage", (event) => {
    if (storageReady) {
      if (
        (event.key === markerKey &&
          event.newValue !== String(documentStore.revision)) ||
        event.key === null
      ) {
        draftConflict = true;
        render();
      }
      return;
    }
    if (
      (event.key === LOOP_DRAFT_KEY || event.key === null) &&
      event.newValue !== draftStore.expected
    ) {
      draftConflict = true;
      render();
    }
  });
  render();
  const restored = (async () => {
    try {
      const project = await documentStore.read();
      storageReady = true;
      if (project) {
        history = new LoopHistory(
          eightTrackProject(JSON.stringify(project), registry),
          registry,
        );
        recovery = null;
        error = null;
        draftUnsaved = false;
        storageReceipt = true;
        incomingReady = false;
      } else {
        let marker;
        try {
          marker = localStorage.getItem(markerKey);
        } catch {
          /* Optional notification. */
        }
        if (marker) {
          recovery = draft ?? "";
          error = "audioStorageMissing";
        } else if (history.project.assetRefs.length) {
          recovery = draft ?? "";
          error = "missingRecording";
        }
      }
    } catch (e) {
      storageReady = !!documentStore.backend.db;
      let marker;
      try {
        marker = localStorage.getItem(markerKey);
      } catch {
        /* Optional marker. */
      }
      if (documentStore.current || history.project.assetRefs.length || marker) {
        recovery = documentStore.current?.raw ?? draft ?? "";
        error = e.code ?? "draftRecoveryRequired";
      } else {
        error = e.code ?? "audioStorageUnavailable";
      }
    } finally {
      restoring = false;
      selected = history.project.tracks[0].id;
      revision++;
      render();
    }
    if (incomingReady && recovery === null)
      await act(async () => {
        await save(history.project);
        sessionStorage.removeItem(LOOP_INCOMING_KEY);
        incoming = null;
        revision++;
        render();
      });
  })();
  async function prepareCapture(trackId, options, stereo) {
    const c = ensureAudio();
    if (
      controller.status !== "stopped" ||
      controller.rows.size ||
      engine.transport.running
    )
      fail("recordBusy");
    const frozen = freezeCaptureProject(
      history.project,
      controller.registry,
      c.sampleRate,
    );
    if (JSON.stringify(frozen) !== JSON.stringify(history.project))
      await commit(() => frozen);
    const boundary = audioOwner.begin("prepare-capture");
    try {
      await boundary.closed;
      await waitProgramme();
      await audioOwner.replaceable();
      await controller.load(history.project);
      if (!boundary.current()) fail("cancelled");
      // Keep original capture/monitor levels before creating any producer.
      engine.outputStage.setProgrammeGain(1);
    } finally {
      boundary.finish();
    }
    return stereo
      ? audioOwner.prepareInstrument(trackId, options)
      : audioOwner.prepareSynthetic(trackId, options);
  }
  async function prepareRecorder(
    trackId = selected,
    { overdub = false, instrumentId = "saron-barung" } = {},
  ) {
    if (restoring || storageOperation || recovery !== null) fail("recordBusy");
    await resetRecoveredAudio();
    const c = ensureAudio();
    await c.resume();
    if (
      !controller.plan ||
      JSON.stringify(controller.project) !== JSON.stringify(history.project) ||
      audioOwner.captureTrack !== trackId ||
      !audioOwner.capture
    )
      await prepareCapture(
        trackId,
        { moduleURL: captureModuleURL, overdub },
        true,
      );
    recorder ??= new SelectedRecorder(audioOwner);
    await recorder.prepare(trackId, { overdub, instrumentId });
    return recorder;
  }
  async function recordSelected(options) {
    if (!recorder) fail("instrumentNotReady");
    if (!engine.transport.running) await play(false);
    return recorder.arm(options);
  }
  // Local candidate module bridge. Production gating above remains required.
  return {
    owner: audioOwner,
    memory,
    restored,
    documentStore,
    finalPanel,
    finalExporter,
    get recorder() {
      return recorder;
    },
    get project() {
      return history.project;
    },
    commands: {
      initializeAudio: ensureAudio,
      play,
      previewFinal,
      pause,
      stop,
      closeAudio,
      leave,
      commit,
      moveHistory,
      stopTrack: (id) => audioOwner.stopTrack(id),
      playTrack: (id) => controller.playTrack(id),
      prepareSynthetic: (id, options) => prepareCapture(id, options, false),
      prepareInstrument: (id, options) => prepareCapture(id, options, true),
      prepareRecorder,
      recordSelected,
      downloadProject,
      adoptTake,
      importProject,
      cancelStorage: () => storageOperation?.abort(),
    },
  };
}
