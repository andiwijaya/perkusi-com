/* global AudioWorkletProcessor, registerProcessor, sampleRate */
import { createAnchoredStreamProcessor } from "./processor.mjs";
registerProcessor(
  "prototype-anchored-stream",
  createAnchoredStreamProcessor(AudioWorkletProcessor, sampleRate),
);
