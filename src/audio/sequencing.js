import { secondsPerBeat } from "./transport.js";
import { createOneShotVoice, fadeOutVoice } from "./voice.js";

export function stepBeat(index, swing) {
  return index / 4 + (index % 2 ? swing / 4 : 0);
}
// Inverse of the same monotonic grid used by live scheduling and WAV export.
// An odd step remains in the future between its straight and swung boundaries.
export function stepIndexAtBeat(beat, swing) {
  const index = Math.max(0, Math.floor(beat * 4));
  return stepBeat(index, swing) > beat ? index - 1 : index;
}
export function nextStepIndex(beat, swing) {
  const index = Math.max(0, Math.floor(beat * 4));
  return stepBeat(index, swing) < beat ? index + 1 : index;
}
export function stepTime(index, bpm, swing) {
  return stepBeat(index, swing) * secondsPerBeat(bpm);
}
export function sequenceEvents(project, index, arrangement = true) {
  const patternId = arrangement
    ? project.chain[Math.floor(index / 16) % project.chain.length]
    : project.activePattern;
  const pattern = project.patterns.find((p) => p.id === patternId),
    step = index % 16;
  return project.tracks
    .filter((t) => pattern.steps[t.role][step] > 0)
    .map((t) => ({
      role: t.role,
      velocity: pattern.steps[t.role][step],
      patternId,
      step,
    }));
}
export function trackGain(track, tracks) {
  return track.mute || (tracks.some((t) => t.solo) && !track.solo)
    ? 0
    : track.volume;
}
export function createTrackMixer(context, output, tracks) {
  const nodes = new Map(
    tracks.map((t) => {
      const gain = context.createGain(),
        pan = context.createStereoPanner();
      gain.connect(pan);
      pan.connect(output);
      return [t.role, { gain, pan }];
    }),
  );
  return {
    nodes,
    update(next, when = context.currentTime, immediate = false) {
      for (const t of next) {
        const n = nodes.get(t.role),
          value = trackGain(t, next);
        if (immediate) {
          n.gain.gain.value = value;
          n.pan.pan.value = t.pan;
        } else {
          n.gain.gain.setTargetAtTime(value, when, 0.004);
          n.pan.pan.setTargetAtTime(t.pan, when, 0.004);
        }
      }
    },
    dispose() {
      for (const n of nodes.values()) {
        n.gain.disconnect();
        n.pan.disconnect();
      }
      nodes.clear();
    },
    cancelFrom(when) {
      for (const n of nodes.values())
        for (const param of [n.gain.gain, n.pan.pan]) {
          try {
            param.cancelAndHoldAtTime?.(when);
          } catch {
            /* A new target follows cancellation. */
          }
          param.cancelScheduledValues(when);
        }
    },
  };
}
export function scheduleShot(
  context,
  mixer,
  entry,
  when,
  velocity,
  prior = null,
) {
  if (prior && prior.endTime > when && prior.when <= when)
    fadeOutVoice(prior, when);
  return createOneShotVoice(
    context,
    mixer.nodes.get(entry.stem.id).gain,
    entry,
    when,
    velocity,
  );
}
export function arrangementEvents(project) {
  const events = [];
  for (let i = 0; i < project.chain.length * 16; i++)
    for (const e of sequenceEvents(project, i))
      events.push({
        ...e,
        index: i,
        when: stepTime(i, project.timing.bpm, project.timing.swing),
      });
  return events;
}
