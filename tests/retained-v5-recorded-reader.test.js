// Retained shared/data assertions extracted before failed-feature retirement.
import test from "node:test";
import assert from "node:assert/strict";
import { instrumentVoice } from "../src/audio/instrument-voice.js";

const code = (value) => (e) => e.code === value;

const param = () => ({
  value: 1,
  calls: [],
  setValueAtTime(v, t) {
    this.calls.push(["set", v, t]);
    this.value = v;
  },
  linearRampToValueAtTime(v, t) {
    this.calls.push(["ramp", v, t]);
    this.value = v;
  },
  cancelScheduledValues(t) {
    this.calls.push(["cancel", t]);
  },
});

class FakeNode {
  constructor(context) {
    this.context = context;
    this.gain = param();
    this.pan = param();
    this.playbackRate = param();
    this.connections = new Set();
    this.stopCalls = [];
    this.disconnections = 0;
  }
  connect(n) {
    this.connections.add(n);
  }
  disconnect() {
    this.connections.clear();
    this.disconnections++;
  }
  start(when, offset = 0) {
    this.when = when;
    this.offset = offset;
    this.initialBuffer = this.buffer;
    this.nativeEnd = this.loop
      ? Infinity
      : when + this.buffer.duration - offset;
    if (this.context.failStart) throw Error("injected source.start failure");
  }
  stop(time = this.context.currentTime) {
    this.stopCalls.push(time);
    this.nativeEnd = Math.min(this.nativeEnd ?? Infinity, time);
  }
  end() {
    this.ended = true;
    this.onended?.();
  }
}

class FakeContext extends EventTarget {
  state = "running";
  currentTime = 0;
  sources = [];
  constructor(rate) {
    super();
    this.sampleRate = rate;
  }
  createGain() {
    return new FakeNode(this);
  }
  createStereoPanner() {
    return new FakeNode(this);
  }
  createBufferSource() {
    const n = new FakeNode(this);
    this.sources.push(n);
    return n;
  }
  advance(time) {
    this.currentTime = time;
    for (const s of this.sources)
      if (!s.ended && !this.holdEnded && s.nativeEnd <= time) s.end();
  }
  confirmClosed() {
    this.state = "closed";
    this.dispatchEvent(new Event("statechange"));
  }
}

test("ordinary instrumentVoice rejects invalid loop geometry before allocating a source", () => {
  const context = new FakeContext(48000),
    buffer = {
      length: 128,
      sampleRate: 48000,
      numberOfChannels: 2,
      duration: 128 / 48000,
    };
  assert.throws(
    () =>
      instrumentVoice(context, context.createGain(), buffer, 0.1, 1, {
        loopFrames: 127,
      }),
    code("invalidInstrumentVoice"),
  );
  assert.throws(
    () =>
      instrumentVoice(context, context.createGain(), buffer, 0.1, 1, {
        loopFrames: 128,
        offset: buffer.duration - 1e-16,
      }),
    code("invalidInstrumentVoice"),
  );
  assert.equal(context.sources.length, 0);
});
