import { arrangementEvents, stepTime, trackGain } from "./sequencing.js";
import { compositionNote } from "./composition.js";
import { allMix } from "../project/composition-model.js";
import {
  f32,
  shotEnvelope,
  panMatrix,
  releaseFrames,
  renderYield,
} from "./frame-dsp.js";
import { throwIfCancelled } from "./wav.js";

export async function canonicalLegacyRender({
  context,
  project,
  bank,
  extras,
  rate,
  signal,
  yieldTask = renderYield,
  onProgress = () => {},
}) {
  const frames = Math.round(
    ((project.chain.length * 4 * 60) / project.timing.bpm) * rate,
  );
  const buffer =
    typeof context.createBuffer === "function"
      ? context.createBuffer(2, frames, rate)
      : null;
  const channels = buffer
    ? [buffer.getChannelData(0), buffer.getChannelData(1)]
    : [new Float32Array(frames), new Float32Array(frames)];
  const tracks = allMix(project),
    roles = [];
  for (const t of project.tracks)
    roles.push({
      track: t,
      voices: arrangementEvents(project)
        .filter((e) => e.role === t.role)
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
        clip: true,
        voices: [
          { entry: extras.banks.loop(clip), start: 0, velocity: 1, loop: true },
        ],
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
  // Order is declared by the validated track array, then clip array, then Bilah.
  // Accumulate every voice sequentially; native multi-input reductions disappear.
  for (const role of roles) {
    const gain = f32(trackGain(role.track, tracks));
    if (!gain) continue;
    for (let j = 0; j < role.voices.length; j++) {
      const v = role.voices[j],
        b = v.entry.buffer,
        source = [
          b.getChannelData(0),
          b.getChannelData(b.numberOfChannels - 1),
        ];
      const matrix = role.clip
        ? [
            role.track.pan === 0
              ? 1
              : f32(
                  Math.SQRT2 * Math.cos(((role.track.pan + 1) * Math.PI) / 4),
                ),
            0,
            0,
            role.track.pan === 0
              ? 1
              : f32(
                  Math.SQRT2 * Math.sin(((role.track.pan + 1) * Math.PI) / 4),
                ),
          ]
        : panMatrix(role.track.pan, b.numberOfChannels === 1);
      const level = f32(v.entry.stem.gainTrim * v.velocity);
      const choke =
        !v.loop && role.voices[j + 1]
          ? role.voices[j + 1].start - v.start
          : null;
      const stop = v.loop
        ? frames
        : Math.min(
            frames,
            v.start + b.length,
            choke !== null ? v.start + choke + releaseFrames(rate) : Infinity,
          );
      for (let block = v.start; block < stop; block += 65536) {
        throwIfCancelled(signal);
        for (let n = block; n < Math.min(stop, block + 65536); n++) {
          const relative = n - v.start;
          const envelope = v.loop
            ? f32(Math.min(1, relative / releaseFrames(rate)))
            : shotEnvelope(relative, b.length, rate, choke);
          let at = v.loop
            ? ((relative * b.length) / (5 * rate)) % b.length
            : relative;
          const index = Math.floor(at),
            fraction = at - index;
          const next = (index + 1) % b.length;
          const sampleL = f32(
            source[0][index] + fraction * (source[0][next] - source[0][index]),
          );
          const sampleR = f32(
            source[1][index] + fraction * (source[1][next] - source[1][index]),
          );
          const voiceGain = f32(level * envelope),
            left = f32(f32(sampleL * voiceGain) * gain),
            right = f32(f32(sampleR * voiceGain) * gain);
          const a = f32(f32(left * matrix[0]) + f32(right * matrix[1]));
          const pannedRight = f32(
            f32(left * matrix[2]) + f32(right * matrix[3]),
          );
          channels[0][n] = f32(channels[0][n] + a);
          channels[1][n] = f32(channels[1][n] + pannedRight);
        }
        await yieldTask();
        throwIfCancelled(signal);
      }
    }
  }
  // The exact existing65537-point legacy curve, with declared scalar lookup.
  const curve = Float32Array.from({ length: 65537 }, (_, i) => {
    const x = i / 32768 - 1,
      a = Math.abs(x);
    return a <= 0.7
      ? x
      : Math.sign(x) *
          (0.7 + 0.2 * (1 - (1 - Math.min(1, (a - 0.7) / 0.3)) ** 1.5));
  });
  for (let block = 0; block < frames; block += 65536) {
    throwIfCancelled(signal);
    for (let n = block; n < Math.min(frames, block + 65536); n++) {
      const master = f32(
        project.master.volume * Math.min(1, (frames - n) / releaseFrames(rate)),
      );
      for (let c = 0; c < 2; c++) {
        const x = Math.max(
            -1,
            Math.min(1, f32(f32(channels[c][n] * master) * 3)),
          ),
          position = (x + 1) * 32768;
        const i = Math.min(65535, Math.floor(position));
        channels[c][n] = f32(
          curve[i] + (position - i) * (curve[i + 1] - curve[i]),
        );
      }
    }
    onProgress({
      phase: "rendering",
      value: Math.min(frames, block + 65536) / frames,
    });
    await yieldTask();
    throwIfCancelled(signal);
  }
  return (
    buffer ?? {
      length: frames,
      sampleRate: rate,
      numberOfChannels: 2,
      duration: frames / rate,
      getChannelData: (c) => channels[c],
    }
  );
}
