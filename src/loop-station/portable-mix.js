import { eqGains, fxBytes, limiterEnabled, softLimit } from "./fx-model.js";
import { panMatrix } from "../audio/frame-dsp.js";
import { checkAbort } from "./recording-data.js";
import { fail } from "../project/instrument-contract.js";
import { SourceWindows, SOURCE_WINDOW_BYTES } from "./source-windows.js";

const f32 = Math.fround;
export function portableMixBytes(
  project,
  program,
  { boundedSourceViews = false } = {},
) {
  const buffers = new Set(program.events.map((e) => e.spec.buffer));
  return (
    4096 +
    8192 * project.tracks.length +
    fxBytes(project) +
    (boundedSourceViews
      ? SOURCE_WINDOW_BYTES
      : [...buffers].reduce((n, b) => n + b.length * b.numberOfChannels * 4, 0))
  );
}

// Browsers without OfflineAudioContext.suspend cannot incrementally create native
// sources. Evaluate the same fixed-frame voice/mix program in bounded chunks,
// with no future native voice preallocation, extra clock, stretch or normalization.
// Caller owns output/source-view/state accounting through complete job cleanup.
export async function renderPortableMix(
  context,
  project,
  program,
  {
    signal,
    analysisOnly = false,
    boundedSourceViews = false,
    onChunk = () => {},
    onProgress = () => {},
    yieldTask = () => new Promise((r) => setTimeout(r, 0)),
  } = {},
) {
  checkAbort(signal);
  const rate = program.rate,
    frames = program.frames,
    output = context.createBuffer(
      4,
      analysisOnly ? Math.min(2048, frames) : frames,
      rate,
    ),
    channels = Array.from({ length: 4 }, (_, c) => output.getChannelData(c)),
    views = new Map(),
    windows = boundedSourceViews ? new SourceWindows() : null,
    solo = project.tracks.some((t) => t.solo),
    tracks = project.tracks.map((t) => {
      const g = eqGains(t.eq);
      return {
        gain: f32(t.mute || (solo && !t.solo) ? 0 : t.gain),
        matrix: panMatrix(f32(t.pan)),
        g: [f32(g.high), f32(g.upper), f32(g.lower)],
        active: g.high !== 1 || g.upper !== 0 || g.lower !== 0,
        low: [0, 0],
        upper: [0, 0],
      };
    }),
    indices = new Map(project.tracks.map((t, i) => [t.id, i])),
    events = program.events
      .map((e) => {
        const b = e.spec.buffer;
        if (!boundedSourceViews && !views.has(b))
          views.set(
            b,
            Array.from({ length: b.numberOfChannels }, (_, c) =>
              b.getChannelData(c),
            ),
          );
        return {
          ...e.spec,
          track: indices.get(e.trackId),
          data: views.get(b),
          level: f32(e.spec.velocity * 0.25),
          scale: f32(e.spec.scale),
          matrix:
            e.spec.pan === 0
              ? [1, 0, 0, 1]
              : panMatrix(f32(e.spec.pan), b.numberOfChannels === 1),
        };
      })
      .sort((a, b) => a.startFrame - b.startFrame || a.track - b.track),
    inputs = new Float32Array(tracks.length * 2),
    a = Math.exp((-2 * Math.PI * 200) / rate),
    b = Math.exp((-2 * Math.PI * 3000) / rate),
    dampFrames = Math.round(0.02 * rate),
    master = f32(project.master.volume),
    curve = limiterEnabled(project.master)
      ? Float32Array.from({ length: 65537 }, (_, i) => softLimit(i / 32768 - 1))
      : null,
    active = [];
  let cursor = 0;
  for (let from = 0; from < frames; from += 2048) {
    checkAbort(signal);
    for (let f = from; f < Math.min(frames, from + 2048); f++) {
      for (let i = active.length - 1; i >= 0; i--)
        if (active[i].endFrame <= f) active.splice(i, 1);
      while (cursor < events.length && events[cursor].startFrame <= f) {
        const e = events[cursor++];
        if (e.endFrame > f) active.push(e);
      }
      if (active.length > 16) fail("voiceLimit");
      inputs.fill(0);
      for (const e of active) {
        const n = e.loopFrames
            ? (((f - e.startFrame + (e.phaseOffsetFrames ?? 0)) %
                e.loopFrames) +
                e.loopFrames) %
              e.loopFrames
            : f - e.startFrame,
          level =
            e.dampFrame !== null && f >= e.dampFrame
              ? f32(e.level * Math.max(0, 1 - (f - e.dampFrame) / dampFrames))
              : e.level,
          l = f32(
            f32(
              (windows ? windows.read(e.buffer, 0, n) : e.data[0][n]) * level,
            ) * e.scale,
          ),
          r = f32(
            f32(
              (windows
                ? windows.read(e.buffer, e.buffer.numberOfChannels - 1, n)
                : e.data[e.data.length - 1][n]) * level,
            ) * e.scale,
          ),
          m = e.matrix,
          i = e.track * 2;
        inputs[i] = f32(inputs[i] + f32(f32(l * m[0]) + f32(r * m[1])));
        inputs[i + 1] = f32(inputs[i + 1] + f32(f32(l * m[2]) + f32(r * m[3])));
      }
      let left = 0,
        right = 0;
      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i],
          g = t.g,
          m = t.matrix;
        let l = f32(inputs[i * 2] * t.gain),
          r = f32(inputs[i * 2 + 1] * t.gain);
        if (t.active) {
          t.low[0] = (1 - a) * l + a * t.low[0];
          t.upper[0] = (1 - b) * l + b * t.upper[0];
          t.low[1] = (1 - a) * r + a * t.low[1];
          t.upper[1] = (1 - b) * r + b * t.upper[1];
          l = f32(
            f32(f32(l * g[0]) + f32(f32(t.upper[0]) * g[1])) +
              f32(f32(t.low[0]) * g[2]),
          );
          r = f32(
            f32(f32(r * g[0]) + f32(f32(t.upper[1]) * g[1])) +
              f32(f32(t.low[1]) * g[2]),
          );
        }
        left = f32(left + f32(f32(l * m[0]) + f32(r * m[1])));
        right = f32(right + f32(f32(l * m[2]) + f32(r * m[3])));
      }
      left = f32(left * master);
      right = f32(right * master);
      const writeFrame = analysisOnly ? f - from : f;
      channels[2][writeFrame] = left;
      channels[3][writeFrame] = right;
      for (const [c, x] of [
        [0, left],
        [1, right],
      ]) {
        if (!Number.isFinite(x) || Math.abs(x) > 0.95) fail("unsafeOutput");
        if (curve) {
          const p = (x + 1) * 32768,
            i = Math.min(65535, Math.floor(p));
          channels[c][writeFrame] = f32(
            curve[i] + (p - i) * (curve[i + 1] - curve[i]),
          );
        } else channels[c][writeFrame] = x;
      }
    }
    if (analysisOnly)
      onChunk(
        channels.map((c) => c.subarray(0, Math.min(2048, frames - from))),
      );
    onProgress({
      phase: "rendering",
      value: Math.min(1, (from + 2048) / frames),
    });
    await yieldTask();
    checkAbort(signal);
  }
  return output;
}
