import { arrangementEvents, trackGain, stepTime } from "./sequencing.js";
import { compositionNote } from "./composition.js";
import { allMix } from "../project/composition-model.js";
import { fail } from "../project/instrument-contract.js";
import {
  f32,
  panMatrix,
  releaseFrames,
  shotEnvelope,
  renderYield,
} from "./frame-dsp.js";
import { throwIfCancelled } from "./wav.js";

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// One prefix per cycle, then its natural terminal continuation. No periodic fade
// or master reset: the nonlinear stage sees incoming tails and current strikes
// together. The bounded phase states preserve the original five-second clips.
export function legacyCycleGeometry(project, rate, periodFrames) {
  const expected = (project.chain.length * 4 * 60 * rate) / project.timing.bpm;
  if (
    !Number.isSafeInteger(periodFrames) ||
    periodFrames < 128 ||
    Math.abs(expected - periodFrames) > 1e-7 ||
    ![44100, 48000].includes(rate)
  )
    fail("legacyLoopClockUnsupported");
  const phases = project.clips.some((c) => c.enabled)
    ? (5 * rate) / gcd(periodFrames, 5 * rate)
    : 1;
  if (phases > 4) fail("legacyLoopClockUnsupported");
  return { periodFrames, phases, states: phases + 1 };
}

