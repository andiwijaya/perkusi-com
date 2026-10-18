import { AudioEngine } from "./engine.js";
import { createPackFromCatalog } from "./pack-catalog.js";
import { originalRegistry } from "../project/original-registry.js";
import { Transport, secondsPerBeat } from "./transport.js";
import { InstrumentRegistry } from "./instrument-registry.js";
import { InstrumentSampleCache } from "./instrument-cache.js";
import { AudioMemory } from "./audio-memory.js";
import { validateFocus, focusSelection } from "../gamelan/instrument-focus.js";
import { ExtensionOwners } from "./extension-owners.js";
import { instrumentVoice, INSTRUMENT_LEVEL } from "./instrument-voice.js";
import { renderInstrumentWav, plannedHeadroom } from "./instrument-renderer.js";
import { gamelanPlaybackScale } from "./gamelan-level.js";
import {
  createProgrammeOutputStage,
  isProgrammeOutputStage,
} from "./programme-output.js";
import {
  auditionGain,
  auditionMetricsReady,
  PROGRAMME_SCRATCH_BYTES,
} from "./programme-level.js";
import { prepareLegacyBus } from "./legacy-bus.js";
import { DAMP_SECONDS } from "./instrument-voice.js";
import { groupMix } from "../project/instrument-mix.js";
import {
  gamelanRepeatPlan,
  repeatedVoice,
  repeatAdmission,
  REPEAT_LOOKAHEAD,
} from "../project/gamelan-repeat.js";
import {
  emptyInstrumentTake,
  appendInstrumentEvent,
  takePlan,
} from "../project/instrument-take.js";
import {
  parseInstrumentProject,
  validateInstrumentProject,
  migrateToInstrumentProject,
  PPQ,
} from "../project/instrument-project.js";
import {
  fail,
  frozenCopy,
  finite,
  utf8Bytes,
} from "../project/instrument-contract.js";

const key = (bank, sample) => bank + "/" + sample;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const defaultEngine = () =>
  new AudioEngine(
    createPackFromCatalog(
      originalRegistry,
      undefined,
      (path) => "/sounds/original-groove/" + path.split("/").at(-1),
    ),
    { outputStageFactory: createProgrammeOutputStage },
  );
function auditionTrim(item, engine) {
  if (!isProgrammeOutputStage(engine.outputStage)) return 1;
  if (!auditionMetricsReady(item.lease.buffer)) fail("instrumentNotReady");
  return (
    auditionGain(
      item.lease.buffer,
      gamelanPlaybackScale(item.bank, item.lease.metrics.peak),
      0.65,
    ) / (engine.outputStage.programmeGain ?? 1)
  );
}

