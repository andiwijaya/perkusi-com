/* global AudioWorkletProcessor, registerProcessor */
import {
  frameClockDescriptors,
  nativeWorkletFrame,
} from "./worklet-frame-clock.js";

class CanonicalPrint extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return frameClockDescriptors();
  }
  constructor(o) {
    super();
    const p = o.processorOptions;
    this.left = this.right = null;
    this.frames = p.frames;
    this.origin = p.origin;
    this.from = p.from;
    this.end = p.origin + p.frames - p.from;
    this.fade = null;
    this.sent = false;
    this.previousFrame = null;
    this.previousSize = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === "load" && !this.left && !this.sent) {
        if (
          !(data.left instanceof Float32Array) ||
          !(data.right instanceof Float32Array) ||
          data.left.length !== this.frames ||
          data.right.length !== this.frames
        ) {
          this.finish("invalidCanonicalPrint");
          return;
        }
        this.left = data.left;
        this.right = data.right;
      } else if (data.type === "stop") {
        this.fade = data.start;
        this.end = Math.min(this.end, data.end);
        if (this.end <= this.origin) this.finish();
      }
    };
  }
  finish(fault = null) {
    if (!this.sent) {
      this.sent = true;
      this.left = this.right = null;
      this.port.postMessage({ type: "ended", frame: this.end, fault });
    }
  }
  process(_, outputs, parameters) {
    const cs = outputs[0],
      n = cs[0].length;
    for (const c of cs) c.fill(0);
    if (this.sent) return false;
    const first = nativeWorkletFrame(parameters, n);
    if (first === null && this.previousFrame === null) return true;
    if (
      !Number.isSafeInteger(first) ||
      first < 0 ||
      (this.previousFrame !== null &&
        first !== this.previousFrame + this.previousSize)
    ) {
      this.finish("canonicalPrintClockDiscontinuity");
      return false;
    }
    this.previousFrame = first;
    this.previousSize = n;
    for (let i = 0; i < n; i++) {
      const frame = first + i,
        at = this.from + frame - this.origin;
      if (!this.left && frame >= this.origin && frame < this.end) {
        this.finish("canonicalPrintNotReady");
        return false;
      }
      const gain =
        this.fade === null || frame < this.fade
          ? 1
          : this.end === this.fade
            ? 0
            : Math.max(0, (this.end - frame) / (this.end - this.fade));
      const active =
        this.left &&
        frame >= this.origin &&
        frame < this.end &&
        at >= 0 &&
        at < this.frames;
      cs[0][i] = active ? this.left[at] * gain : 0;
      cs[1][i] = active ? this.right[at] * gain : 0;
    }
    if (first + n >= this.end) {
      this.finish();
      return false;
    }
    return true;
  }
}
registerProcessor("canonical-programme-print", CanonicalPrint);

// Same soft-knee-v1 function/constants as the portable mixer. Evaluating the
// function avoids WaveShaper's Float32 table-index rounding in its linear region.
// The existing programme calibration/safety stage remains downstream unchanged.
// prettier-ignore
class CanonicalMaster extends AudioWorkletProcessor {
 process(inputs,outputs){const input=inputs[0],out=outputs[0];for(let c=0;c<out.length;c++)for(let i=0;i<out[c].length;i++){
 const x=input[c]?.[i]??input[0]?.[i]??0,a=Math.abs(x),span=.95-.8;out[c][i]=a<=.8?x:Math.sign(x)*(.8+span*(1-Math.exp(-(a-.8)/span)));}return true;}}
registerProcessor("canonical-shared-master", CanonicalMaster);
