/* global AudioWorkletProcessor, registerProcessor */
import {
  frameClockDescriptors,
  nativeWorkletFrame,
} from "../audio/worklet-frame-clock.js";
// Raw input is never altered. The separate stereo monitor is silent by default;
// a bounded gain and whole-quantum gate apply only to its optional output.
export class MicMeterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return frameClockDescriptors();
  }
  constructor() {
    super();
    this.blocks = 0;
    this.peak = 0;
    this.meanSquare = 0;
    this.samples = 0;
    this.windowFrames = 0;
    this.clips = 0;
    this.intervalClips = 0;
    this.pending = false;
    this.port.onmessage = ({ data }) => {
      if (data?.type === "ack") this.pending = false;
      if (
        data?.type === "monitor" &&
        Number.isSafeInteger(data.id) &&
        data.id > 0 &&
        Number.isSafeInteger(data.frame) &&
        data.frame >= 0 &&
        typeof data.enabled === "boolean" &&
        !this.monitorCommand
      )
        this.monitorCommand = data;
      if (data?.type === "stop") {
        this.stopped = true;
        this.port.postMessage({ type: "closed" });
      }
    };
  }
  process(inputs, outputs, parameters) {
    for (const bus of outputs) for (const c of bus) c.fill(0);
    if (this.stopped) return false;
    const size = outputs[0]?.[0]?.length ?? 0,
      frame = nativeWorkletFrame(parameters, size);
    if (frame === null && this.nextFrame === undefined) return true;
    if (
      !Number.isSafeInteger(frame) ||
      frame < 0 ||
      (this.nextFrame !== undefined && frame !== this.nextFrame)
    ) {
      this.monitorEnabled = false;
      this.stopped = true;
      this.port.postMessage({ type: "clock-error" });
      this.port.postMessage({ type: "closed" });
      return false;
    }
    this.nextFrame = frame + size;
    const input = inputs[0] ?? [];
    const frames = input[0]?.length ?? outputs[0]?.[0]?.length ?? 0;
    let peak = 0,
      energy = 0,
      samples = 0,
      clips = 0,
      invalid = false;
    for (const channel of input)
      for (const v of channel) {
        if (!Number.isFinite(v)) invalid = true;
        else {
          peak = Math.max(peak, Math.abs(v));
          energy += v * v;
          samples++;
          if (Math.abs(v) >= 1) clips++;
        }
      }
    const monitorSafe =
      !invalid &&
      !this.invalid &&
      !this.changed &&
      peak <= 0.5 &&
      [1, 2].includes(input.length) &&
      (this.channels === undefined || this.channels === input.length);
    for (let i = 0; i < frames; i++) {
      const command = this.monitorCommand;
      if (command && frame + i >= command.frame) {
        this.monitorEnabled = command.enabled;
        this.port.postMessage({
          type: "monitor-state",
          id: command.id,
          enabled: command.enabled,
          frame: frame + i,
        });
        this.monitorCommand = null;
      }
      if (this.monitorEnabled && monitorSafe)
        for (let ch = 0; ch < (outputs[0]?.length ?? 0); ch++)
          outputs[0][ch][i] = input[Math.min(ch, input.length - 1)][i] * 0.25;
    }
    this.peak = Math.max(this.peak, peak);
    if (samples) {
      this.meanSquare +=
        (energy / samples - this.meanSquare) *
        (samples / (this.samples + samples));
      this.samples = Math.min(Number.MAX_SAFE_INTEGER, this.samples + samples);
    }
    this.clips = Math.min(Number.MAX_SAFE_INTEGER, this.clips + clips);
    this.intervalClips = Math.min(
      Number.MAX_SAFE_INTEGER,
      this.intervalClips + clips,
    );
    this.windowFrames = Math.min(
      Number.MAX_SAFE_INTEGER,
      this.windowFrames + (input[0]?.length ?? outputs[0]?.[0]?.length ?? 0),
    );
    // Accumulate every quantum, including while an older snapshot awaits ACK.
    // One bounded scalar receipt per 2048 frames at the usual128-frame quantum.
    // Immediate topology/invalid receipts avoid hiding faults between updates.
    if (this.channels !== undefined && input.length !== this.channels)
      this.changed = true;
    this.invalid ||= invalid;
    if (
      !this.pending &&
      (this.blocks === 0 ||
        this.windowFrames >= 2048 ||
        this.changed ||
        this.invalid)
    ) {
      this.pending = true;
      this.port.postMessage({
        type: "meter",
        frame,
        channels: input.length,
        peak: this.peak,
        rms: Math.sqrt(this.meanSquare),
        clips: this.clips,
        intervalClips: this.intervalClips,
        windowFrames: this.windowFrames,
        samples: this.samples,
        invalid: this.invalid,
        changed: this.changed === true,
        monitorGated: !!this.monitorEnabled && !monitorSafe,
      });
      this.peak =
        this.meanSquare =
        this.samples =
        this.intervalClips =
        this.windowFrames =
          0;
    }
    this.blocks++;
    this.channels = input.length;
    return true;
  }
}
registerProcessor("perkusi-mic-meter-v5", MicMeterProcessor);
