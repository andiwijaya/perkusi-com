import { recordedLoopGeometry } from "./recorded-loop.js";
import { fxTailFrames, limiterEnabled } from "./fx-model.js";
import {
  finiteMixSignature,
  finiteTailBytes,
  startFiniteTail,
} from "./finite-tail.js";
import { digest } from "./recording-data.js";
import { fail } from "../project/instrument-contract.js";
import { sameFiniteIdentity } from "./finite-reader-core.js";
const contexts = new WeakMap(),
  voices = new WeakMap(),
  loaded = new WeakMap();
const uuid = () => crypto.randomUUID(),
  safe = (n) => Number.isSafeInteger(n) && n >= 0;
export const finiteReaderOutcome = (voice) =>
  voices.get(voice)?.snapshot() ?? null;
export const isFiniteReaderVoice = (voice) => voices.has(voice);
export const softFinitePreparationFailure = (error) =>
  ["finiteReaderUnavailable", "combinedMemoryLimit"].includes(error?.code);

// Optional, privately qualified, <=3 reader,48k capability. Prepared host
// copies + digest overlap and each worker's structured-clone overlap are charged.
export async function prepareFiniteReaders(
  plan,
  context,
  memory,
  moduleURL,
  nodeFactory,
  signal,
) {
  const clips = plan.tracks.flatMap((t) => t.clips);
  if (
    !moduleURL ||
    !context.audioWorklet ||
    context.sampleRate !== 48000 ||
    new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] !== 4 ||
    clips.length < 1 ||
    clips.length > 3 ||
    limiterEnabled(plan.project.master) ||
    clips.some((c) => c.startTick !== 0 || !recordedLoopGeometry(c, plan.clock))
  )
    return null;
  const url = new URL(moduleURL, import.meta.url);
  if (globalThis.location && url.origin !== location.origin)
    fail("externalCaptureModule");
  let modules = loaded.get(context);
  if (!modules) loaded.set(context, (modules = new Map()));
  if (!modules.has(url.href))
    modules.set(
      url.href,
      (() => {
        let timer;
        return Promise.race([
          context.audioWorklet.addModule(url.href),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(Error("finiteReaderModuleDeadline")),
              5000,
            );
          }),
        ])
          .finally(() => clearTimeout(timer))
          .catch((e) => {
            modules.delete(url.href);
            throw Object.assign(Error("finiteReaderUnavailable"), {
              code: "finiteReaderUnavailable",
              cause: e,
            });
          });
      })(),
    );
  await modules.get(url.href);
  if (signal?.aborted) fail("cancelled");
  const sources = new Map(),
    epochs = new Set(),
    contextId = contexts.get(context) ?? uuid(),
    planId = uuid();
  contexts.set(context, contextId);
  try {
    for (const clip of clips) {
      const g = recordedLoopGeometry(clip, plan.clock),
        bytes = g.periodFrames * g.channels * 4;
      const lease = memory.reserve(
        2 * bytes + 4096,
        "finite-reader/prepared-copy-and-digest",
      );
      sources.set(clip, { lease, g, bytes });
      const data = new ArrayBuffer(bytes),
        view = new DataView(data);
      for (let c = 0; c < g.channels; c++) {
        const channel = g.buffer.getChannelData(c);
        for (let n = 0; n < g.periodFrames; n++) {
          if (!Number.isFinite(channel[n])) fail("invalidRecordingPCM");
          view.setFloat32((c * g.periodFrames + n) * 4, channel[n], true);
        }
      }
      if ((await digest(data)) !== g.sourceHash) fail("recordingHashMismatch");
      if (signal?.aborted) fail("cancelled");
      sources.get(clip).buffers = Array.from(
        { length: g.channels },
        (_, c) =>
          new Float32Array(data, c * g.periodFrames * 4, g.periodFrames),
      );
    }
  } catch (e) {
    for (const s of sources.values()) s.lease.release();
    throw e;
  }
  const create =
    nodeFactory ??
    ((c, options) =>
      new AudioWorkletNode(c, "perkusi-finite-reader-v5", options));
  return Object.freeze({
    readerCount: clips.length,
    tailFrames: fxTailFrames(plan.project, 48000),
    supportsMix: (project) =>
      !fxTailFrames(plan.project, 48000) ||
      finiteMixSignature(project) === finiteMixSignature(plan.project),
    begin() {
      const tailFrames = fxTailFrames(plan.project, 48000);
      const lease = memory.reserve(
        [...sources.values()].reduce((n, s) => n + 2 * s.bytes + 8192, 0) +
          (tailFrames ? finiteTailBytes(plan.project) : 0),
        "finite-reader/epoch-clone-workers-nodes",
      );
      let unused = sources.size + (tailFrames ? 1 : 0),
        active = 0,
        released = false;
      const states = new Set(),
        epoch = uuid(),
        used = new Set();
      const settle = () => {
        if (!unused && !active && !released) {
          released = true;
          lease.release();
          epochs.delete(operation);
          context.removeEventListener("statechange", closed);
        }
      };
      const closed = () => {
        if (context.state === "closed")
          for (const s of states) s.confirmClose();
      };
      context.addEventListener("statechange", closed);
      const operation = Object.freeze({
        epoch,
        abortUnstarted() {
          unused = 0;
          settle();
        },
        openTail({
          startFrame,
          bodyEndFrame,
          endFrame,
          input,
          output,
          onRelease,
          onFault,
          nodeFactory,
        }) {
          if (
            !tailFrames ||
            released ||
            used.has("tail") ||
            !safe(startFrame) ||
            !safe(bodyEndFrame) ||
            !safe(endFrame) ||
            bodyEndFrame <= startFrame ||
            endFrame - bodyEndFrame !== tailFrames
          )
            fail("invalidLoopPlan");
          used.add("tail");
          unused--;
          active++;
          const identity = Object.freeze({
            contextId,
            planId,
            epoch,
            graphId: uuid(),
            rate: 48000,
            startFrame,
            bodyEndFrame,
            endFrame,
            mixSignature: finiteMixSignature(plan.project),
          });
          let state;
          const voice = startFiniteTail({
            context,
            identity,
            input,
            output,
            nodeFactory,
            onFault,
            onRelease: () => {
              states.delete(state);
              active--;
              settle();
              onRelease();
            },
          });
          state = {
            snapshot: voice.snapshot,
            confirmClose: voice.confirmClose,
          };
          states.add(state);
          return voice;
        },
        start(clip, spec, when, from, destination, onRelease, onFault) {
          const source = sources.get(clip),
            g = source?.g,
            startFrame = Math.round(when * 48000);
          if (
            released ||
            used.has(clip) ||
            !g ||
            recordedLoopGeometry(clip, plan.clock) !== g ||
            spec.buffer !== g.buffer ||
            spec.loopFrames !== g.periodFrames ||
            spec.startFrame !== g.startFrame ||
            spec.scale !== 4 ||
            spec.velocity !== 1 ||
            spec.pan !== 0 ||
            spec.dampFrame !== null ||
            !safe(from) ||
            !safe(spec.stopFrame) ||
            spec.stopFrame <= from ||
            !safe(startFrame) ||
            Math.abs(when * 48000 - startFrame) > 1e-5
          )
            fail("invalidLoopPlan");
          used.add(clip);
          unused--;
          active++;
          const identity = Object.freeze({
            contextId,
            planId,
            readerId: uuid(),
            epoch,
            sourceHash: g.sourceHash,
            rate: 48000,
            channels: g.channels,
            periodFrames: g.periodFrames,
            startFrame,
            endFrame: startFrame + spec.stopFrame - from,
            fromFrame: from,
            scoreStartFrame: g.startFrame,
            ...(g.phaseOffsetFrames
              ? { alignmentVersion: 1, advanceFrames: g.phaseOffsetFrames }
              : {}),
            phaseFrame:
              (((from - g.startFrame + g.phaseOffsetFrames) % g.periodFrames) +
                g.periodFrames) %
              g.periodFrames,
          });
          let node,
            timer,
            ready = false,
            body = null,
            bodyText = null,
            releasedVoice = false,
            controlled = false,
            fault = null,
            eof = null;
          const snapshot = () =>
            Object.freeze({
              identity,
              kind: fault
                ? fault === "recordingLoopEnded"
                  ? "fault"
                  : "unverified"
                : controlled
                  ? "controlled"
                  : releasedVoice && body?.reason === "complete" && eof
                    ? "verified"
                    : "pending",
              fault,
              ready,
              body,
              closed: !!eof,
              confirmedContextClose: releasedVoice && !eof,
            });
          const latch = (code) => {
            if (fault || releasedVoice || controlled) return;
            fault = code;
            onFault({ code });
          };
          const release = () => {
            if (releasedVoice) return;
            releasedVoice = true;
            clearTimeout(timer);
            node?.disconnect();
            node?.port.close();
            states.delete(state);
            active--;
            settle();
            onRelease();
          };
          const state = { snapshot, confirmClose: release };
          states.add(state);
          const cancel = () => {
            node?.port.postMessage({
              type: "cancel",
              identity,
              atFrame: Math.min(
                identity.endFrame,
                Math.round(context.currentTime * 48000),
              ),
              fadeFrames: 960,
            });
          };
          const voice = Object.freeze({
            when,
            end: identity.endFrame / 48000,
            stop() {
              if (releasedVoice) return;
              controlled = true;
              if (context.state === "closed") release();
              else cancel();
            },
            disconnect() {
              if (context.state !== "closed") fail("loopClosePending");
              release();
            },
            snapshot,
          });
          voices.set(voice, state);
          const validBody = (b) =>
            b &&
            safe(b.coveredFrames) &&
            safe(b.writtenFrames) &&
            b.coveredFrames <= b.writtenFrames &&
            b.writtenFrames <= identity.endFrame - identity.startFrame &&
            b.channelWrites === 2 * b.writtenFrames &&
            b.firstWriteFrame ===
              (b.writtenFrames ? identity.startFrame : null) &&
            (b.observedFrame === null || safe(b.observedFrame)) &&
            b.lastWriteFrameExclusive === identity.startFrame + b.writtenFrames;
          const completeBody = (b) =>
            validBody(b) &&
            b.reason === "complete" &&
            b.coveredFrames === identity.endFrame - identity.startFrame &&
            b.coveredFrames === b.writtenFrames &&
            b.firstWriteFrame === identity.startFrame &&
            safe(b.processBlocks) &&
            b.processBlocks > 0 &&
            safe(b.firstProcessFrame) &&
            b.firstProcessFrame <= identity.startFrame &&
            safe(b.lastProcessFrame) &&
            safe(b.lastBlockSize) &&
            b.lastBlockSize > 0 &&
            b.lastBlockSize <= 16384 &&
            b.nextFrame === b.lastProcessFrame + b.lastBlockSize &&
            b.lastProcessFrame < identity.endFrame &&
            b.nextFrame >= identity.endFrame &&
            b.observedFrame === identity.endFrame &&
            b.cancelFrame === null;
          try {
            node = create(context, {
              numberOfInputs: 0,
              numberOfOutputs: 1,
              outputChannelCount: [2],
              processorOptions: {
                identity,
                sourceHash: g.sourceHash,
                buffers: source.buffers,
              },
            });
            node.port.onmessage = (event) => {
              if (releasedVoice) return;
              const d = event.data;
              if (
                event.isTrusted !== true ||
                !sameFiniteIdentity(d?.identity, identity)
              ) {
                latch("recordingLoopCompletionUnverified");
                return;
              }
              if (d.type === "ready" && d.sequence === 0 && !ready && !body) {
                ready = true;
                return;
              }
              if (
                (d.type === "body-complete" || d.type === "body-fault") &&
                d.sequence === 1
              ) {
                if (bodyText === JSON.stringify(d.body)) return;
                if (!ready || body || !validBody(d.body)) {
                  latch("recordingLoopCompletionUnverified");
                  return;
                }
                body = Object.freeze({ ...d.body });
                bodyText = JSON.stringify(d.body);
                if (d.type !== "body-complete" || !completeBody(body))
                  latch(
                    d.type === "body-fault"
                      ? "recordingLoopEnded"
                      : "recordingLoopCompletionUnverified",
                  );
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
                  !completeBody(body) ||
                  JSON.stringify(d.body) !== bodyText ||
                  d.closedFrame < body.nextFrame
                )
                  latch("recordingLoopCompletionUnverified");
                eof = Object.freeze({ closedFrame: d.closedFrame });
                release();
                return;
              }
              latch("recordingLoopCompletionUnverified");
            };
            node.addEventListener(
              "processorerror",
              () => {
                node.disconnect();
                latch("recordingLoopCompletionUnverified");
              },
              { once: true },
            );
            node.connect(destination);
          } catch {
            queueMicrotask(() => latch("recordingLoopCompletionUnverified"));
          }
          timer = setTimeout(
            () => {
              latch("recordingLoopCompletionUnverified");
              cancel();
            },
            Math.max(
              1000,
              (identity.endFrame / 48000 - context.currentTime) * 1000 + 1000,
            ),
          );
          return voice;
        },
      });
      epochs.add(operation);
      return operation;
    },
    release() {
      if (epochs.size) fail("loopClosePending");
      for (const s of sources.values()) {
        s.buffers = null;
        s.lease.release();
      }
      sources.clear();
    },
  });
}
