import test from "node:test";
import assert from "node:assert/strict";
import { MicInput } from "../src/loop-station/mic-input.js";

class Track extends EventTarget {
  readyState = "live";
  stops = 0;
  stop() {
    this.stops++;
    this.readyState = "ended";
  }
  getSettings() {
    return {
      sampleRate: 44100,
      channelCount: 2,
      deviceId: "must-not-persist",
      groupId: "private",
    };
  }
}
const stream = () => {
  const track = new Track();
  return { track, getTracks: () => [track], getAudioTracks: () => [track] };
};
class Context extends EventTarget {
  state = "running";
  connections = 0;
  disconnections = 0;
  createMediaStreamSource() {
    return {
      connect: () => this.connections++,
      disconnect: () => this.disconnections++,
    };
  }
}
test("constructor/gesture refusal never requests mic or monitors; explicit enable retains negotiated non-identifying settings", async () => {
  const context = new Context(),
    s = stream();
  let calls = 0,
    active = false,
    constraints;
  const mic = new MicInput(context, {
    activation: () => active,
    supportedConstraints: () => ({ echoCancellation: true }),
    provider: async (c) => {
      calls++;
      constraints = c;
      return s;
    },
  });
  assert.equal(calls, 0);
  await assert.rejects(mic.enable());
  await assert.rejects(mic.enable({ userGesture: true }));
  assert.equal(calls, 0);
  active = true;
  assert.equal(await mic.enable({ userGesture: true }), true);
  assert.equal(calls, 1);
  assert.equal(context.connections, 0);
  assert.deepEqual(mic.settings, { sampleRate: 44100, channelCount: 2 });
  assert.deepEqual(constraints.audio.echoCancellation, { ideal: false });
  assert.equal(Object.hasOwn(constraints.audio, "noiseSuppression"), false);
  assert.equal(constraints.video, false);
  mic.connectCapture({ context });
  assert.equal(context.connections, 1);
  mic.close();
  assert.equal(s.track.stops, 1);
  assert.equal(context.disconnections, 1);
  assert.equal(mic.settings, null);
  assert.equal(mic.state, "closed");
});
test("pending permission after close releases late tracks without reviving closed owner", async () => {
  const context = new Context(),
    s = stream();
  let resolve;
  const mic = new MicInput(context, {
    activation: () => true,
    provider: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  const pending = mic.enable({ userGesture: true });
  mic.close();
  resolve(s);
  assert.equal(await pending, false);
  assert.equal(s.track.stops, 1);
  assert.equal(mic.state, "closed");
  assert.equal(context.connections, 0);
});
test("denied/unavailable are recoverable and disconnect/suspend stop actual owned tracks", async () => {
  for (const name of ["NotAllowedError", "NotFoundError"]) {
    const mic = new MicInput(new Context(), {
      activation: () => true,
      provider: async () => {
        throw Object.assign(Error(name), { name });
      },
    });
    assert.equal(await mic.enable({ userGesture: true }), false);
    assert.equal(
      mic.state,
      name === "NotAllowedError" ? "denied" : "unavailable",
    );
    mic.close();
  }
  for (const cause of ["ended", "suspended"]) {
    const context = new Context(),
      s = stream(),
      reasons = [];
    const mic = new MicInput(context, {
      activation: () => true,
      provider: async () => s,
      onRelease: (r) => reasons.push(r),
    });
    await mic.enable({ userGesture: true });
    if (cause === "ended") s.track.dispatchEvent(new Event("ended"));
    else {
      context.state = "suspended";
      context.dispatchEvent(new Event("statechange"));
    }
    assert.equal(s.track.stops, 1);
    assert.equal(mic.state, "off");
    assert.equal(reasons[0], cause === "ended" ? "inputLost" : "suspended");
    mic.close();
  }
});

test("unknown constraint support keeps defaults usable and a failing stop cannot leave another owned track active", async () => {
  const context = new Context(),
    first = new Track(),
    second = new Track();
  first.stop = () => {
    throw Error("simulated device stop error");
  };
  const s = {
    getTracks: () => [first, second],
    getAudioTracks: () => [first, second],
  };
  let request;
  const mic = new MicInput(context, {
    activation: () => true,
    supportedConstraints: () => {
      throw Error("capability lookup unavailable");
    },
    provider: async (constraints) => {
      request = constraints;
      return s;
    },
  });
  assert.equal(await mic.enable({ userGesture: true }), true);
  assert.deepEqual(request, { audio: {}, video: false });
  mic.close();
  assert.equal(second.stops, 1);
  assert.equal(mic.state, "closed");
});

test("cancel settles a still-pending grant immediately; a later grant cannot reconnect or keep tracks", async () => {
  const context = new Context(),
    s = stream();
  let grant;
  const mic = new MicInput(context, {
    activation: () => true,
    provider: () =>
      new Promise((r) => {
        grant = r;
      }),
  });
  const p = mic.enable({ userGesture: true });
  mic.release();
  assert.equal(
    await p,
    false,
    "does not wait for the browser permission response",
  );
  assert.equal(s.track.stops, 0);
  grant(s);
  await new Promise((r) => setImmediate(r));
  assert.equal(s.track.stops, 1);
  assert.equal(context.connections, 0);
});

test("denied can be explicitly retried; muted is visible and disconnect failure cannot keep a device active", async () => {
  const context = new Context(),
    s = stream();
  let calls = 0;
  context.createMediaStreamSource = () => ({
    connect() {},
    disconnect() {
      throw Error("removed native graph");
    },
  });
  const mic = new MicInput(context, {
    activation: () => true,
    provider: async () => {
      if (++calls === 1)
        throw Object.assign(Error("denied"), { name: "NotAllowedError" });
      return s;
    },
  });
  assert.equal(await mic.enable({ userGesture: true }), false);
  assert.equal(await mic.enable({ userGesture: true }), true);
  s.track.muted = true;
  s.track.dispatchEvent(new Event("mute"));
  assert.equal(mic.muted, true);
  s.track.muted = false;
  s.track.dispatchEvent(new Event("unmute"));
  assert.equal(mic.muted, false);
  mic.close();
  assert.equal(s.track.stops, 1);
  assert.equal(mic.state, "closed");
});
