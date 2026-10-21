import { identity, sameIdentity, integer, MAX_BLOCK } from "./protocol.mjs";

export function createAnchoredStreamProcessor(Base, actualRate) {
  return class AnchoredStream extends Base {
    static get parameterDescriptors() {
      return [
        {
          name: "startGate",
          defaultValue: 0,
          minValue: 0,
          maxValue: 1,
          automationRate: "a-rate",
        },
      ];
    }
    constructor(options = {}) {
      super();
      const supplied = options.processorOptions ?? {};
      this.identity = identity(supplied.identity);
      this.rate = actualRate;
      if (![44100, 48000].includes(actualRate) || supplied.rate !== actualRate)
        throw Error("anchoredRateMismatch");
      this.queue = [];
      this.received = this.rendered = this.nextId = this.consumed = 0;
      this.origin = this.end = this.fade = null;
      this.programmeOffset = 0;
      this.ready = false;
      this.active = false;
      this.finished = false;
      this.staleIgnored = 0;
      this.staleNotified = false;
      this.readyMessage = {
        type: "ready",
        identity: this.identity,
        rate: actualRate,
        gateInactive: true,
      };
      this.startedMessage = {
        type: "started",
        identity: this.identity,
        origin: null,
        programmeOffset: 0,
        sampleIndex: null,
      };
      this.consumedMessage = {
        type: "consumed",
        identity: this.identity,
        id: 0,
        endFrame: 0,
      };
      this.closedMessage = {
        type: "closed",
        identity: this.identity,
        fault: null,
        frame: null,
        renderedFrames: 0,
        acceptedChunks: 0,
        consumedChunks: 0,
        programmeEndFrame: null,
        staleIgnored: 0,
      };
      this.port.onmessage = ({ data }) => this.message(data);
    }
    message(m) {
      if (this.finished) return;
      if (!sameIdentity(m?.identity, this.identity)) {
        if (this.staleIgnored < Number.MAX_SAFE_INTEGER) this.staleIgnored++;
        if (!this.staleNotified) {
          this.staleNotified = true;
          this.port.postMessage({
            type: "stale-rejected",
            identity: this.identity,
          });
        }
        return;
      }
      if (m.type === "chunk") {
        const { left, right, id, from } = m;
        if (
          this.end !== null ||
          this.queue.length >= 32 ||
          id !== this.nextId ||
          from !== this.received ||
          !(left instanceof Float32Array) ||
          !(right instanceof Float32Array) ||
          !integer(left.length, 1, 4096) ||
          right.length !== left.length ||
          left.buffer === right.buffer ||
          left.byteOffset !== 0 ||
          right.byteOffset !== 0 ||
          left.buffer.byteLength !== left.byteLength ||
          right.buffer.byteLength !== right.byteLength ||
          !integer(this.received + left.length)
        )
          return this.finish("canonicalStreamPacket");
        for (let c = 0; c < 2; c++) {
          const channel = c ? right : left;
          for (let i = 0; i < channel.length; i++)
            if (!Number.isFinite(channel[i]) || Math.abs(channel[i]) > 0.95)
              return this.finish("unsafeOutput");
        }
        this.queue.push({ left, right, id, from, at: 0 });
        this.received += left.length;
        this.nextId++;
        this.port.postMessage({
          type: "accepted",
          identity: this.identity,
          id,
          received: this.received,
        });
      } else if (m.type === "arm") {
        if (
          !this.ready ||
          this.origin !== null ||
          !this.queue.length ||
          !integer(m.origin, 0, Number.MAX_SAFE_INTEGER - MAX_BLOCK) ||
          !integer(m.programmeOffset, 0, Number.MAX_SAFE_INTEGER - MAX_BLOCK)
        )
          return this.finish("anchoredArm");
        this.origin = m.origin;
        this.programmeOffset = m.programmeOffset;
        this.port.postMessage({
          type: "armed",
          identity: this.identity,
          origin: this.origin,
          programmeOffset: this.programmeOffset,
        });
      } else if (m.type === "end") {
        if (
          this.end !== null ||
          m.frames !== this.received ||
          !integer(m.frames, 1)
        )
          return this.finish("canonicalStreamPacket");
        this.end = m.frames;
      } else if (m.type === "stop") {
        // Actual processor activation is authoritative; the host's receipt
        // can still be in flight. A pre-activation Stop never starts PCM.
        if (!this.active || m.immediate === true) return this.finish();
        if (
          !integer(m.start) ||
          !integer(m.end, m.start) ||
          m.end - m.start > 4096
        )
          return this.finish("canonicalStreamStop");
        this.fade = { start: m.start, end: m.end };
      } else if (m.type === "invalidate")
        this.finish(
          "anchoredContinuityInvalidated",
          this.active ? this.origin + this.rendered : null,
        );
      else this.finish("canonicalStreamPacket");
    }
    finish(fault = null, frame = null) {
      if (this.finished) return;
      this.finished = true;
      this.queue.length = 0;
      const m = this.closedMessage;
      m.fault = fault;
      m.frame = frame;
      m.renderedFrames = this.rendered;
      m.acceptedChunks = this.nextId;
      m.consumedChunks = this.consumed;
      m.programmeEndFrame =
        this.origin === null ? null : this.programmeOffset + this.rendered;
      m.staleIgnored = this.staleIgnored;
      this.port.postMessage(m);
      this.port.onmessage = null;
      this.port.close();
    }
    process(_inputs, outputs, parameters) {
      const cs = outputs[0],
        n = cs?.[0]?.length;
      if (!integer(n, 1, MAX_BLOCK) || cs.length !== 2 || cs[1].length !== n) {
        this.finish("canonicalStreamOutput");
        return false;
      }
      cs[0].fill(0);
      cs[1].fill(0);
      if (this.finished) return false;
      const gate = parameters?.startGate;
      if (
        !(gate instanceof Float32Array) ||
        (gate.length !== 1 && gate.length !== n)
      ) {
        this.finish("anchoredGateShape");
        return false;
      }
      let first = -1;
      for (let i = 0; i < n; i++) {
        const value = gate[gate.length === 1 ? 0 : i];
        if (
          (value !== 0 && value !== 1) ||
          (this.active && value !== 1) ||
          (first >= 0 && value !== 1)
        ) {
          this.finish(
            "anchoredGateInvalid",
            this.active ? this.origin + this.rendered : null,
          );
          return false;
        }
        if (value === 1 && first < 0) first = i;
      }
      if (!this.active) {
        if (first < 0) {
          if (!this.ready) {
            this.ready = true;
            this.port.postMessage(this.readyMessage);
          }
          return true;
        }
        if (!this.ready || this.origin === null) {
          this.finish("anchoredGateWithoutArm");
          return false;
        }
        this.active = true;
        this.startedMessage.origin = this.origin;
        this.startedMessage.programmeOffset = this.programmeOffset;
        this.startedMessage.sampleIndex = first;
        this.port.postMessage(this.startedMessage);
      } else first = 0;
      if (
        !integer(this.origin + this.rendered + n - first) ||
        !integer(this.programmeOffset + this.rendered + n - first)
      ) {
        this.finish("anchoredFrameRange", this.origin + this.rendered);
        return false;
      }
      for (let i = first; i < n; i++) {
        const frame = this.origin + this.rendered;
        if (
          (this.fade && frame >= this.fade.end) ||
          (this.end !== null && this.rendered === this.end)
        ) {
          this.finish(null, frame);
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
          this.consumedMessage.id = row.id;
          this.consumedMessage.endFrame = this.rendered;
          this.port.postMessage(this.consumedMessage);
        }
      }
      if (this.end !== null && this.rendered === this.end) {
        this.finish(null, this.origin + this.rendered);
        return false;
      }
      return true;
    }
  };
}
