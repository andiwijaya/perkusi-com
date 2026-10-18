import { createOneShotVoice, fadeOutVoice } from "../audio/voice.js";

// Studio's exact one-shot envelope, with explicit owned native lifetime.
export function drumVoice(
  context,
  output,
  buffer,
  descriptor,
  when,
  velocity,
  release,
) {
  const v = createOneShotVoice(
    context,
    output,
    {
      buffer,
      stem: { id: descriptor.id, gainTrim: descriptor.gainTrim },
    },
    when,
    velocity,
  );
  let ended = false,
    dampAt = null;
  const naturalEnd = v.endTime;
  const finish = () => {
    if (ended) return;
    ended = true;
    v.source.onended = null;
    v.source.disconnect();
    v.gain.disconnect();
    try {
      v.source.buffer = null;
    } catch {
      /* Native lifetime. */
    }
    release();
  };
  v.source.onended = finish;
  const voice = {
    end: naturalEnd,
    damp: (time) => {
      if (ended || (dampAt !== null && time >= dampAt)) return;
      dampAt = Math.max(when, time);
      fadeOutVoice(v, dampAt);
      voice.end = Math.min(naturalEnd, v.endTime);
      v.source.stop(voice.end);
    },
    stop: (at = context.currentTime) => {
      if (ended) return;
      if (context.state === "closed") return finish();
      if (when > context.currentTime) {
        v.gain.gain.cancelScheduledValues(0);
        v.gain.gain.setValueAtTime(0, 0);
        v.source.stop(context.currentTime);
      } else voice.damp(at);
    },
    disconnect: finish,
  };
  return voice;
}
