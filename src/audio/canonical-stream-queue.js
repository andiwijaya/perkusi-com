import { fail, integer } from "../project/instrument-contract.js";
import { installWorkletFrameClock } from "./worklet-frame-clock.js";

export async function installCanonicalStreamPlayer(context) {
  if (!context.audioWorklet) fail("canonicalStreamUnavailable");
  const url = import.meta.env
    ? (await import("./canonical-stream-processor.js?worker&url")).default
    : import.meta.resolve("./canonical-stream-processor.js");
  await context.audioWorklet.addModule(url);
}

// Caller owns the decoder/source producer and its exclusive native context.
// Chunks are allocated under individual tickets BEFORE production and really
// transferred. Tickets survive stop/fault until consumed/closed native receipt
// or actual context closure. No timeout or local disconnect proves retirement.
export function createCanonicalStreamQueue({
  context,
  destination,
  memory,
  produce,
  totalFrames = null,
  signal,
  nodeFactory = (context, options) =>
    new AudioWorkletNode(context, "canonical-pcm-stream", options),
} = {}) {
  if (
    ![44100, 48000].includes(context?.sampleRate) ||
    typeof produce !== "function" ||
    destination?.context !== context ||
    (totalFrames !== null && !integer(totalFrames, 1, Number.MAX_SAFE_INTEGER))
  )
    fail("invalidCanonicalStream");
  if (signal?.aborted) fail("cancelled");
  const lease = memory.reserve(
      16384,
      "canonical/stream-node-clock-and-control",
    ),
    pending = new Map();
  let node,
    clock,
    inflight = null,
    sent = 0,
    nextId = 0,
    consumed = 0,
    accepted = 0,
    received = 0,
    started = false,
    armed = false,
    endSent = false,
    stopping = false,
    closed = false,
    disposed = false,
    fault = null,
    origin = null,
    receipt = null,
    readySettled = false,
    doneSettled = false,
    refillRequested = false;
  let resolveReady,
    rejectReady,
    resolveDone,
    rejectDone,
    reportFault,
    resolveArmed,
    rejectArmed;
  // Notification and retirement are separate. Even a terminated processor
  // reports promptly after ready; this promise NEVER releases an allocation.
  const faulted = new Promise((resolve) => {
    reportFault = resolve;
  });
  const armedReady = new Promise((resolve, reject) => {
    resolveArmed = resolve;
    rejectArmed = reject;
  });
  armedReady.catch(() => {});
  const ready = new Promise((a, b) => {
      resolveReady = a;
      rejectReady = b;
    }),
    done = new Promise((a, b) => {
      resolveDone = a;
      rejectDone = b;
    });
  ready.catch(() => {});
  done.catch(() => {});
  function settleReady(error = null) {
    if (readySettled) return;
    readySettled = true;
    if (error) rejectReady(error);
    else resolveReady({ queuedFrames: sent });
  }
  function errorOf(code) {
    return Object.assign(Error(code), { code });
  }
  function requestStop(error = null) {
    fault ??= error;
    if (fault) reportFault(fault);
    if (!armed) rejectArmed(fault ?? errorOf("cancelled"));
    if (closed || stopping) return;
    stopping = true;
    settleReady(fault ?? errorOf("cancelled"));
    const start = Math.round(context.currentTime * context.sampleRate);
    try {
      node.port.postMessage(
        started
          ? {
              type: "stop",
              start,
              end: start + Math.round(0.02 * context.sampleRate),
            }
          : { type: "stop", immediate: true },
      );
    } catch (e) {
      fault ??= e;
      reportFault(fault);
    }
  }
  function finish(message) {
    if (closed) return;
    closed = true;
    receipt = message;
    if (message.fault) fault ??= errorOf(message.fault);
    if (fault) reportFault(fault);
    if (!armed) rejectArmed(fault ?? errorOf("cancelled"));
    for (const row of pending.values()) row.lease.release();
    pending.clear();
    settleReady(fault ?? errorOf("cancelled"));
    if (!doneSettled) {
      doneSettled = true;
      if (fault) rejectDone(fault);
      else resolveDone(message);
    }
  }
  function pump() {
    if (inflight) {
      refillRequested = true;
      return;
    }
    if (closed || stopping || disposed) return;
    const task = (async () => {
      while (
        !closed &&
        !stopping &&
        !disposed &&
        pending.size < (started ? 32 : 16)
      ) {
        if (totalFrames !== null && sent === totalFrames) {
          if (!endSent) {
            node.port.postMessage({ type: "end", frames: sent });
            endSent = true;
          }
          if (received === totalFrames) settleReady();
          break;
        }
        if (signal?.aborted) {
          requestStop(errorOf("cancelled"));
          break;
        }
        const frames = Math.min(
            4096,
            totalFrames === null ? 4096 : totalFrames - sent,
          ),
          held = memory.reserve(
            frames * 8 + 256,
            "canonical/transferred-stream-chunk",
          );
        let left,
          right,
          posted = false;
        try {
          left = new Float32Array(frames);
          right = new Float32Array(frames);
          await produce([left, right], { from: sent, signal });
          if (closed || stopping || disposed || signal?.aborted) {
            if (signal?.aborted) requestStop(errorOf("cancelled"));
            break;
          }
          const id = nextId;
          pending.set(id, {
            lease: held,
            frames,
            end: sent + frames,
            accepted: false,
          });
          node.port.postMessage(
            { type: "chunk", id, from: sent, left, right },
            [left.buffer, right.buffer],
          );
          posted = true;
          nextId++;
          sent += frames;
        } finally {
          // No native transfer happened: local producer references can be
          // retired when this awaited producer call has actually returned.
          if (!posted) {
            if (left?.byteLength === 0 || right?.byteLength === 0) {
              // An exceptional post may already have transferred ownership.
              pending.set(nextId, {
                lease: held,
                frames,
                end: sent + frames,
                accepted: false,
              });
            } else {
              pending.delete(nextId);
              left = right = null;
              held.release();
            }
          }
        }
      }
    })();
    inflight = task;
    task
      .catch((e) => requestStop(e))
      .finally(() => {
        inflight = null;
        if (refillRequested) {
          refillRequested = false;
          pump();
        }
      });
  }
  const onAbort = () => requestStop(errorOf("cancelled"));
  const onContextState = () => {
    if (context.state !== "closed" || closed) return;
    if (!stopping) requestStop(errorOf("canonicalStreamContextClosed"));
    finish({
      type: "context-closed",
      fault: fault?.code ?? null,
      renderedFrames: null,
    });
  };
  try {
    node = nodeFactory(context, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    node.port.onmessage = ({ data: m }) => {
      if (closed || disposed) return;
      if (m?.type === "accepted") {
        const row = pending.get(m.id);
        if (
          !row ||
          row.accepted ||
          m.id !== accepted ||
          m.received !== row.end
        ) {
          requestStop(errorOf("canonicalStreamReceipt"));
          return;
        }
        row.accepted = true;
        accepted++;
        received = m.received;
        if (accepted >= 16 || (endSent && received === totalFrames))
          settleReady();
      } else if (m?.type === "consumed") {
        const row = pending.get(m.id);
        if (!row?.accepted || m.id !== consumed || m.endFrame !== row.end) {
          requestStop(errorOf("canonicalStreamReceipt"));
          return;
        }
        pending.delete(m.id);
        row.lease.release();
        consumed++;
        pump();
      } else if (m?.type === "closed") {
        if (
          !integer(m.renderedFrames, 0, sent) ||
          !integer(m.acceptedChunks, consumed, nextId) ||
          m.consumedChunks !== consumed ||
          (!stopping &&
            !m.fault &&
            (totalFrames === null ||
              m.renderedFrames !== totalFrames ||
              m.acceptedChunks !== nextId))
        ) {
          requestStop(errorOf("canonicalStreamReceipt"));
          return;
        }
        finish(m);
      } else if (
        m?.type === "armed" &&
        started &&
        !armed &&
        m.origin === origin
      ) {
        armed = true;
        resolveArmed({ originFrame: origin });
      } else requestStop(errorOf("canonicalStreamReceipt"));
    };
    node.onprocessorerror = () =>
      requestStop(errorOf("canonicalStreamProcessorFault"));
    signal?.addEventListener("abort", onAbort, { once: true });
    context.addEventListener?.("statechange", onContextState);
    pump();
  } catch (e) {
    if (!node) {
      lease.release();
      throw e;
    }
    // An unpublished native node still needs actual retirement evidence.
    requestStop(e);
  }
  return Object.freeze({
    ready,
    done,
    faulted,
    armedReady,
    finishAt(frames) {
      if (
        closed ||
        stopping ||
        endSent ||
        totalFrames !== null ||
        !integer(frames, sent + 1, Number.MAX_SAFE_INTEGER)
      )
        fail("invalidCanonicalStreamEnd");
      totalFrames = frames;
      pump();
    },
    start() {
      if (disposed || closed || stopping || started || !readySettled || fault)
        fail("canonicalStreamNotReady");
      origin =
        Math.ceil(
          (context.currentTime * context.sampleRate +
            0.08 * context.sampleRate) /
            128,
        ) * 128;
      try {
        clock = installWorkletFrameClock(
          node,
          context,
          origin,
          null,
          requestStop,
        );
        started = true;
        node.port.postMessage({ type: "arm", origin });
        node.connect(destination);
        pump();
        return origin;
      } catch (e) {
        requestStop(e);
        throw e;
      }
    },
    stop: () => requestStop(),
    snapshot: () => ({
      sentFrames: sent,
      receivedFrames: received,
      sentChunks: nextId,
      consumedChunks: consumed,
      pendingChunks: pending.size,
      started,
      armed,
      stopping,
      closed,
      disposed,
      originFrame: origin,
      fault: fault?.code ?? fault?.message ?? null,
      receipt,
    }),
    async dispose() {
      if (disposed) return;
      requestStop();
      if (!closed && context.state !== "closed")
        fail("canonicalStreamStillOwned");
      if (!closed)
        finish({
          type: "context-closed",
          fault: fault?.code ?? null,
          renderedFrames: null,
        });
      await inflight?.catch(() => {});
      disposed = true;
      signal?.removeEventListener("abort", onAbort);
      context.removeEventListener?.("statechange", onContextState);
      clock?.dispose();
      node.onprocessorerror = null;
      node.disconnect();
      node.port.onmessage = null;
      node.port.close();
      lease.release();
    },
  });
}
