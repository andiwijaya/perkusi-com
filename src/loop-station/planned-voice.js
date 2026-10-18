import { instrumentVoice } from "../audio/instrument-voice.js";

// One native source/gain/pan/damping recipe, used by the live scheduler and the
// bounded offline program. Caller holds the immutable prepared buffer until end.
export function startPlannedVoice(
  context,
  destination,
  spec,
  when,
  from,
  memory,
  onRelease = () => {},
) {
  const lease = memory.reserve(8192, "loop-event-voice/group-pan");
  let gain,
    pan,
    voice,
    released = false;
  const release = () => {
    if (released) return;
    released = true;
    gain?.disconnect();
    pan?.disconnect();
    lease.release();
    onRelease();
  };
  try {
    gain = context.createGain();
    gain.gain.value = spec.scale;
    if (spec.pan !== 0) {
      pan = context.createStereoPanner();
      pan.pan.value = spec.pan;
      gain.connect(pan);
      pan.connect(destination);
    } else gain.connect(destination);
    const initial =
      spec.dampFrame !== null && from > spec.dampFrame
        ? Math.max(
            0,
            1 - (from - spec.dampFrame) / Math.round(0.02 * context.sampleRate),
          )
        : 1;
    voice = instrumentVoice(context, gain, spec.buffer, when, spec.velocity, {
      offset:
        (spec.loopFrames
          ? (((from - spec.startFrame + (spec.phaseOffsetFrames ?? 0)) %
              spec.loopFrames) +
              spec.loopFrames) %
            spec.loopFrames
          : from - spec.startFrame) / context.sampleRate,
      initialLevel: initial,
      release,
      loopFrames: spec.loopFrames ?? null,
    });
    if (spec.dampFrame !== null) {
      if (from <= spec.dampFrame)
        voice.damp(when + (spec.dampFrame - from) / context.sampleRate);
      else {
        const end = when + (spec.endFrame - from) / context.sampleRate;
        voice.gain.gain.linearRampToValueAtTime(0, end);
        voice.source.stop(end);
      }
    }
    if (spec.stopFrame !== undefined) {
      voice.end = Math.min(
        voice.end,
        when + (spec.stopFrame - from) / context.sampleRate,
      );
      voice.source.stop(voice.end);
    }
    return voice;
  } catch (e) {
    if (voice) voice.stop();
    else release();
    throw e;
  }
}
