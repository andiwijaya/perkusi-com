import { finite, fail } from "../project/instrument-contract.js";
import { frameTime, dampFrames } from "./frame-dsp.js";

export const INSTRUMENT_LEVEL = 0.25;
export const DAMP_SECONDS = 0.02;
// Full one-shot source at native rate; only an explicit damp changes its tail.
export function instrumentVoice(
  context,
  output,
  buffer,
  when,
  velocity = 1,
  { offset = 0, initialLevel = 1, release = () => {} } = {},
) {
  if (
    !buffer ||
    !finite(when, 0, Number.MAX_VALUE) ||
    !finite(velocity, Number.MIN_VALUE, 1) ||
    !finite(offset, 0, buffer.duration) ||
    !finite(initialLevel, 0, 1)
  )
    fail("invalidInstrumentVoice");
  when = frameTime(when, context.sampleRate);
  offset = frameTime(offset, context.sampleRate);
  const source = context.createBufferSource(),
    gain = context.createGain();
  const level = velocity * INSTRUMENT_LEVEL;
  // A scheduled set can fall just after the first source frame in native DSP.
  // The source must never inherit createGain's unity default before that event.
  gain.gain.value = level * initialLevel;
  source.buffer = buffer;
  source.loop = false;
  source.playbackRate.value = 1;
  gain.gain.setValueAtTime(level * initialLevel, when);
  source.connect(gain);
  gain.connect(output);
  let ended = false,
    dampAt = null;
  const finish = () => {
    if (ended) return;
    ended = true;
    source.onended = null;
    source.disconnect();
    gain.disconnect();
    try {
      source.buffer = null;
    } catch {
      /* Native source lifetime rules. */
    }
    release();
  };
  source.onended = finish;
  const voice = {
    source,
    gain,
    when,
    level,
    end: when + buffer.duration - offset,
    damp: (time) => {
      if (ended || (dampAt !== null && time >= dampAt)) return;
      dampAt = frameTime(Math.max(when, time), context.sampleRate);
      gain.gain.cancelScheduledValues(dampAt);
      gain.gain.setValueAtTime(level * initialLevel, dampAt);
      const end = dampAt + dampFrames(context.sampleRate) / context.sampleRate;
      gain.gain.linearRampToValueAtTime(0, end);
      voice.end = Math.min(voice.end, end);
      try {
        source.stop(voice.end);
      } catch {
        finish();
      }
    },
    stop: () => {
      if (ended) return;
      if (context.state === "closed") {
        finish();
        return;
      }
      if (when > context.currentTime) {
        gain.gain.cancelScheduledValues(0);
        gain.gain.setValueAtTime(0, 0);
        try {
          source.stop(context.currentTime);
        } catch {
          finish();
        }
      } else voice.damp(context.currentTime);
      // Keep the source pin until real onended. A suspended owner closes its
      // context and invokes disconnect only after native close resolves.
    },
    disconnect: finish,
  };
  try {
    source.start(when, offset);
  } catch (error) {
    finish();
    throw error;
  }
  return voice;
}
