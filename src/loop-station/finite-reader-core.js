const integer = (v) => Number.isSafeInteger(v) && v >= 0;
export const FINITE_IDENTITY_FIELDS = Object.freeze([
  "contextId",
  "planId",
  "readerId",
  "epoch",
  "sourceHash",
  "rate",
  "channels",
  "periodFrames",
  "startFrame",
  "endFrame",
  "fromFrame",
  "scoreStartFrame",
  "phaseFrame",
]);
export function sameFiniteIdentity(a, b) {
  const fields = [
    ...FINITE_IDENTITY_FIELDS,
    ...(a?.alignmentVersion === undefined
      ? []
      : ["alignmentVersion", "advanceFrames"]),
  ];
  return (
    !!a &&
    !!b &&
    Object.keys(a).length === fields.length &&
    Object.keys(b).length === fields.length &&
    fields.every((k) => a[k] === b[k])
  );
}
export function validFiniteIdentity(p) {
  return (
    !!p &&
    Object.keys(p).length ===
      FINITE_IDENTITY_FIELDS.length +
        (p.alignmentVersion === undefined ? 0 : 2) &&
    (p.alignmentVersion === undefined ||
      (p.alignmentVersion === 1 &&
        Number.isSafeInteger(p.advanceFrames) &&
        Math.abs(p.advanceFrames) <= Math.floor(p.rate * 0.25) &&
        Math.abs(p.advanceFrames) < p.periodFrames)) &&
    ["contextId", "planId", "readerId", "epoch"].every(
      (k) => typeof p[k] === "string" && /^[a-zA-Z0-9-]{1,128}$/.test(p[k]),
    ) &&
    /^[a-f0-9]{64}$/.test(p.sourceHash) &&
    p.rate === 48000 &&
    [1, 2].includes(p.channels) &&
    [
      "periodFrames",
      "startFrame",
      "endFrame",
      "fromFrame",
      "scoreStartFrame",
      "phaseFrame",
    ].every((k) => integer(p[k])) &&
    p.periodFrames >= 128 &&
    p.periodFrames <= 32 * p.rate &&
    p.endFrame > p.startFrame &&
    p.endFrame - p.startFrame <= 32 * p.rate &&
    p.fromFrame >= p.scoreStartFrame &&
    p.phaseFrame ===
      (((p.fromFrame - p.scoreStartFrame + (p.advanceFrames ?? 0)) %
        p.periodFrames) +
        p.periodFrames) %
        p.periodFrames
  );
}

