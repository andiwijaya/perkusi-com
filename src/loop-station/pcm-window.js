const int = (v) => Number.isSafeInteger(v) && v >= 0;

// Pure audio-thread core. Finite raw float PCM, including silence/overrange,
// is preserved. Missing input/frames terminate a recoverable prefix, not padding.
export class PcmWindow {
  constructor({
    startFrame,
    endFrame,
    channels,
    sampleRate,
    replayPeakLimit = Infinity,
  }) {
    if (
      !int(startFrame) ||
      !int(endFrame) ||
      endFrame <= startFrame ||
      !Number.isInteger(sampleRate) ||
      sampleRate < 8000 ||
      sampleRate > 192000 ||
      ![1, 2].includes(channels) ||
      endFrame - startFrame > sampleRate * 32
    )
      throw RangeError("invalidCaptureWindow");
    Object.assign(this, { startFrame, endFrame, channels, sampleRate });
    this.capacity = endFrame - startFrame;
    this.data = Array.from(
      { length: channels },
      () => new Float32Array(this.capacity),
    );
    this.frames = 0;
    this.peak = 0;
    this.reason = null;
    if (!(replayPeakLimit > 0)) throw RangeError("invalidReplayPeakLimit");
    this.replayPeakLimit = replayPeakLimit;
  }
  finish(reason) {
    if (!this.reason) this.reason = reason;
  }
  consume(input, frame, size) {
    if (this.reason) return;
    if (!int(frame) || !Number.isInteger(size) || size < 1 || size > 16384) {
      this.finish("invalidBlock");
      return;
    }
    if (frame + size <= this.startFrame) return;
    const from = Math.max(frame, this.startFrame),
      to = Math.min(frame + size, this.endFrame);
    if (from !== this.startFrame + this.frames || to <= from) {
      this.finish("frameGap");
      return;
    }
    if (input.length !== this.channels) {
      this.finish(input.length ? "channelsChanged" : "inputLost");
      return;
    }
    let peak = this.peak;
    for (const channel of input) {
      if (!(channel instanceof Float32Array) || channel.length !== size) {
        this.finish("invalidBlock");
        return;
      }
      for (let i = from - frame; i < to - frame; i++) {
        if (!Number.isFinite(channel[i])) {
          this.finish("invalidPCM");
          return;
        }
        peak = Math.max(peak, Math.abs(channel[i]));
      }
    }
    for (let c = 0; c < this.channels; c++)
      this.data[c].set(
        input[c].subarray(from - frame, to - frame),
        this.frames,
      );
    this.frames += to - from;
    this.peak = peak;
    if (this.frames === this.capacity)
      this.finish(
        this.peak > this.replayPeakLimit ? "unsafeReplay" : "complete",
      );
  }
  render(output, frame, size) {
    // The first repeat starts at the exact capture end, without a main-thread hop.
    if (this.reason !== "complete") return;
    for (let i = Math.max(0, this.endFrame - frame); i < size; i++) {
      const offset = (frame + i - this.endFrame) % this.frames;
      for (let c = 0; c < Math.min(output.length, this.channels); c++)
        output[c][i] = this.data[c][offset];
    }
  }
  metadata() {
    return {
      startFrame: this.startFrame,
      endFrame: this.endFrame,
      sampleRate: this.sampleRate,
      channels: this.channels,
      capacity: this.capacity,
      frames: this.frames,
      reason: this.reason,
      peak: this.peak,
    };
  }
}