export async function renderLegacyCycles({
  context,
  project,
  bank,
  extras,
  rate,
  signal,
  periodFrames,
  yieldTask = renderYield,
  onProgress = () => {},
}) {
  const geometry = legacyCycleGeometry(project, rate, periodFrames),
    tracks = allMix(project),
    roles = [],
    release = releaseFrames(rate);
  for (const track of project.tracks)
    roles.push({
      track,
      voices: arrangementEvents(project)
        .filter((e) => e.role === track.role)
        .map((e) => ({
          entry: bank.get(e.role),
          start: Math.round(e.when * rate),
          velocity: e.velocity,
        })),
    });
  if (extras) {
    for (const clip of project.clips.filter((c) => c.enabled))
      roles.push({
        track: tracks.find((t) => t.role === "clip-" + clip.role),
        loop: extras.banks.loop(clip),
        voices: [],
      });
    const voices = [];
    for (let i = 0; i < project.chain.length * 16; i++) {
      const note = compositionNote(project, i);
      if (note)
        voices.push({
          entry: extras.banks.instrument.get(note.pitch),
          start: Math.round(
            stepTime(i, project.timing.bpm, project.timing.swing) * rate,
          ),
          velocity: note.velocity,
        });
    }
    roles.push({ track: tracks.find((t) => t.role === "bilah"), voices });
  }
  const active = roles.filter(
      (r) => trackGain(r.track, tracks) > 0 && (r.loop || r.voices.length),
    ),
    curve = Float32Array.from({ length: 65537 }, (_, i) => {
      const x = i / 32768 - 1,
        a = Math.abs(x);
      return a <= 0.7
        ? x
        : Math.sign(x) *
            (0.7 + 0.2 * (1 - (1 - Math.min(1, (a - 0.7) / 0.3)) ** 1.5));
    });
  const states = [];
  let maxPeak = 0,
    maxLogicalVoices = 0;
  for (let cycle = 0; cycle < geometry.states; cycle++) {
    throwIfCancelled(signal);
    const groups = active.map((role) => {
      const voices = [
        ...role.voices.map((v, i) => ({
          ...v,
          choke: role.voices[i + 1] ? role.voices[i + 1].start - v.start : null,
        })),
      ];
      // Choke belongs to the role (Bilah across pitches), not the buffer id.
      if (cycle > 0 && role.voices.length) {
        const v = role.voices.at(-1);
        voices.unshift({
          ...v,
          start: v.start - periodFrames,
          choke: periodFrames + role.voices[0].start - v.start,
        });
      }
      return { ...role, voices, gain: f32(trackGain(role.track, tracks)) };
    });
    let frames = periodFrames;
    const intervals = [];
    for (const role of groups) {
      if (role.loop) {
        frames = Math.max(frames, periodFrames + release);
        intervals.push([0, 1], [periodFrames + release, -1]);
      }
      for (const v of role.voices) {
        const end = Math.min(
          v.start + v.entry.buffer.length,
          v.choke === null ? Infinity : v.start + v.choke + release,
        );
        frames = Math.max(frames, end);
        if (end > Math.max(0, v.start))
          intervals.push([Math.max(0, v.start), 1], [end, -1]);
      }
    }
    intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let owned = 0;
    for (const [, delta] of intervals) {
      owned += delta;
      maxLogicalVoices = Math.max(maxLogicalVoices, owned);
    }
    if (maxLogicalVoices > 16) fail("voiceLimit");
    const buffer = context.createBuffer(2, frames, rate),
      channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
    for (const role of groups) {
      const list = role.loop
        ? [{ entry: role.loop, start: 0, velocity: 1, loop: true }]
        : role.voices;
      for (const v of list) {
        const b = v.entry.buffer,
          source = [
            b.getChannelData(0),
            b.getChannelData(b.numberOfChannels - 1),
          ],
          matrix = v.loop
            ? [
                role.track.pan === 0
                  ? 1
                  : f32(
                      Math.SQRT2 *
                        Math.cos(((role.track.pan + 1) * Math.PI) / 4),
                    ),
                0,
                0,
                role.track.pan === 0
                  ? 1
                  : f32(
                      Math.SQRT2 *
                        Math.sin(((role.track.pan + 1) * Math.PI) / 4),
                    ),
              ]
            : panMatrix(role.track.pan, b.numberOfChannels === 1),
          level = f32(v.entry.stem.gainTrim * v.velocity),
          end = v.loop
            ? periodFrames + release
            : Math.min(
                frames,
                v.start + b.length,
                v.choke === null ? Infinity : v.start + v.choke + release,
              );
        for (let block = Math.max(0, v.start); block < end; block += 65536) {
          throwIfCancelled(signal);
          for (let n = block; n < Math.min(end, block + 65536); n++) {
            const relative = n - v.start,
              absolute = cycle * periodFrames + n,
              envelope = v.loop
                ? f32(
                    Math.min(1, absolute / release) *
                      (n < periodFrames
                        ? 1
                        : Math.max(0, 1 - (n - periodFrames) / release)),
                  )
                : shotEnvelope(relative, b.length, rate, v.choke),
              at = v.loop
                ? ((absolute * b.length) / (5 * rate)) % b.length
                : relative,
              index = Math.floor(at),
              fraction = at - index,
              next = (index + 1) % b.length,
              left = f32(
                f32(
                  f32(
                    source[0][index] +
                      fraction * (source[0][next] - source[0][index]),
                  ) * f32(level * envelope),
                ) * role.gain,
              ),
              right = f32(
                f32(
                  f32(
                    source[1][index] +
                      fraction * (source[1][next] - source[1][index]),
                  ) * f32(level * envelope),
                ) * role.gain,
              );
            channels[0][n] = f32(
              channels[0][n] +
                f32(f32(left * matrix[0]) + f32(right * matrix[1])),
            );
            channels[1][n] = f32(
              channels[1][n] +
                f32(f32(left * matrix[2]) + f32(right * matrix[3])),
            );
          }
          await yieldTask();
          throwIfCancelled(signal);
        }
      }
    }
    for (let block = 0; block < frames; block += 65536) {
      throwIfCancelled(signal);
      for (let n = block; n < Math.min(frames, block + 65536); n++)
        for (let c = 0; c < 2; c++) {
          const x = Math.max(
              -1,
              Math.min(
                1,
                f32(f32(channels[c][n] * f32(project.master.volume)) * 3),
              ),
            ),
            position = (x + 1) * 32768,
            i = Math.min(65535, Math.floor(position)),
            value = f32(curve[i] + (position - i) * (curve[i + 1] - curve[i]));
          if (!Number.isFinite(value) || Math.abs(value) > 0.950001)
            fail("unsafeOutput");
          channels[c][n] = value;
          maxPeak = Math.max(maxPeak, Math.abs(value));
        }
      onProgress({
        phase: "rendering",
        value:
          (cycle + Math.min(1, (block + 65536) / frames)) / geometry.states,
      });
      await yieldTask();
      throwIfCancelled(signal);
    }
    states.push({ buffer, frames });
  }
  return {
    ...geometry,
    states,
    peak: maxPeak,
    maxLogicalVoices,
    frames: Math.max(...states.map((s) => s.frames)),
    bytes: states.reduce((n, s) => n + s.frames * 16, 0) + 4096,
  };
}