// A candidate presentation of the existing engine's context/master/Transport.
// No second live clock and no automatic AudioContext on construction.
export class InstrumentSession {
  #registries;
  #registry;
  #engineFactory;
  #engine = null;
  #cache = null;
  #untrim = null;
  #memory;
  #contextMemory = null;
  #legacyMemory = null;
  #owners;
  #listeners = new Set();
  #project;
  #focus = [];
  #replayAssets = [];
  #voices = new Set();
  #focusController = null;
  #generation = 0;
  #eventId = 0;
  #timer = null;
  #record = null;
  #armingRecord = false;
  #replay = null;
  #legacy = false;
  #nextLegacy = 0;
  #closing = null;
  #exportController = null;
  #exportResult = null;
  #heldOutputs = new Set();
  #disposed = false;
  #disposing = false;
  #disposal = null;
  #rate = 48000;
  #status = "needsAudio";
  #error = null;
  #requested = { instrument: "saron-barung", laras: "pelog", ensemble: false };
  #stateListener = null;
  #exportSettled = null;
  #legacyBus = null;
  #legacySource = null;
  #replaySettled = null;
  #resumeFrame = 0;
  #resumeRepeat = false;
  #attributionFactory;
  #renderYield;
  constructor({
    catalogs,
    memory = new AudioMemory(),
    engineFactory = defaultEngine,
    attributionFactory = null,
    renderYield,
  } = {}) {
    this.#registries = new Map(
      [44100, 48000].map((rate) => [
        rate,
        new InstrumentRegistry(catalogs[rate].banks),
      ]),
    );
    this.#registry = this.#registries.get(48000);
    this.#memory = memory;
    this.#engineFactory = engineFactory;
    if (attributionFactory !== null && typeof attributionFactory !== "function")
      fail("invalidInstrumentProject");
    this.#attributionFactory = attributionFactory;
    if (renderYield !== undefined && typeof renderYield !== "function")
      fail("invalidInstrumentProject");
    this.#renderYield = renderYield;
    this.#project = emptyInstrumentTake(this.#registry);
    this.#owners = new ExtensionOwners({
      playbackRequested: () =>
        !!this.#engine?.playbackRequested &&
        this.#engine.context?.state === "running",
    });
  }
  subscribe(fn) {
    this.#listeners.add(fn);
    fn(this.snapshot());
    return () => this.#listeners.delete(fn);
  }
  #notify() {
    for (const fn of [...this.#listeners]) {
      try {
        fn(this.snapshot());
      } catch {
        /* UI does not own audio. */
      }
    }
  }
  get project() {
    return this.#project;
  }
  get memory() {
    return this.#memory;
  }
  get registry() {
    return this.#registry;
  }
  get audioContext() {
    return this.#engine?.context ?? null;
  }
  #assert() {
    if (this.#disposed || this.#disposing) fail("sessionDisposed");
  }
  async enable({ gesture = false, focus = null } = {}) {
    this.#assert();
    if (this.#exportController) fail("exportBusy");
    if (!gesture) fail("audioGestureRequired");
    if (this.#closing) fail("audioClosing");
    if (focus !== null) validateFocus(focus);
    const focusChanged =
      focus !== null &&
      JSON.stringify(focus) !== JSON.stringify(this.#requested);
    if (focusChanged) {
      this.pause();
      this.#requested = { ...focus };
      this.#resumeFrame = 0;
      this.#resumeRepeat = false;
    }
    if (
      this.#engine?.playbackRequested &&
      this.audioContext?.state === "running" &&
      this.#focus.length &&
      !focusChanged
    )
      return this.snapshot();
    if (!this.#engine) {
      const contextMemory = this.#memory.reserve(
        524288,
        "live context/graph allowance",
      );
      let engine;
      try {
        engine = this.#engineFactory();
        if (
          !(engine.transport instanceof Transport) ||
          engine.playbackRequested ||
          engine.voices.size ||
          engine.captures.size ||
          [...engine.banks].some((bank) =>
            bank
              .loadingResources()
              .some((q) => q.active || q.queued || q.nativeDecodes),
          )
        )
          fail("legacyEngineBusy");
        const buffers = new Set(
          [...engine.banks].flatMap((bank) =>
            [...bank.entries.values()].map((e) => e.buffer).filter(Boolean),
          ),
        );
        const bytes = [...buffers].reduce(
          (n, b) => n + b.length * b.numberOfChannels * 4,
          0,
        );
        if (bytes)
          this.#legacyMemory = this.#memory.reserve(
            bytes,
            "adopted legacy engine buffers",
          );
        this.#engine = engine;
        this.#contextMemory = contextMemory;
      } catch (error) {
        contextMemory.release();
        throw error;
      }
    }
    const engine = this.#engine,
      operation = this.#generation;
    // Native resume is initiated synchronously in the UI's trusted gesture.
    const context = engine.ensureContext(),
      resumed = context.resume();
    engine.playbackRequested = true;
    this.#status = "starting";
    this.#notify();
    this.#assert();
    if (!this.#cache) {
      if (!this.#registries.has(context.sampleRate)) {
        await this.closeAudio();
        fail("unsupportedDecodeProfile");
      }
      this.#rate = context.sampleRate;
      this.#registry = this.#registries.get(this.#rate);
      this.#project = validateInstrumentProject(this.#project, this.#registry);
      this.#cache = new InstrumentSampleCache(context, this.#registry, {
        memoryPolicy: this.#memory.cachePolicy(context),
      });
      this.#untrim = this.#memory.registerTrimmer(this.#cache, () =>
        this.#cache?.trim(),
      );
      this.#stateListener = () => {
        if (
          context.state !== "running" &&
          this.#engine === engine &&
          !this.#closing
        ) {
          this.cancelExport();
          this.pause();
          void this.closeAudio();
        }
      };
      context.addEventListener("statechange", this.#stateListener);
    }
    await resumed;
    await this.#waitVoices();
    if (
      this.#disposed ||
      this.#disposing ||
      operation !== this.#generation ||
      engine !== this.#engine ||
      !engine.playbackRequested ||
      context.state !== "running"
    )
      fail("cancelled");
    engine.setVolume(this.#project.composition.master.volume);
    engine.master.gain.cancelScheduledValues(context.currentTime);
    engine.master.gain.setValueAtTime(engine.volume, context.currentTime);
    const token = this.#owners.begin("instrument");
    this.#owners.adopt(token, () => this.#stopVoices());
    this.#status = this.#focus.length ? "ready" : "loading";
    this.#error = null;
    this.#notify();
    if (!engine.playbackRequested) fail("cancelled");
    if (!this.#focus.length || focusChanged) {
      const cursor = this.#resumeFrame,
        repeatCursor = this.#resumeRepeat,
        project = this.#project;
      await this.setFocus(this.#requested);
      // Reloading the same physical focus to re-enable audio must not erase
      // the paused arrangement position. Explicit focus/project edits still do.
      if (project === this.#project) {
        this.#resumeFrame = cursor;
        this.#resumeRepeat = repeatCursor;
      }
      this.#notify();
    }
    return this.snapshot();
  }
  async setFocus(spec) {
    this.#assert();
    if (this.#exportController) fail("exportBusy");
    validateFocus(spec);
    if (this.#record) this.finishRecording();
    this.#focusController?.abort();
    const generation = ++this.#generation;
    this.#requested = { ...spec };
    this.#resumeFrame = 0;
    this.#resumeRepeat = false;
    this.#error = null;
    this.#replay = null;
    this.#legacy = false;
    this.#stopVoices();
    this.#status = this.#cache ? "loading" : "needsAudio";
    this.#notify();
    if (!this.#cache) return this.snapshot();
    const cache = this.#cache,
      controller = new AbortController();
    this.#focusController = controller;
    await this.#waitVoices();
    if (generation !== this.#generation) fail("cancelled");
    this.#releaseFocus();
    cache.trim();
    const desired = focusSelection(this.#registry, spec);
    const loaded = [];
    try {
      for (const item of desired) {
        if (controller.signal.aborted || generation !== this.#generation)
          fail("cancelled");
        const transient = await cache.acquire(
          item.bank.id,
          item.bank.version,
          item.descriptor.id,
          { signal: controller.signal },
        );
        let held;
        try {
          held = transient.retain();
        } finally {
          transient.release();
        }
        loaded.push({
          ...item,
          lease: held,
          key: key(item.bank.id, item.descriptor.id),
        });
        if (isProgrammeOutputStage(this.#engine.outputStage)) {
          const meter = this.#memory.reserve(
            PROGRAMME_SCRATCH_BYTES,
            "prepared-audition-meter",
          );
          try {
            auditionGain(
              held.buffer,
              gamelanPlaybackScale(item.bank, held.metrics.peak),
              0.65,
            );
          } finally {
            meter.release();
          }
        }
      }
      if (controller.signal.aborted || generation !== this.#generation)
        fail("cancelled");
      this.#focus = loaded;
      this.#status = "ready";
      this.#error = null;
      this.#notify();
      return this.snapshot();
    } catch (error) {
      loaded.forEach((item) => item.lease.release());
      cache.trim();
      if (generation === this.#generation) {
        this.#status = error.code === "cancelled" ? "cancelled" : "error";
        this.#error = error.code ?? "assetFailed";
        this.#notify();
      }
      throw error;
    } finally {
      if (this.#focusController === controller) this.#focusController = null;
    }
  }
  cancelLoading() {
    this.#focusController?.abort();
    this.#notify();
  }
  #releaseFocus() {
    this.#focus.forEach((item) => item.lease.release());
    this.#focus = [];
    this.#replayAssets.forEach((item) => item.lease.release());
    this.#replayAssets = [];
  }
  #when() {
    const context = this.audioContext;
    if (
      !context ||
      context.state !== "running" ||
      !this.#engine.playbackRequested
    )
      fail("audioPaused");
    return Math.round((context.currentTime + 0.005) * this.#rate) / this.#rate;
  }
  #nextEvent(bank, sample, action, velocity, when, closing = false) {
    if (!this.#record) return this.#project;
    if (action === "strike" && when - this.#record.time > 32) {
      this.finishRecording();
      fail("recordDurationLimit");
    }
    const tick =
      this.#record.offset +
      Math.max(
        0,
        Math.round(
          ((when - this.#record.time) *
            this.#project.composition.timing.bpm *
            PPQ) /
            60,
        ),
      );
    if (this.#project.events.length >= (closing ? 4096 : 4064))
      fail("eventLimit");
    let id;
    do {
      if (this.#eventId >= Number.MAX_SAFE_INTEGER) fail("eventLimit");
      id = "e-" + ++this.#eventId;
    } while (this.#project.events.some((e) => e.id === id));
    return appendInstrumentEvent(this.#project, this.#registry, {
      id,
      tick,
      bankId: bank.id,
      version: bank.version,
      sampleId: sample.id,
      action,
      velocity,
    });
  }
  #start(
    item,
    velocity,
    when,
    { record = true, spec = null, fromFrame = 0, dynamicMix = false } = {},
  ) {
    if (this.#voices.size >= 16) fail("voiceLimit");
    const volume = this.#engine.volume,
      existing = [...this.#voices].reduce((n, v) => n + this.#voicePeak(v), 0),
      mix = spec?.mix ?? { volume: 1, pan: 0 },
      playbackScale =
        gamelanPlaybackScale(item.bank, item.lease.metrics.peak) *
        (spec ? 1 : auditionTrim(item, this.#engine)),
      peak =
        item.lease.metrics.peak *
        playbackScale *
        velocity *
        INSTRUMENT_LEVEL *
        volume *
        mix.volume *
        (mix.pan ? Math.SQRT2 : 1);
    if (existing + peak + (this.#legacyBus?.peak ?? 0) > 0.95)
      fail("voiceHeadroom");
    let held, nodeMemory, mixGain, pan;
    const row = {
      item,
      when,
      peak,
      velocity,
      mix,
      playbackScale,
      dynamicMix,
      voice: null,
      pendingPeak: null,
    };
    try {
      const next = record
        ? this.#nextEvent(item.bank, item.descriptor, "strike", velocity, when)
        : this.#project;
      nodeMemory = this.#memory.reserve(4096, "live voice node allowance");
      held = item.lease.retain();
      let output = this.#engine.master;
      if (spec && mix.pan !== 0) {
        pan = this.audioContext.createStereoPanner();
        pan.pan.value = mix.pan;
        pan.connect(output);
        output = pan;
      }
      if (playbackScale !== 1 || (spec && (mix.volume !== 1 || dynamicMix))) {
        mixGain = this.audioContext.createGain();
        mixGain.gain.value = mix.volume * playbackScale;
        mixGain.connect(output);
        output = mixGain;
      }
      row.groupGain = mixGain;
      const initialLevel =
        spec?.dampFrame !== null &&
        spec?.dampFrame !== undefined &&
        fromFrame > spec.dampFrame
          ? Math.max(
              0,
              1 -
                (fromFrame - spec.dampFrame) /
                  Math.round(DAMP_SECONDS * this.#rate),
            )
          : 1;
      row.voice = instrumentVoice(
        this.audioContext,
        output,
        held.buffer,
        when,
        velocity,
        {
          offset: spec
            ? Math.max(0, fromFrame - spec.startFrame) / this.#rate
            : 0,
          initialLevel,
          release: () => {
            mixGain?.disconnect();
            pan?.disconnect();
            held.release();
            nodeMemory.release();
            this.#voices.delete(row);
            this.#notify();
          },
        },
      );
      if (
        spec?.dampFrame !== null &&
        spec?.dampFrame !== undefined &&
        fromFrame > spec.dampFrame
      ) {
        const end = when + (spec.endFrame - fromFrame) / this.#rate;
        row.voice.gain.gain.linearRampToValueAtTime(0, end);
        row.voice.source.stop(end);
      }
      row.recordId =
        next !== this.#project
          ? next.events.find((e) => e.id === "e-" + this.#eventId)?.id
          : null;
      this.#project = next;
      this.#voices.add(row);
      this.#notify();
      return when;
    } catch (error) {
      held?.release();
      nodeMemory?.release();
      mixGain?.disconnect();
      pan?.disconnect();
      throw error;
    }
  }
  strike(bankId, sampleId, velocity = 1) {
    this.#assert();
    if (this.#replay?.repeat) fail("recordBusy");
    if (this.#status !== "ready" || !finite(velocity, Number.MIN_VALUE, 1))
      fail("instrumentNotReady");
    const item = this.#focus.find((item) => item.key === key(bankId, sampleId));
    if (!item) fail("unknownInstrumentSample");
    return this.#start(item, velocity, this.#when());
  }
  #voicePeak(row) {
    if (
      row.pendingPeak &&
      this.audioContext.currentTime >= row.pendingPeak.until
    ) {
      row.peak = row.pendingPeak.next;
      row.pendingPeak = null;
    }
    return row.pendingPeak
      ? Math.max(row.peak, row.pendingPeak.next)
      : row.peak;
  }
  setInstrumentGroupMix(group) {
    this.#assert();
    if (
      this.#record ||
      this.#armingRecord ||
      this.#exportController ||
      this.#focusController ||
      (this.#replay && !this.#replay.playAlong)
    )
      fail("recordBusy");
    const next = structuredClone(this.#project);
    next.instrumentMix ??= [];
    const prior = next.instrumentMix.find(
      (m) => m.bankId === group.bankId && m.instrumentId === group.instrumentId,
    );
    if (prior) Object.assign(prior, group);
    else next.instrumentMix.push(group);
    const valid = validateInstrumentProject(next, this.#registry);
    if (this.#replay) {
      const full = takePlan(valid, this.#registry, this.#rate, {
        includeMuted: true,
      });
      const plan = {
        ...full,
        voices: full.voices.filter((v) => v.endFrame > this.#replay.offset),
      };
      if (
        plan.voices.some(
          (v, i) => v.mix.pan !== this.#replay.plan.voices[i]?.mix.pan,
        )
      )
        fail("recordBusy");
      const metrics = new Map(
        this.#replayAssets.map((i) => [
          i.key,
          {
            ...i.lease.metrics,
            peak:
              i.lease.metrics.peak *
              gamelanPlaybackScale(i.bank, i.lease.metrics.peak),
          },
        ]),
      );
      const transitioning = new Map();
      for (const row of this.#voices)
        if (row.dynamicMix) {
          const denominator =
            row.item.lease.metrics.peak *
            row.playbackScale *
            row.velocity *
            INSTRUMENT_LEVEL *
            this.#engine.volume *
            (row.mix.pan ? Math.SQRT2 : 1);
          const id = row.item.bank.id + "/" + row.item.descriptor.instrumentId;
          transitioning.set(
            id,
            Math.max(
              transitioning.get(id) ?? 0,
              denominator ? this.#voicePeak(row) / denominator : 0,
            ),
          );
        }
      // The union envelope bounds current and future starts through the4ms
      // transition, including manual strikes. Unsafe live changes refuse intact.
      const union = {
        ...plan,
        voices: plan.voices.map((v, i) => ({
          ...v,
          mix: {
            ...v.mix,
            volume: Math.max(
              v.mix.volume,
              this.#replay.plan.voices[i]?.mix.volume ?? 0,
              transitioning.get(v.bankId + "/" + v.descriptor.instrumentId) ??
                0,
            ),
          },
        })),
      };
      if (
        plannedHeadroom(union, metrics, this.#engine.volume) +
          [...this.#voices]
            .filter((row) => !row.dynamicMix)
            .reduce((sum, row) => sum + this.#voicePeak(row), 0) +
          (this.#legacyBus?.peak ?? 0) >
        0.95
      )
        fail("voiceHeadroom");
      const now = this.audioContext.currentTime;
      for (const row of this.#voices)
        if (row.dynamicMix) {
          const mix = groupMix(
              valid,
              this.#registry,
              row.item.bank.id,
              row.item.descriptor.instrumentId,
            ),
            param = row.groupGain.gain;
          const conservative = this.#voicePeak(row);
          param.cancelScheduledValues(now);
          param.setValueAtTime(param.value, now);
          param.linearRampToValueAtTime(
            mix.volume * row.playbackScale,
            now + 0.004,
          );
          row.peak = conservative;
          row.pendingPeak = {
            until: now + 0.004,
            next:
              row.item.lease.metrics.peak *
              row.playbackScale *
              row.velocity *
              INSTRUMENT_LEVEL *
              this.#engine.volume *
              mix.volume *
              (mix.pan ? Math.SQRT2 : 1),
          };
          row.mix = mix;
        }
      this.#replay.plan = plan;
    }
    this.#project = valid;
    this.#notify();
  }
  damp(bankId, sampleId) {
    this.#assert();
    const matches = [...this.#voices].filter(
      (v) => v.item.key === key(bankId, sampleId),
    );
    if (!matches.length) return;
    const when = Math.max(
      this.#when(),
      ...matches.map((v) => v.when + 1 / this.#rate),
    );
    const next = this.#nextEvent(
      matches[0].item.bank,
      matches[0].item.descriptor,
      "damp",
      0,
      when,
    );
    matches.forEach((v) => v.voice.damp(when));
    this.#project = next;
    this.#notify();
  }
  dampAll() {
    for (const k of new Set([...this.#voices].map((v) => v.item.key))) {
      const [bank, sample] = k.split("/");
      this.damp(bank, sample);
    }
  }
  #stopVoices() {
    for (const row of [...this.#voices]) row.voice?.stop();
    if (this.#legacySource)
      try {
        this.#legacySource.stop();
      } catch {
        /* native onended still owns bus */
      }
  }
  async #waitVoices() {
    const until = Date.now() + 3000;
    while ((this.#voices.size || this.#legacySource) && Date.now() < until)
      await delay(5);
    if (this.#voices.size || this.#legacySource) fail("audioClosing");
  }
  async startRecording() {
    this.#assert();
    if (
      this.#record ||
      this.#armingRecord ||
      this.#replay ||
      this.#exportController
    )
      fail("recordBusy");
    if (this.#project.events.length >= 4000) fail("eventLimit");
    this.#resumeFrame = 0;
    this.#resumeRepeat = false;
    const generation = this.#generation;
    this.#when();
    this.#armingRecord = true;
    this.#stopVoices();
    this.#notify();
    try {
      await this.#waitVoices();
      if (generation !== this.#generation || !this.#engine?.playbackRequested)
        fail("cancelled");
    } finally {
      this.#armingRecord = false;
      this.#notify();
    }
    const time = this.#when(),
      offset = this.#project.events.length
        ? this.#project.clock.lengthTicks
        : 0;
    this.#record = { time, offset, before: this.#project.events.length };
    this.#engine.transport.reset();
    this.#engine.transport.beatSeconds = secondsPerBeat(
      this.#project.composition.timing.bpm,
    );
    this.#engine.transport.start(time);
    if (this.#legacy) {
      this.#stopVoices();
      this.#nextLegacy = time;
    }
    this.#startTimer();
    this.#pump();
    this.#notify();
  }
  async prepareStudio() {
    this.#assert();
    if (
      this.#record ||
      this.#armingRecord ||
      this.#exportController ||
      this.#replay ||
      this.#focusController
    )
      fail("recordBusy");
    const generation = this.#generation;
    this.pause();
    await this.#waitVoices();
    this.#assert();
    if (generation !== this.#generation) fail("cancelled");
    return this.#project;
  }
  finishRecording() {
    if (!this.#record) return;
    const rec = this.#record;
    this.#record = null;
    const end =
      rec.offset +
      Math.max(
        1,
        Math.round(
          ((this.audioContext?.currentTime - rec.time) *
            this.#project.composition.timing.bpm *
            PPQ) /
            60,
        ),
      );
    const next = structuredClone(this.#project);
    next.events = next.events.filter((e, i) => i < rec.before || e.tick <= end);
    next.clock.lengthTicks = Math.max(
      4 * PPQ,
      Math.ceil((end + 1) / (4 * PPQ)) * 4 * PPQ,
    );
    this.#project = validateInstrumentProject(next, this.#registry);
    this.#notify();
  }
  clearRecording() {
    this.#assert();
    this.pause();
    this.#resumeFrame = 0;
    this.#resumeRepeat = false;
    const next = structuredClone(this.#project);
    next.events = [];
    next.banks = [];
    if (Object.hasOwn(next, "instrumentMix")) next.instrumentMix = [];
    next.clock.lengthTicks = 4 * PPQ;
    this.#project = validateInstrumentProject(next, this.#registry);
    this.#notify();
  }
  setTempo(bpm) {
    this.#assert();
    if (this.#project.events.length || this.#record || this.#legacy)
      fail("recordedTempoLocked");
    secondsPerBeat(bpm);
    if (this.#project.composition.clips.some((c) => c.enabled) && bpm !== 96)
      fail("legacyTempo");
    const next = structuredClone(this.#project);
    next.composition.timing.bpm = bpm;
    this.#project = validateInstrumentProject(next, this.#registry);
    this.#notify();
  }
  async legacyGuide(enabled) {
    this.#assert();
    if (this.#record || this.#replay) fail("recordBusy");
    if (!enabled) {
      this.#legacy = false;
      for (const v of [...this.#voices])
        if (v.item.bank.id === "legacy-hat") v.voice.stop();
      const removed = this.#replayAssets.filter(
        (i) => i.bank.id === "legacy-hat",
      );
      removed.forEach((i) => i.lease.release());
      this.#replayAssets = this.#replayAssets.filter(
        (i) => i.bank.id !== "legacy-hat",
      );
      this.#notify();
      return;
    }
    if (this.#legacy) return;
    if (this.#project.composition.timing.bpm !== 96) fail("legacyTempo");
    this.#when();
    const bank = this.#registry.bank("legacy-hat", "1.0.0-local"),
      descriptor = bank.samples[0];
    const generation = this.#generation,
      raw = await this.#cache.acquire(bank.id, bank.version, descriptor.id);
    if (generation !== this.#generation || !this.#engine?.playbackRequested) {
      raw.release();
      fail("cancelled");
    }
    let lease;
    try {
      lease = raw.retain();
    } finally {
      raw.release();
    }
    const item = { bank, descriptor, lease, key: key(bank.id, descriptor.id) };
    this.#replayAssets.push(item);
    this.#legacy = true;
    this.#nextLegacy = this.#when();
    this.#startTimer();
    this.#pump();
    this.#notify();
  }
  #startTimer() {
    if (!this.#timer) this.#timer = setInterval(() => this.#pump(), 25);
  }
  #pump() {
    if (
      this.#disposing ||
      this.#disposed ||
      !this.audioContext ||
      !this.#engine.playbackRequested
    )
      return;
    const horizon = this.audioContext.currentTime + 0.08;
    try {
      if (
        this.#record &&
        this.audioContext.currentTime - this.#record.time >= 32
      )
        this.finishRecording();
      if (this.#legacy && !this.#armingRecord) {
        const item = this.#replayAssets.find((i) => i.bank.id === "legacy-hat");
        while (item && this.#nextLegacy < horizon) {
          this.#start(item, 1, this.#nextLegacy);
          this.#nextLegacy += 5;
        }
      }
      if (this.#replay) {
        const p = this.#replay;
        const ahead = p.repeat
          ? this.audioContext.currentTime + REPEAT_LOOKAHEAD
          : horizon;
        let scheduled = 0;
        while (p.repeat || p.index < p.plan.voices.length) {
          const v = p.repeat
            ? repeatedVoice(p.plan, p.cycle, p.index)
            : p.plan.voices[p.index];
          const from = Math.max(p.offset, v.startFrame),
            when = p.time + (from - p.offset) / this.#rate;
          if (when >= ahead) break;
          p.index++;
          if (p.repeat && p.index === p.plan.voices.length) {
            p.index = 0;
            p.cycle++;
          }
          if (v.endFrame <= p.offset) continue;
          if (p.repeat && when < this.audioContext.currentTime - 0.01)
            fail("replayLate");
          if (++scheduled > 4096) fail("voiceLimit");
          const item = this.#replayAssets.find((i) => i.key === v.key);
          this.#start(item, v.velocity, when, {
            record: false,
            spec: v,
            fromFrame: from,
            dynamicMix: p.playAlong,
          });
          if (v.dampFrame !== null && v.dampFrame >= from) {
            const row = [...this.#voices].at(-1);
            row.voice.damp(p.time + (v.dampFrame - p.offset) / this.#rate);
          }
        }
        if (
          !p.repeat &&
          p.index === p.plan.voices.length &&
          this.#voices.size === 0 &&
          !this.#legacySource &&
          this.audioContext.currentTime >=
            p.time + (p.plan.frames - p.offset) / this.#rate
        ) {
          this.#replay = null;
          this.#resumeFrame = 0;
          this.#resumeRepeat = false;
          this.#releaseReplay();
          this.#notify();
        }
      }
    } catch (error) {
      this.#error = error.code ?? "audioFailed";
      this.pause();
      this.#notify();
    }
  }
  #releaseReplay() {
    this.#replayAssets.forEach((i) => i.lease.release());
    this.#replayAssets = [];
  }
  async replay({ resume = false, playAlong = false, repeat = false } = {}) {
    this.#assert();
    this.#when();
    if (
      this.#record ||
      this.#armingRecord ||
      this.#exportController ||
      this.#focusController ||
      this.#replaySettled
    )
      fail("recordBusy");
    if (typeof repeat !== "boolean") fail("invalidLoopPlan");
    const repeatMode = resume ? this.#resumeRepeat : repeat;
    if (repeatMode) playAlong = false;
    const offset = resume ? this.#resumeFrame : 0;
    let settled;
    this.#replaySettled = new Promise((r) => {
      settled = r;
    });
    this.pause();
    try {
      await this.#waitVoices();
      const needed = new Set(
        this.#project.events
          .filter((e) => e.action === "strike")
          .map((e) => key(e.bankId, e.sampleId)),
      );
      if (
        !playAlong &&
        [...needed].some(
          (k) =>
            !this.#focus.some((i) => i.key === k) &&
            !k.startsWith("legacy-hat/"),
        )
      )
        this.#releaseFocus();
      // Previous replay assets have their own leases, including paused tails.
      // Voices have settled above; release these even when focus is also shed.
      this.#releaseReplay();
      this.#cache.trim();
      const originalPlan = repeatMode
          ? gamelanRepeatPlan(this.#project, this.#registry, this.#rate)
          : takePlan(this.#project, this.#registry, this.#rate, {
              includeMuted: playAlong,
            }),
        plan = {
          ...originalPlan,
          voices: repeatMode
            ? originalPlan.voices
            : originalPlan.voices.filter((v) => v.endFrame > offset),
        },
        items = [],
        metrics = new Map(),
        generation = ++this.#generation,
        controller = new AbortController(),
        engine = this.#engine,
        cache = this.#cache;
      this.#focusController = controller;
      this.#status = "loading";
      this.#notify();
      let bus = null;
      try {
        bus = await prepareLegacyBus(plan.project, {
          memory: this.#memory,
          rate: this.#rate,
          signal: controller.signal,
        });
        const unique = [
          ...new Map(plan.voices.map((v) => [v.key, v])).values(),
        ].sort((a, b) => b.descriptor.frames - a.descriptor.frames);
        for (const v of unique) {
          const raw = await cache.acquire(v.bankId, v.version, v.sampleId, {
            signal: controller.signal,
          });
          let lease;
          try {
            lease = raw.retain();
          } finally {
            raw.release();
          }
          items.push({
            bank: this.#registry.bank(v.bankId, v.version),
            descriptor: v.descriptor,
            lease,
            key: v.key,
          });
          metrics.set(v.key, {
            ...lease.metrics,
            peak:
              lease.metrics.peak *
              gamelanPlaybackScale(
                this.#registry.bank(v.bankId, v.version),
                lease.metrics.peak,
              ),
          });
        }
        if (repeatMode) repeatAdmission(plan, metrics, this.#engine.volume);
        if (
          !repeatMode &&
          plannedHeadroom(plan, metrics, this.#engine.volume) +
            (bus?.peak ?? 0) >
            0.95
        )
          fail("voiceHeadroom");
        const edges = plan.voices
          .flatMap((v) => [
            { f: v.startFrame, n: 1 },
            { f: v.endFrame, n: -1 },
          ])
          .sort((a, b) => a.f - b.f || a.n - b.n);
        let concurrent = 0;
        for (const edge of edges) {
          concurrent += edge.n;
          if (concurrent > 16) fail("voiceLimit");
        }
        if (
          generation !== this.#generation ||
          controller.signal.aborted ||
          engine !== this.#engine
        )
          fail("cancelled");
        this.#replayAssets = items;
        if (!resume && isProgrammeOutputStage(engine.outputStage)) {
          const analysis = await renderInstrumentWav(this.#project, {
            registry: this.#registry,
            cache,
            memory: this.#memory,
            rate: this.#rate,
            signal: controller.signal,
            yieldTask: this.#renderYield,
            analysisOnly: true,
          });
          if (
            controller.signal.aborted ||
            generation !== this.#generation ||
            engine !== this.#engine
          )
            fail("cancelled");
          engine.outputStage.setProgrammeGain(
            analysis.programmeCalibration.gain,
          );
        }
        this.#engine.playbackRequested = true;
        const token = this.#owners.begin("instrument");
        this.#owners.adopt(token, () => this.#stopVoices());
        const time = repeatMode
          ? Math.max(
              this.#when(),
              Math.ceil((engine.context.currentTime + 0.1) * this.#rate) /
                this.#rate,
            )
          : this.#when();
        if (bus && offset < bus.frames) {
          const source = engine.context.createBufferSource();
          source.buffer = bus.buffer;
          source.playbackRate.value = 1;
          source.loop = false;
          // The legacy Float32 bus already includes its master and mastering.
          source.connect(
            isProgrammeOutputStage(engine.outputStage)
              ? engine.outputStage.programmeInput
              : engine.context.destination,
          );
          this.#legacyBus = bus;
          this.#legacySource = source;
          const ownedBus = bus;
          bus = null;
          source.onended = () => {
            source.onended = null;
            source.disconnect();
            source.buffer = null;
            ownedBus.release();
            if (this.#legacySource === source) {
              this.#legacySource = null;
              this.#legacyBus = null;
              this.#notify();
            }
          };
          try {
            source.start(time, offset / this.#rate);
          } catch (e) {
            source.onended();
            throw e;
          }
        } else {
          bus?.release();
          bus = null;
        }
        this.#engine.transport.reset();
        this.#engine.transport.beatSeconds = secondsPerBeat(
          this.#project.composition.timing.bpm,
        );
        this.#engine.transport.position =
          offset / this.#rate / this.#engine.transport.beatSeconds;
        this.#engine.transport.start(time);
        this.#replay = {
          plan,
          index: 0,
          time,
          offset,
          playAlong,
          repeat: repeatMode,
          cycle: repeatMode
            ? Math.max(
                0,
                Math.floor(offset / plan.periodFrames) -
                  Math.ceil(plan.maxTailFrames / plan.periodFrames) -
                  1,
              )
            : 0,
        };
        this.#status = "ready";
        this.#startTimer();
        this.#pump();
        this.#notify();
      } catch (error) {
        bus?.release();
        this.#stopVoices();
        items.forEach((i) => i.lease.release());
        cache.trim();
        if (generation === this.#generation) {
          this.#error = error.code ?? "assetFailed";
          this.#status = "error";
          this.#notify();
        }
        throw error;
      } finally {
        if (this.#focusController === controller) this.#focusController = null;
      }
    } finally {
      this.#replaySettled = null;
      settled();
    }
  }
  pause() {
    if (this.#disposed) return;
    if (this.#replay && this.audioContext) {
      this.#resumeRepeat = this.#replay.repeat === true;
      this.#resumeFrame = Math.min(
        this.#resumeRepeat
          ? Number.MAX_SAFE_INTEGER
          : this.#replay.plan.frames - 1,
        this.#replay.offset +
          Math.max(
            0,
            Math.round(
              (this.audioContext.currentTime - this.#replay.time) * this.#rate,
            ),
          ),
      );
    }
    if (this.#record && this.audioContext) {
      const now = this.audioContext.currentTime,
        notPlayed = new Set(
          [...this.#voices]
            .filter((v) => v.when > now)
            .map((v) => v.recordId)
            .filter(Boolean),
        );
      if (notPlayed.size) {
        const next = structuredClone(this.#project);
        next.events = next.events.filter((e) => !notPlayed.has(e.id));
        this.#project = validateInstrumentProject(next, this.#registry);
      }
      for (const k of new Set(
        [...this.#voices].filter((v) => v.when <= now).map((v) => v.item.key),
      )) {
        const row = [...this.#voices].find((v) => v.item.key === k),
          when = Math.round(now * this.#rate) / this.#rate;
        const next = this.#nextEvent(
          row.item.bank,
          row.item.descriptor,
          "damp",
          0,
          when,
          true,
        );
        for (const v of this.#voices) if (v.item.key === k) v.voice.damp(when);
        this.#project = next;
      }
    }
    this.finishRecording();
    this.#focusController?.abort();
    this.#legacy = false;
    this.#replay = null;
    this.#owners.stop();
    this.#engine?.pause();
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#status = this.#focus.length ? "ready" : "needsAudio";
    this.#notify();
  }
  stopPlayback() {
    this.#assert();
    if (this.#record || this.#armingRecord || this.#exportController)
      fail("recordBusy");
    this.pause();
    this.#resumeFrame = 0;
    this.#resumeRepeat = false;
    this.#engine?.transport.reset();
    this.#notify();
  }
  async closeAudio() {
    if (this.#closing) return this.#closing;
    if (!this.#engine) return;
    this.pause();
    const engine = this.#engine,
      cache = this.#cache,
      context = engine.context;
    ++this.#generation;
    this.#closing = (async () => {
      context?.removeEventListener("statechange", this.#stateListener);
      if (
        engine.disposalClosePending &&
        typeof engine.retryDisposedClose === "function"
      )
        await engine.retryDisposedClose();
      else await engine.dispose({ immediate: true });
      if (this.#legacySource) {
        const source = this.#legacySource;
        source.onended?.();
      }
      for (const row of [...this.#voices]) row.voice.disconnect();
      this.#releaseFocus();
      cache?.dispose();
      this.#untrim?.();
      this.#untrim = null;
      this.#contextMemory?.release();
      this.#legacyMemory?.release();
      this.#contextMemory = null;
      this.#legacyMemory = null;
      this.#engine = null;
      this.#cache = null;
      this.#status = "needsAudio";
      this.#notify();
    })();
    try {
      await this.#closing;
    } finally {
      this.#closing = null;
    }
  }
  importJSON(text) {
    this.#assert();
    if (this.#record || this.#exportController) fail("recordBusy");
    if (typeof text !== "string" || utf8Bytes(text) > 1048576)
      fail("projectTooLarge");
    let version;
    try {
      const source = JSON.parse(text);
      if (!source || typeof source !== "object" || Array.isArray(source))
        fail("invalidInstrumentProject");
      version = source.schemaVersion;
    } catch {
      fail("invalidInstrumentProject");
    }
    const project = [0, 1, 2, 3].includes(version)
      ? migrateToInstrumentProject(text, this.#registry)
      : parseInstrumentProject(text, this.#registry);
    this.pause();
    ++this.#generation;
    this.#resumeFrame = 0;
    this.#resumeRepeat = false;
    this.#project = project;
    this.#eventId = 0;
    this.#error = null;
    this.#notify();
  }
  toJSON() {
    return (
      JSON.stringify(
        validateInstrumentProject(this.#project, this.#registry),
        null,
        2,
      ) + "\n"
    );
  }
  cancelExport() {
    this.#exportController?.abort();
  }
  releaseExport() {
    this.#exportResult?.release();
    this.#exportResult = null;
    this.#notify();
  }
  async exportWav({ pauseAndRelease = false, onProgress = () => {} } = {}) {
    this.#assert();
    if (this.#replay?.repeat) fail("recordBusy");
    if (this.#exportController || this.#record) fail("exportBusy");
    // Acquire before any await or observer notification (including releaseExport).
    const controller = new AbortController();
    this.#exportController = controller;
    let settled;
    this.#exportSettled = new Promise((resolve) => {
      settled = resolve;
    });
    let cache = null,
      owned = false,
      contextMemory,
      untrim;
    try {
      const token = this.#owners.begin("export");
      this.#owners.adopt(token, () => controller.abort());
      this.releaseExport();
      if (pauseAndRelease) await this.closeAudio();
      if (controller.signal.aborted || this.#disposing || this.#disposed)
        fail("cancelled");
      if (this.#cache && this.audioContext?.state !== "closed") {
        cache = new InstrumentSampleCache(this.audioContext, this.#registry, {
          memoryPolicy: this.#memory.cachePolicy(this.audioContext),
        });
        untrim = this.#memory.registerTrimmer(cache, () => cache.trim());
        owned = true;
      } else {
        contextMemory = this.#memory.reserve(
          524288,
          "offline decode context allowance",
        );
        const context = new OfflineAudioContext(2, 1, this.#rate);
        cache = new InstrumentSampleCache(context, this.#registry, {
          memoryPolicy: this.#memory.cachePolicy(context),
        });
        untrim = this.#memory.registerTrimmer(cache, () => cache.trim());
        owned = true;
      }
      const result = await renderInstrumentWav(this.#project, {
        matchProgramme: true,
        registry: this.#registry,
        cache,
        memory: this.#memory,
        rate: this.#rate,
        signal: controller.signal,
        onProgress,
        attribution: this.#attributionFactory?.(this.#project) ?? "",
        yieldTask: this.#renderYield,
      });
      if (controller.signal.aborted) {
        result.release();
        fail("cancelled");
      }
      this.#exportResult = result;
      this.#heldOutputs.add(result);
      result.released.then(() => this.#heldOutputs.delete(result));
      this.#notify();
      return result;
    } finally {
      if (owned) cache?.dispose();
      untrim?.();
      contextMemory?.release();
      if (this.#exportController === controller) {
        this.#owners.cancel("export");
        this.#exportController = null;
        this.#exportSettled = null;
      }
      settled();
      this.#notify();
    }
  }
  dispose() {
    if (this.#disposal) return this.#disposal;
    // Terminal admission closes synchronously; internal cleanup can still pause.
    this.#disposing = true;
    ++this.#generation;
    const pendingExport = this.#exportSettled;
    const pendingReplay = this.#replaySettled;
    // Install the shared promise before cleanup or notifications can re-enter.
    this.#disposal = Promise.resolve().then(async () => {
      await this.closeAudio();
      await pendingExport;
      await pendingReplay;
      this.releaseExport();
      await Promise.all(
        [...this.#heldOutputs].map((output) => output.released),
      );
      this.#owners.dispose();
      this.#disposed = true;
      this.#disposing = false;
      this.#notify();
      this.#listeners.clear();
    });
    this.cancelExport();
    this.#focusController?.abort();
    this.#notify();
    return this.#disposal;
  }
  snapshot() {
    return frozenCopy({
      status: this.#status,
      disposing: this.#disposing,
      disposed: this.#disposed,
      error: this.#error,
      profile: this.#rate,
      clock: {
        bpm: this.#project.composition.timing.bpm,
        currentTime: this.audioContext?.currentTime ?? 0,
        origin: this.#engine?.transport.origin ?? 0,
        beat:
          this.#engine?.transport.beatsAt(
            this.audioContext?.currentTime ?? 0,
          ) ?? 0,
        running: this.#engine?.transport.running ?? false,
      },
      contextState: this.audioContext?.state ?? "absent",
      playbackRequested: !!this.#engine?.playbackRequested,
      focus: this.#requested,
      recording: !!this.#record,
      armingRecord: this.#armingRecord,
      replaying: !!this.#replay,
      repeating: this.#replay?.repeat === true,
      canResume: this.#resumeFrame > 0,
      legacyBusActive: !!this.#legacySource,
      legacyGuide: this.#legacy,
      exporting: !!this.#exportController,
      events: this.#project.events.length,
      voiceCount: this.#voices.size,
      notes: this.#focus.map((i) => ({
        bankId: i.bank.id,
        sampleId: i.descriptor.id,
        instrument: i.descriptor.instrumentId,
        pitch: i.descriptor.pitchId,
        articulation: i.descriptor.articulation,
        voicePolicy: i.descriptor.voicePolicy,
        active: [...this.#voices].filter((v) => v.item.key === i.key).length,
        bytes: i.lease.metrics.bytes,
        encodedBytes: i.descriptor.encodedBytes,
      })),
      memory: this.#memory.snapshot(),
      cache: this.#cache?.snapshot() ?? null,
      owners: this.#owners.snapshot(),
    });
  }
}
