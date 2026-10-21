/* global AudioWorkletProcessor, registerProcessor */
import {
  frameClockDescriptors,
  nativeWorkletFrame,
} from "./worklet-frame-clock.js";

// Bounded native PCM transport for canonical continuous playback.
// One clock runs across every packet boundary; starvation is a terminal fault.
class CanonicalStream extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return frameClockDescriptors();
  }
  constructor() {
    super();
    this.queue = [];
    this.received = this.rendered = this.nextId = this.consumed = 0;
    this.origin = this.end = this.fade = null;
    this.previousFrame = null;
    this.previousSize = 0;
    this.finished = false;
    this.port.onmessage = ({ data }) => this.message(data);
  }
  message(m) {
    if (this.finished) return;
    if (m?.type === "chunk") {
      const { left, right, id, from } = m;
      if (
        this.end !== null ||
        this.queue.length >= 32 ||
        id !== this.nextId ||
        from !== this.received ||
        !(left instanceof Float32Array) ||
        !(right instanceof Float32Array) ||
        left.length < 1 ||
        left.length > 4096 ||
        right.length !== left.length ||
        left.buffer === right.buffer ||
        left.byteOffset !== 0 ||
        right.byteOffset !== 0 ||
        left.buffer.byteLength !== left.byteLength ||
        right.buffer.byteLength !== right.byteLength ||
        !Number.isSafeInteger(this.received + left.length)
      )
        return this.finish("canonicalStreamPacket");
      for (const c of [left, right])
        for (const n of c)
          if (!Number.isFinite(n) || Math.abs(n) > 0.95)
            return this.finish("unsafeOutput");
      this.queue.push({ left, right, id, from, at: 0 });
      this.received += left.length;
      this.nextId++;
      this.port.postMessage({ type: "accepted", id, received: this.received });
    } else if (m?.type === "arm") {
      if (
        this.origin !== null ||
        !this.queue.length ||
        !Number.isSafeInteger(m.origin) ||
        m.origin < 0
      )
        return this.finish("canonicalStreamArm");
      this.origin = m.origin;
      this.port.postMessage({ type: "armed", origin: this.origin });
    } else if (m?.type === "end") {
      if (this.end !== null || m.frames !== this.received || m.frames < 1)
        return this.finish("canonicalStreamPacket");
      this.end = m.frames;
    } else if (m?.type === "stop") {
      if (this.origin === null || m.immediate === true) return this.finish();
      if (
        !Number.isSafeInteger(m.start) ||
        !Number.isSafeInteger(m.end) ||
        m.end < m.start ||
        m.end - m.start > 4096
      )
        return this.finish("canonicalStreamStop");
      this.fade = { start: m.start, end: m.end };
    } else return this.finish("canonicalStreamPacket");
  }
  finish(fault = null, frame = null) {
    if (this.finished) return;
    this.finished = true;
    // All queued PCM references are dropped before the real closed receipt.
    this.queue.length = 0;
    this.port.postMessage({
      type: "closed",
      fault,
      frame,
      renderedFrames: this.rendered,
      acceptedChunks: this.nextId,
      consumedChunks: this.consumed,
    });
    // Disentangle the endpoint too: no queued/in-transit chunk may become a
    // new native PCM owner after this actual closed receipt.
    this.port.onmessage = null;
    this.port.close();
  }
  process(_, outputs, parameters) {
    const cs = outputs[0],
      n = cs?.[0]?.length;
    if (!n || cs.length !== 2 || cs[1].length !== n) {
      this.finish("canonicalStreamOutput");
      return false;
    }
    for (const c of cs) c.fill(0);
    if (this.finished) return false;
    if (this.origin === null) return true;
    const first = nativeWorkletFrame(parameters, n);
    if (first === null && this.previousFrame === null) return true;
    if (
      !Number.isSafeInteger(first) ||
      first < 0 ||
      (this.previousFrame !== null &&
        first !== this.previousFrame + this.previousSize)
    ) {
      this.finish("canonicalStreamClockDiscontinuity", first);
      return false;
    }
    this.previousFrame = first;
    this.previousSize = n;
    for (let i = 0; i < n; i++) {
      const frame = first + i;
      if (frame < this.origin) continue;
      if (this.fade && frame >= this.fade.end) {
        this.finish(null, frame);
        return false;
      }
      if (this.end !== null && this.rendered === this.end) {
        this.finish(null, frame);
        return false;
      }
      if (frame - this.origin !== this.rendered) {
        this.finish("canonicalStreamStartMissed", frame);
        return false;
      }
      const row = this.queue[0];
      if (!row) {
        this.finish("canonicalStreamStarved", frame);
        return false;
      }
      const gain =
        this.fade && frame >= this.fade.start
          ? (this.fade.end - frame) / (this.fade.end - this.fade.start)
          : 1;
      cs[0][i] = gain === 1 ? row.left[row.at] : row.left[row.at] * gain;
      cs[1][i] = gain === 1 ? row.right[row.at] : row.right[row.at] * gain;
      this.rendered++;
      row.at++;
      if (row.at === row.left.length) {
        this.queue.shift();
        this.consumed++;
        // A consumed receipt proves native references to this chunk are gone.
        this.port.postMessage({
          type: "consumed",
          id: row.id,
          endFrame: this.rendered,
        });
      }
    }
    if (this.end !== null && this.rendered === this.end) {
      this.finish(null, first + n);
      return false;
    }
    return true;
  }
}
registerProcessor("canonical-pcm-stream", CanonicalStream);
