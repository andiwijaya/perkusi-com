import { AudioMemory } from "../audio/audio-memory.js";
import { Transport } from "../audio/transport.js";
import { InstrumentRegistry } from "../audio/instrument-registry.js";
import { InstrumentSampleCache } from "../audio/instrument-cache.js";
import {
  instrumentVoice,
  INSTRUMENT_LEVEL,
} from "../audio/instrument-voice.js";
import { HeldPadInputs } from "../gamelan/held-pad-inputs.js";
import { fail } from "../project/instrument-contract.js";
import { isDrumAssignment, DRUM_VOICES } from "./drum-sources.js";
import { drumVoice } from "./drum-voice.js";
import { isMelodicAssignment, melodicPolicy } from "./melodic-sources.js";
import { micInputChannels, closeMicSource } from "./mic-source.js";
import { gamelanPlaybackScale } from "../audio/gamelan-level.js";
import {
  auditionGain,
  PROGRAMME_SCRATCH_BYTES,
} from "../audio/programme-level.js";

const branded = new WeakMap();
export const createLiveInstrumentInput = (options) =>
  createInstrumentInput({
    ...options,
    live: true,
    endFrame: Number.MAX_SAFE_INTEGER,
  });
export function activateInstrumentMonitor(source, options) {
  const p = branded.get(source);
  if (!p?.live) fail("invalidCaptureSource");
  return p.activateMonitor(options);
}
export function closeInstrumentMonitor(source) {
  if (source?.kind === "original-microphone-input")
    return closeMicSource(source);
  const p = branded.get(source);
  if (!p?.live) fail("invalidCaptureSource");
  return p.close();
}
// Certified pending/live monitor frontier. Rows keep their complete peak until
// actual native ended/close, including damped and future-scheduled voices.
export function instrumentMonitorPeak(source, context, memory, transport) {
  const p = branded.get(source);
  if (
    !p?.live ||
    p.context !== context ||
    p.memory !== memory ||
    p.transport !== transport
  )
    fail("invalidCaptureSource");
  return [...p.rows, ...p.pendingRows].reduce((n, r) => n + r.peak, 0);
}
const safe = (n) => Number.isSafeInteger(n) && n >= 0;
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

// Shared root/workspace accounting. Includes route, both full PCM copies,
// transfer pages and worklet/node allowance; producer/cache costs are separate.
export function captureReservedBytes(channels, frames) {
  if (
    ![1, 2].includes(channels) ||
    !safe(frames) ||
    !safe(8 * channels * frames + 20480 + 32768 * channels)
  )
    fail("invalidCaptureSource");
  return 8 * channels * frames + 20480 + 32768 * channels;
}
export function captureInputChannels(source, context, memory, transport) {
  const mic = micInputChannels(source, context, memory, transport);
  if (mic !== null) return mic;
  if (source?.kind === "qualified-finite-synthetic") {
    if (source.channels !== undefined && source.channels !== 1)
      fail("invalidCaptureSource");
    return 1;
  }
  const p = branded.get(source);
  if (
    !p ||
    p.context !== context ||
    p.memory !== memory ||
    p.transport !== transport ||
    !p.current()
  )
    fail("invalidCaptureSource");
  return 2;
}

