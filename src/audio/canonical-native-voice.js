import { fail } from "../project/instrument-contract.js";

// Keep ended readers connected at zero through the complete programme/EQ tail.
// They STILL own their node allowance and source pin: graph stability never
// grants an exemption from the actual16-owner limit.
export function canonicalNativeVoice(
  context,
  destination,
  spec,
  when,
  from,
  memory,
  onEnded,
) {
  const lease = memory.reserve(8192, "canonical/stable-native-voice"),
    nodes = [];
  let source = null,
    ended = false,
    released = false,
    started = false,
    fault = null,
    end = Infinity,
    stopAction = () => {};
  const keep = (n) => {
    nodes.push(n);
    return n;
  };
  const cleanup = () => {
    if (released) return;
    if (started && !ended && context.state !== "closed")
      fail("canonicalVoiceStillOwned");
    released = true;
    if (source) {
      source.onended = null;
      try {
        source.buffer = null;
      } catch {
        /* Some engines retain a started buffer setter. */
      }
    }
    for (const n of nodes) n.disconnect();
    source = null;
    nodes.length = 0;
    lease.release();
  };
  const voice = {
    get ended() {
      return ended;
    },
    get end() {
      return end;
    },
    get fault() {
      return fault;
    },
    stop() {
      if (!released) stopAction();
    },
    dispose: cleanup,
  };
  try {
    const scale = keep(context.createGain());
    scale.gain.value = spec.scale;
    if (spec.pan !== 0) {
      const pan = keep(context.createStereoPanner());
      pan.pan.value = spec.pan;
      scale.connect(pan);
      pan.connect(destination);
    } else scale.connect(destination);
    source = keep(context.createBufferSource());
    const gain = keep(context.createGain()),
      rate = context.sampleRate;
    const dampLength = Math.round(0.02 * rate),
      initial =
        spec.dampFrame !== null && from > spec.dampFrame
          ? Math.max(0, 1 - (from - spec.dampFrame) / dampLength)
          : 1,
      level = spec.velocity * 0.25;
    source.buffer = spec.buffer;
    source.playbackRate.value = 1;
    source.loop = spec.loopFrames !== undefined;
    if (source.loop) {
      source.loopStart = 0;
      source.loopEnd = spec.loopFrames / rate;
    }
    gain.gain.value = level * initial;
    gain.gain.setValueAtTime(level * initial, when);
    source.connect(gain);
    gain.connect(scale);
    end = when + (spec.endFrame - from) / rate;
    let stopAt = null;
    if (spec.dampFrame !== null) {
      const damp = when + Math.max(0, spec.dampFrame - from) / rate;
      if (from <= spec.dampFrame) gain.gain.setValueAtTime(level, damp);
      gain.gain.linearRampToValueAtTime(
        0,
        from <= spec.dampFrame
          ? when + (spec.dampFrame - from + dampLength) / rate
          : end,
      );
      stopAt = end;
    }
    if (spec.stopFrame !== undefined)
      stopAt = when + (spec.stopFrame - from) / rate;
    source.onended = () => {
      if (ended) return;
      ended = true;
      onEnded();
    };
    const offset = spec.loopFrames
      ? (((from - spec.startFrame + (spec.phaseOffsetFrames ?? 0)) %
          spec.loopFrames) +
          spec.loopFrames) %
        spec.loopFrames
      : from - spec.startFrame;
    stopAction = () => {
      if (ended) return;
      if (when > context.currentTime) {
        gain.gain.cancelScheduledValues(0);
        gain.gain.setValueAtTime(0, 0);
        end = context.currentTime;
        source.stop(end);
      } else {
        if (
          spec.dampFrame !== null &&
          context.currentTime >=
            when + Math.max(0, spec.dampFrame - from) / rate
        )
          return;
        const at = Math.max(when, context.currentTime);
        gain.gain.cancelScheduledValues(at);
        gain.gain.setValueAtTime(level * initial, at);
        end = Math.min(end, at + dampLength / rate);
        gain.gain.linearRampToValueAtTime(0, end);
        source.stop(end);
      }
    };
    source.start(when, offset / rate);
    started = true;
    if (stopAt !== null) source.stop(stopAt);
    return voice;
  } catch (e) {
    if (started) {
      fault = e;
      try {
        source.stop(context.currentTime);
      } catch {
        /* Keep ownership until ended/actual close. */
      }
      return voice;
    }
    cleanup();
    throw e;
  }
}
