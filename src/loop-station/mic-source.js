import { AudioMemory } from "../audio/audio-memory.js";
import { Transport } from "../audio/transport.js";
import { fail } from "../project/instrument-contract.js";
import { installWorkletFrameClock } from "../audio/worklet-frame-clock.js";

const branded = new WeakMap();
const loaded = new WeakMap();
export const MIC_REPLAY_PEAK = 0.5;
export const MIC_MONITOR_PEAK = 0.125;
// Identity of the versioned live-input contract, not a hash of unknown audio.
export const MIC_CONTRACT_SHA256 =
  "c62077b344751435e76810dcd7379b137635f330c4c0f2c08ae9783c8266bab2";
export const micAssignment = (trackId) =>
  Object.freeze({
    format: "perkusi-mic-assignment",
    schemaVersion: 1,
    trackId,
    sampleIds: Object.freeze([]),
    origin: "original-local-input",
  });
export function micInputChannels(source, context, memory, transport) {
  const p = branded.get(source);
  if (!p) return null;
  if (
    p.context !== context ||
    p.memory !== memory ||
    p.transport !== transport ||
    !source.isCurrent()
  )
    fail("invalidCaptureSource");
  return source.channels;
}
export function closeMicSource(source) {
  return branded.get(source)?.close();
}
export function retireMicPreparation(source) {
  const p = branded.get(source);
  if (!p) fail("invalidCaptureSource");
  p.retirePreparation();
}
export function setMicMonitor(source, destination, enabled) {
  const p = branded.get(source);
  if (!p) fail("invalidCaptureSource");
  return p.monitor(destination, enabled);
}
export async function createMicSource({
  context,
  memory,
  transport,
  mic,
  framesPerBar,
  nodeFactory = (c, options) =>
    new AudioWorkletNode(c, "perkusi-mic-meter-v5", options),
  meterURL,
  signal,
}) {
  if (
    !(memory instanceof AudioMemory) ||
    !(transport instanceof Transport) ||
    mic.state !== "ready" ||
    context.state !== "running"
  )
    fail("micNotReady");
  const allocation = memory.reserve(
    51200 + 4096,
    "mic-source/meter/routes/bounded-scalar-receipts",
  );
  let bus,
    frameClock,
    meter,
    sink,
    timer,
    closed = false,
    released = false,
    generation = 0,
    fault = null,
    stats = null;
  const listeners = new Set();
  let monitorId = 0,
    monitorPending = null,
    monitorEnabled = false,
    monitorDestination = null;
  const monitor = (destination, enabled) => {
    if (
      closed ||
      fault ||
      context.state !== "running" ||
      monitorPending ||
      typeof enabled !== "boolean" ||
      destination?.context !== context
    )
      fail("recordBusy");
    if (monitorDestination && monitorDestination !== destination)
      fail("invalidCaptureSource");
    if (!monitorDestination) {
      meter.connect(destination);
      monitorDestination = destination;
    }
    return new Promise((resolve) => {
      const frame =
        Math.ceil(context.currentTime * context.sampleRate) +
        Math.ceil(0.05 * context.sampleRate);
      monitorPending = { id: ++monitorId, resolve, enabled, frame };
      meter.port.postMessage({
        type: "monitor",
        id: monitorId,
        enabled,
        frame,
      });
    });
  };
  let rejectProbe, confirmClosed;
  const meterClosed = new Promise((r) => {
    confirmClosed = r;
  });
  const cancelMonitor = () => {
    // Contain this optional output before cancellation/fault becomes visible.
    // A queued native Enable may still run, but cannot reconnect this route.
    // Keep the zero sink, raw capture bus and worker ownership intact.
    if (monitorDestination) {
      meter.disconnect(monitorDestination);
      monitorDestination = null;
    }
    monitorEnabled = false;
    const pending = monitorPending;
    monitorPending = null;
    pending?.resolve({ cancelled: true });
  };
  const lose = (reason) => {
    if (closed || fault) return;
    fault = Object.freeze({ code: "micInputLost", reason });
    generation++;
    cancelMonitor();
    rejectProbe?.(Object.assign(Error(reason), { code: reason }));
    for (const fn of listeners) fn(fault);
  };
  const clockLost = () => {
    if (closed || fault) return;
    lose("micClockDiscontinuity");
  };
  const close = async () => {
    if (released) return;
    if (closed && context.state !== "closed") fail("micCleanupUnconfirmed");
    closed = true;
    cancelMonitor();
    generation++;
    clearTimeout(timer);
    signal?.removeEventListener("abort", aborted);
    mic.close();
    bus?.disconnect();
    meter?.disconnect();
    sink?.disconnect();
    if (meter && context.state !== "closed") {
      meter.port.postMessage({ type: "stop" });
      let timeout, stateClosed;
      try {
        await Promise.race([
          meterClosed,
          new Promise((resolve) => {
            stateClosed = () => {
              if (context.state === "closed") resolve();
            };
            context.addEventListener?.("statechange", stateClosed);
            stateClosed();
          }),
          new Promise((_, reject) => {
            timeout = setTimeout(
              () =>
                reject(
                  Object.assign(Error("micCleanupUnconfirmed"), {
                    code: "micCleanupUnconfirmed",
                  }),
                ),
              3000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
        context.removeEventListener?.("statechange", stateClosed);
      }
    }
    meter?.port.close();
    frameClock?.dispose();
    allocation.release();
    released = true;
    listeners.clear();
  };
  const retirePreparation = () => signal?.removeEventListener("abort", aborted);
  // Cancellation belongs to the preparation operation, not to active input
  // failure. The owner checks the signal through installation and disposes it.
  const aborted = () => {
    if (closed || fault) return;
    fault = Object.freeze({
      code: "captureCancelled",
      reason: "captureCancelled",
    });
    generation++;
    cancelMonitor();
    rejectProbe?.(
      Object.assign(Error("captureCancelled"), { code: "captureCancelled" }),
    );
  };
  try {
    if (!loaded.has(context)) {
      const loading = (async () => {
        const url =
          meterURL ??
          (import.meta.env
            ? (await import("./mic-meter-worklet.js?worker&url")).default
            : import.meta.resolve("./mic-meter-worklet.js"));
        await context.audioWorklet.addModule(url);
      })().catch((e) => {
        loaded.delete(context);
        throw e;
      });
      loaded.set(context, loading);
    }
    await loaded.get(context);
    if (signal?.aborted || mic.state !== "ready") fail("captureCancelled");
    bus = context.createGain();
    bus.gain.value = 1;
    bus.channelCount = 2;
    bus.channelCountMode = "max";
    meter = nodeFactory(context, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCountMode: "max",
    });
    // Construction/clock/route failures still need the actual close receipt.
    meter.port.onmessage = ({ data }) => {
      if (data?.type === "closed") confirmClosed();
    };
    frameClock = installWorkletFrameClock(
      meter,
      context,
      Math.ceil(((context.currentTime + 0.05) * context.sampleRate) / 128) *
        128,
      null,
      clockLost,
    );
    sink = context.createGain();
    sink.gain.value = 0;
    bus.connect(meter);
    meter.connect(sink);
    sink.connect(context.destination);
    mic.connectCapture(bus);
    let channels;
    await new Promise((resolve, reject) => {
      rejectProbe = reject;
      timer = setTimeout(
        () =>
          reject(
            Object.assign(Error("micProbeTimeout"), {
              code: "micProbeTimeout",
            }),
          ),
        3000,
      );
      meter.port.onmessage = ({ data: d }) => {
        if (d?.type === "clock-error") {
          clockLost();
          return;
        }
        if (d?.type === "closed") {
          confirmClosed();
          return;
        }
        if (d?.type === "monitor-state") {
          if (
            !closed &&
            !fault &&
            monitorPending?.id === d.id &&
            d.enabled === monitorPending.enabled &&
            Number.isSafeInteger(d.frame) &&
            d.frame >= monitorPending.frame
          ) {
            monitorEnabled = d.enabled;
            const pending = monitorPending;
            monitorPending = null;
            pending.resolve(Object.freeze({ ...d }));
          }
          return;
        }
        if (closed || d?.type !== "meter") return;
        meter.port.postMessage({ type: "ack" });
        if (![1, 2].includes(d.channels)) {
          lose("micChannelsUnsupported");
          return;
        }
        if (d.changed || (channels && channels !== d.channels)) {
          lose("channelsChanged");
          return;
        }
        channels ??= d.channels;
        stats = Object.freeze({
          frame: d.frame,
          channels: d.channels,
          peak: d.peak,
          rms: d.rms,
          clips: d.clips,
          intervalClips: d.intervalClips,
          windowFrames: d.windowFrames,
          samples: d.samples,
          invalid: d.invalid,
          monitorGated: d.monitorGated === true,
        });
        if (d.invalid) {
          lose("invalidPCM");
          return;
        }
        clearTimeout(timer);
        resolve();
      };
      signal?.addEventListener("abort", aborted, { once: true });
    });
    rejectProbe = null;
    if (mic.state !== "ready" || signal?.aborted || fault)
      fail("captureCancelled");
    const source = Object.freeze({
      kind: "original-microphone-input",
      context,
      memory,
      transport,
      channels,
      sampleRate: context.sampleRate,
      framesPerBar,
      preGain: true,
      estimatedBytes: 0,
      voices: 1,
      producerVoices: 1,
      peak: MIC_REPLAY_PEAK,
      replayPeakLimit: MIC_REPLAY_PEAK,
      referenceSHA256: MIC_CONTRACT_SHA256,
      get monitoring() {
        return monitorEnabled ? "enabled" : "disabled";
      },
      descriptors: Object.freeze([]),
      get generation() {
        return generation;
      },
      isCurrent: () =>
        !closed &&
        !fault &&
        mic.state === "ready" &&
        context.state === "running",
      onFault(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      invalidate: lose,
      silence: () => Promise.resolve(),
      snapshot: () => ({
        accepting: !closed && !fault && mic.state === "ready",
        closing: closed && !released,
        disposed: released,
        fault,
        tokens: [],
        voices: [],
        meter: stats,
        muted: mic.muted,
        settings: mic.settings,
        monitoring: monitorEnabled ? "enabled" : "disabled",
        monitorPending: !!monitorPending,
      }),
      async prepare(options) {
        if (
          !source.isCurrent() ||
          options.context !== context ||
          options.memory !== memory ||
          options.transport !== transport ||
          options.signal?.aborted
        )
          fail("invalidCaptureSource");
        return {
          input: bus,
          channels,
          memory,
          generation,
          startFrame: Math.ceil(context.currentTime * context.sampleRate),
          endFrame: Number.MAX_SAFE_INTEGER,
          release: () => Promise.resolve(),
        };
      },
    });
    branded.set(source, {
      context,
      memory,
      transport,
      close,
      retirePreparation,
      monitor,
    });
    return source;
  } catch (e) {
    await close();
    throw e;
  }
}
