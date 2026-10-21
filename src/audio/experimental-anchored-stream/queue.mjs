/* global AudioWorkletNode, setTimeout, clearTimeout */
import {
  identity as validateIdentity,
  sameIdentity,
  integer,
  fail,
  MAX_BLOCK,
} from "./protocol.mjs";

export async function installAnchoredStreamPlayer(context) {
  if (!context?.audioWorklet) fail("canonicalStreamUnavailable");
  // Existing R18 worker-packaging convention; queue behavior is unchanged R2.
  const url = import.meta.env
    ? (await import("./worklet.mjs?worker&url")).default
    : import.meta.resolve("./worklet.mjs");
  await context.audioWorklet.addModule(url);
}

// Prototype API: asynchronous ARM/ACK, deliberately not a drop-in product backend.
// Producer/memory transfer and retirement rules derive from frozen R18.
export function createAnchoredStreamQueue({
  context,
  destination,
  memory,
  produce,
  totalFrames = null,
  signal,
  identity: providedIdentity,
  programmeOffset = 0,
  nodeFactory = (c, o) =>
    new AudioWorkletNode(c, "prototype-anchored-stream", o),
} = {}) {
  const id = validateIdentity(providedIdentity),
    rate = context?.sampleRate;
  if (
    ![44100, 48000].includes(rate) ||
    typeof produce !== "function" ||
    destination?.context !== context ||
    !integer(programmeOffset, 0, Number.MAX_SAFE_INTEGER - MAX_BLOCK) ||
    (totalFrames !== null &&
      (!integer(totalFrames, 1) || !integer(programmeOffset + totalFrames)))
  )
    fail("invalidCanonicalStream");
  if (signal?.aborted) fail("cancelled");
  const lease = memory.reserve(
      16384,
      "prototype/stream-node-anchor-and-control",
    ),
    pending = new Map();
  let node,
    inflight = null,
    sent = 0,
    nextId = 0,
    consumed = 0,
    accepted = 0,
    received = 0,
    nativeReady = false,
    startRequested = false,
    armed = false,
    gateScheduled = false,
    activated = false,
    endSent = false,
    stopping = false,
    closed = false,
    disposed = false,
    fault = null,
    origin = null,
    receipt = null,
    readySettled = false,
    doneSettled = false,
    refillRequested = false,
    pauseExpected = false,
    staleReceived = 0,
    disposeTask = null;
  let resolveReady,
    rejectReady,
    resolveDone,
    rejectDone,
    reportFault,
    resolveArmed,
    rejectArmed;
  const faulted = new Promise((r) => (reportFault = r)),
    armedReady = new Promise((a, b) => {
      resolveArmed = a;
      rejectArmed = b;
    }),
    ready = new Promise((a, b) => {
      resolveReady = a;
      rejectReady = b;
    }),
    done = new Promise((a, b) => {
      resolveDone = a;
      rejectDone = b;
    });
  armedReady.catch(() => {});
  ready.catch(() => {});
  done.catch(() => {});
  const errorOf = (code) => Object.assign(Error(code), { code });
  const post = (m, transfer = []) =>
    node.port.postMessage({ ...m, identity: id }, transfer);
  function settleReady(error = null) {
    if (readySettled) return;
    readySettled = true;
    if (error) rejectReady(error);
    else resolveReady({ queuedFrames: sent, identity: id, gateInactive: true });
  }
  function maybeReady() {
    if (
      nativeReady &&
      (accepted >= 16 || (endSent && received === totalFrames))
    )
      settleReady();
  }
  function requestStop(error = null) {
    fault ??= error;
    if (fault) reportFault(fault);
    if (!armed) rejectArmed(fault ?? errorOf("cancelled"));
    if (closed || stopping) return;
    stopping = true;
    settleReady(fault ?? errorOf("cancelled"));
    const start = Math.round(context.currentTime * rate);
    try {
      post(
        gateScheduled
          ? { type: "stop", start, end: start + Math.round(0.02 * rate) }
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
        pending.size < (gateScheduled ? 32 : 16)
      ) {
        if (totalFrames !== null && sent === totalFrames) {
          if (!endSent) {
            post({ type: "end", frames: sent });
            endSent = true;
          }
          maybeReady();
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
          await produce([left, right], { from: sent, signal, programmeOffset });
          if (closed || stopping || disposed || signal?.aborted) {
            if (signal?.aborted) requestStop(errorOf("cancelled"));
            break;
          }
          pending.set(nextId, {
            lease: held,
            frames,
            end: sent + frames,
            accepted: false,
          });
          post({ type: "chunk", id: nextId, from: sent, left, right }, [
            left.buffer,
            right.buffer,
          ]);
          posted = true;
          nextId++;
          sent += frames;
        } finally {
          if (!posted) {
            if (left?.byteLength === 0 || right?.byteLength === 0)
              pending.set(nextId, {
                lease: held,
                frames,
                end: sent + frames,
                accepted: false,
              });
            else {
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
    if (closed) return;
    if (context.state === "closed") {
      if (!stopping) requestStop(errorOf("canonicalStreamContextClosed"));
      finish({
        type: "context-closed",
        identity: id,
        fault: fault?.code ?? null,
        renderedFrames: null,
      });
    } else if (
      startRequested &&
      context.state !== "running" &&
      !(pauseExpected && context.state === "suspended")
    ) {
      invalidate("anchoredContextInterrupted");
    }
  };
  function invalidate(code = "anchoredContinuityInvalidated") {
    if (closed || stopping) return;
    fault ??= errorOf(code);
    reportFault(fault);
    stopping = true;
    settleReady(fault);
    if (!armed) rejectArmed(fault);
    try {
      post({ type: "invalidate" });
    } catch (e) {
      reportFault(fault ?? e);
    }
  }
  try {
    node = nodeFactory(context, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { identity: id, rate },
    });
    node.port.onmessage = ({ data: m }) => {
      if (closed || disposed) return;
      if (!sameIdentity(m?.identity, id)) {
        if (staleReceived < Number.MAX_SAFE_INTEGER) staleReceived++;
        return;
      }
      if (m.type === "ready") {
        if (nativeReady || m.rate !== rate || m.gateInactive !== true) {
          requestStop(errorOf("anchoredReady"));
          return;
        }
        nativeReady = true;
        maybeReady();
      } else if (m.type === "accepted") {
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
        maybeReady();
      } else if (m.type === "consumed") {
        const row = pending.get(m.id);
        if (!row?.accepted || m.id !== consumed || m.endFrame !== row.end) {
          requestStop(errorOf("canonicalStreamReceipt"));
          return;
        }
        pending.delete(m.id);
        row.lease.release();
        consumed++;
        pump();
      } else if (m.type === "armed") {
        if (
          !startRequested ||
          armed ||
          m.origin !== origin ||
          m.programmeOffset !== programmeOffset
        ) {
          requestStop(errorOf("anchoredAck"));
          return;
        }
        armed = true;
        resolveArmed({ originFrame: origin, identity: id });
      } else if (m.type === "started") {
        if (
          !gateScheduled ||
          activated ||
          m.origin !== origin ||
          m.programmeOffset !== programmeOffset ||
          !integer(m.sampleIndex, 0, MAX_BLOCK - 1)
        ) {
          requestStop(errorOf("anchoredActivation"));
          return;
        }
        activated = true;
      } else if (m.type === "closed") {
        if (
          !integer(m.renderedFrames, 0, sent) ||
          !integer(m.acceptedChunks, consumed, nextId) ||
          m.consumedChunks !== consumed ||
          (m.frame !== null &&
            (!integer(m.frame) ||
              origin === null ||
              m.frame !== origin + m.renderedFrames)) ||
          m.programmeEndFrame !==
            (origin === null ? null : programmeOffset + m.renderedFrames) ||
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
      } else if (m.type !== "stale-rejected")
        requestStop(errorOf("canonicalStreamReceipt"));
    };
    node.onprocessorerror = () =>
      requestStop(errorOf("canonicalStreamProcessorFault"));
    signal?.addEventListener("abort", onAbort, { once: true });
    context.addEventListener?.("statechange", onContextState);
    node.connect(destination);
    pump();
  } catch (e) {
    if (!node) {
      lease.release();
      throw e;
    }
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
        !integer(frames, sent + 1) ||
        !integer(programmeOffset + frames)
      )
        fail("invalidCanonicalStreamEnd");
      totalFrames = frames;
      pump();
    },
    async start({ originFrame = null, leadSeconds = 0.08 } = {}) {
      if (
        disposed ||
        closed ||
        stopping ||
        startRequested ||
        !readySettled ||
        !nativeReady ||
        fault ||
        context.state !== "running"
      )
        fail("canonicalStreamNotReady");
      if (!Number.isFinite(leadSeconds) || leadSeconds <= 0)
        fail("anchoredLead");
      const candidateOrigin =
        originFrame ?? Math.ceil((context.currentTime + leadSeconds) * rate);
      if (
        !integer(candidateOrigin, 0, Number.MAX_SAFE_INTEGER - MAX_BLOCK) ||
        candidateOrigin / rate <= context.currentTime
      )
        fail("anchoredOrigin");
      origin = candidateOrigin;
      startRequested = true;
      let timer;
      try {
        const timeout = new Promise(
          (_, reject) =>
            (timer = setTimeout(
              () => reject(errorOf("anchoredAckTimeout")),
              1000,
            )),
        );
        post({ type: "arm", origin, programmeOffset });
        await Promise.race([armedReady, timeout]);
        if (closed || stopping || disposed || signal?.aborted)
          throw fault ?? errorOf("cancelled");
        if (context.state !== "running" || origin / rate <= context.currentTime)
          throw errorOf("anchoredAckLate");
        const gate = node.parameters.get("startGate");
        if (!gate || gate.automationRate !== "a-rate")
          throw errorOf("anchoredGateUnavailable");
        gate.setValueAtTime(1, origin / rate);
        gateScheduled = true;
        // Submission can consume the remaining lead without throwing. Keep
        // the submitted event/origin intact, but retire this generation if
        // the observable postcondition is lost. Already emitted PCM cannot
        // be retracted; no catch-up, retry or rebase is attempted.
        if (
          closed ||
          stopping ||
          disposed ||
          signal?.aborted ||
          context.state !== "running" ||
          origin / rate <= context.currentTime
        ) {
          const error =
            fault ??
            errorOf(
              origin / rate <= context.currentTime
                ? "anchoredGateDeadlineLost"
                : "anchoredGateIneligible",
            );
          invalidate(error.code ?? "anchoredGateIneligible");
          throw error;
        }
        pump();
        return origin;
      } catch (e) {
        // Explicit Stop cancels the pending start without becoming a playback
        // fault. Abort, timeout and native/API faults retain their own cause.
        if (!(stopping && !fault && e.code === "cancelled")) requestStop(e);
        throw e;
      } finally {
        clearTimeout(timer);
      }
    },
    async pause() {
      if (
        !gateScheduled ||
        closed ||
        stopping ||
        pauseExpected ||
        context.state !== "running"
      )
        fail("anchoredPauseState");
      pauseExpected = true;
      try {
        await context.suspend();
      } catch (e) {
        invalidate("anchoredPauseFailed");
        throw e;
      }
    },
    async resume() {
      if (!pauseExpected || closed || stopping || context.state !== "suspended")
        fail("anchoredResumeState");
      try {
        await context.resume();
        pauseExpected = false;
      } catch (e) {
        invalidate("anchoredResumeFailed");
        throw e;
      }
    },
    invalidate: () => invalidate(),
    stop: () => requestStop(),
    snapshot: () => ({
      identity: id,
      syncScope: "LOCAL_CALLBACK_COUNT_ONLY",
      sentFrames: sent,
      receivedFrames: received,
      sentChunks: nextId,
      consumedChunks: consumed,
      pendingChunks: pending.size,
      nativeReady,
      startRequested,
      armed,
      gateScheduled,
      activated,
      stopping,
      closed,
      disposed,
      originFrame: origin,
      programmeOffset,
      pauseExpected,
      staleReceived,
      fault: fault?.code ?? fault?.message ?? null,
      receipt,
    }),
    async dispose() {
      if (disposed) return;
      if (disposeTask) return disposeTask;
      requestStop();
      if (!closed && context.state !== "closed")
        fail("canonicalStreamStillOwned");
      if (!closed)
        finish({
          type: "context-closed",
          identity: id,
          fault: fault?.code ?? null,
          renderedFrames: null,
        });
      disposeTask = (async () => {
        await inflight?.catch(() => {});
        disposed = true;
        signal?.removeEventListener("abort", onAbort);
        context.removeEventListener?.("statechange", onContextState);
        node.onprocessorerror = null;
        node.disconnect();
        node.port.onmessage = null;
        node.port.close();
        lease.release();
      })();
      return disposeTask;
    },
  });
}