// Internal capture-only producer. No direct monitor/FX, engine ownership,
// transport pause/reset or user Record UI. Native sample data is never edited.
export async function createInstrumentInput({
  context,
  transport,
  memory,
  registry,
  bankId,
  bankVersion,
  sampleIds,
  framesPerBar,
  endFrame,
  signal,
  live = false,
  outputGain = 1,
  fetcher,
  memoryPolicy = null,
}) {
  if (
    !context ||
    !Number.isFinite(outputGain) ||
    outputGain < 1 ||
    outputGain > 16 ||
    !(memory instanceof AudioMemory) ||
    !(transport instanceof Transport) ||
    !(registry instanceof InstrumentRegistry) ||
    !safe(framesPerBar) ||
    !framesPerBar ||
    !safe(endFrame) ||
    endFrame <= Math.ceil(context.currentTime * context.sampleRate) ||
    !Array.isArray(sampleIds) ||
    ![2, 3, 8].includes(sampleIds.length) ||
    new Set(sampleIds).size !== sampleIds.length
  )
    fail("invalidCaptureSource");
  const descriptors = sampleIds.map((id) =>
    registry.sample(bankId, bankVersion, id),
  );
  const drum = isDrumAssignment(bankId, bankVersion, sampleIds, descriptors);
  const melodic = isMelodicAssignment(
    bankId,
    bankVersion,
    sampleIds,
    descriptors,
  );
  if (
    descriptors.some((d) => d.sampleRate !== context.sampleRate) ||
    (!drum &&
      !melodic &&
      (sampleIds.length !== 2 ||
        descriptors.some(
          (d) =>
            d.channels !== 2 ||
            d.sampleRate !== context.sampleRate ||
            !["saron-barung", "slenthem"].includes(d.instrumentId),
        ) ||
        descriptors[0].instrumentId !== descriptors[1].instrumentId))
  )
    fail("invalidCaptureSource");
  const allocation = memory.reserve(
    drum || melodic ? 57344 : 40960,
    melodic
      ? "melodic-input/bus-carrier/three-voice-allowance/tokens"
      : drum
        ? "drum-input/bus-carrier/four-voices/tokens"
        : "instrument-input/bus-carrier/two-voices/tokens",
  );
  let leases = [],
    producer,
    cache,
    untrim;
  try {
    cache = new InstrumentSampleCache(context, registry, {
      memoryPolicy: memoryPolicy ?? memory.cachePolicy(context),
      ...(fetcher ? { fetcher } : {}),
    });
    untrim = memory.registerTrimmer(cache, () => cache.trim());
    const loaded = await Promise.allSettled(
      sampleIds.map((id) => cache.acquire(bankId, bankVersion, id, { signal })),
    );
    leases = loaded.filter((r) => r.status === "fulfilled").map((r) => r.value);
    const rejected = loaded.find((r) => r.status === "rejected");
    if (rejected) throw rejected.reason;
    if (signal?.aborted || context.state === "closed") fail("captureCancelled");
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(descriptors)),
    );
    const referenceSHA256 = [...new Uint8Array(digest)]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
    producer = Object.create(InstrumentInput.prototype);
    producer.initialize({
      context,
      transport,
      memory,
      cache,
      allocation,
      untrim,
      descriptors,
      leases,
      playbackScales: leases.map((l, i) => {
        const bank = registry.bank(bankId, bankVersion),
          base = gamelanPlaybackScale(bank, l.metrics.peak);
        const trusted = [
          "cdm-porto-recorded-candidate",
          "studio-original-synthesis",
          "freepats-recorded-plucked",
        ].includes(bank.setId);
        let trim = 1;
        if (trusted) {
          const meter = memory.reserve(
            PROGRAMME_SCRATCH_BYTES,
            "instrument-audition-meter",
          );
          try {
            const voices = drum
              ? DRUM_VOICES
              : melodic
                ? melodicPolicy(descriptors[0].instrumentId).voices
                : 2;
            const equivalent =
              base *
              descriptors[i].gainTrim *
              (drum
                ? 4
                : melodic
                  ? melodicPolicy(descriptors[0].instrumentId).liveLevel
                  : 1);
            trim = auditionGain(l.buffer, equivalent, 1, 0.8 / voices);
          } finally {
            meter.release();
          }
        }
        return (base * trim) / outputGain;
      }),
      framesPerBar,
      endFrame,
      referenceSHA256,
      live,
      drum,
      melodic: melodic ? melodicPolicy(descriptors[0].instrumentId) : null,
      voiceLimit: drum
        ? DRUM_VOICES
        : melodic
          ? melodicPolicy(descriptors[0].instrumentId).voices
          : 2,
    });
    return producer.source;
  } catch (error) {
    if (producer) await producer.close();
    else {
      for (const lease of leases) lease.release();
      cache?.trim();
      cache?.dispose();
      untrim?.();
      allocation.release();
    }
    throw error;
  }
}

