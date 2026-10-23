export const MICROFADE = 0.004;
export const MASTER_MAX = 0.75;

// Same envelope/cleanup contract for live sequence, pads and offline arrangement.
export function createOneShotVoice(context, output, entry, when, velocity = 1) {
  if (
    !entry.buffer ||
    !Number.isFinite(velocity) ||
    velocity < 0 ||
    velocity > 1
  )
    throw new Error("Invalid one-shot");
  const source = context.createBufferSource(),
    gain = context.createGain();
  const trim = entry.stem.gainTrim * velocity,
    endTime = when + entry.buffer.duration;
  source.buffer = entry.buffer;
  source.loop = false;
  source.playbackRate.value = 1;
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(trim, when + 0.0006);
  gain.gain.setValueAtTime(trim, Math.max(when + 0.0006, endTime - MICROFADE));
  gain.gain.linearRampToValueAtTime(0, endTime);
  source.connect(gain);
  gain.connect(output);
  source.start(when);
  return {
    context,
    source,
    gain,
    id: entry.stem.id,
    when,
    phase: 0,
    ratio: 1,
    trim,
    endTime,
    envelope: [
      { time: when, value: 0 },
      { time: when + 0.0006, value: trim },
      { time: endTime - MICROFADE, value: trim },
      { time: endTime, value: 0 },
    ],
  };
}

// Both live and QA offline rendering use this sample/phase/gain contract.
export function createLoopVoice(
  context,
  output,
  entry,
  timing,
  when,
  phase = 0,
) {
  const source = context.createBufferSource();
  const gain = context.createGain();
  const ratio = entry.buffer.duration / timing.duration;
  source.buffer = entry.buffer;
  source.loop = true;
  source.loopStart = 0;
  source.loopEnd = entry.buffer.duration;
  // Correct only the <=2-sample decode rounding accepted by SampleBank.
  source.playbackRate.value = ratio;
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(entry.stem.gainTrim, when + MICROFADE);
  source.connect(gain);
  gain.connect(output);
  source.start(when, phase * ratio);
  return {
    context,
    source,
    gain,
    id: entry.stem.id,
    when,
    phase,
    ratio,
    trim: entry.stem.gainTrim,
    endTime: null,
    envelope: [
      { time: when, value: 0 },
      { time: when + MICROFADE, value: entry.stem.gainTrim },
    ],
  };
}

// The voice exclusively owns linear gain automation. AudioParam.value is not
// a reliable query for a future ramp, so retain its exact piecewise envelope.
export function gainValueAt(voice, time) {
  const points = voice.envelope;
  if (time < points[0].time) return 0;
  for (let i = 1; i < points.length; i++) {
    if (time < points[i].time) {
      const a = points[i - 1],
        b = points[i];
      return (
        a.value + ((b.value - a.value) * (time - a.time)) / (b.time - a.time)
      );
    }
  }
  return points.at(-1).value;
}

function holdGain(voice, requestedTime) {
  const time = Math.max(requestedTime, voice.context.currentTime);
  const value = gainValueAt(voice, time);
  const param = voice.gain.gain;
  if (typeof param.cancelAndHoldAtTime === "function") {
    try {
      param.cancelAndHoldAtTime(time);
    } catch {
      /* Use the linear-envelope fallback. */
    }
  }
  // Normalize from our owned envelope even after a native hold. Chromium can
  // replace a completed future attack endpoint when holding beyond that ramp;
  // restore the still-future prefix endpoints before the truncated endpoint.
  // This also supplies the missing/throwing-API fallback. A setValue alone
  // would erase the preceding ramp and create a step.
  param.cancelScheduledValues(time);
  for (const point of voice.envelope)
    if (point.time > voice.context.currentTime && point.time < time)
      param.linearRampToValueAtTime(point.value, point.time);
  param.linearRampToValueAtTime(value, time);
  const retained = voice.envelope.filter((point) => point.time < time);
  // Retain the segment crossing the current clock; older history is not needed.
  let first = 0;
  for (let i = 0; i < retained.length; i++)
    if (retained[i].time <= voice.context.currentTime) first = i;
  voice.envelope = [...retained.slice(first), { time, value }];
  return time;
}

function rampGain(voice, target, requestedTime, duration = MICROFADE) {
  const time = holdGain(voice, requestedTime);
  voice.gain.gain.linearRampToValueAtTime(target, time + duration);
  voice.envelope.push({ time: time + duration, value: target });
  return time + duration;
}

export function fadeOutVoice(voice, when, duration = MICROFADE) {
  voice.endTime = rampGain(voice, 0, when, duration);
}

export function cancelFade(voice, when) {
  rampGain(voice, voice.trim, when);
  voice.endTime = null;
}

export function disconnectVoice(voice) {
  voice.source.onended = null;
  try {
    voice.source.stop();
  } catch {
    /* Already ended. */
  }
  voice.source.disconnect();
  voice.gain.disconnect();
}
