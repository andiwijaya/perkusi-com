import { AudioMemory } from "../audio/audio-memory.js";
import { LoopClock } from "./loop-clock.js";
import { TakePool } from "./take-pool.js";
import { waveformSlice } from "./waveform.js";
import { integer, fail } from "../project/instrument-contract.js";

const loaded = new WeakMap();
const constructionToken = Symbol("owned-capture-session");
async function load(context, url) {
  let modules = loaded.get(context);
  if (!modules) {
    modules = new Map();
    loaded.set(context, modules);
  }
  if (!modules.has(url)) {
    const promise = context.audioWorklet.addModule(url).catch((e) => {
      modules.delete(url);
      throw e;
    });
    modules.set(url, promise);
  }
  await modules.get(url);
}

// Opt-in low-level prototype. Caller supplies the shared context/transport,
// AudioMemory, existing master destination and compiled self-origin worklet URL.
export class CaptureSession {
  #context;
  #pool;
  #node;
  #workerLease;
  #reservation;
  #arrays;
  #received = 0;
  #sequence = 0;
  #finished = false;
  #closed = false;
  #resolveReady;
  #resolveClosed;
  #stateListener;
  #signal;
  #abortListener;
  #stopping = false;
  #playbackOutcome = null;
  #resolvePlaybackFault;
  #interruptionReason = null;
  constructor(token) {
    if (token !== constructionToken) fail("useCaptureSessionOpen");
  }
  static async open({
    clock,
    memory,
    pool,
    destination,
    moduleURL,
    channels = 1,
    plan,
    bars = 1,
    countInBars = 1,
    signal,
    replayPeakLimit,
    nodeFactory = (c, o) =>
      new AudioWorkletNode(c, "perkusi-loop-capture-v5", o),
  }) {
    if (
      !(clock instanceof LoopClock) ||
      !(memory instanceof AudioMemory) ||
      !(pool instanceof TakePool) ||
      !pool.usesMemory(memory) ||
      ![1, 2].includes(channels) ||
      !moduleURL ||
      destination?.context !== clock.context ||
      clock.context.state !== "running"
    )
      fail("invalidCaptureSession");
    const context = clock.context;
    if (signal?.aborted) fail("captureCancelled");
    if (!context.audioWorklet) fail("workletUnavailable");
    const url = new URL(moduleURL, import.meta.url);
    if (globalThis.location && url.origin !== location.origin)
      fail("externalCaptureModule");
    await load(context, url.href);
    if (signal?.aborted) fail("captureCancelled");
    plan ??= clock.plan({ bars, countInBars });
    if (
      context.state !== "running" ||
      plan.sampleRate !== context.sampleRate ||
      !integer(
        plan.startFrame,
        Math.ceil(context.currentTime * context.sampleRate) + 1,
        Number.MAX_SAFE_INTEGER,
      ) ||
      !integer(
        plan.endFrame,
        plan.startFrame + 1,
        plan.startFrame + context.sampleRate * 32,
      )
    )
      fail("captureStartMissed");
    const capacity = plan.endFrame - plan.startFrame;
    const session = new CaptureSession(constructionToken);
    session.#context = context;
    session.#pool = pool;
    session.plan = Object.freeze({ ...plan });
    session.channels = channels;
    session.ready = new Promise((r) => {
      session.#resolveReady = r;
    });
    session.closed = new Promise((r) => {
      session.#resolveClosed = r;
    });
    session.playbackFault = new Promise((r) => {
      session.#resolvePlaybackFault = r;
    });
    session.state = "armed";
    try {
      session.#reservation = pool.reserve({
        capacity,
        channels,
        sampleRate: context.sampleRate,
      });
      session.#workerLease = memory.reserve(
        capacity * channels * 4 + 2 * 4096 * channels * 4 + 8192,
        "loop-worklet-window/transfer/nodes",
      );
      session.#arrays = Array.from(
        { length: channels },
        () => new Float32Array(capacity),
      );
      session.#node = nodeFactory(context, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [channels],
        channelCountMode: "max",
        processorOptions: {
          startFrame: plan.startFrame,
          endFrame: plan.endFrame,
          sampleRate: context.sampleRate,
          channels,
          replayPeakLimit,
        },
      });
      session.#node.port.onmessage = (e) => session.#message(e.data);
      session.#node.addEventListener(
        "processorerror",
        () => {
          session.#finish("processorError", "processor-terminated-prefix");
          session.#releaseWorker();
        },
        { once: true },
      );
      session.#node.connect(destination);
      session.#stateListener = () => {
        if (context.state === "closed") {
          session.#finish(
            session.#interruptionReason ?? "closed",
            "confirmed-context-close-prefix",
          );
          session.#releaseWorker();
        } else if (context.state !== "running") {
          // Suspension stops rendering, not delivery of already-produced PCM.
          // Keep the original reserved arrays until the ordered flush/closed
          // receipt (or confirmed context close) makes publication terminal.
          session.#interruptionReason ??= "suspended";
          session.stop("suspended");
        }
      };
      context.addEventListener("statechange", session.#stateListener);
      session.#signal = signal;
      session.#abortListener = () => session.stop("userStop");
      signal?.addEventListener("abort", session.#abortListener, { once: true });
      return session;
    } catch (e) {
      session.#node?.disconnect();
      session.#node?.port.close();
      pool.cancel(session.#reservation);
      session.#workerLease?.release();
      throw e;
    }
  }
  get input() {
    return this.#node;
  }
  get acknowledgedFrames() {
    return this.#received;
  }
  get playbackOutcome() {
    return this.#playbackOutcome;
  }
  waveform(fromFrame = 0) {
    if (this.take) return this.#pool.waveform(this.take.id, fromFrame);
    return waveformSlice({
      capacity: this.plan.endFrame - this.plan.startFrame,
      frames: this.#received,
      channels: this.channels,
      fromFrame,
      sample: (c, f) => this.#arrays[c][f],
    });
  }
  #message(data) {
    if (this.#closed) return;
    if (data?.type === "playback-error" && !this.#playbackOutcome) {
      const frame = (n) => n === null || integer(n, 0, Number.MAX_SAFE_INTEGER),
        expected = data.previousFrame + data.previousBlockSize;
      if (
        data.code !== "replayFrameDiscontinuity" ||
        !frame(data.expectedFrame) ||
        !frame(data.observedFrame) ||
        !integer(data.previousFrame, 0, Number.MAX_SAFE_INTEGER) ||
        !integer(data.previousBlockSize, 1, 16384) ||
        !integer(data.blockSize, 0, 4294967295) ||
        data.expectedFrame !==
          (Number.isSafeInteger(expected) ? expected : null) ||
        (data.observedFrame !== null &&
          data.expectedFrame !== null &&
          data.observedFrame === data.expectedFrame &&
          integer(data.blockSize, 1, 16384) &&
          Number.isSafeInteger(data.observedFrame + data.blockSize))
      ) {
        this.#finish("protocolError");
        this.stop();
        return;
      }
      this.#playbackOutcome = Object.freeze({
        code: data.code,
        expectedFrame: data.expectedFrame,
        observedFrame: data.observedFrame,
        blockSize: data.blockSize,
        previousFrame: data.previousFrame,
        previousBlockSize: data.previousBlockSize,
      });
      this.#resolvePlaybackFault(this.#playbackOutcome);
      this.#stopping = true;
      this.state = "error";
      this.#node.disconnect();
    } else if (data?.type === "started") {
      if (
        !this.#finished &&
        !this.#stopping &&
        data.frame === this.plan.startFrame
      )
        this.state = "recording";
    } else if (data?.type === "pcm") {
      if (this.#finished) {
        // No receipt may be acknowledged after immutable publication. A valid
        // worker emits all PCM before complete; extra PCM is a protocol fault.
        this.stop();
        return;
      }
      try {
        if (
          data.sequence !== this.#sequence ||
          data.offset !== this.#received ||
          !integer(data.frames, 1, 4096) ||
          this.#received + data.frames > this.#reservation.capacity ||
          !Array.isArray(data.buffers) ||
          data.buffers.length !== this.channels ||
          data.buffers.some(
            (b) =>
              !(b instanceof ArrayBuffer) || b.byteLength !== data.frames * 4,
          )
        )
          fail("invalidCaptureReceipt");
        for (const b of data.buffers)
          for (const v of new Float32Array(b))
            if (!Number.isFinite(v)) fail("invalidCaptureReceipt");
        for (let c = 0; c < this.channels; c++)
          this.#arrays[c].set(
            new Float32Array(data.buffers[c]),
            this.#received,
          );
        this.#received += data.frames;
        this.#sequence++;
        if (!this.#stopping) this.state = "recording";
        this.#node.port.postMessage({ type: "ack", sequence: data.sequence });
      } catch {
        this.#finish("protocolError");
        this.stop();
      }
    } else if (data?.type === "complete" && !this.#finished) {
      if (
        data.frames !== this.#received ||
        data.startFrame !== this.plan.startFrame ||
        data.sampleRate !== this.plan.sampleRate ||
        data.channels !== this.channels ||
        data.endFrame !== this.plan.endFrame ||
        data.capacity !== this.#reservation.capacity ||
        ![
          "complete",
          "userStop",
          "inputLost",
          "suspended",
          "closed",
          "invalidBlock",
          "frameGap",
          "channelsChanged",
          "invalidPCM",
          "unsafeReplay",
        ].includes(data.reason) ||
        !Array.isArray(data.blockSizes) ||
        data.blockSizes.length > 32 ||
        data.blockSizes.some((n) => !integer(n, 1, 16384)) ||
        (data.reason === "complete" &&
          data.frames !== this.#reservation.capacity)
      ) {
        this.#finish("protocolError");
        this.stop();
      } else {
        this.blockSizes = Object.freeze([...data.blockSizes]);
        this.#finish(
          this.#interruptionReason ?? data.reason,
          "worker-complete",
          data.reason,
        );
      }
    } else if (data?.type === "closed") {
      if (!this.#finished)
        this.#finish(
          this.#interruptionReason ?? "processorClosed",
          "worker-closed-prefix",
        );
      this.#releaseWorker();
    }
  }
  #finish(
    reason,
    deliveryProof = "protocol-error-prefix",
    workerReason = null,
  ) {
    if (this.#finished) return;
    this.#finished = true;
    this.outcome = Object.freeze({
      reason,
      frames: this.#received,
      startFrame: this.plan.startFrame,
      sampleRate: this.plan.sampleRate,
      partial: reason !== "complete",
      persistence: "memory-only",
      deliveryProof,
      workerFlushConfirmed: deliveryProof === "worker-complete",
      workerReason,
    });
    let take = null;
    try {
      if (this.#received)
        take = this.#pool.adopt(
          this.#reservation,
          {
            ...this.#reservation,
            startFrame: this.plan.startFrame,
            frames: this.#received,
            reason,
          },
          this.#arrays.map((c) => c.buffer),
        );
      else this.#pool.cancel(this.#reservation);
      this.take = take;
      this.state = this.#playbackOutcome
        ? "error"
        : this.#stopping
          ? "closing"
          : reason === "complete"
            ? "looping"
            : "partial";
    } catch {
      this.#pool.cancel(this.#reservation);
      // A normal-complete worker is already repeating its private PCM window.
      // Failed adoption must not leave that unretained loop routed to output.
      // stop() only requests close; the worker lease stays held until its ack.
      this.stop();
      this.state = "error";
      this.outcome = Object.freeze({
        ...this.outcome,
        reason: "takeAdoptionFailed",
        captureReason: reason,
      });
    }
    this.#arrays = null;
    this.#resolveReady(take);
  }
  stop(reason = "userStop") {
    if (this.#closed || this.#stopping) return this.closed;
    this.#stopping = true;
    this.state = "closing";
    this.#node.port.postMessage({ type: "stop", reason });
    this.#node.disconnect(); // Input monitoring stays disconnected, even on suspend.
    return this.closed;
  }
  #releaseWorker() {
    if (this.#closed) return;
    this.#closed = true;
    this.#context.removeEventListener("statechange", this.#stateListener);
    this.#signal?.removeEventListener("abort", this.#abortListener);
    this.#node?.disconnect();
    this.#node?.port.close();
    this.#workerLease?.release();
    this.#workerLease = null;
    this.state = "closed";
    this.#resolvePlaybackFault(null);
    this.#resolveClosed();
  }
}
