/* global AudioWorkletProcessor,sampleRate,registerProcessor */
import {
  frameClockDescriptors,
  nativeWorkletFrame,
} from "../audio/worklet-frame-clock.js";
import { FiniteRecordingProducer } from "./finite-reader-core.js";
import { FiniteGraphOutput } from "./finite-tail-core.js";
class FiniteReaderProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return frameClockDescriptors();
  }
  constructor(options) {
    super();
    if (options.processorOptions.identity.rate !== sampleRate)
      throw RangeError("finiteReaderRateMismatch");
    this.producer = new FiniteRecordingProducer(options.processorOptions);
    this.identity = this.producer.identity;
    this.closing = false;
    this.port.onmessage = ({ data }) => {
      if (data?.type === "cancel" && this.producer) this.producer.cancel(data);
    };
    this.port.postMessage({
      type: "ready",
      sequence: 0,
      identity: this.identity,
    });
  }
  process(_inputs, outputs, parameters) {
    for (const bus of outputs) for (const a of bus) a.fill(0);
    const frame = nativeWorkletFrame(parameters, outputs[0][0].length);
    if (frame === null) return true;
    if (this.closing) {
      const body = this.producer.close();
      this.producer = null;
      this.port.postMessage({
        type: "closed",
        sequence: 2,
        identity: this.identity,
        workerClosed: true,
        closedFrame: frame,
        body,
      });
      return false;
    }
    const result = this.producer.process(frame, outputs[0]);
    if (result) {
      this.closing = true;
      this.port.postMessage({
        type: result.reason === "complete" ? "body-complete" : "body-fault",
        sequence: 1,
        identity: this.identity,
        body: result,
      });
    }
    return true;
  }
}
registerProcessor("perkusi-finite-reader-v5", FiniteReaderProcessor);

class FiniteTailProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return frameClockDescriptors();
  }
  constructor(options) {
    super();
    if (options.processorOptions.identity.rate !== sampleRate)
      throw RangeError("finiteTailRateMismatch");
    this.writer = new FiniteGraphOutput(options.processorOptions.identity);
    this.identity = this.writer.identity;
    this.closing = false;
    this.port.onmessage = ({ data }) => {
      if (data?.type === "cancel" && this.writer) this.writer.cancel(data);
    };
    this.port.postMessage({
      type: "ready",
      sequence: 0,
      identity: this.identity,
    });
  }
  process(inputs, outputs, parameters) {
    for (const bus of outputs) for (const a of bus) a.fill(0);
    // A false return does not by itself terminate a processor with an active
    // native input. Retired writer state stays dropped until host disconnection.
    if (!this.writer) return false;
    const frame = nativeWorkletFrame(parameters, outputs[0][0].length);
    if (frame === null) return true;
    if (this.closing) {
      const body = this.writer.close();
      this.writer = null;
      this.port.postMessage({
        type: "closed",
        sequence: 2,
        identity: this.identity,
        workerClosed: true,
        closedFrame: frame,
        body,
      });
      return false;
    }
    const result = this.writer.process(frame, inputs[0], outputs[0]);
    if (result) {
      this.closing = true;
      this.port.postMessage({
        type: result.reason === "complete" ? "output-complete" : "output-fault",
        sequence: 1,
        identity: this.identity,
        body: result,
      });
    }
    return true;
  }
}
registerProcessor("perkusi-finite-tail-v5", FiniteTailProcessor);