// The source writer and coverage counter are one component. Zero PCM is valid
// only when this component actually performs the writes; there is no input tap.
export class FiniteRecordingProducer {
  #source;
  #identity;
  #coveredFrames;
  #writtenFrames;
  #processBlocks;
  #nextFrame;
  #result;
  #cancelPlan;
  #firstProcessFrame;
  #lastProcessFrame;
  #lastBlockSize;
  get identity() {
    return this.#identity;
  }
  get result() {
    return this.#result;
  }
  constructor({ identity, sourceHash, buffers }) {
    if (
      !validFiniteIdentity(identity) ||
      sourceHash !== identity.sourceHash ||
      !Array.isArray(buffers) ||
      buffers.length !== identity.channels ||
      buffers.some(
        (a) =>
          !(a instanceof Float32Array) ||
          !ArrayBuffer.isView(a) ||
          a.length !== identity.periodFrames ||
          a.some((v) => !Number.isFinite(v)),
      )
    )
      throw RangeError("finiteReaderInvalidSource");
    this.#identity = Object.freeze({ ...identity });
    this.#source = buffers.map((a) => a.slice());
    this.#coveredFrames = 0;
    this.#writtenFrames = 0;
    this.#processBlocks = 0;
    this.#nextFrame = null;
    this.#result = null;
    this.#cancelPlan = null;
    Object.freeze(this);
  }
  #finish(reason, observedFrame) {
    if (
      reason === "complete" &&
      (this.#coveredFrames !==
        this.#identity.endFrame - this.#identity.startFrame ||
        this.#writtenFrames !== this.#coveredFrames)
    )
      reason = "coverageIncomplete";
    if (!this.#result)
      this.#result = Object.freeze({
        reason,
        coveredFrames: this.#coveredFrames,
        writtenFrames: this.#writtenFrames,
        channelWrites: 2 * this.#writtenFrames,
        firstWriteFrame: this.#writtenFrames ? this.#identity.startFrame : null,
        lastWriteFrameExclusive:
          this.#identity.startFrame + this.#writtenFrames,
        processBlocks: this.#processBlocks,
        firstProcessFrame: this.#firstProcessFrame ?? null,
        lastProcessFrame: this.#lastProcessFrame ?? null,
        lastBlockSize: this.#lastBlockSize ?? null,
        nextFrame: this.#nextFrame,
        observedFrame: integer(observedFrame) ? observedFrame : null,
        cancelFrame: this.#cancelPlan?.effectiveFrame ?? null,
        cancelRequestedFrame: this.#cancelPlan?.requestedFrame ?? null,
        cancelObservedNextFrame: this.#cancelPlan?.observedNextFrame ?? null,
        cancelFadeFrames: this.#cancelPlan?.fadeFrames ?? null,
      });
    return this.#result;
  }
  cancel({ identity, atFrame, fadeFrames = 0 }) {
    if (this.#result) return;
    if (
      !sameFiniteIdentity(identity, this.#identity) ||
      !integer(atFrame) ||
      !integer(fadeFrames) ||
      fadeFrames > this.#identity.rate ||
      atFrame > this.#identity.endFrame
    )
      return this.#finish("invalidCancel", this.#nextFrame);
    const effectiveFrame = Math.max(atFrame, this.#nextFrame ?? 0);
    if (!this.#cancelPlan || effectiveFrame < this.#cancelPlan.effectiveFrame)
      this.#cancelPlan = {
        effectiveFrame,
        fadeFrames,
        requestedFrame: atFrame,
        observedNextFrame: this.#nextFrame ?? 0,
      };
  }
  process(frame, output) {
    if (this.#result) return this.#result;
    const size = output?.[0]?.length;
    if (
      !integer(frame) ||
      !integer(size) ||
      size < 1 ||
      size > 16384 ||
      !integer(frame + size) ||
      output.length !== 2 ||
      output.some(
        (a) =>
          !(a instanceof Float32Array) ||
          !ArrayBuffer.isView(a) ||
          a.length !== size,
      )
    )
      return this.#finish("invalidOutput", frame);
    for (const a of output) a.fill(0);
    if (this.#nextFrame !== null && frame !== this.#nextFrame)
      return this.#finish("frameDiscontinuity", frame);
    this.#firstProcessFrame ??= frame;
    this.#lastProcessFrame = frame;
    this.#lastBlockSize = size;
    this.#processBlocks++;
    this.#nextFrame = frame + size;
    const p = this.#identity,
      cancelEnd = this.#cancelPlan
        ? this.#cancelPlan.effectiveFrame + this.#cancelPlan.fadeFrames
        : Infinity;
    if (cancelEnd <= frame) return this.#finish("canceled", frame);
    for (
      let f = Math.max(frame, p.startFrame);
      f < Math.min(frame + size, p.endFrame);
      f++
    ) {
      if (f >= cancelEnd) return this.#finish("canceled", f);
      if (f !== p.startFrame + this.#writtenFrames)
        return this.#finish("frameDiscontinuity", f);
      const phase = (p.phaseFrame + this.#writtenFrames) % p.periodFrames;
      const beforeCancel =
        !this.#cancelPlan || f < this.#cancelPlan.effectiveFrame;
      const level = beforeCancel
        ? 1
        : Math.max(
            0,
            1 -
              (f - this.#cancelPlan.effectiveFrame) /
                this.#cancelPlan.fadeFrames,
          );
      const left = this.#source[0][phase],
        right = this.#source[p.channels - 1][phase];
      if (!Number.isFinite(left) || !Number.isFinite(right))
        return this.#finish("invalidPCM", f);
      // Preserve the existing instrument .25 stage followed by recording
      // scale4, including Float32 underflow/rounding at each native stage.
      const voiceLevel = Math.fround(0.25 * level);
      output[0][f - frame] = Math.fround(Math.fround(left * voiceLevel) * 4);
      output[1][f - frame] = Math.fround(Math.fround(right * voiceLevel) * 4);
      this.#writtenFrames++; // Only after BOTH actual Float32 output writes.
      if (beforeCancel) this.#coveredFrames++;
    }
    if (this.#writtenFrames === p.endFrame - p.startFrame)
      return this.#finish(
        this.#cancelPlan ? "canceled" : "complete",
        p.endFrame,
      );
    if (cancelEnd <= frame + size) return this.#finish("canceled", cancelEnd);
    return null;
  }
  close() {
    if (!this.#result) throw Error("finiteReaderCloseBeforeBody");
    this.#source = null; // Worker PCM ownership ends BEFORE its closed receipt.
    return this.#result;
  }
}
