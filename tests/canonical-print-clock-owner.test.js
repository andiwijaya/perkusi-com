import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { AudioMemory } from "../src/audio/audio-memory.js";
import { installWorkletFrameClock } from "../src/audio/worklet-frame-clock.js";
import { fakeWorkletParams } from "./helpers/worklet-frame-clock.js";

// Actual owner/clock code with a modeled native port and branded-data boundary.
// These real, budgeted unit PCM arrays are not production assets or native DSP.
const ownerText = await readFile(
  new URL("../src/audio/canonical-print-voice.js", import.meta.url),
  "utf8",
);
for (const terminal of ["ended", "context-close"])
  for (const mode of ["host-fault", "stop-first", "disposed"])
    test(`long admitted print ${mode} retains ownership until ${terminal}`, async (t) => {
      const P = 1048576,
        rate = 48000,
        frames = 3 * P + 8192,
        memory = new AudioMemory(),
        foreign = memory.reserve(313, "foreign"),
        source = memory.reserve(frames * 8 + 4096, "test/immutable-print");
      const data = {
        rate,
        frames,
        channels: [new Float32Array(frames), new Float32Array(frames)],
      };
      data.channels[0][0] = 0.25;
      data.channels[1][frames - 1] = -0.125;
      const context = {
        sampleRate: rate,
        currentTime: (P - 4096) / rate,
        state: "running",
        audioWorklet: { addModule: async () => {} },
      };
      let node,
        callback,
        notified = 0,
        ended = 0;
      t.mock.method(globalThis, "setInterval", (fn) => {
        callback = fn;
        return { unref() {} };
      });
      t.mock.method(globalThis, "clearInterval", () => {});
      class NativeNode {
        parameters = fakeWorkletParams();
        messages = [];
        port = {
          postMessage: (d, transfer = []) =>
            this.messages.push(structuredClone(d, { transfer })),
          close: () => {
            this.port.closed = true;
          },
        };
        constructor() {
          node = this;
        }
        connect() {}
        disconnect() {}
      }
      const code = ownerText
        .replace(/^import .*;\r?\n/gm, "")
        .replace(
          "export async function installCanonicalPrintPlayer",
          "async function installCanonicalPrintPlayer",
        )
        .replace(
          /const processorURL = import\.meta\.env[\s\S]*?import\.meta\.resolve\("\.\/canonical-print-processor\.js"\);/,
          'const processorURL="unit-only-native-boundary";',
        );
      assert.ok(!code.includes("import.meta"));
      const install = runInNewContext(code + "\ninstallCanonicalPrintPlayer", {
        canonicalPrintData: () => data,
        fail: (code) => {
          throw Object.assign(Error(code), { code });
        },
        installWorkletFrameClock,
        AudioWorkletNode: NativeNode,
        Float32Array,
        Error,
        Math,
      });
      const factory = await install(context),
        errors = [];
      const voice = factory(
        {},
        { print: {}, frames },
        (P - 128) / rate,
        0,
        memory,
        () => ended++,
        (e) => {
          notified++;
          errors.push(e);
        },
      );
      t.after(() => {
        context.state = "closed";
        voice.dispose();
        source.release();
        foreign.release();
        assert.equal(memory.snapshot().bytes, 0);
      });
      assert.equal(typeof callback, "function");
      assert.equal(voice.fault, null);
      assert.ok(memory.snapshot().bytes < 67108864);
      const held = memory.snapshot().bytes;
      if (mode === "stop-first") voice.stop();
      if (mode === "disposed") {
        context.state = "closed";
        voice.dispose();
      }
      const error = Error("QAHostPrintClockFailure");
      node.parameters.get("framePhase").linearRampToValueAtTime = () => {
        throw error;
      };
      context.currentTime = (2 * P) / rate;
      callback();
      callback();
      assert.equal(notified, mode === "host-fault" ? 1 : 0);
      assert.equal(ended, 0);
      assert.equal(voice.fault, mode === "host-fault" ? error : null);
      if (mode === "host-fault") {
        assert.equal(errors[0], error);
        assert.ok(node.messages.some((m) => m.type === "stop"));
      }
      assert.equal(
        memory.snapshot().bytes,
        mode === "disposed" ? frames * 8 + 4096 + 313 : held,
      );
      if (mode !== "disposed") {
        assert.throws(
          () => voice.dispose(),
          (e) => e.code === "canonicalVoiceStillOwned",
        );
        if (terminal === "ended")
          node.port.onmessage({
            data: {
              type: "ended",
              fault: mode === "host-fault" ? "laterNativeFault" : null,
            },
          });
        else context.state = "closed";
        voice.dispose();
      }
      assert.equal(memory.snapshot().bytes, frames * 8 + 4096 + 313);
      assert.equal(voice.fault, mode === "host-fault" ? error : null);
      const events = node.parameters.get("framePhase").events.length;
      callback();
      assert.equal(node.parameters.get("framePhase").events.length, events);
      assert.equal(data.channels[0][0], 0.25);
      assert.equal(data.channels[1][frames - 1], -0.125);
      assert.equal(data.channels[0].byteLength, frames * 4);
    });