class InstrumentInput {
  initialize(options) {
    Object.assign(this, options);
    this.rows = new Set();
    this.pendingRows = new Set();
    this.tokens = new Map();
    this.faults = new Set();
    this.generation = 0;
    this.accepting = false;
    this.closing = false;
    this.disposed = false;
    this.fault = null;
    this.carrierDone = deferred();
    this.started = null;
    this.releaseTime = null;
    this.startFrame = Math.ceil(
      this.context.currentTime * this.context.sampleRate,
    );
    this.onState = () => {
      if (this.context.state === "closed") {
        for (const r of [...this.rows]) r.voice?.disconnect();
        this.carrierDone.resolve();
      }
    };
    this.context.addEventListener("statechange", this.onState);
    if (this.endFrame <= this.startFrame) fail("invalidCaptureSource");
    this.bus = this.context.createGain();
    this.bus.gain.value = 1;
    this.bus.channelCount = 2;
    this.bus.channelCountMode = "explicit";
    this.carrier = this.context.createConstantSource();
    this.carrier.offset.value = 0;
    this.carrier.connect(this.bus);
    this.carrier.onended = () => {
      this.carrierEnded = true;
      this.carrierDone.resolve();
      if (!this.closing) this.lose("instrumentInputEnded");
    };
    this.held = new HeldPadInputs({
      activate: (id) => this.start(id, this.started),
      deactivate: (id, damp) => {
        if (!damp || this.activationFailed || this.drum) return;
        const when = this.releaseTime ?? this.context.currentTime;
        // Ownership belongs to the pad, including legal overlapping strikes.
        // Ending rows retain their own earlier damp and their native pins.
        for (const row of this.rows) if (row.id === id) row.voice?.damp(when);
      },
    });
    const p = this;
    this.source = Object.freeze({
      kind: this.live
        ? "live-stereo-instrument"
        : "continuous-stereo-instrument",
      channels: 2,
      context: this.context,
      memory: this.memory,
      sampleRate: this.context.sampleRate,
      framesPerBar: this.framesPerBar,
      preGain: true,
      estimatedBytes: 0,
      referenceSHA256: this.referenceSHA256,
      // Two producer sources, one declared zero topology carrier, one replay.
      voices: this.live ? 1 : this.voiceLimit + 2,
      producerVoices: this.voiceLimit + 1,
      peak:
        this.voiceLimit *
        (this.drum ? 1 : INSTRUMENT_LEVEL) *
        (this.melodic?.liveLevel ?? 1) *
        Math.max(
          ...this.leases.map(
            (l, i) =>
              l.metrics.peak *
              this.descriptors[i].gainTrim *
              this.playbackScales[i],
          ),
        ),
      descriptors: Object.freeze([...this.descriptors]),
      metrics: Object.freeze(this.leases.map((l) => l.metrics)),
      monitoring: this.live ? "selected-track" : "disabled",
      effects: Object.freeze([]),
      get generation() {
        return p.generation;
      },
      isCurrent: () => p.current(),
      prepare: (options) => p.prepare(options),
      press: (token, id, options) => p.press(token, id, options),
      release: (token, options) => p.release(token, options),
      strike: (id, options) => p.start(id, options),
      silence: () => p.silence(),
      observe: (node) => {
        if (node.context !== p.context || p.closing)
          fail("invalidCaptureSource");
        p.bus.connect(node);
        let connected = true;
        return () => {
          if (connected && !p.disposed && !p.closing) p.bus.disconnect(node);
          connected = false;
        };
      },
      onFault: (fn) => {
        if (typeof fn !== "function") fail("invalidCaptureSource");
        p.faults.add(fn);
        return () => p.faults.delete(fn);
      },
      invalidate: (reason) => p.lose(reason ?? "instrumentInputLost"),
      snapshot: () => ({
        generation: p.generation,
        accepting: p.accepting,
        fault: p.fault,
        closing: p.closing,
        disposed: p.disposed,
        tokens: [...p.tokens],
        voices: [...p.rows].map((r) => ({
          id: r.id,
          startFrame: r.startFrame,
          endFrame: Math.round(r.voice.end * p.context.sampleRate),
        })),
        carrierEnded: !!p.carrierEnded,
        cache: p.cache.snapshot(),
      }),
      dispose: () => {
        if (p.accepting) p.lose("instrumentInputDisposed");
        return p.close();
      },
    });
    branded.set(this.source, this);
  }
  current() {
    return (
      !this.closing &&
      !this.disposed &&
      !this.fault &&
      !this.carrierEnded &&
      this.context.state !== "closed" &&
      Math.ceil(this.context.currentTime * this.context.sampleRate) <
        this.endFrame
    );
  }
  lose(reason) {
    if (this.fault || this.closing) return;
    this.fault = { code: "instrumentInputLost", reason };
    this.generation++;
    this.accepting = false;
    for (const fn of [...this.faults]) {
      try {
        fn(this.fault);
      } catch {
        /* observers own no resource */
      }
    }
    this.stopVoices();
  }
  stopVoices() {
    this.accepting = false;
    this.tokens.clear();
    this.held?.clear({ damp: false });
    // Live failure/Stop must publish future gain automation, not an ambiguous
    // already-rendered current quantum. Keep every voice/pin through native
    // ended; future unstarted voices are still canceled immediately by stop().
    const at = this.live
      ? (Math.ceil(this.context.currentTime * this.context.sampleRate) +
          Math.ceil(0.05 * this.context.sampleRate)) /
        this.context.sampleRate
      : this.context.currentTime;
    for (const r of this.rows) r.voice?.stop(at);
  }
  async silence() {
    this.stopVoices();
    await Promise.all([...this.rows].map((r) => r.done.promise));
    if (this.live && this.current()) this.accepting = true;
  }
  activateMonitor({ destination, admitVoice }) {
    if (
      !this.live ||
      this.prepared ||
      !this.current() ||
      destination.context !== this.context ||
      typeof admitVoice !== "function"
    )
      fail("invalidCaptureSource");
    admitVoice();
    this.admitVoice = admitVoice;
    this.startFrame =
      Math.ceil(this.context.currentTime * this.context.sampleRate) +
      Math.ceil(0.05 * this.context.sampleRate);
    this.bus.connect(destination);
    this.carrier.start(this.startFrame / this.context.sampleRate);
    this.carrierStarted = true;
    this.prepared = true;
    this.accepting = true;
    return this.startFrame;
  }
  async prepare({ context, transport, memory, signal, plan, admitVoice }) {
    if (this.live) {
      if (
        !this.current() ||
        !this.prepared ||
        this.reader ||
        context !== this.context ||
        transport !== this.transport ||
        memory !== this.memory ||
        signal.aborted ||
        plan.startFrame < this.startFrame
      )
        fail("invalidCaptureSourceLease");
      admitVoice();
      this.reader = true;
      let released = false;
      return Object.freeze({
        input: this.bus,
        channels: 2,
        memory,
        generation: this.generation,
        startFrame: this.startFrame,
        endFrame: this.endFrame,
        release: () => {
          if (!released) {
            released = true;
            this.reader = false;
          }
        },
      });
    }
    if (
      !this.current() ||
      this.prepared ||
      context !== this.context ||
      transport !== this.transport ||
      memory !== this.memory ||
      typeof admitVoice !== "function" ||
      signal.aborted ||
      plan.startFrame < this.startFrame ||
      plan.endFrame > this.endFrame
    )
      fail("invalidCaptureSourceLease");
    admitVoice();
    this.prepared = true;
    this.accepting = true;
    this.admitVoice = admitVoice;
    this.abort = () => this.stopVoices();
    this.signal = signal;
    signal.addEventListener("abort", this.abort, { once: true });
    // The carrier is a reserved voice only AFTER root admission. Its valid
    // stereo horizon starts at a shared native future frame, before capture.
    this.startFrame =
      Math.ceil(context.currentTime * context.sampleRate) +
      Math.ceil(0.05 * context.sampleRate);
    try {
      this.carrier.start(this.startFrame / context.sampleRate);
      this.carrierStarted = true;
      this.carrier.stop(this.endFrame / context.sampleRate);
    } catch (error) {
      this.lose(error.code ?? "instrumentCarrierFailed");
      await this.close();
      throw error;
    }
    const p = this;
    return Object.freeze({
      input: this.bus,
      channels: 2,
      memory,
      generation: this.generation,
      startFrame: this.startFrame,
      endFrame: this.endFrame,
      release: () => p.close(),
    });
  }
  options(id, { when = this.context.currentTime + 0.05, velocity = 1 } = {}) {
    const index = this.descriptors.findIndex((d) => d.id === id),
      frame = Math.round(when * this.context.sampleRate);
    if (!this.current() || !this.accepting || this.context.state !== "running")
      fail("recordBusy");
    if (
      index < 0 ||
      !Number.isFinite(velocity) ||
      velocity <= 0 ||
      velocity > 1 ||
      !safe(frame) ||
      frame <
        Math.max(
          this.startFrame,
          Math.ceil(this.context.currentTime * this.context.sampleRate),
        ) ||
      frame + this.descriptors[index].frames > this.endFrame
    )
      fail("invalidInstrumentVoice");
    return { index, frame, velocity };
  }
  start(id, options) {
    const o = this.options(id, options);
    if (this.rows.size + this.pendingRows.size >= this.voiceLimit)
      fail("voiceLimit");
    const done = deferred(),
      row = {
        id,
        startFrame: o.frame,
        done,
        peak:
          this.leases[o.index].metrics.peak *
          this.descriptors[o.index].gainTrim *
          this.playbackScales[o.index] *
          (this.drum ? 1 : INSTRUMENT_LEVEL) *
          (this.melodic?.liveLevel ?? 1) *
          o.velocity,
      };
    // Publish a bounded pending ticket before calling admission, so a reentrant
    // request sees it. A refusal allocates no voice pin or native audio node.
    this.pendingRows.add(row);
    try {
      this.admitVoice();
    } finally {
      this.pendingRows.delete(row);
    }
    this.rows.add(row);
    let pin, trim;
    const release = () => {
      trim?.disconnect();
      pin?.release();
      this.rows.delete(row);
      done.resolve();
    };
    try {
      pin = this.leases[o.index].retain();
      if (this.drum) {
        row.voice = drumVoice(
          this.context,
          this.bus,
          pin.buffer,
          {
            ...this.descriptors[o.index],
            gainTrim:
              this.descriptors[o.index].gainTrim * this.playbackScales[o.index],
          },
          o.frame / this.context.sampleRate,
          o.velocity,
          release,
        );
        if (this.descriptors[o.index].pitchId === "closed-hat")
          for (const old of this.rows)
            if (
              old !== row &&
              old.startFrame <= o.frame &&
              this.descriptors.find((d) => d.id === old.id)?.pitchId ===
                "open-hat"
            )
              old.voice?.damp(o.frame / this.context.sampleRate);
        if (this.descriptors[o.index].pitchId === "open-hat")
          for (const next of this.rows)
            if (
              next !== row &&
              next.startFrame >= o.frame &&
              this.descriptors.find((d) => d.id === next.id)?.pitchId ===
                "closed-hat"
            )
              row.voice.damp(next.startFrame / this.context.sampleRate);
        return true;
      }
      trim = this.context.createGain();
      trim.gain.value =
        this.descriptors[o.index].gainTrim * this.playbackScales[o.index];
      trim.connect(this.bus);
      row.voice = instrumentVoice(
        this.context,
        trim,
        pin.buffer,
        o.frame / this.context.sampleRate,
        o.velocity * (this.melodic?.liveLevel ?? 1),
        {
          release,
          ...(this.melodic ? { releaseSeconds: this.melodic.release } : {}),
        },
      );
      return true;
    } catch (error) {
      release();
      this.lose(error.code ?? "instrumentVoiceFailed");
      throw error;
    }
  }
  press(token, id, options) {
    if (typeof token !== "string" || !token || token.length > 128)
      fail("invalidInstrumentVoice");
    this.options(id, options);
    if (this.tokens.has(token)) return false;
    if (this.tokens.size >= 16) fail("voiceLimit");
    const newPad = ![...this.tokens.values()].includes(id);
    if (newPad && this.rows.size >= this.voiceLimit) fail("voiceLimit");
    this.admitVoice(); // also protects adding physical owners to an existing pad
    this.started = options;
    try {
      this.held.press(token, id);
      this.tokens.set(token, id);
      return true;
    } catch (error) {
      this.activationFailed = true;
      try {
        this.held.release(token);
      } finally {
        this.activationFailed = false;
      }
      throw error;
    } finally {
      this.started = null;
    }
  }
  release(
    token,
    { when = this.context.currentTime + (this.melodic ? 0.05 : 0) } = {},
  ) {
    if (!this.tokens.has(token)) return false;
    if (
      !Number.isFinite(when) ||
      when < this.context.currentTime ||
      when * this.context.sampleRate > this.endFrame
    )
      fail("invalidInstrumentVoice");
    this.tokens.delete(token);
    this.releaseTime = when;
    try {
      return this.held.release(token);
    } finally {
      this.releaseTime = null;
    }
  }
  close() {
    if (this.closure) return this.closure;
    this.closing = true;
    this.stopVoices();
    this.signal?.removeEventListener("abort", this.abort);
    if (!this.carrierStarted || this.context.state === "closed") {
      for (const r of [...this.rows]) r.voice.disconnect();
      this.carrierDone.resolve();
    } else {
      try {
        this.carrier.stop(this.context.currentTime);
      } catch {
        /* wait for native ended/closed */
      }
    }
    this.closure = (async () => {
      await Promise.all([...this.rows].map((r) => r.done.promise));
      await this.carrierDone.promise;
      this.carrier?.disconnect();
      if (this.carrier) this.carrier.onended = null;
      this.bus?.disconnect();
      for (const lease of this.leases) lease.release();
      this.cache.trim();
      this.cache.dispose();
      this.untrim();
      this.allocation.release();
      this.context.removeEventListener("statechange", this.onState);
      this.faults.clear();
      this.disposed = true;
    })();
    return this.closure;
  }
}
