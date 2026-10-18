import { sameTailIdentity } from "./finite-tail-core.js";
import { fail } from "../project/instrument-contract.js";
const safe = (n) => Number.isSafeInteger(n) && n >= 0;
export const finiteMixSignature = (project) =>
  JSON.stringify({
    master: project.master,
    tracks: project.tracks.map((t) => ({
      id: t.id,
      gain: t.gain,
      pan: t.pan,
      mute: t.mute,
      solo: t.solo,
      eq: t.eq ?? null,
    })),
  });
export const finiteTailBytes = (project) =>
  32768 + 16 * finiteMixSignature(project).length;

// The caller epoch reserves this worker before construction, and owns it even
// if construction/processor state is unknown. No timeout can prove closure.
export function startFiniteTail({
  context,
  identity,
  input,
  output,
  onRelease,
  onFault,
  nodeFactory,
}) {
  let node,
    timer,
    ready = false,
    body = null,
    bodyText = null,
    eof = null,
    released = false,
    controlled = false,
    fault = null;
  const snapshot = () =>
    Object.freeze({
      identity,
      kind: fault
        ? "unverified"
        : controlled
          ? "controlled"
          : released && body?.reason === "complete" && eof
            ? "verified"
            : "pending",
      fault,
      ready,
      body,
      closed: !!eof,
      released,
      confirmedContextClose: released && !eof,
    });
  const latch = () => {
    if (fault || released || controlled) return;
    fault = "recordingLoopCompletionUnverified";
    onFault({ code: fault });
  };
  const release = () => {
    if (released) return;
    if (node && context.state !== "closed") {
      try {
        input.disconnect(node);
        node.disconnect();
      } catch {
        latch();
        return;
      }
    }
    released = true;
    clearTimeout(timer);
    if (context.state === "closed") node?.disconnect();
    node?.port.close();
    onRelease();
  };
  const valid = (b) =>
    b &&
    safe(b.writtenFrames) &&
    b.writtenFrames <= identity.endFrame - identity.startFrame &&
    b.channelWrites === 2 * b.writtenFrames &&
    b.firstWriteFrame === (b.writtenFrames ? identity.startFrame : null) &&
    b.lastWriteFrameExclusive === identity.startFrame + b.writtenFrames &&
    b.bodyOutputFrames ===
      Math.min(b.writtenFrames, identity.bodyEndFrame - identity.startFrame) &&
    b.tailOutputFrames === b.writtenFrames - b.bodyOutputFrames;
  const complete = (b) =>
    valid(b) &&
    b.reason === "complete" &&
    b.writtenFrames === identity.endFrame - identity.startFrame &&
    b.tailOutputFrames === 4800 &&
    b.control === null &&
    safe(b.processBlocks) &&
    b.processBlocks > 0 &&
    safe(b.firstProcessFrame) &&
    b.firstProcessFrame <= identity.startFrame &&
    safe(b.lastProcessFrame) &&
    safe(b.lastBlockSize) &&
    b.lastBlockSize > 0 &&
    b.lastBlockSize <= 16384 &&
    b.lastProcessFrame < identity.endFrame &&
    b.nextFrame === b.lastProcessFrame + b.lastBlockSize &&
    b.nextFrame >= identity.endFrame &&
    b.observedFrame === identity.endFrame;
  const command = (mode, atFrame, fadeFrames) => {
    controlled = true;
    if (released) return;
    if (context.state === "closed") return release();
    node?.port.postMessage({
      type: "cancel",
      identity,
      mode,
      atFrame,
      fadeFrames,
    });
  };
  const voice = Object.freeze({
    snapshot,
    confirmClose: release,
    markControlled() {
      controlled = true;
    },
    drain(endFrame) {
      command("drain", endFrame, 0);
    },
    fade() {
      command(
        "fade",
        Math.min(identity.endFrame, Math.round(context.currentTime * 48000)),
        960,
      );
    },
    disconnect() {
      if (context.state !== "closed") fail("loopClosePending");
      release();
    },
  });
  try {
    input.disconnect(output);
    node = (
      nodeFactory ??
      ((c, options) =>
        new AudioWorkletNode(c, "perkusi-finite-tail-v5", options))
    )(context, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { identity },
    });
    node.port.onmessage = (event) => {
      if (released) return;
      const d = event.data;
      if (
        event.isTrusted !== true ||
        !sameTailIdentity(d?.identity, identity)
      ) {
        latch();
        return;
      }
      if (d.type === "ready" && d.sequence === 0 && !ready && !body) {
        ready = true;
        return;
      }
      if (
        ["output-complete", "output-fault"].includes(d.type) &&
        d.sequence === 1
      ) {
        if (bodyText === JSON.stringify(d.body)) return;
        if (!ready || body || !valid(d.body)) {
          latch();
          return;
        }
        body = Object.freeze({ ...d.body });
        bodyText = JSON.stringify(d.body);
        if (d.type !== "output-complete" || !complete(body)) latch();
        return;
      }
      if (
        d.type === "closed" &&
        d.sequence === 2 &&
        d.workerClosed === true &&
        safe(d.closedFrame)
      ) {
        if (
          !ready ||
          !body ||
          !complete(body) ||
          JSON.stringify(d.body) !== bodyText ||
          d.closedFrame < body.nextFrame
        )
          latch();
        eof = Object.freeze({ closedFrame: d.closedFrame });
        release();
        return;
      }
      latch();
    };
    node.addEventListener(
      "processorerror",
      () => {
        node.disconnect();
        latch();
      },
      { once: true },
    );
    // The native graph has no other destination in this isolated capability.
    input.connect(node);
    node.connect(output);
  } catch {
    queueMicrotask(latch);
  }
  timer = setTimeout(
    () => {
      latch();
      voice.fade();
    },
    Math.max(
      1000,
      (identity.endFrame / 48000 - context.currentTime) * 1000 + 1000,
    ),
  );
  return voice;
}
