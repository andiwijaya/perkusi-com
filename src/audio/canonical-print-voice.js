import { canonicalPrintData } from "./canonical-playback.js";
import { fail } from "../project/instrument-contract.js";

const processorURL = new URL(
  "./canonical-print-processor.js?no-inline",
  import.meta.url,
);
export async function installCanonicalPrintPlayer(context) {
  if (!context.audioWorklet) return null;
  await context.audioWorklet.addModule(processorURL.href);
  return (destination, spec, when, from, memory, onEnded) => {
    const data = canonicalPrintData(spec.print),
      rate = context.sampleRate;
    if (data.rate !== rate) fail("takeRateMismatch");
    const lease = memory.reserve(
      8192 + data.frames * 16,
      "canonical/print-worklet-node-and-clone",
    );
    let node = null,
      ended = false,
      released = false,
      fault = null,
      end = when + (data.frames - from) / rate;
    const voice = {
      get end() {
        return end;
      },
      get fault() {
        return fault;
      },
      stop() {
        if (ended || !node) return;
        const start = Math.round(context.currentTime * rate),
          finish =
            when > context.currentTime
              ? start
              : start + Math.round(0.02 * rate);
        end = Math.min(end, finish / rate);
        node.port.postMessage({
          type: "stop",
          start,
          end: Math.round(end * rate),
        });
      },
      dispose() {
        if (released) return;
        if (!ended && context.state !== "closed")
          fail("canonicalVoiceStillOwned");
        released = true;
        node?.disconnect();
        node?.port.close();
        lease.release();
      },
    };
    try {
      node = new AudioWorkletNode(context, "canonical-programme-print", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: {
          left: data.channels[0],
          right: data.channels[1],
          origin: Math.round(when * rate),
          from,
        },
      });
      node.port.onmessage = ({ data: message }) => {
        if (message.type === "ended" && !ended) {
          ended = true;
          onEnded();
        }
      };
      node.connect(destination);
      return voice;
    } catch (error) {
      if (!node) {
        lease.release();
        throw error;
      }
      fault = error;
      voice.stop();
      return voice;
    }
  };
}
