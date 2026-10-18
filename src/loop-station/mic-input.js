import { fail } from "../project/instrument-contract.js";

const stopStream = (stream) => {
  for (const track of stream?.getTracks?.() ?? []) {
    try {
      track.stop();
    } catch {
      /* Release all remaining tracks too. */
    }
  }
};

// Deliberate enable only; no constructor side effects, monitoring or telemetry.
export class MicInput {
  #context;
  #provider;
  #activation;
  #supported;
  #stream = null;
  #source = null;
  #epoch = 0;
  #closed = false;
  #clean = [];
  #notify;
  #cancelRequest = null;
  constructor(
    context,
    {
      provider = (constraints) =>
        navigator.mediaDevices.getUserMedia(constraints),
      activation = () => navigator.userActivation?.isActive === true,
      supportedConstraints = () =>
        navigator.mediaDevices?.getSupportedConstraints?.() ?? {},
      onRelease = () => {},
    } = {},
  ) {
    this.#context = context;
    this.#provider = provider;
    this.#activation = activation;
    this.#supported = supportedConstraints;
    this.#notify = onRelease;
    this.state = "off";
    this.settings = null;
    this.muted = false;
  }
  async enable({ userGesture = false } = {}) {
    if (this.#closed) fail("micClosed");
    if (!userGesture || !this.#activation()) fail("micGestureRequired");
    if (["requesting", "ready"].includes(this.state)) fail("micAlreadyActive");
    if (typeof this.#provider !== "function") {
      this.state = "unavailable";
      return false;
    }
    const epoch = ++this.#epoch;
    this.state = "requesting";
    let stream;
    try {
      let supported = {};
      try {
        supported = this.#supported() ?? {};
      } catch {
        /* Unknown capabilities use browser defaults, not exact constraints. */
      }
      const audio = Object.fromEntries(
        ["echoCancellation", "noiseSuppression", "autoGainControl"]
          .filter((key) => supported[key] === true)
          .map((key) => [key, { ideal: false }]),
      );
      const supplied = Promise.resolve(
        this.#provider({ audio, video: false }),
      ).then((value) => {
        if (epoch !== this.#epoch || this.#closed) {
          stopStream(value);
          return null;
        }
        return value;
      });
      stream = await Promise.race([
        supplied,
        new Promise((resolve) => {
          this.#cancelRequest = () => resolve(null);
        }),
      ]);
      if (epoch === this.#epoch) this.#cancelRequest = null;
      if (epoch !== this.#epoch || this.#closed) {
        stopStream(stream);
        return false;
      }
      const tracks = stream.getAudioTracks();
      if (!tracks.length || tracks.some((t) => t.readyState !== "live"))
        fail("micNoLiveInput");
      this.#source = this.#context.createMediaStreamSource(stream);
      this.#stream = stream;
      // Do not persist/export unique device IDs or labels.
      const negotiated = tracks[0].getSettings?.() ?? {};
      this.settings = Object.freeze(
        Object.fromEntries(
          [
            "sampleRate",
            "channelCount",
            "echoCancellation",
            "noiseSuppression",
            "autoGainControl",
          ]
            .filter((k) => Object.hasOwn(negotiated, k))
            .map((k) => [k, negotiated[k]]),
        ),
      );
      const ended = () => this.release("inputLost");
      const state = () => {
        if (this.#context.state !== "running")
          this.release(
            this.#context.state === "closed" ? "closed" : "suspended",
          );
      };
      for (const track of tracks) {
        track.addEventListener("ended", ended);
        this.#clean.push(() => track.removeEventListener("ended", ended));
        const muted = () => {
          this.muted = tracks.some((t) => t.muted === true);
        };
        for (const event of ["mute", "unmute"]) {
          track.addEventListener(event, muted);
          this.#clean.push(() => track.removeEventListener(event, muted));
        }
        muted();
      }
      this.#context.addEventListener("statechange", state);
      this.#clean.push(() =>
        this.#context.removeEventListener("statechange", state),
      );
      this.state = "ready";
      if (this.#context.state !== "running") state();
      return this.state === "ready";
    } catch (error) {
      stopStream(stream);
      if (epoch !== this.#epoch || this.#closed) return false;
      this.#cancelRequest = null;
      for (const clean of this.#clean.splice(0)) clean();
      try {
        this.#source?.disconnect();
      } catch {
        /* Device release still wins. */
      }
      this.#source = null;
      this.#stream = null;
      this.state =
        error.name === "NotAllowedError"
          ? "denied"
          : ["NotSupportedError", "NotFoundError"].includes(error.name) ||
              error instanceof TypeError
            ? "unavailable"
            : "error";
      return false;
    }
  }
  connectCapture(node) {
    if (this.state !== "ready" || !node || node.context !== this.#context)
      fail("micNotReady");
    this.#source.connect(node);
  }
  release(reason = "userStop") {
    ++this.#epoch;
    this.#cancelRequest?.();
    this.#cancelRequest = null;
    for (const clean of this.#clean.splice(0)) clean();
    const stream = this.#stream;
    this.#stream = null;
    try {
      this.#source?.disconnect();
    } catch {
      /* Always stop every device track. */
    }
    this.#source = null;
    stopStream(stream);
    this.state = this.#closed ? "closed" : "off";
    this.settings = null;
    this.muted = false;
    try {
      this.#notify(reason);
    } catch {
      /* Ownership released before observer. */
    }
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.release("closed");
  }
}
