const safe = (v) => Number.isSafeInteger(v) && v >= 0;
export const TAIL_IDENTITY_FIELDS = Object.freeze([
  "contextId",
  "planId",
  "epoch",
  "graphId",
  "rate",
  "startFrame",
  "bodyEndFrame",
  "endFrame",
  "mixSignature",
]);
export function sameTailIdentity(a, b) {
  return (
    !!a &&
    Object.keys(a).length === TAIL_IDENTITY_FIELDS.length &&
    TAIL_IDENTITY_FIELDS.every((k) => a[k] === b[k])
  );
}
export function validTailIdentity(p) {
  return (
    !!p &&
    Object.keys(p).length === TAIL_IDENTITY_FIELDS.length &&
    ["contextId", "planId", "epoch", "graphId"].every(
      (k) => typeof p[k] === "string" && /^[a-zA-Z0-9-]{1,128}$/.test(p[k]),
    ) &&
    p.rate === 48000 &&
    [p.startFrame, p.bodyEndFrame, p.endFrame].every(safe) &&
    p.bodyEndFrame > p.startFrame &&
    p.endFrame - p.bodyEndFrame === 4800 &&
    p.endFrame - p.startFrame <= 32 * p.rate &&
    typeof p.mixSignature === "string" &&
    p.mixSignature.length > 0 &&
    p.mixSignature.length <= 8192
  );
}

// This is the sole final output writer for the selected native EQ graph.
// It writes the actual graph input, never inferred silence or a clock pilot.
// Source-body authority remains with the separate finite PCM producers.
export class FiniteGraphOutput {
  #identity;
  #next = null;
  #first = null;
  #last = null;
  #blocks = 0;
  #written = 0;
  #result = null;
  #control = null;
  #size = null;
  #closed = false;
  constructor(identity) {
    if (!validTailIdentity(identity)) throw RangeError("finiteTailIdentity");
    this.#identity = Object.freeze({ ...identity });
    Object.freeze(this);
  }
  get identity() {
    return this.#identity;
  }
  get result() {
    return this.#result;
  }
  #finish(reason, observedFrame) {
    if (!this.#result) {
      const p = this.#identity,
        body = Math.min(this.#written, p.bodyEndFrame - p.startFrame);
      this.#result = Object.freeze({
        reason,
        writtenFrames: this.#written,
        bodyOutputFrames: body,
        tailOutputFrames: this.#written - body,
        channelWrites: 2 * this.#written,
        firstWriteFrame: this.#written ? p.startFrame : null,
        lastWriteFrameExclusive: p.startFrame + this.#written,
        firstProcessFrame: this.#first,
        lastProcessFrame: this.#last,
        lastBlockSize: this.#size,
        processBlocks: this.#blocks,
        nextFrame: this.#next,
        observedFrame,
        control: this.#control ? Object.freeze({ ...this.#control }) : null,
      });
    }
    return this.#result;
  }
  cancel({ identity, mode, atFrame, fadeFrames = 0 }) {
    if (this.#result) return;
    if (
      !sameTailIdentity(identity, this.#identity) ||
      !["drain", "fade"].includes(mode) ||
      !safe(atFrame) ||
      !safe(fadeFrames) ||
      fadeFrames > 48000 ||
      (mode === "drain" && fadeFrames !== 0)
    )
      return this.#finish("invalidControl", this.#next);
    const effectiveFrame = Math.max(atFrame, this.#next ?? 0),
      endFrame = Math.min(
        this.#identity.endFrame,
        effectiveFrame + (mode === "fade" ? fadeFrames : 0),
      );
    if (!this.#control || endFrame < this.#control.endFrame)
      this.#control = Object.freeze({
        mode,
        requestedFrame: atFrame,
        observedNextFrame: this.#next ?? 0,
        effectiveFrame,
        fadeFrames,
        endFrame,
      });
  }
  process(frame, input, output) {
    if (this.#closed) throw Error("finiteTailClosed");
    if (this.#result) return this.#result;
    const size = output?.[0]?.length;
    if (
      !safe(frame) ||
      !safe(size) ||
      size < 1 ||
      size > 16384 ||
      !safe(frame + size) ||
      output.length !== 2 ||
      output.some((a) => !(a instanceof Float32Array) || a.length !== size)
    )
      return this.#finish("invalidOutput", safe(frame) ? frame : null);
    for (const a of output) a.fill(0);
    if (this.#next !== null && frame !== this.#next)
      return this.#finish("frameDiscontinuity", frame);
    this.#first ??= frame;
    this.#last = frame;
    this.#size = size;
    this.#blocks++;
    this.#next = frame + size;
    const p = this.#identity,
      end = this.#control?.endFrame ?? p.endFrame;
    if (end <= frame)
      return this.#finish(this.#control ? "canceled" : "complete", end);
    for (
      let f = Math.max(frame, p.startFrame);
      f < Math.min(frame + size, end);
      f++
    ) {
      if (f !== p.startFrame + this.#written)
        return this.#finish("frameDiscontinuity", f);
      if (
        !Array.isArray(input) ||
        input.length !== 2 ||
        input.some((a) => !(a instanceof Float32Array) || a.length !== size)
      )
        return this.#finish("missingGraphInput", f);
      const i = f - frame,
        l = input[0][i],
        r = input[1][i];
      if (!Number.isFinite(l) || !Number.isFinite(r))
        return this.#finish("invalidGraphPCM", f);
      const c = this.#control,
        level =
          !c || c.mode !== "fade" || f < c.effectiveFrame
            ? 1
            : Math.max(0, 1 - (f - c.effectiveFrame) / c.fadeFrames);
      output[0][i] = Math.fround(l * level);
      output[1][i] = Math.fround(r * level);
      this.#written++;
    }
    if (frame + size >= end)
      return this.#finish(this.#control ? "canceled" : "complete", end);
    return null;
  }
  close() {
    if (!this.#result) throw Error("finiteTailCloseBeforeOutput");
    this.#closed = true;
    return this.#result;
  }
}
