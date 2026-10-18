import { finite, fail } from "../project/instrument-contract.js";
import { frameTime, dampFrames } from "./frame-dsp.js";

export const INSTRUMENT_LEVEL = 0.25;
export const DAMP_SECONDS = 0.02;
// Native-rate source; an internal complete recorded period may opt into looping.
// Ordinary instrument tails still change only through explicit damping.
export function instrumentVoice(
  context,
  output,
  buffer,
  when,
  velocity = 1,
  {
    offset = 0,
    initialLevel = 1,
    release = () => {},
    loopFrames = null,
    releaseSeconds = DAMP_SECONDS,
  } = {},
) {
  if (
    !buffer ||
    !finite(when, 0, Number.MAX_VALUE) ||
    !finite(velocity, Number.MIN_VALUE, 1) ||
    !finite(offset, 0, buffer.duration) ||
    !finite(initialLevel, 0, 1) ||
    !finite(releaseSeconds, DAMP_SECONDS, 1.5) ||
    (loopFrames !== null &&
      (!Number.isSafeInteger(loopFrames) ||
        loopFrames < 128 ||
        loopFrames !== buffer.length ||
        buffer.sampleRate !== context.sampleRate ||
        offset >= buffer.duration))
  )
    fail("invalidInstrumentVoice");
  when = frameTime(when, context.sampleRate);
  offset = frameTime(offset, context.sampleRate);
  if (
    loopFrames !== null &&
    Math.round(offset * context.sampleRate) >= loopFrames
  )
    fail("invalidInstrumentVoice");
  const source = context.createBufferSource(),
    gain = context.createGain();
  const level = velocity * INSTRUMENT_LEVEL;
  // A scheduled set can fall just after the first source frame in native DSP.
  // The source must never inherit createGain's unity default before that event.
  gain.gain.value = level * initialLevel;
  source.buffer = buffer;
  source.loop = loopFrames !== null;
  if (source.loop) {
    source.loopStart = 0;
    source.loopEnd = loopFrames / context.sampleRate;
  }
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
    end: loopFrames === null ? when + buffer.duration - offset : Infinity,
    damp: (time) => {
      if (ended || (dampAt !== null && time >= dampAt)) return;
      dampAt = frameTime(Math.max(when, time), context.sampleRate);
      gain.gain.cancelScheduledValues(dampAt);
      gain.gain.setValueAtTime(level * initialLevel, dampAt);
      const end =
        dampAt +
        (releaseSeconds === DAMP_SECONDS
          ? dampFrames(context.sampleRate)
          : Math.round(releaseSeconds * context.sampleRate)) /
          context.sampleRate;
      gain.gain.linearRampToValueAtTime(0, end);
      voice.end = Math.min(voice.end, end);
      try {
        source.stop(voice.end);
      } catch {
        finish();
      }
    },
    stop: (at = context.currentTime) => {
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
      } else voice.damp(at);
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
