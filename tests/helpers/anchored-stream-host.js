import assert from "node:assert/strict";
import { createAnchoredStreamProcessor } from "../../src/audio/experimental-anchored-stream/processor.mjs";
export const flush = () => new Promise(setImmediate);
// Deterministic native/message shim, not a browser/device qualification.
export function anchoredHost(
  rate = 48000,
  { holdAck = false, failClose = false } = {},
) {
  let processor,
    node,
    portClosed = false,
    terminated = false;
  const events = [],
    held = [],
    outbound = [],
    inbound = [],
    listeners = new Set(),
    modules = [];
  const context = {
    sampleRate: rate,
    currentTime: 0,
    state: "running",
    audioWorklet: {
      async addModule(url) {
        modules.push(String(url));
      },
    },
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn),
    async suspend() {
      context.state = "suspended";
      listeners.forEach((f) => f());
    },
    async resume() {
      if (context.state === "closed") throw Error("closed context");
      context.state = "running";
      listeners.forEach((f) => f());
    },
    async close() {
      if (context.failClose) throw Error("injected close failure");
      context.state = "closed";
      listeners.forEach((f) => f());
    },
    failClose,
  };
  const graphNode = () => ({
    context,
    gain: {
      value: 1,
      setValueAtTime(value) {
        this.value = value;
      },
    },
    connect() {},
    disconnect() {},
    port: { close() {} },
  });
  context.createGain = graphNode;
  context.createWaveShaper = graphNode;
  const deliver = (m) => {
    inbound.push(m);
    node?.port.onmessage?.({ data: m });
  };
  const C = createAnchoredStreamProcessor(
    class {
      constructor() {
        this.port = {
          postMessage(m) {
            const copy = structuredClone(m);
            if (holdAck && m.type === "armed") held.push(copy);
            else queueMicrotask(() => deliver(copy));
          },
          close() {
            portClosed = true;
          },
        };
      }
    },
    rate,
  );
  function construct(_context, name, options) {
    if (name === "canonical-shared-master") return graphNode();
    if (name !== "prototype-anchored-stream")
      throw Error("unexpected native worker " + name);
    node = {
      context,
      parameters: new Map([
        [
          "startGate",
          {
            automationRate: "a-rate",
            setValueAtTime(value, time) {
              events.push({ value, time, frame: Math.round(time * rate) });
            },
          },
        ],
      ]),
      connect() {},
      disconnect() {},
      port: {
        postMessage(m, transfer = []) {
          const data = structuredClone(m, { transfer });
          outbound.push(data);
          queueMicrotask(() => {
            if (!portClosed && !terminated)
              processor.port.onmessage?.({ data });
          });
        },
        close() {},
      },
    };
    processor = new C(options);
    return node;
  }
  return {
    context,
    events,
    held,
    outbound,
    inbound,
    modules,
    construct,
    get node() {
      return node;
    },
    get processor() {
      return processor;
    },
    get portClosed() {
      return portClosed;
    },
    releaseAck() {
      for (const m of held.splice(0)) deliver(m);
    },
    deliver,
    terminate() {
      terminated = true;
      node.onprocessorerror();
    },
    step(frame, n = 128) {
      assert.equal(context.state, "running");
      context.currentTime = frame / rate;
      const channels = [new Float32Array(n), new Float32Array(n)],
        event = events[0];
      const startGate = Float32Array.from({ length: n }, (_, i) =>
        event && frame + i >= event.frame ? 1 : 0,
      );
      const alive = processor.process([], [channels], { startGate });
      context.currentTime = (frame + n) / rate;
      return { channels, alive };
    },
  };
}
export function nativeFactory(host) {
  return class {
    constructor(context, name, options) {
      return host.construct(context, name, options);
    }
  };
}
