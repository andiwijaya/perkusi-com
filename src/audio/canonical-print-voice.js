import { canonicalPrintData } from "./canonical-playback.js";
import { fail } from "../project/instrument-contract.js";
import { installWorkletFrameClock } from "./worklet-frame-clock.js";
export async function installCanonicalPrintPlayer(context) {
  if (!context.audioWorklet) return null;
  // Vite bundles the processor's imports as a separate same-origin worker
  // asset. Node unit hosts can import this owner without executing a worklet.
  const processorURL = import.meta.env
    ? (await import("./canonical-print-processor.js?worker&url")).default
    : import.meta.resolve("./canonical-print-processor.js");
  await context.audioWorklet.addModule(processorURL);
  const createVoice = (
    destination,
    spec,
    when,
    from,
    memory,
    onEnded,
    onFault,
  ) => {
    const data = canonicalPrintData(spec.print),
      rate = context.sampleRate;
    if (data.rate !== rate) fail("takeRateMismatch");
    const lease = memory.reserve(
      8192 + 4096 + data.frames * 8,
      "canonical/print-worklet-node-and-transferred-stereo-copy",
    );
    let node = null,
      frameClock = null,
      ended = false,
      released = false,
      stopping = false,
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
        if (ended || !node || stopping) return;
        stopping = true;
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
        frameClock?.dispose();
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
          frames: data.frames,
          origin: Math.round(when * rate),
          from,
        },
      });
      node.port.onmessage = ({ data: message }) => {
        if (message.type === "ended" && !ended) {
          if (message.fault)
            fault ??= Object.assign(Error(message.fault), {
              code: message.fault,
            });
          ended = true;
          onEnded();
        }
      };
      frameClock = installWorkletFrameClock(
        node,
        context,
        Math.round(when * rate),
        Math.round(end * rate),
        (error) => {
          if (ended || released || stopping) return;
          fault ??= error;
          voice.stop();
          onFault?.(fault);
        },
      );
      // One real stereo copy is transferred, never structured-cloned a second
      // time. The immutable score's channels remain attached and unchanged.
      const left = new Float32Array(data.channels[0]),
        right = new Float32Array(data.channels[1]);
      node.port.postMessage({ type: "load", left, right }, [
        left.buffer,
        right.buffer,
      ]);
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
  createVoice.createMaster = (memory, onFault) => {
    const held = memory.reserve(16384, "canonical/shared-master-worklet-node");
    let node,
      closed = false;
    try {
      node = new AudioWorkletNode(context, "canonical-shared-master", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
      });
      node.onprocessorerror = () =>
        onFault(
          Object.assign(Error("canonicalMasterFault"), {
            code: "canonicalMasterFault",
          }),
        );
      return {
        input: node,
        output: node,
        dispose() {
          if (closed) return;
          closed = true;
          node.onprocessorerror = null;
          node.disconnect();
          node.port.close();
          held.release();
        },
      };
    } catch (e) {
      node?.disconnect();
      held.release();
      throw e;
    }
  };
  return createVoice;
}
