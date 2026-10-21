/* global AudioWorkletProcessor, sampleRate, registerProcessor */
import { PcmWindow } from "./pcm-window.js";
import {
  frameClockDescriptors,
  nativeWorkletFrame,
} from "../audio/worklet-frame-clock.js";
const safeFrame = (n) => Number.isSafeInteger(n) && n >= 0;

export class LoopCaptureProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return frameClockDescriptors();
  }
  constructor(options) {
    super();
    const p = options.processorOptions;
    if (p.sampleRate !== sampleRate) throw RangeError("captureRateMismatch");
    if (p.replay !== undefined && typeof p.replay !== "boolean")
      throw RangeError("invalidReplayMode");
    this.replay = p.replay !== false;
    this.window = new PcmWindow(p);
    this.sent = 0;
    this.sequence = 0;
    this.pending = new Set();
    this.announced = false;
    this.closing = false;
    this.closed = false;
    this.previousFrame = null;
    this.previousSize = 0;
    this.captureFault = null;
    this.callbackCount = 0;
    this.playbackFault = null;
    this.blockSizes = new Set();
    this.port.onmessage = ({ data }) => {
      if (data?.type === "ack" && this.pending.delete(data.sequence))
        this.flush();
      if (data?.type === "stop" && !this.closed) {
        this.closing = true;
        this.window.finish(
          ["userStop", "inputLost", "suspended", "closed"].includes(data.reason)
            ? data.reason
            : "userStop",
        );
        this.flush();
      }
    };
  }
  flush() {
    if (this.closed) return;
    const w = this.window;
    // At most two transferred 4096-frame chunks in flight. The bounded full
    // window absorbs main-thread stalls; there is no unbounded message queue.
    while (this.pending.size < 2 && this.sent < w.frames) {
      const count = Math.min(4096, w.frames - this.sent);
      if (count < 4096 && !w.reason) break;
      const buffers = w.data.map(
        (c) => c.slice(this.sent, this.sent + count).buffer,
      );
      const sequence = this.sequence++;
      this.pending.add(sequence);
      this.port.postMessage(
        { type: "pcm", sequence, offset: this.sent, frames: count, buffers },
        buffers,
      );
      this.sent += count;
    }
    if (w.reason && this.sent === w.frames && !this.pending.size) {
      if (!this.announced) {
        this.announced = true;
        this.port.postMessage({
          type: "complete",
          ...w.metadata(),
          blockSizes: [...this.blockSizes],
          ...(this.captureFault ? { captureFault: this.captureFault } : {}),
        });
      }
      if (this.closing || w.reason !== "complete") {
        this.closed = true;
        this.window = null;
        this.port.postMessage({
          type: "closed",
          startFrame: w.startFrame,
          endFrame: w.endFrame,
          channels: w.channels,
          sampleRate: w.sampleRate,
          lastProcessFrame: this.previousFrame,
          lastBlockSize: this.previousSize,
          nextOutputFrame:
            this.previousFrame === null
              ? null
              : this.previousFrame + this.previousSize,
          ...(this.captureFault ? { captureFault: this.captureFault } : {}),
        });
      }
    }
  }
  process(inputs, outputs, parameters) {
    for (const bus of outputs) for (const channel of bus) channel.fill(0);
    if (this.closed) return false;
    this.callbackCount++;
    const size = outputs[0]?.[0]?.length ?? inputs[0]?.[0]?.length ?? 0,
      frame = nativeWorkletFrame(parameters, size),
      validSize = Number.isInteger(size) && size >= 1 && size <= 16384;
    if (frame === null && this.previousFrame === null && !this.closing) {
      this.flush();
      return !this.closed;
    }
    if (validSize && this.blockSizes.size < 32) this.blockSizes.add(size);
    if (this.replay && !this.closing && this.window.reason === "complete") {
      const expected = this.previousFrame + this.previousSize;
      if (
        !safeFrame(frame) ||
        !validSize ||
        !safeFrame(frame + size) ||
        !safeFrame(expected) ||
        frame !== expected
      ) {
        // A replay fault does not change a completed capture or its PCM. Keep
        // flushing/acking that take, but never emit another replay sample.
        this.playbackFault = {
          code: "replayFrameDiscontinuity",
          expectedFrame: safeFrame(expected) ? expected : null,
          observedFrame: safeFrame(frame) ? frame : null,
          blockSize: size,
          previousFrame: this.previousFrame,
          previousBlockSize: this.previousSize,
        };
        this.closing = true;
        this.port.postMessage({
          type: "playback-error",
          ...this.playbackFault,
        });
      }
    }
    if (!this.closing) {
      const before = this.window.frames;
      this.window.consume(inputs[0] ?? [], frame, size);
      if (!this.captureFault && this.window.reason === "frameGap") {
        // Freeze the FIRST fault before later callbacks/ACK drain can overwrite
        // previousFrame. No PCM/log allocation is performed on normal quanta.
        this.captureFault = Object.freeze({
          code: "captureFrameDiscontinuity",
          expectedFrame: this.window.startFrame + before,
          observedFrame: frame,
          previousFrame: this.previousFrame,
          previousBlockSize: this.previousSize,
          blockSize: size,
          capturedFrames: before,
          callbackCount: this.callbackCount,
          inputChannels: inputs[0]?.length ?? 0,
        });
      }
      if (!before && this.window.frames)
        this.port.postMessage({
          type: "started",
          frame: this.window.startFrame,
        });
      // Recorded-loop playback only; input is never live-monitored.
      if (this.replay) this.window.render(outputs[0] ?? [], frame, size);
      else if (this.window.reason === "complete") this.closing = true;
      this.previousFrame = frame;
      this.previousSize = size;
    }
    this.flush();
    return !this.closed;
  }
}
registerProcessor("perkusi-loop-capture-v5", LoopCaptureProcessor);
